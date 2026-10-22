# Performance validation

Run `npm run benchmark` for the repeatable emulated-API workload. It creates fresh 1,000- and 10,000-text-node documents, maps 10% of their nodes, runs five repetitions, verifies output counts, and reports separate scan/plan/apply samples and medians. These are JavaScript workload checks, **not Figma speed claims**.

For native Figma measurements use a duplicate file and record:

- Hardware, operating system, Figma build, plugin version, available fonts.
- Total scene nodes, text layers, source ranges, unique target font styles.
- Scope and inclusion policies. Fast and exact-count scopes must not be compared as equivalent work.
- Separate cold/warm page and font runs; reset the document before every Apply.
- Scan, plan, load, apply, verification, total duration, and cancellation responsiveness.
- At least 10 tuning repetitions; increase the sample size for release percentiles.

The result screen exposes stage timings. Measure 1k and 10k text layers, deep frames, component-heavy files, and one long text node with thousands of font runs. Verify unchanged characters/formatting and expected assignments before accepting an optimization.

To evaluate native typed traversal independently, run this read-only fragment in a development plugin sandbox on a fully loaded test page:

```ts
await figma.currentPage.loadAsync();
const start = Date.now();
const text = figma.currentPage.findAllWithCriteria({ types: ['TEXT'] });
console.log({ nativeTraversalMs: Date.now() - start, textNodes: text.length });
```

This measures only node discovery. Our scan also reads fonts, checks policies, and builds an index. It is not a valid full-scan comparison until both alternatives perform the same work. A native traversal call cannot be cooperatively cancelled midway, so it has not been made the default without native evidence.
