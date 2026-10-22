# Figma validation checklist — 0.1.0

Run in a duplicate/disposable design file. Record editor build, OS, available fonts, fixture size, plugin build, and results. This checklist is pending; it is not evidence that native Figma testing has passed.

| Case | Expected outcome | Result |
| --- | --- | --- |
| Import manifest and launch | Panel opens; fonts enumerate; no console errors | Pending |
| Selection: one text layer | Directly selected text appears in inventory | Pending |
| Selection: nested frame | Only selected roots/descendants scanned; no duplicates | Pending |
| Empty selection | Selection action disabled / clear error; scope never expands silently | Pending |
| Mixed fonts in one layer | Only mapped ranges change; characters, links, color, size retained | Pending |
| A→B and B→C in one operation | Original A ends as B; original B ends as C | Pending |
| Missing source font | Available destination replaces it without loading unavailable source | Pending |
| Missing source in mixed layer | Supported ranges replace, or failure is clearly reported | Pending |
| Empty text node | Font changes without an empty-range error | Pending |
| Locked/hidden ancestor | Inclusion policy matches options and skipped count | Pending |
| Main component default exclusion | No change to main component or propagated instances | Pending |
| Instance opt-in | Text changes without detaching; override behavior understood | Pending |
| Main component opt-in | Propagation understood and stale descendants correctly skipped | Pending |
| Local/remote text styles | Definitions untouched; override behavior observed | Pending |
| Font variables, including mixed ranges | Bound family/style/weight text skipped | Pending |
| Variable source font | Review warns about reset axes; selected named style applies | Pending |
| Arabic/Urdu, CJK, emoji | String and range boundaries retained; visual coverage inspected | Pending |
| Edit text after scan, keeping length | Layer skipped as stale | Pending |
| Move text outside selected frame | Layer skipped as outside original scope | Pending |
| Delete text after scan | Layer skipped with actionable note | Pending |
| Font unavailable during preflight | No text writes occur | Pending |
| Cancel during scan | No edits; partial inventory discarded | Pending |
| Cancel during font loading | No edits | Pending |
| Cancel during replacement | Completed edits counted; future writes stop | Pending |
| Native undo / redo | Apply groups correctly and restores fonts/styles as expected | Pending |
| Entire-file scan | Loads only requested pages; no navigation side effects | Pending |
| Large file, 1k / 10k text nodes | Measure scan/load/apply and longest UI stall separately | Pending |
| Dark theme and resize | All states legible; no clipped actions | Pending |

Do not publish performance percentages until matched-scope baseline and candidate runs produce equivalent correct results. Browser preview timings are not Figma benchmarks.
