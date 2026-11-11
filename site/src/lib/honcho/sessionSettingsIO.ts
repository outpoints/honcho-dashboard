import { honcho, type HonchoClientOptions } from "./client.ts";
import type { SessionMember, SessionSettingsIO } from "./sessionSettings.ts";

/** Members whose session flags are read. Sessions rarely have more than a few. */
export const MAX_SETTINGS_MEMBERS = 50;

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * Honcho reads and writes for one session's settings, all through the raw
 * client: the SDK's `session(id)` get-or-creates, which a settings screen must
 * never do. Writes still reach a get-or-create route, so `saveSessionSettings`
 * re-reads the session first.
 */
export function sessionSettingsIO(opts: HonchoClientOptions, workspaceId: string, sessionId: string): SessionSettingsIO {
  return {
    readSession: () => honcho.sessions.get(opts, workspaceId, sessionId),
    async readMembers() {
      const page = await honcho.sessions.peers(opts, workspaceId, sessionId, { page: 1, size: 100 });
      const items = Array.isArray(page?.items) ? page.items : [];
      const listed = items.slice(0, MAX_SETTINGS_MEMBERS);
      const members: SessionMember[] = await Promise.all(listed.map(async (peer) => {
        if (typeof peer?.id !== "string") throw new Error("Honcho returned a malformed session member.");
        const config = await honcho.sessions.peerConfig(opts, workspaceId, sessionId, peer.id);
        return {
          id: peer.id,
          peerObserveMe: bool(peer.configuration?.observe_me),
          observeMe: bool(config?.observe_me),
          observeOthers: bool(config?.observe_others),
        };
      }));
      const total = typeof page?.total === "number" ? page.total : items.length;
      return { members, truncated: items.length > listed.length || total > items.length };
    },
    writeSession: (configuration) => honcho.sessions.update(opts, workspaceId, sessionId, { configuration }),
    writeMember: (peerId, body) => honcho.sessions.setPeerConfig(opts, workspaceId, sessionId, peerId, body),
  };
}
