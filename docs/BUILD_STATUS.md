# Development build 0.1.0

Created 22 October 2026.

## User confirmation

On 22 October 2026, the user confirmed that version 0.1.2 is working in Figma. The detailed edge-case and performance checklist remains available in `FIGMA_VALIDATION.md`; this confirmation does not imply every checklist case was tested.

## Startup fix — 0.1.1

The screenshot reported a panel stuck at both “Connecting to Figma…” and “Loading available fonts…”. Fixed the UI's rejection of native bridge replies with a null message source, installed the sandbox receiver before opening the panel, and added bounded initialization retries plus a recoverable font-list timeout. Regression tests exercise the compiled UI and sandbox entry points, including immediate startup and null-source replies. Native editor confirmation remains pending.

## Follow-up startup fix — 0.1.2

The second screenshot confirmed the 0.1.1 timeout but still no received page context. The earlier source check was incomplete: a non-parent, non-null forwarding window was still rejected. Removed window-identity filtering, following Figma's documented `event.data.pluginMessage` receive pattern. Added host-initiated context/font bootstrapping after `showUI` (Figma queues these messages until the UI loads), visible build identification, and console startup markers without document content. The compiled UI/sandbox integration test now covers forwarded replies with no INIT delivery. Native confirmation remains pending; the supplied console logs contain no plugin-specific exception establishing the actual relay identity.

## Completed verification

- Strict TypeScript validation, including plugin source and development preview host.
- Automated engine tests against an emulated Figma API.
- Production bundling to `dist/code.js` and self-contained `dist/ui.html`.
- Browser inspection of the initial panel, inventory, family picker, mapping results, review, and completion states.
- Browser end-to-end workflow using the real replacement engine and an emulated 128-layer sample document: 125 eligible layers replaced, 3 locked layers excluded by scan policy, zero replacement errors.

The sample document is explicitly labeled development data. Its timings are not Figma performance measurements.

## Pending editor validation

No native Figma document was modified during this development pass. Native undo behavior, unavailable source-font recovery, text-style override details, variable font behavior, and component propagation remain subject to the editor checklist in `FIGMA_VALIDATION.md`.

## Build contents

- `manifest.json`: Figma Design, dynamic pages, no network domains.
- `dist/code.js`: sandbox engine and message handler.
- `dist/ui.html`: interface, styles, and UI code in one local file.

The development preview, emulated document, tests, and test fixtures are not bundled into the plugin.
