# Font Replacer Pro: reference review and implementation plan

Prepared 22 October 2026. Status: planning only; no plugin implementation has been created.

## 1. Recommendation

Build an independently implemented Figma Design plugin that reproduces Uwarp Font Replacer's verified core job of replacing fonts and swapping families in batches, then improves precision, responsiveness, and large-file handling. Treat exact workflow and visual parity as a separate discovery milestone before calling this a replica.

The first release should make this task excellent: select a scope, see its font usage, map source fonts to available replacements, review ambiguous style matches, and apply the changes with an accurate report and tested native undo behavior.

Do not begin with AI matching, cloud accounts, a backend, font downloads, or automatic layout repair. Those features do not establish the reliability or speed of the core operation.

## 2. Evidence and limits of this review

### What was actually inspected

- The supplied [Figma Community URL](https://www.figma.com/community/plugin/1326934612692352393/uwarp-font-replacer-replace-fonts-font-swap-batch-change-in-figma) identifies plugin 1326934612692352393. Direct web retrieval failed; browser navigation did not produce usable listing content. Search also reported the Community path blocked by robots.txt.
- The publisher's indexed [Uwarp product site](https://ox.uwarp.design/) names the product “Uwarp Font Replacer – Replace Fonts, Font Swap & Batch Change in Figma” and describes replacing fonts, swapping families, and batch typography changes. This verifies its advertised purpose, not its implementation quality.
- The local project at `/Users/apple/Downloads/Figma-Plugins/Font-replacer-Pro` is empty. No manifest, source, package configuration, or project instructions were found there. This is a new build rather than an optimization of existing code.
- Current official Figma Plugin API documentation was reviewed for text ranges, font loading, traversal, dynamic pages, event handling, undo, and variable fonts. Sources appear below.

### What cannot honestly be concluded yet

The reference plugin was not run in a Figma test document. Its exact panel layout, controls, supported scopes, pricing, limits, current version, error behavior, mixed-font handling, matching algorithm, undo grouping, and measured speed remain unverified. No reference source code was inspected. There is no evidence that Uwarp uses a particular framework, traversal algorithm, or inefficient implementation.

Every performance problem below is a risk to avoid in our implementation, not an allegation about Uwarp. Every feature beyond the verified advertised core is our proposed behavior unless subsequently verified.

## 3. Reference feature inventory

| Capability | Evidence status | Our proposed treatment |
| --- | --- | --- |
| Replace fonts | Advertised by publisher | Core requirement |
| Swap font families | Advertised by publisher | Core requirement |
| Batch typography/font changes | Advertised by publisher | Core requirement; clarify exact scope through testing |
| Scan selected layers and descendants | Unverified | Required for our first release |
| Scan current page | Unverified | Required for our first release |
| Selected pages / whole file | Unverified | Add after page-level engine works |
| List source families and styles with counts | Unverified | Required for a reviewable workflow |
| Preserve bold/italic when changing family | Unverified | Explicit matching policy and ambiguity review |
| Replace a single style or several mappings together | Unverified | Required |
| Mixed-font ranges within one text layer | Unverified | Required correctness case |
| Replace unavailable source fonts | Unverified | Required prototype and supported path where API permits |
| Hidden layers / locked layers / instances | Unverified | Explicit inclusion policies and truthful reporting |
| Local text-style migration | Unverified | Separate advanced mode |
| Typography-variable migration | Unverified | Later mode; do not silently alter bindings |
| Native undo and cancellation | Unverified | Required; define and test semantics |
| Saved rules, search, recent fonts | Unverified | Enhancements after core correctness |
| Accurate target-font visual preview | Unverified | Optional; Figma-rendered samples, not assumed iframe fonts |

## 4. Exact-parity discovery milestone

Use a disposable Figma file. Do not infer behavior from a marketing title. Record the reference version/date, editor version, operating system, available fonts, screenshots of every state, and a short recording of each workflow.

### Inspection script

1. Launch with no selection. Record initial scope, scan behavior, defaults, dimensions, loading state, empty state, and primary action.
2. Select one plain text layer, then a frame with nested text, then multiple frames. Check whether descendants are included and whether directly selected text is counted.
3. Inspect the font list: family versus style grouping, counts, sorting, searching, missing-font badges, filtering, and font picker behavior.
4. Replace one font. Record whether mapping applies immediately or requires Apply, whether other typography changes, and what success looks like.
5. Replace an entire family with Regular, Medium, Bold, and Italic variants. Test a target family with different style names and missing weights.
6. Replace one family in a mixed-font text node. Verify that only the intended ranges change and that links, fills, size differences, and decorations survive.
7. Attempt simultaneous A→B and B→C mappings. Determine whether original B changes to C while original A stops at B, or whether replacements cascade.
8. Test hidden text, a hidden ancestor, locked text, a locked ancestor, main components, local instances, nested instances, and library instances.
9. Test local text styles, remote styles, per-range styles, and variable-bound font properties. Record overrides, detachment, propagation, and errors.
10. Test current-page and whole-file operations if exposed. Include unloaded pages and changes made after the scan.
11. Test missing source fonts, target load failures, empty text, unsupported nodes, deleted layers, and changes during an operation.
12. Test cancellation, plugin closure during work, undo, redo, rerun, and persistence of settings.
13. Measure reference scan and apply separately using the same fixtures planned for our plugin. If internal timings are unavailable, record end-to-end wall time with consistent start/end events.

### Discovery deliverables and gate

- A completed matrix with each feature marked observed, absent, failed, or untested.
- Annotated reference screenshots and a state/interaction inventory.
- Reproducible baseline timings, with cold and warm runs separated.
- Decisions on which reference behaviors to reproduce and which to improve.

Gate: do not describe untested features as reference parity or claim a speed advantage without comparable measurements. Discovery can proceed alongside an API prototype, but exact visual replication depends on observing the reference UI.

## 5. Proposed product workflow

### Default panel

Start around 420 × 600 px, resizable, with Figma light/dark theme support. Dimensions are our proposal pending reference inspection.

1. **Scope:** Selection, Current page, Selected pages, Entire file. Use Selection when there is a meaningful selection, otherwise Current page. Never silently expand an empty selection into a file-wide operation.
2. **Font inventory:** family, styles, unique layer count, range count, and missing-font status. A layer with multiple styles can appear in multiple rows; total layers must be deduplicated.
3. **Replacement mapping:** source → target family/style, with optional family-wide matching. Rows expose exact matches, suggested fallbacks, and unresolved mappings.
4. **Review:** affected layers/ranges, skipped content, binding/style implications, and unavailable targets. The review is a dry-run plan, not a guarantee of identical layout.
5. **Apply:** progress by stage and processed work, plus Cancel at a safe boundary.
6. **Result:** changed layers, changed ranges, unchanged items, skipped items, failed items, reasons, and navigation to affected layers.

### Proposed default policies

- Include ordinary hidden layers so scoped migration is complete; expose a faster visible-content option.
- Skip layers that are locked or have a locked ancestor unless Include locked is explicitly enabled. This is a product policy, not an assumption that the API forbids all locked writes.
- Permit instance overrides only through a clearly labeled option, initially off. Main component edits can propagate beyond the scanned selection; surface that impact and test it before enabling component migration.
- Keep local style-definition migration off by default. Direct node overrides and changing shared definitions are different operations.
- Skip variable-bound font properties in the basic mode with a reason. Provide an explicit binding policy in a later advanced mode.
- Apply mappings simultaneously against the original snapshot. A→B and B→C must not accidentally become A→C.
- Do not change characters, font sizes, fills, links, line height, tracking, or other unrelated properties. Font changes may still alter wrapping, glyph appearance, dimensions, and auto-layout.
- Do not detach instances, flatten text, or resize frames as part of a font replacement.

## 6. Architecture

Use TypeScript for the engine and shared message types. Use a small UI implementation, such as Preact, with a bundled local HTML entry and a straightforward build such as esbuild. Confirm current dependency versions at implementation time. Bundle size and clarity matter more than choosing a framework based on presumed runtime speed.

```text
Plugin UI iframe
  Scope • Font inventory • Mappings • Review • Results
                       ↕ validated messages
Figma plugin sandbox
  Operation controller
    → Scope resolver / traversal adapter
    → Font-usage index
    → Mapping resolver
    → Preflight / stale-plan checks
    → Font-load cache / bounded queue
    → Batched mutation executor
    → Verification / result reporter
```

The sandbox owns document reads and writes. The UI owns presentation and user intent. Do not send live Figma node objects across the boundary. Do not assume a browser worker can access Figma's document API or that Promise.all parallelizes synchronous document mutations.

### Suggested source organization

```text
manifest.json
src/main.ts
src/shared/protocol.ts
src/shared/model.ts
src/engine/controller.ts
src/engine/scope.ts
src/engine/traversal.ts
src/engine/inventory.ts
src/engine/font-loader.ts
src/engine/style-matcher.ts
src/engine/plan.ts
src/engine/executor.ts
src/engine/verification.ts
src/ui/index.tsx
src/ui/components/
tests/unit/
tests/fixtures/
benchmarks/
docs/
```

### State and operation model

Use an explicit state machine: Idle → Scanning → Ready → Planning → Preflight → Applying → Verifying → Complete. Cancellation and failure have separate terminal states; a partially applied operation must never display ordinary success.

Every request carries an operation ID. Inventory and plans carry a revision and scope identity. Ignore late messages from superseded scans. Allow one mutation job at a time. Freeze mappings and scope at Apply; changing the selection must not redirect an active job.

Message examples: SCAN_REQUEST, SCAN_PROGRESS, INVENTORY_READY, PLAN_REQUEST, PLAN_READY, APPLY_REQUEST, CANCEL_REQUEST, APPLY_PROGRESS, OPERATION_RESULT. Validate both message shape and allowed state transition. Throttle progress messages and send deltas rather than an entire inventory on every update.

## 7. Scan and indexing strategy

### Scope resolution

- Normalize selected roots: remove duplicate IDs and descendants already covered by another selected root.
- Include selected text roots themselves; descendant search methods do not imply including the receiver.
- Explicitly load each requested page before querying it. Use dynamic page access from startup.
- Never load every page merely to display the panel or enumerate available fonts.
- For whole-file operations, freeze the initial page set. Newly created pages are not silently added mid-run.

Figma documents loading individual pages through `PageNode.loadAsync()`. Document-wide traversal has additional loading requirements. Prefer processing explicitly loaded pages rather than querying `figma.root` for selection/page jobs. Loading pages sequentially can pace work, but there is no assumed API to unload pages afterwards. [Accessing the Document](https://developers.figma.com/docs/plugins/accessing-document/).

### Two traversal strategies to benchmark

1. **Native typed traversal:** `findAllWithCriteria({ types: ['TEXT'] })` on loaded scopes. Figma documents this as faster than general callback search. Good candidate for normal files; one synchronous traversal may still delay cancellation. [Typed traversal](https://developers.figma.com/docs/plugins/api/properties/nodes-findallwithcriteria/).
2. **Cooperative iterative traversal:** an explicit stack with time-budgeted yields. Candidate for large scopes or strict responsiveness. Higher API-call overhead may make total scanning slower; measure before choosing a threshold.

Do not assume native traversal can be cancelled midway. Chunked processing after a native search only makes the processing stage cancellable.

### Inventory extraction

- Read uniform `fontName` directly when available.
- For mixed fonts or variable-axis differences, use styled text segments rather than one API query per character.
- Keep range offsets as returned by Figma; do not recompute them using Unicode code-point iteration.
- Handle empty text explicitly: inspect and replace its node-level font without making an invalid empty range call.
- Store compact node IDs, source font keys, range offsets, and necessary validation metadata. Do not retain full document text in UI payloads or persistent storage.
- Key fonts structurally by family, style, and sorted variation-axis entries; do not concatenate with an ambiguous delimiter or collapse variable instances into one style key.
- Maintain source-font → affected node/range references so mapping edits do not rescan the document.

The text API supports uniform and range-based inspection. [Styled segments](https://developers.figma.com/docs/plugins/api/properties/TextNode-getstyledtextsegments/).

### Hidden instance children

`figma.skipInvisibleInstanceChildren = true` can greatly accelerate traversal, but it also excludes content from access. Treat it as a scope policy, not a harmless universal optimization. If Include hidden is on, use a compatible traversal setting. Rebuild the affected index when switching this flag; old node references can become inaccessible. Report excluded hidden instance content separately. [Figma's documented tradeoff](https://developers.figma.com/docs/plugins/api/properties/figma-skipinvisibleinstancechildren/).

### Cache freshness

Use page-level `nodechange`, selection/page events, and `stylechange` where suitable. Do not force full-document loading just to subscribe to global `documentchange`; dynamic-page plugins have a loading prerequisite for it. Style or main-component propagation may require broader invalidation than the directly reported node. [Events](https://developers.figma.com/docs/plugins/api/properties/figma-on/).

An event cache is advisory. Before a node's first write, reacquire/revalidate it against the original planned ranges and relevant font/binding state. Skip and report stale nodes instead of applying obsolete offsets. New text edits of the same length must also invalidate a plan; length alone is not a sufficient check. Never claim collaborative edits are atomically isolated.

## 8. Replacement engine and correctness rules

### Phase A: compile mappings

Resolve source-specific mappings before family-wide rules. Reject conflicting duplicate rules, drop no-op replacements, and produce one deterministic action list from original source states. Each action records the node, affected range or whole-node assignment, original font, target font, and relevant constraints.

### Phase B: preflight target fonts

List available fonts once per session, with manual refresh for font installation changes. Only load targets used by the compiled plan. Cache in-flight and successful loads by actual load identity; remove rejected promises so explicit retry can work. Start with a bounded queue, for example 4 concurrent font loads, and tune experimentally.

Figma's loader makes already accessible fonts usable by the plugin; it does not download fonts from the internet. Its own cache does not remove repeated promise/event-loop overhead, so avoid per-layer awaits of the same font. [Font loader](https://developers.figma.com/docs/plugins/api/properties/figma-loadfontasync/).

For font-name assignment, do not blindly require every original font to load: an unavailable source must not automatically block a valid replacement. Prototype whole-node and mixed-range recovery separately. Other text/layout mutations have different font-loading requirements; the replacement engine should avoid them. [Working with text](https://developers.figma.com/docs/plugins/working-with-text/).

Default behavior: unresolved or unloadable targets block Apply until fixed or explicitly excluded. If a load fails during execution, preserve accurate partial-result reporting.

### Phase C: apply minimal mutations

- Change the whole-node font only when the entire node is intended to use the same target.
- Otherwise use `setRangeFontName` only on matching original ranges.
- Merge adjacent ranges only when target font/axes and relevant binding/style policies agree.
- Do not rewrite characters to force a font update.
- Process node-by-node in deterministic order, with yields between time-budgeted batches.
- Revalidate each node once immediately before its range writes; avoid asynchronous gaps inside that node's range loop where practical.
- If a range assignment fails partway through a node, report the actual completed ranges. Do not label the entire node unchanged.
- Protect component/instance cases from double work or unintended inheritance effects; validate these in a dedicated fixture before enabling them broadly.

### Phase D: verify and report

Read back assigned font identities on changed ranges. Compare unrelated typography on correctness fixtures, including styled ranges. Aggregate attempted, changed, skipped, unchanged, and failed counts. Use named skip reasons such as stale node, locked by policy, bound font, excluded instance, unresolved style, and target unavailable.

Verification that a font was assigned does not prove every glyph is covered or that a layout still fits. Full-file geometry inspection and image rendering should remain optional because they can dominate runtime.

## 9. Style matching and variable fonts

### Static matching order

1. User's explicit source-style → target-style rule.
2. Exact available target style name.
3. Conservative normalized aliases, preserving italic/slant and width distinctions.
4. Suggested nearest known weight within the same slant/width class.
5. Unresolved: ask through the mapping UI rather than silently using Regular.

Normalize matching metadata only; always write the actual target family/style returned by Figma. Names such as Book, Roman, Medium, Demi, and Semi Bold are not a universally reliable numeric weight system. Unrecognized names must stay ambiguous. Same numeric weight also does not guarantee equivalent visual weight.

Example plan:

| Original | Available destination | Decision |
| --- | --- | --- |
| Source Regular | Target Regular | Exact |
| Source SemiBold | Target Semi Bold | Normalized suggestion |
| Source Bold Italic | Target Bold, Regular Italic | Unresolved; no silent loss of weight or italic |
| Source Condensed Bold | Target Bold | Width mismatch flagged |

### Variable-font policy

Current Figma documentation exposes variable settings and axis discovery. Feature-detect required methods and verify against installed typings/editor runtime before relying on them. Preserve applicable axes deliberately, inspect supported destination axes, flag dropped axes and out-of-range mappings, and never copy arbitrary axes blindly. Static-to-variable and variable-to-static conversions need explicit rules. [fontName](https://developers.figma.com/docs/plugins/api/properties/TextNode-fontname/), [FontName types](https://developers.figma.com/docs/plugins/api/FontName/).

## 10. Undo, cancellation, and recovery

Native undo is the first recovery mechanism. Define and test one Apply operation as one useful undo group where Figma permits it; avoid committing every progress batch. `commitUndo()` creates undo boundaries, not an ACID transaction or automatic rollback. [Undo API](https://developers.figma.com/docs/plugins/api/properties/figma-commitundo/).

Cancel before mutation leaves the document unchanged. Cancel during mutation stops at the next safe boundary and keeps completed changes, with a clear partial-results state and native undo guidance. Do not promise all-or-nothing cancellation.

Do not automatically call global undo to roll back after an error: concurrent user activity and undo grouping must be understood first. A custom per-operation revert journal is a later feature, requiring post-state conflict checks, available original fonts, and careful restoration of styles and bindings. It is not a substitute for proving undo behavior.

## 11. Performance plan

### Likely cost centers in any font replacer

| Cost | Planned response | Tradeoff / validation |
| --- | --- | --- |
| Loading unrelated pages | Narrow scope and dynamic pages | Whole-file jobs still pay loading cost |
| Traversing many non-text nodes | Typed search or measured cooperative traversal | Native calls can block until they return |
| Inspecting every character | Uniform fast path; styled ranges for mixed text | Highly fragmented text still costs more |
| Repeated font awaits | Deduplicate targets; cache promises | Failures need retry invalidation |
| Too many document writes | Skip no-ops; merge compatible ranges | Never merge across incompatible policies |
| Figma reflow after each write | Minimal assignments; no redundant geometry reads | Reflow cost cannot be eliminated by UI code |
| Rescanning after every mapping edit | Reuse index and compile plans | Must detect stale document state |
| Thousands of UI rows | Virtualized lists if measured necessary | Keep accessibility and keyboard navigation |
| UI/sandbox serialization | Compact summaries, paged details, throttled progress | UI needs accurate final reconciliation |
| Duplicate jobs | Operation controller and cancellation tokens | No concurrent document mutation jobs |

Suggested batch budget starts at 8–12 ms of our own work before yielding through the event loop. This is a tuning value, not a promise that every Figma API call fits inside it. Avoid fixed sleeps per node. Measure both throughput and responsiveness; a responsive algorithm may complete slightly later and still be preferable.

### Benchmark fixtures

| Fixture | Content |
| --- | --- |
| Small | 100 text nodes, 2 families, 4 styles |
| Typical | 1,000 text nodes, 10 families, nested frames |
| Large | 10,000 text nodes, mixed fonts, 20+ styles |
| Stress | 50,000 total scene nodes; record actual text-node count separately |
| Fragmented text | 1 very long node with many style runs plus many short mixed nodes |
| Component-heavy | Local/remote instances, overrides, hidden instance descendants |
| Multi-page | 20 pages, including initially unloaded pages |
| Recovery | Missing source fonts, failed targets, stale/deleted nodes |
| International | Arabic/Urdu, RTL/LTR mixtures, CJK, emoji and combining marks |

Compare identical inputs, scopes, inclusion policies, target fonts, and correctness outcomes. A faster run that skips hidden content is not a valid comparison against a complete scan. Duplicate/reset the fixture for each mutation run; do not benchmark already-replaced no-ops as apply speed.

Measure panel startup, time to first useful inventory, complete scan, font enumeration, font loading, plan compilation, mutation, verification, total operation, cancellation latency, longest observable stall, node/range/write counts, and UI payload sizes. Track memory only where the environment supports meaningful instrumentation; do not imply complete access to Figma's internal memory.

Use at least 10 warmed repetitions for early tuning with medians and ranges; use a larger set, such as 30, for release percentile reporting. Separate cold-font/cold-page runs. Record hardware, OS, Figma build, plugin build, and fixture version. Retain raw timing data.

### Provisional targets (not measured claims)

- Panel usable within 500 ms after plugin entry on the agreed baseline machine, excluding Figma's own launch scheduling.
- First useful inventory within 1 s for the 1,000-text-node fixture when its page is already loaded.
- Font search interaction generally under 100 ms with a large available-font catalog.
- Cancellation observed within 250 ms between interruptible batches; document any uninterruptible native-call exceptions.
- No repeated full scan merely because the user changes a destination font.
- At most one actual underlying load request per unique target load identity during a successful operation.
- Seek at least a 2× median scan improvement over the measured reference on large matched-scope fixtures. Change this goal after baselines if the reference is already near the API floor.
- Set absolute apply-time budgets after the prototype quantifies font loading and Figma reflow. No honest fixed 10,000-node timing can be promised yet.

## 12. Test and release gates

### Unit tests for pure logic

Test selection-root deduplication, font-key stability including axes, matching precedence, ambiguous aliases, conflicting rules, simultaneous mappings, no-op removal, range merging, stale-plan rejection, font-load deduplication/retry, operation-state transitions, and summary accounting.

### Integration tests inside Figma

Use actual document fixtures for font assignment, unavailable-source replacement, mixed ranges, empty nodes, styles/bindings, instances/components, inherited visibility/locking, page loading, variable axes, undo/redo, cancellation, partial failures, and edits between scan and Apply. Mocks cannot establish these behaviors.

### Acceptance criteria

1. Only planned in-scope text changes, with component propagation explicitly addressed.
2. Characters and unrelated formatting survive; expected style overrides are reported.
3. Missing source fonts do not automatically disqualify a valid font-only recovery path.
4. No silent substitution to Regular or loss of italic/width intent.
5. Counts remain accurate for overlapping roots, mixed nodes, no-ops, failures, and cancellation.
6. No unhandled exception leaves Apply enabled against an invalid plan.
7. A second Apply with the same result produces no unnecessary writes.
8. Undo/redo restore the tested operation correctly.
9. Large-scope responsiveness and timings meet agreed measured budgets.
10. Clean development import works through a valid Figma manifest and packaged outputs.

The plugin should run locally without external services by default. Store preferences and reusable mappings rather than document text. Add a backend only if a later requirement needs one.

## 13. Delivery sequence

Estimates below are planning ranges for one experienced engineer, not a delivery commitment. Discovery access, Figma API edge cases, and exact visual parity can change them. Do not add all advanced features to the first release.

| Phase | Work | Exit condition | Indicative effort |
| --- | --- | --- | --- |
| 0. Reference discovery | Run the inspection script, capture UI, measure baseline | Verified parity matrix and selected target workflow | 1–2 days once reference access works |
| 1. API feasibility | Font-only missing-source recovery, mixed ranges, styles, undo, traversal benchmarks | Risk cases demonstrated in Figma | 1–2 days |
| 2. Core engine | Selection/page scan, index, rules, loading cache, deterministic apply, summaries | Correctness fixtures pass | 3–5 days |
| 3. Product UI | Inventory, picker, mapping review, progress, cancel, results, theming | Complete end-to-end main workflow | 2–4 days |
| 4. Hardening | Pages, policy filters, cache invalidation, partial failures, performance tuning | Large fixtures pass and results are reproducible | 3–5 days |
| 5. Advanced migration | Local-style mode, explicit variable policy, presets, variable-font conversions | Separate advanced-mode acceptance tests pass | 3–6 days |
| 6. Release | Packaging, instructions, regression run, final comparison | Importable plugin and documented limitations | 1–2 days |

A production-quality core is roughly 2–4 working weeks after access and feasibility are established. A broader advanced release may take roughly 3–6 weeks. Exact UI parity stays dependent on reference inspection; no phase should conceal that dependency.

### Build order within the core

1. Manifest and minimal UI/sandbox bridge.
2. Selection/page inventory with mixed-font fixtures.
3. Explicit one-to-one replacements and missing-source feasibility.
4. Deterministic multi-mapping and conservative family matching.
5. Preflight, progress, cancellation, results, and undo validation.
6. Real-file benchmarks and targeted optimization.
7. UI polish and optional capabilities after correctness holds.

## 14. Main risks and decisions

| Risk | Decision |
| --- | --- |
| Exact reference behavior unavailable | Keep parity claims open; discover before copying UI details |
| Font metrics change layout | Preserve unrelated properties; warn through concrete review outcomes; optional later layout audit |
| Style or variable bindings conflict with direct edits | Separate node overrides from definition migration; skip unsupported bindings |
| Component propagation reaches outside scope | Report and gate component migration; validate effective font state |
| Cached inventory becomes stale | Page events plus pre-write validation; skip conflicts |
| Native scans/load calls block cancellation | Measure and expose stage; cooperative traversal where justified |
| Full-file page loading consumes resources | Opt-in scope, incremental results, no assumed unload capability |
| Target lacks glyphs | Do not equate API load success with language coverage; use representative script samples |
| Apparent speed gained by doing less | Require identical scope and correct output in comparisons |

Recommended first milestone: prove the engine on selection/current-page workflows and the difficult text cases, then build the polished interface around measured behavior. That provides a credible foundation for both replication and improvement.

## 15. Sources

Reference material:

- [Supplied Community listing](https://www.figma.com/community/plugin/1326934612692352393/uwarp-font-replacer-replace-fonts-font-swap-batch-change-in-figma): access unsuccessful in this review.
- [Publisher product index](https://ox.uwarp.design/): indexed product title and advertised core purpose; live fetch also timed out.

Official technical documentation:

- [Working with Text](https://developers.figma.com/docs/plugins/working-with-text/)
- [loadFontAsync](https://developers.figma.com/docs/plugins/api/properties/figma-loadfontasync/)
- [getStyledTextSegments](https://developers.figma.com/docs/plugins/api/properties/TextNode-getstyledtextsegments/)
- [findAllWithCriteria](https://developers.figma.com/docs/plugins/api/properties/nodes-findallwithcriteria/)
- [skipInvisibleInstanceChildren](https://developers.figma.com/docs/plugins/api/properties/figma-skipinvisibleinstancechildren/)
- [Accessing the Document](https://developers.figma.com/docs/plugins/accessing-document/)
- [Dynamic page migration](https://developers.figma.com/docs/plugins/migrating-to-dynamic-loading/)
- [Events](https://developers.figma.com/docs/plugins/api/properties/figma-on/)
- [commitUndo](https://developers.figma.com/docs/plugins/api/properties/figma-commitundo/)
- [fontName](https://developers.figma.com/docs/plugins/api/properties/TextNode-fontname/)
- [FontName types](https://developers.figma.com/docs/plugins/api/FontName/)

Architecture, priorities, policies, estimates, and provisional targets are recommendations developed for this project. They are not claims made by these sources or measurements of the reference plugin.
