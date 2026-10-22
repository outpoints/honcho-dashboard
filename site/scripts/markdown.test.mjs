import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { MARKDOWN_INLINE_ELEMENTS, MARKDOWN_REMARK_PLUGINS } from "../src/lib/markdown.ts";

const block = (text) => renderToStaticMarkup(createElement(Markdown, { remarkPlugins: MARKDOWN_REMARK_PLUGINS }, text));
const inline = (text) =>
  renderToStaticMarkup(
    createElement(
      Markdown,
      { remarkPlugins: MARKDOWN_REMARK_PLUGINS, allowedElements: MARKDOWN_INLINE_ELEMENTS, unwrapDisallowed: true },
      text,
    ),
  );

test("common markdown renders instead of showing its markers", () => {
  const html = block("## Heading\n\nSome **bold**, *italic*, and `code`.\n\n- one\n- two\n\n1. first\n2. second");
  assert.match(html, /<h2>Heading<\/h2>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<ul>\s*<li>one<\/li>/);
  assert.match(html, /<ol>\s*<li>first<\/li>/);
  assert.doesNotMatch(html, /\*\*|##/);
});

test("GFM tables, task lists, fenced code, and autolinks render", () => {
  const html = block("| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n```toml\nkey = 1\n```\n\nSee https://example.com/docs");
  assert.match(html, /<table>/);
  assert.match(html, /<li class="task-list-item"><input type="checkbox" disabled="" checked=""\/> done<\/li>/);
  assert.match(html, /<pre><code class="language-toml">key = 1\n<\/code><\/pre>/);
  assert.match(html, /<a href="https:\/\/example.com\/docs">/);
});

test("single newlines stay line breaks", () => {
  assert.match(block("[2026-10-14] first fact\n[2026-10-14] second fact"), /first fact<br\/>\n\[2026-10-14\] second fact/);
});

test("raw HTML shows as literal text and is never dropped", () => {
  const blockHtml = block("<script>alert(1)</script>\n\nafter");
  assert.doesNotMatch(blockHtml, /<script/);
  assert.match(blockHtml, /<p>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/p>/);
  const inlineHtml = block("press <kbd>Ctrl</kbd> now");
  assert.doesNotMatch(inlineHtml, /<kbd>/);
  assert.match(inlineHtml, /press &lt;kbd&gt;Ctrl&lt;\/kbd&gt; now/);
});

test("images are never fetched; they become a link that names them", () => {
  const html = block("look ![release chart](https://images.example.com/chart.png) and ![](https://images.example.com/x.png)\n\n![ref one][r]\n\n[r]: https://images.example.com/r.png");
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /<a href="https:\/\/images.example.com\/chart.png">\[image: release chart\]<\/a>/);
  assert.match(html, /<a href="https:\/\/images.example.com\/x.png">\[image: https:\/\/images.example.com\/x.png\]<\/a>/);
  assert.match(html, /<a href="https:\/\/images.example.com\/r.png">\[image: ref one\]<\/a>/);
});

test("unsafe link protocols are cleared", () => {
  assert.match(block("[click](javascript:alert(1))"), /<a href="">click<\/a>/);
});

test("single tildes are not strikethrough; double tildes are", () => {
  assert.doesNotMatch(block("about ~20 seconds, up to ~30"), /<del>/);
  assert.match(block("~~gone~~"), /<del>gone<\/del>/);
});

test("underscores never format, so identifiers stay intact", () => {
  const html = block("Edit __init__.py for __active__, _private_ and ___both___. Keep **bold**, *italic*, and ***both***.");
  assert.match(html, /Edit __init__.py for __active__, _private_ and ___both___\./);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<em><strong>both<\/strong><\/em>/);
  assert.match(block("*mixed _inner_ text*"), /<em>mixed _inner_ text<\/em>/);
  assert.match(block("- __dunder__ item\n- `__code__` stays code"), /<li>__dunder__ item<\/li>\n<li><code>__code__<\/code> stays code<\/li>/);
});

test("the preview variant flattens blocks but keeps inline emphasis", () => {
  const html = inline("# Title\n\nPara with **bold** and `x`.\n\n- item\n\n![img](https://images.example.com/a.png) <b>tag</b>");
  assert.doesNotMatch(html, /<(h1|p|ul|li|a|img|b)\b/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>x<\/code>/);
  assert.match(html, /\[image: img\]/);
  assert.match(html, /&lt;b&gt;tag&lt;\/b&gt;/);
});
