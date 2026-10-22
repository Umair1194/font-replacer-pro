# Font Replacer Pro

A local Figma Design plugin for inspecting font usage and replacing fonts in batches. Current development build: 0.2.0, independently implemented from the project plan. Exact Uwarp UI/feature parity has not been established.

## Import into Figma

1. Open a disposable design file in the **Figma desktop app**.
2. Choose **Plugins → Development → Import plugin from manifest…** (also available through Figma's actions search).
3. Select `manifest.json` in this project folder. The built `dist/code.js` and `dist/ui.html` are included.
4. Run **Font Replacer Pro** from Development plugins.
5. Choose a scope, scan, map fonts, review, and replace.

This local manifest does not reuse another publisher's plugin ID. If Figma asks you to register a plugin before importing/publishing, create one in Development and use the ID Figma assigns in this manifest. No Community publishing has been performed.

## Included

Version 0.2.0 adds grouped families, mapping filters, selected pages, mapping preservation on refresh, fast/exact scan modes, bounded cancellable waits, indexed planning, detailed reviews, recent destinations, issue reports, and keyboard/contrast improvements. See [release notes](docs/RELEASE_0.2.0.md). Phase 3 features remain excluded.

- Selection (including nested text), current page, selected pages, and whole-file scopes.
- Cooperative traversal with inherited hidden/locked checks. Fast mode prunes excluded containers and reports their container counts; turn it off for exact skipped-text counts.
- Font family/style inventory, layer/range counts, variable-font identification, and unavailable-source indicators.
- Searchable destination picker using fonts available to Figma.
- Explicit per-source mappings and bulk family mapping using exact or spacing-normalized style names. No automatic nearest-weight fallback.
- Mixed-font range replacement, simultaneous/non-cascading mappings, and empty-text handling.
- Four concurrent destination-font loads, deduplicated and cached across operations.
- Preflight font loading before writes, pre-write snapshot checks, progress, cancellation, read-back verification, partial-error reporting, and native undo boundaries.
- Local bundled UI, light/dark theme support, keyboard-accessible dialogs, resizable panel, and no network access.

## Important behavior

- Locked text, instance text, and main-component text are excluded by default. Hidden text is included. Options check ancestors as well as the text layer itself.
- Font-family/style/weight variable bindings are skipped, including range bindings. This build does not migrate shared text-style definitions or typography variables.
- Changing a font on styled text may create an override. Changing main components (if enabled) can propagate to instances beyond the scanned scope.
- Choosing a named destination style resets custom source variable axes to that style's defaults. Custom axis migration is not included.
- Cancel during replacement leaves completed changes in place. Use native Figma Undo; do not assume transactional rollback.
- Font assignment may change wrapping, geometry, auto-layout, and glyph appearance. The plugin preserves text content and does not repair layout automatically.
- The picker shows font names in the interface typeface; it does not claim to render local Figma fonts in the iframe.
- In-memory snapshots retain source text only for stale-edit detection during the session; text is never sent to an external service or saved to persistent storage.

## Develop

Requires Node.js 22+ and npm. Dependencies are pinned in `package-lock.json`.

```sh
npm ci
npm run check
npm run watch
npm run benchmark
```

`npm run check` runs strict TypeScript checks, engine tests, and a production build. Reload/reopen the plugin in Figma after rebuilding. `npm run watch` also observes the HTML/CSS shell.

```sh
npm run build
npm run preview
```

The preview at `http://127.0.0.1:4317` uses the **real engine with an emulated document** and sample fonts. It is a UI/logic development aid, not a connection to Figma. Preview code is excluded from the plugin bundles.

## Validation status

Automated tests cover deterministic mappings, range preservation, empty text, stale edits, moved selection descendants, missing-source loading strategy, failed-load retry, partial writes, cancellation before writes, and policies. They emulate the Figma API; they cannot establish editor behavior.

Still required inside Figma before a production release:

- Verify one-operation native undo/redo and cancellation during long operations.
- Verify missing-source recovery for both whole text and mixed ranges.
- Verify font-variable detection and behavior of styled text in actual editor files.
- Verify instance overrides/main-component propagation when explicitly enabled.
- Verify local/variable fonts, complex scripts, very long mixed-font nodes, and large-file timings.
- Compare matched fixtures against Uwarp before making relative speed claims.

See `docs/FIGMA_VALIDATION.md` for a hands-on checklist and `PLUGIN_REVIEW_AND_PLAN.md` for the full architecture and roadmap.
