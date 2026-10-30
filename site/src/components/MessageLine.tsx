"use client";

import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from "react";
import { Button } from "@/components/atoms";
import { Icon } from "@/components/icons";
import { CitedByButton, CitingConclusionsPanel } from "@/components/CitingConclusions";
import { Markdown } from "@/components/Markdown";
import { useToast } from "@/components/toast";
import { snippetAround } from "@/lib/messageStream";
import { shortStamp } from "@/lib/sessionTranscript";
import { cn } from "@/lib/utils";

/**
 * A peer's type from its configuration (`observe_me`), or null when the
 * configuration does not say. Never guessed from the name.
 */
export type PeerKind = "user" | "agent" | null;

/** The fields a message line shows; both ApiMessage and the operator stream row fit. */
export interface LineMessage {
  id: string;
  peer_id: string;
  session_id: string;
  content: string;
  token_count: number;
  created_at: string;
}

/**
 * Column header for a list of message lines. `grid` must be the same template
 * the lines use. Sticks to the top of its scroll box, or the window.
 */
export function MessageLineHeader({ grid, tokensColumn = true }: { grid: string; tokensColumn?: boolean }) {
  return (
    <div
      aria-hidden
      data-transcript-header
      className={cn(
        grid,
        // A fixed height, so rows that stick below it (session dividers) know where.
        "hidden sm:grid sticky top-0 z-10 h-6 items-center px-3 bg-surface border-b border-border text-[9px] uppercase tracking-wider text-text-muted",
      )}
    >
      <span>PEER</span>
      <span>MESSAGE</span>
      {tokensColumn ? <span className="text-right">TOKENS</span> : null}
      <span className="text-right">TIME</span>
    </div>
  );
}

/**
 * One message on one line; selecting the line opens the whole message in
 * place, with its raw text and a copy action. Used by the Sessions transcript
 * and the Messages page.
 */
export function MessageLine({
  message,
  kind,
  grid,
  tokensColumn = true,
  repeatPeer = false,
  searchText = "",
  open: openProp,
  onOpenChange,
  className,
}: {
  message: LineMessage;
  kind: PeerKind;
  grid: string;
  /** Show tokens in their own column; otherwise the opened line names them. */
  tokensColumn?: boolean;
  /** The line above is from the same peer: the name steps back so turns stand out. */
  repeatPeer?: boolean;
  /** Active text search: a closed line previews the text around the first match. */
  searchText?: string;
  /**
   * Controlled open state, for lists that may remount a line (the Messages
   * page regroups lines as pages load). Without it the line keeps its own.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = (next: boolean) => (onOpenChange ? onOpenChange(next) : setOwnOpen(next));
  const bodyId = useId();
  const lineRef = useRef<HTMLLIElement | null>(null);
  const wasOpen = useRef(open);

  // A line opened near the bottom of a scroll box scrolls up into view, but
  // never past its own first line (long messages keep their start visible).
  // A line that mounts already open (after a remount) stays where it is.
  useEffect(() => {
    const opened = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opened) return;
    const line = lineRef.current;
    const box = line?.closest<HTMLElement>("[data-transcript-scroll]");
    if (!line || !box) return;
    const header = box.querySelector<HTMLElement>("[data-transcript-header]")?.offsetHeight ?? 0;
    const l = line.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const below = l.bottom - b.bottom;
    if (below <= 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollBy({ top: Math.min(below, l.top - b.top - header), behavior: reduce ? "auto" : "smooth" });
  }, [open]);

  const snippet = useMemo(() => snippetAround(message.content, searchText), [message.content, searchText]);
  const stamp = new Date(message.created_at);
  const fullStamp = Number.isNaN(stamp.getTime()) ? message.created_at : stamp.toLocaleString();

  // The whole line toggles, except links, buttons, and text selection.
  const onLineClick = (event: MouseEvent<HTMLLIElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("a, button")) return;
    if (window.getSelection()?.toString()) return;
    setOpen(!open);
  };

  return (
    <li
      ref={lineRef}
      data-message-id={message.id}
      onClick={onLineClick}
      className={cn(
        grid,
        "items-baseline px-3 py-1.5 border-b border-border last:border-b-0 cursor-pointer transition-colors duration-150",
        open ? "bg-border/20" : "hover:bg-border/20",
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 min-w-0 text-left text-[11px] text-text-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
      >
        <Icon name={open ? "chevron-down" : "chevron-right"} size={10} className="shrink-0 text-text-muted" />
        {/* A fixed slot keeps names aligned whether or not the type is known. */}
        <span className="w-2.5 shrink-0 flex justify-center" title={kind ? (kind === "agent" ? "agent (observe_me off)" : "user (observe_me on)") : undefined}>
          {kind ? <Icon name={kind === "agent" ? "bot" : "user"} size={10} className={kind === "agent" ? "text-purple-400" : "text-blue-400"} /> : null}
        </span>
        <span className="sr-only">{open ? "Hide" : "Show"} the whole message from </span>
        <span className={cn("truncate", repeatPeer && !open && "text-text-muted")} title={message.peer_id}>{message.peer_id}</span>
      </button>
      <div id={bodyId} className="order-3 col-span-2 sm:order-none sm:col-span-1 min-w-0">
        {open ? (
          <OpenMessage message={message} fullStamp={fullStamp} tokensColumn={tokensColumn} />
        ) : (
          <span className="block max-w-[140ch] truncate text-xs text-text-primary">
            {snippet ? snippet : <Markdown inline text={message.content} />}
          </span>
        )}
      </div>
      {tokensColumn ? <span className="hidden sm:block text-right text-[10px] text-text-muted tabular-nums">{message.token_count}</span> : null}
      <span className="text-right text-[10px] text-text-muted tabular-nums whitespace-nowrap" title={fullStamp}>
        {shortStamp(message.created_at)}
      </span>
    </li>
  );
}

function OpenMessage({
  message,
  fullStamp,
  tokensColumn,
}: {
  message: LineMessage;
  fullStamp: string;
  tokensColumn: boolean;
}) {
  const { push } = useToast();
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const [citedOpen, setCitedOpen] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
    } catch {
      push({ type: "error", message: "Could not copy the message. The browser blocked clipboard access." });
    }
  };

  return (
    <div className="py-0.5">
      <MessageBody content={message.content} raw={raw} />
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-muted">
        <span>{fullStamp}</span>
        <span className={cn("tabular-nums", tokensColumn && "sm:hidden")}>{message.token_count} tokens</span>
        <span className="break-all">#{message.id}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" icon="code" onClick={() => setRaw((r) => !r)}>
            {raw ? "SHOW_FORMATTED" : "SHOW_RAW"}
          </Button>
          <Button size="sm" variant="ghost" icon={copied ? "check" : "copy"} onClick={copy}>
            {copied ? "COPIED" : "COPY"}
          </Button>
          <CitedByButton open={citedOpen} onToggle={() => setCitedOpen((v) => !v)} />
        </span>
      </div>
      {citedOpen ? <CitingConclusionsPanel messageId={message.id} /> : null}
    </div>
  );
}

/** Reading leading for message bodies; the collapse height is measured in it. */
const BODY_LEADING = 1.65;
/** Long messages clamp to about 14 lines until SHOW_MORE. */
const COLLAPSE_EM = 14 * BODY_LEADING;
/** Collapse only when it hides a real amount of text, never a line or two. */
const COLLAPSE_SLACK = 1.25;
/**
 * The clamp rarely lands on a line boundary (paragraph and heading spacing vary),
 * so an alpha mask fades the last lines out instead of slicing one in half. It
 * changes transparency only and paints no color.
 */
const FADE_MASK = "linear-gradient(to bottom, black calc(100% - 3em), transparent)";
const CLAMP_STYLE = { maxHeight: `${COLLAPSE_EM}em`, maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK };

/**
 * Message text, rendered as markdown or shown exactly as stored. Long bodies
 * clamp behind SHOW_MORE; the clamp is measured, so it follows the width.
 * Lines stop at 140 characters, the same cap as closed lines and conclusions,
 * so open and closed text share a right edge on wide screens.
 */
export function MessageBody({ content, raw }: { content: string; raw: boolean }) {
  const bodyId = useId();
  const ref = useRef<HTMLDivElement | null>(null);
  const [collapsible, setCollapsible] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Fires once on observe, then whenever the width (and so the wrapping) changes.
    const observer = new ResizeObserver(() => {
      const limit = parseFloat(getComputedStyle(el).fontSize) * COLLAPSE_EM;
      setCollapsible(el.scrollHeight > limit * COLLAPSE_SLACK);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [content, raw]);

  const clamped = collapsible && !expanded;
  return (
    <div>
      <div
        id={bodyId}
        ref={ref}
        className={cn("max-w-[140ch] text-xs text-text-primary", clamped && "overflow-hidden")}
        style={clamped ? CLAMP_STYLE : undefined}
      >
        {raw ? (
          <pre className="whitespace-pre-wrap break-words" style={{ lineHeight: BODY_LEADING }}>
            {content}
          </pre>
        ) : (
          <Markdown text={content} />
        )}
      </div>
      {collapsible ? (
        <Button
          size="sm"
          variant="ghost"
          icon={expanded ? "chevron-up" : "chevron-down"}
          className="mt-1.5"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => {
            setExpanded(!expanded);
            // Collapsing a long message can leave its start above the fold.
            if (expanded) requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "nearest" }));
          }}
        >
          {expanded ? "SHOW_LESS" : "SHOW_MORE"}
        </Button>
      ) : null}
    </div>
  );
}
