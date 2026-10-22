# Font Replacer Pro 0.2.0

This release implements the approved Phase 1 (reliability and performance) and Phase 2 (interface and workflow). Phase 3 is excluded: no axis migration, saved mapping presets, rendered font previews, shared-style migration, or automatic layout repair.

## Reliability and engine changes

- Bound page loading, destination-font loading, and layer lookup waits. Cancel can interrupt our wait for a host promise; it cannot abort Figma's underlying host call. Late results cannot resume an expired mutation job.
- Preserve mappings in the UI during refreshes and invalidation. Drop obsolete source identities after a refresh, keep valid rules, and flag unavailable destinations before review.
- Ignore unrelated style changes. Relevant used text styles and scoped page changes mark the inventory stale, requiring refresh; they do not discard mappings.
- Plan against an index of affected source fonts rather than every node. Planning yields and is cancellable.
- Carry visibility/locking/instance policy during traversal; retrieve each container's children once. Recheck live ancestry immediately before writes.
- Fast scan skips excluded containers. Exact-count mode traverses those containers to count excluded text. These scopes are labeled clearly rather than compared as equivalent work.
- Separate progress-message cadence from cooperative processing slices.
- Cache structural font keys per snapshot segment and avoid duplicate serialized snapshot signatures and action-flattening arrays.
- Distinguish completed writes, verified writes, verification failures, processed layers, and unprocessed layers. Preserve partial results accurately.
- Release state even if native undo-history finalization fails; report the warning.
- Correlate operation messages, validate host response shapes, and keep the working relay-compatible Figma message transport.
- Scanning is available after receiving document context even if destination font enumeration is still pending. Replacement review requires a usable catalog.

## UI and workflow changes

- Smaller header and empty state; readable metadata and theme tokens.
- Family groups with independently expandable styles, including visible variable-axis values.
- Separate source-family mapping from explicitly global mapping.
- All, Mapped, Unmapped, and Attention filters; comfortable/compact density.
- Selected-pages scope in addition to selection, current page, and entire file.
- Detailed source-to-destination mappings and coverage in the review screen.
- Locate representative source layers before replacement.
- Searchable, paginated font picker with recent families. Only recent family names are stored locally; document text and mapping presets are not persisted.
- Keyboard navigation, focus restoration after mapping/clearing, accessible operation announcements, consistent SVG icons, keyboard resizing, and stronger theme-aware contrast.
- Result filters, paginated issue browsing, a local JSON report download, and refresh-to-review remaining work. Retry scans are restricted to failed or unprocessed layer IDs, preventing a second pass over successful A → B changes from cascading through B → C. Retrying never silently applies old ranges.
- One package version source injected at build time; GitHub checks validate tests and committed build outputs.

## Validation

- TypeScript checks and automated engine/startup regression tests.
- Added cases for excluded subtree pruning, selected pages, timed-out font retry, unresolved-promise cancellation, truthful verification counts, undo finalization failure, cancellable planning, source indexing, relevant style changes, malformed responses, and outdated operation messages.
- Browser preview exercised source-family-only mapping, mapping preservation on refresh, detailed review, and verified replacement results using the real engine with emulated Figma data.
- The benchmark harness runs 1,000/10,000-node emulated fixtures with correctness assertions. Its timings do not measure Figma rendering, host API costs, or speed relative to Uwarp.

Native Figma validation is still needed for this new version, especially undo/redo, remote/library instances, variable fonts, exported downloads, and native large-document performance. The user confirmed 0.1.2 works; that does not imply all new 0.2.0 cases have been validated in the editor.
