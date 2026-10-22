"use client";

import { memo, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import { MARKDOWN_INLINE_ELEMENTS, MARKDOWN_REMARK_PLUGINS } from "@/lib/markdown";
import { cn } from "@/lib/utils";

type Props<Tag extends keyof React.JSX.IntrinsicElements> = ComponentPropsWithoutRef<Tag> & ExtraProps;

// Content headings sit inside panels and modals, so they start at h4 and never
// compete with the page outline. `data-md` carries the authored level for CSS.
function H1({ node, ...props }: Props<"h1">) {
  void node;
  return <h4 data-md="h1" {...props} />;
}
function H2({ node, ...props }: Props<"h2">) {
  void node;
  return <h5 data-md="h2" {...props} />;
}
function H3({ node, ...props }: Props<"h3">) {
  void node;
  return <h6 data-md="h3" {...props} />;
}

const EXTERNAL_URL = /^[a-z][a-z0-9+.-]*:/i;

/** Links that leave the dashboard open in a new tab without a referrer. */
function Link({ node, href, ...props }: Props<"a">) {
  void node;
  const external = !!href && EXTERNAL_URL.test(href);
  return (
    <a
      href={href}
      {...props}
      {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
    />
  );
}

function Table({ node, ...props }: Props<"table">) {
  void node;
  return (
    <div className="md-table">
      <table {...props} />
    </div>
  );
}

/** GFM task-list checkboxes render as text markers, never as inert form controls. */
function TaskMarker({ node, checked }: Props<"input">) {
  void node;
  return (
    <>
      <span aria-hidden className="md-task">
        {checked ? "[x]" : "[ ]"}
      </span>
      <span className="sr-only">{checked ? "Done:" : "To do:"}</span>
    </>
  );
}

const BLOCK_COMPONENTS: Components = {
  h1: H1,
  h2: H2,
  h3: H3,
  h4: H3,
  h5: H3,
  h6: H3,
  a: Link,
  table: Table,
  input: TaskMarker,
};

export interface MarkdownProps {
  /** Stored text exactly as Honcho returned it. */
  text: string;
  /**
   * Flatten to one run of text for clamped previews: emphasis and code stay,
   * headings, lists, links, and tables become plain inline text.
   */
  inline?: boolean;
  className?: string;
}

/**
 * Renders stored Honcho text as markdown. Raw HTML stays visible as text and
 * images are never fetched; see `lib/markdown.ts` for the rules. Styles live in
 * `globals.css` under `.md` / `.md-inline` and inherit the caller's font size.
 */
export const Markdown = memo(function Markdown({ text, inline = false, className }: MarkdownProps) {
  if (inline) {
    return (
      <span className={cn("md-inline", className)}>
        <ReactMarkdown
          remarkPlugins={MARKDOWN_REMARK_PLUGINS}
          allowedElements={MARKDOWN_INLINE_ELEMENTS}
          unwrapDisallowed
        >
          {text}
        </ReactMarkdown>
      </span>
    );
  }
  return (
    <div className={cn("md", className)}>
      <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} components={BLOCK_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
