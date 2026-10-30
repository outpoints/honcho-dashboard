/**
 * Search-term highlighting over rendered text, with no DOM rewriting.
 *
 * Uses the CSS Custom Highlight API: the matched ranges are registered under
 * one highlight name and painted by `::highlight(search-match)` in
 * globals.css. Markdown, links, and copy behave exactly as before; browsers
 * without the API just show no highlight.
 */
import { useEffect, useRef, type RefObject } from "react";

export const SEARCH_HIGHLIGHT = "search-match";
const MAX_TERMS = 8;

/** Words worth highlighting: at least two characters, longest first, deduped. */
export function highlightTerms(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).map((w) => w.replace(/^["'(]+|["'),.;:!?]+$/g, ""));
  return [...new Set(words.filter((w) => w.length >= 2))]
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_TERMS);
}

/** Non-overlapping [start, end) spans of any term in `text`, case-insensitive. */
export function findMatches(text: string, terms: string[]): [number, number][] {
  if (!text || terms.length === 0) return [];
  const lower = text.toLowerCase();
  const spans: [number, number][] = [];
  for (const term of terms) {
    let from = 0;
    while (from <= lower.length - term.length) {
      const at = lower.indexOf(term, from);
      if (at < 0) break;
      spans.push([at, at + term.length]);
      from = at + term.length;
    }
  }
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  return merged;
}

// --- DOM binding -----------------------------------------------------------

type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void };
type HighlightCtor = new (...ranges: Range[]) => unknown;

function api(): { registry: HighlightRegistry; Highlight: HighlightCtor } | null {
  if (typeof window === "undefined") return null;
  const registry = (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights;
  const Highlight = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
  return registry && Highlight ? { registry, Highlight } : null;
}

// Every mounted hook contributes its ranges to one shared highlight.
const contributions = new Map<symbol, Range[]>();
function publish() {
  const highlight = api();
  if (!highlight) return;
  const ranges = [...contributions.values()].flat();
  if (ranges.length) highlight.registry.set(SEARCH_HIGHLIGHT, new highlight.Highlight(...ranges));
  else highlight.registry.delete(SEARCH_HIGHLIGHT);
}

function rangesIn(root: HTMLElement, terms: string[]): Range[] {
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const [start, end] of findMatches(node.nodeValue ?? "", terms)) {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      ranges.push(range);
    }
  }
  return ranges;
}

/**
 * Highlight `query` inside `ref`: a string is split into words, an array is
 * used as exact phrases. Pass anything that changes the rendered text as
 * `version` (result ids, a page number) so ranges are recomputed.
 */
export function useTextHighlight(ref: RefObject<HTMLElement | null>, query: string | string[], version: unknown = null) {
  const key = useRef(Symbol("highlight"));
  const signature = typeof query === "string" ? query : JSON.stringify(query);
  useEffect(() => {
    const id = key.current;
    const root = ref.current;
    const terms = typeof query === "string"
      ? highlightTerms(query)
      : [...new Set(query.map((t) => t.toLowerCase()).filter((t) => t.length >= 2))];
    if (!root || terms.length === 0 || !api()) {
      contributions.delete(id);
      publish();
      return;
    }
    // Let Markdown and list animations commit before reading text nodes.
    const frame = requestAnimationFrame(() => {
      contributions.set(id, rangesIn(root, terms));
      publish();
    });
    return () => {
      cancelAnimationFrame(frame);
      contributions.delete(id);
      publish();
    };
    // `signature` stands in for `query` so a new array literal each render doesn't re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, signature, version]);
}
