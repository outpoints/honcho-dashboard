import type { Options } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

/**
 * Markdown rules for text stored in Honcho: messages, chat answers, conclusions,
 * summaries, and representations. All of it is untrusted, so the pipeline never
 * hides or executes what was stored:
 *
 * - Raw HTML is shown as literal text. It is never parsed and never dropped, so
 *   `<kbd>` in a message stays visible exactly as it was written.
 * - Images are never fetched. A remote image would leak the operator's IP to
 *   whoever wrote the message, so it becomes a link that names the image.
 * - A single newline stays a line break, matching how the text was written and
 *   how the dashboard showed it before markdown rendering.
 * - `~text~` is not strikethrough. Only `~~text~~` is, so "~20 seconds" reads
 *   as written.
 * - Underscores never format. Memory text is full of identifiers such as
 *   `__init__.py` and `__active__`, which CommonMark would turn into bold
 *   `init.py` and `active`. Emphasis comes from `*` and `**` only.
 *
 * Unsafe link protocols (`javascript:` and friends) are cleared by
 * react-markdown's default URL transform.
 */

interface MdNode {
  type: string;
  value?: string;
  alt?: string | null;
  url?: string;
  children?: MdNode[];
  position?: { start: { offset?: number } };
}

/** Containers whose children are phrasing (inline) content in mdast. */
const PHRASING_PARENTS = new Set([
  "paragraph",
  "heading",
  "emphasis",
  "strong",
  "delete",
  "link",
  "linkReference",
  "tableCell",
]);

function walk(node: MdNode, visit: (node: MdNode, parent: MdNode | null, index: number) => void) {
  const stack: [MdNode, MdNode | null, number][] = [[node, null, 0]];
  while (stack.length) {
    const [current, parent, index] = stack.pop()!;
    visit(current, parent, index);
    current.children?.forEach((child, i) => stack.push([child, current, i]));
  }
}

/** Turn every raw HTML node into plain text that renders exactly as stored. */
export function remarkLiteralHtml() {
  return (tree: MdNode) => {
    walk(tree, (node, parent, index) => {
      if (node.type !== "html" || !parent?.children) return;
      const text: MdNode = { type: "text", value: node.value ?? "" };
      parent.children[index] = PHRASING_PARENTS.has(parent.type)
        ? text
        : { type: "paragraph", children: [text] };
    });
  };
}

function imageLabel(alt: string | null | undefined, url?: string): string {
  return `[image: ${alt?.trim() || url?.trim() || "untitled"}]`;
}

/** Replace images with links so nothing is fetched from the image host. */
export function remarkImagesAsLinks() {
  return (tree: MdNode) => {
    walk(tree, (node) => {
      if (node.type !== "image" && node.type !== "imageReference") return;
      const label = imageLabel(node.alt, node.url);
      node.type = node.type === "image" ? "link" : "linkReference";
      node.children = [{ type: "text", value: label }];
      delete node.alt;
    });
  };
}

function restoreUnderscores(node: MdNode, source: string) {
  if (!node.children) return;
  const children: MdNode[] = [];
  for (const child of node.children) {
    restoreUnderscores(child, source);
    const offset = child.position?.start.offset;
    const underscored =
      (child.type === "emphasis" || child.type === "strong") &&
      offset !== undefined &&
      source[offset] === "_";
    if (!underscored) {
      children.push(child);
      continue;
    }
    const marker = child.type === "strong" ? "__" : "_";
    children.push({ type: "text", value: marker }, ...(child.children ?? []), { type: "text", value: marker });
  }
  node.children = children;
}

/** Put `_` / `__` emphasis back as the literal text it was written as. */
export function remarkLiteralUnderscores() {
  return (tree: MdNode, file: { value?: unknown }) => {
    restoreUnderscores(tree, String(file.value ?? ""));
  };
}

/** Order matters: HTML and images become text before line breaks are split. */
export const MARKDOWN_REMARK_PLUGINS: NonNullable<Options["remarkPlugins"]> = [
  [remarkGfm, { singleTilde: false }],
  remarkLiteralUnderscores,
  remarkLiteralHtml,
  remarkImagesAsLinks,
  remarkBreaks,
];

/**
 * Elements kept by the one-line preview variant. Everything else is unwrapped to
 * its text, so blocks flow inline and a line clamp can cut them cleanly.
 */
export const MARKDOWN_INLINE_ELEMENTS: readonly string[] = ["strong", "em", "code", "del"];
