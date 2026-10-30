"use client";

/**
 * Live adapters for `workspaceTransfer.ts`. Reads use non-creating list
 * endpoints; scope calls go through the SDK (AGENTS.md) and only run against a
 * workspace that already exists, because the SDK get-or-creates its workspace
 * before every call.
 */
import { honcho, type HonchoClientOptions } from "./client";
import { getSdk } from "./sdk";
import { listAllScopes, listAllScopeSessions } from "./scopeListing";
import type { ApiWorkspace, Page } from "./types";
import type { ExportSource, ImportTarget, TargetState } from "./workspaceTransfer";

const PAGE_SIZE = 100;
/** 1,000,000 items per list at 100 per page; stop rather than spin forever. */
const MAX_PAGES = 10_000;

async function collect<T>(fetchPage: (page: number) => Promise<Page<T>>): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await fetchPage(page);
    items.push(...result.items);
    if (!result.items.length || !result.pages || page >= result.pages) return items;
  }
  throw new Error("List exceeded the export page limit.");
}

/** Find a workspace by id without get-or-create. */
export async function findWorkspace(opts: HonchoClientOptions, workspaceId: string): Promise<ApiWorkspace | null> {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await honcho.workspaces.list(opts, { page, size: PAGE_SIZE });
    const hit = result.items.find((workspace) => workspace.id === workspaceId);
    if (hit) return hit;
    if (!result.items.length || !result.pages || page >= result.pages) return null;
  }
  return null;
}

export function liveExportSource(opts: HonchoClientOptions, workspaceId: string, scopesAvailable: boolean): ExportSource {
  return {
    getWorkspace: () => findWorkspace(opts, workspaceId),
    listPeers: () => collect((page) => honcho.peers.list(opts, workspaceId, { page, size: PAGE_SIZE })),
    listSessions: () => collect((page) => honcho.sessions.list(opts, workspaceId, { page, size: PAGE_SIZE })),
    listSessionPeers: async (sessionId) =>
      (await collect((page) => honcho.sessions.peers(opts, workspaceId, sessionId, { page, size: PAGE_SIZE }))).map((peer) => peer.id),
    sessionPeerConfig: (sessionId, peerId) => honcho.sessions.peerConfig(opts, workspaceId, sessionId, peerId),
    listMessages: (sessionId) => collect((page) => honcho.sessions.messages(opts, workspaceId, sessionId, { page, size: PAGE_SIZE })),
    listConclusions: () => collect((page) => honcho.conclusions.list(opts, workspaceId, { page, size: PAGE_SIZE })),
    ...(scopesAvailable
      ? {
          listScopes: async () => {
            const scopes = await listAllScopes(getSdk(opts, workspaceId));
            return Promise.all(scopes.map(async (scope) => ({
              id: scope.id,
              metadata: scope.metadata ?? {},
              sessions: (await listAllScopeSessions(scope)).map((session) => session.id),
            })));
          },
        }
      : {}),
  };
}

/** Current target contents for planning and the pre-write drift check. */
export async function loadTargetState(
  opts: HonchoClientOptions,
  workspaceId: string,
  scopesAvailable: boolean,
): Promise<TargetState> {
  const workspace = await findWorkspace(opts, workspaceId);
  if (!workspace) {
    return { exists: false, peers: new Set(), sessions: new Set(), scopes: scopesAvailable ? new Set() : null };
  }
  const [peers, sessions, scopes] = await Promise.all([
    collect((page) => honcho.peers.list(opts, workspaceId, { page, size: PAGE_SIZE })),
    collect((page) => honcho.sessions.list(opts, workspaceId, { page, size: PAGE_SIZE })),
    scopesAvailable ? listAllScopes(getSdk(opts, workspaceId)).catch(() => null) : Promise.resolve(null),
  ]);
  return {
    exists: true,
    peers: new Set(peers.map((peer) => peer.id)),
    sessions: new Set(sessions.map((session) => session.id)),
    scopes: scopes ? new Set(scopes.map((scope) => scope.id)) : null,
  };
}

export function liveImportTarget(opts: HonchoClientOptions, workspaceId: string, scopesAvailable: boolean): ImportTarget {
  return {
    createWorkspace: async (body) => { await honcho.workspaces.create(opts, body); },
    createPeer: async (body) => { await honcho.peers.create(opts, workspaceId, body); },
    createSession: async (body) => { await honcho.sessions.create(opts, workspaceId, body); },
    ...(scopesAvailable
      ? {
          createScope: async (scopeId: string, metadata: Record<string, unknown>) => {
            await getSdk(opts, workspaceId).scope(scopeId, Object.keys(metadata).length ? { metadata } : undefined);
          },
          addSessionsToScope: async (scopeId: string, sessionIds: string[]) => {
            const scope = await getSdk(opts, workspaceId).getScope(scopeId);
            await scope.addSessions(sessionIds);
          },
        }
      : {}),
    addMessages: async (sessionId, messages) => (await honcho.sessions.addMessages(opts, workspaceId, sessionId, messages)).length,
    createConclusions: async (items) => (await honcho.conclusions.create(opts, workspaceId, items)).length,
  };
}
