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

To recapture only Overview, add `SCREENSHOT_SET=overview` to the command. Its
generated hourly throughput data shows irregular read-heavy bursts and smaller
write spikes, with both series above zero in every bucket. These illustrative
values are not copied from production metrics.

## Honcho 3.2 release image set

Capture the new features from the current dashboard build with:

```bash
SCREENSHOT_BASE_URL=http://localhost:3000 SCREENSHOT_SET=honcho32 npm run capture:screenshots
```

This uses the same isolated capture browser and request interception as the README
set. It writes six PNGs outside the repository, under the operating system's
temporary directory at `honcho-dashboard-v1.2.0/images/`: chat evidence, conclusion
provenance, instance backlog, call traces, mobile provenance, and trace details.
Set `SCREENSHOT_OUTPUT_DIR` to a persistent directory outside the repository to
keep them. Release notes, changelog drafts, social copy, and their attachment
images are local artifacts and must not be committed or published without
explicit authorization. The README image set remains repository documentation.
Desktop images are 1440 × 1080; the mobile image is 430 × 932. Write actions remain
disabled. These are screenshots of the working tree, not proof of a published tag
or of a configured production trace collector. Apply the metadata and visual/OCR
checks above after capture and before sharing.

## README image set

The default capture produces eleven synthetic-data views. The README embeds ten;
`dashboard.png` documents the expanded session used to open the upload view.

| File | Purpose |
| --- | --- |
| `overview.png` | Per-workspace metrics and the 52-week activity heatmap |
| `fleet.png` | Workspace queues and service-wide instance backlog |
| `reasoning.png` | Instance backlog and expanded deriver task details |
| `chat.png` | Chat modes, recall boundaries, and expanded answer evidence |
| `conclusions.png` | Conclusion browsing, semantic search, and provenance controls |
| `dashboard.png` | Expanded session details and the upload entry point |
| `search.png` | Native hybrid search inside a synthetic named scope |
| `session-upload.png` | Session file-upload modal with a generated fixture file |
| `provenance.png` | A conclusion with its parent premise and derived backlink |
| `diagnostics.png` | Optional LLM and embedding call-trace inspection |
| `context.png` | Aligned scope/session/peer controls, generated context layers, and preview |

## Honcho 3.2.1 release image set

```bash
SCREENSHOT_BASE_URL=http://localhost:3000 SCREENSHOT_SET=honcho321 npm run capture:screenshots
```

This captures four synthetic views from the working tree: workspace evidence with
two observer/observed pairs, the aligned Context toolbar with generated layers,
an explicit conclusion with no parents, and mobile evidence. Capture uses desktop
1440 × 1080 and mobile 430 × 932 viewports, with full-page output to include the
footer when the content is taller. Chat's scrollable transcript is positioned to
show the peer pairs. The server fixtures identify as Honcho 3.2.1.

The default output is the operating system's temporary directory at
`honcho-dashboard-v1.2.1/images/`. Set `SCREENSHOT_OUTPUT_DIR` to keep the images in
a persistent directory outside the repository. The same isolation, metadata,
visual/OCR review, and no-publication rules above apply. Reviewed captures may
also refresh the README's Chat and Context images locally; committing or
publishing them requires explicit authorization.
