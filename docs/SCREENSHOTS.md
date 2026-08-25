# Repository screenshot policy

Every screenshot committed to this repository must use synthetic demo data. Do
not capture a production, personal, or otherwise real Honcho instance and try to
redact it afterward; preventing private data from entering the image is the
primary control.

## Data rules

Screenshots must not contain real:

- workspace, peer, session, message, conclusion, or webhook data;
- names, handles, email addresses, message content, or document contents;
- hostnames, IP addresses, bearer tokens, database URLs, request identifiers,
  local paths, or log lines;
- browser chrome, notifications, other applications, or operating-system UI.

Use obviously synthetic fixture values such as `acme_support`, `demo_user`,
`demo_agent`, `demo-session-001`, and `http://honcho.demo:8000`. Uploaded-file
examples must be generated fixtures rather than copies of real documents.

## Capture checklist

1. Build and run the exact commit being documented against a demo instance that
   contains only synthetic fixtures.
2. Keep write actions disabled unless the screenshot specifically documents a
   write-action control. Never connect the capture browser to a real instance.
3. Capture the dashboard viewport only. Keep the active route and selected
   filters representative of the feature being documented.
4. Inspect the full-resolution image for private data, clipped controls, stale
   version labels, error states, and loading placeholders.
5. Remove image metadata and perform a final visual and OCR-assisted review
   before staging the file.
6. Run the project check and review the staged image diff before committing.

If any value is uncertain, discard the capture and repeat it with a known
synthetic fixture. Do not blur or paint over uncertain content.

## Reproducing the image set

Start the dashboard from the commit being documented, then run the capture from
`site/`:

```bash
npx playwright install chromium
SCREENSHOT_BASE_URL=http://localhost:3000 npm run capture:screenshots
```

Set `SCREENSHOT_BASE_URL` to the mapped Docker port when needed. An existing
browser binary can be selected with `PLAYWRIGHT_EXECUTABLE_PATH`. The capture
script supplies every Honcho and operator response from synthetic fixtures,
blocks external traffic, fails on unmocked API requests, and enables write
actions only for the session-upload views.

## README image set

The README currently presents these synthetic-data views:

| File | Purpose |
| --- | --- |
| `overview.png` | Per-workspace metrics and the 52-week activity heatmap |
| `fleet.png` | Cross-workspace queue monitoring |
| `reasoning.png` | Deriver queue details |
| `chat.png` | Memory-augmented chat |
| `conclusions.png` | Conclusion browsing and semantic search |
| `dashboard.png` | Expanded session details and the upload entry point |
| `search.png` | Native hybrid search and relevance ordering |
| `session-upload.png` | Session file-upload modal with a generated fixture file |
