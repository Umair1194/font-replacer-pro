import { fontKey, loadKey, type FontRef, type ScanOptions, type Inventory, type FontUsage, type Mapping, type Review, type Result, type Response } from './shared';

interface Segment { start: number; end: number; font: FontRef; styleId: string; bindings: string }
interface Snapshot { id: string; name: string; characters: string; segments: Segment[]; signature: string }
interface Action { start: number; end: number; target: FontRef }
interface PlannedNode { snapshot: Snapshot; actions: Action[] }
interface Plan { review: Review; nodes: PlannedNode[] }
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const textError = (e: unknown) => e instanceof Error ? e.message : String(e);
const copyFont = (f: FontRef): FontRef => ({ family: f.family, style: f.style, ...(f.variationSettings ? { variationSettings: { ...f.variationSettings } } : {}) });

export function hasFontBinding(value: object | undefined): boolean {
  const bindings = value as Record<string, unknown> | undefined;
  return !!bindings && ['fontFamily', 'fontStyle', 'fontWeight'].some(k => bindings[k] !== undefined);
}
export function policyReason(node: SceneNode, options: ScanOptions): string | undefined {
  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    if ('locked' in current && current.locked && !options.includeLocked) return 'Locked layer or ancestor';
    if ('visible' in current && !current.visible && !options.includeHidden) return 'Hidden layer or ancestor';
    if (current.type === 'INSTANCE' && !options.includeInstances) return 'Instance text';
    if ((current.type === 'COMPONENT' || current.type === 'COMPONENT_SET') && !options.includeComponents) return 'Main component text';
    current = current.parent;
  }
}
export function normalizeRoots(nodes: readonly SceneNode[]): SceneNode[] {
  const ids = new Set(nodes.map(n => n.id));
  const seen = new Set<string>();
  return nodes.filter(node => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    let p = node.parent;
    while (p && p.type !== 'PAGE' && p.type !== 'DOCUMENT') {
      if (ids.has(p.id)) return false;
      p = p.parent;
    }
    return true;
  });
}
export function takeSnapshot(node: TextNode): Snapshot {
  const characters = node.characters;
  let segments: Segment[];
  if (!characters.length) {
    if (node.fontName === figma.mixed) throw new Error('Empty text has no uniform font');
    segments = [{ start: 0, end: 0, font: copyFont(node.fontName), styleId: typeof node.textStyleId === 'string' ? node.textStyleId : '', bindings: JSON.stringify(node.boundVariables || {}) }];
  } else {
    segments = node.getStyledTextSegments(['fontName', 'textStyleId', 'boundVariables']).map(s => ({ start: s.start, end: s.end, font: copyFont(s.fontName), styleId: s.textStyleId, bindings: JSON.stringify(s.boundVariables || {}) }));
  }
  if (hasFontBinding(node.boundVariables) || segments.some(s => hasFontBinding(JSON.parse(s.bindings)))) throw new Error('Font variable binding');
  return { id: node.id, name: node.name, characters, segments, signature: JSON.stringify(segments) };
}
export function compileActions(snapshot: Snapshot, mappings: Map<string, FontRef>): Action[] {
  const actions: Action[] = [];
  let priorSegment: Segment | undefined;
  for (const segment of snapshot.segments) {
    const target = mappings.get(fontKey(segment.font));
    if (!target || fontKey(target) === fontKey(segment.font)) { priorSegment = segment; continue; }
    const previous = actions[actions.length - 1];
    // Merge only within the same original styling/binding boundary.
    if (previous && previous.end === segment.start && fontKey(previous.target) === fontKey(target) && priorSegment?.styleId === segment.styleId && priorSegment.bindings === segment.bindings) previous.end = segment.end;
    else actions.push({ start: segment.start, end: segment.end, target: copyFont(target) });
    priorSegment = segment;
  }
  return actions;
}

export class FontEngine {
  private snapshots = new Map<string, Snapshot>();
  private inventory?: Inventory;
  private plan?: Plan;
  private serial = 0;
  private cancelled = false;
  private loads = new Map<string, Promise<void>>();
  private catalog = new Set<string>();
  private busy = false;
  constructor(private send: (message: Response) => void) {}
  get isBusy() { return this.busy; }
  cancel() { this.cancelled = true; }
  setCatalog(fonts: FontRef[]) { this.catalog = new Set(fonts.map(loadKey)); }
  invalidate(reason: string) { this.plan = undefined; this.inventory = undefined; this.snapshots.clear(); this.send({ type: 'INVALIDATED', reason }); }
  private progress(stage: string, done: number, total: number) { this.send({ type: 'PROGRESS', stage, done, total }); }

  async scan(options: ScanOptions): Promise<void> {
    if (this.busy) throw new Error('Wait for the current operation to finish.');
    this.busy = true; this.cancelled = false; this.plan = undefined; this.inventory = undefined; this.snapshots.clear();
    this.send({ type: 'BUSY', operation: 'scan' });
    const start = Date.now();
    const skipped: Record<string, number> = {};
    const usage = new Map<string, FontUsage & { ids: Set<string> }>();
    let scanned = 0;
    figma.skipInvisibleInstanceChildren = false; // Complete scope; hidden text is an explicit policy.
    try {
      const page = figma.currentPage;
      const selectedRoots = normalizeRoots(page.selection);
      this.scopeRoots = new Set(selectedRoots.map(n => n.id));
      if (options.scope === 'selection' && !selectedRoots.length) throw new Error('Select a text layer, frame, or group in Figma, then scan again.');
      const pages = options.scope === 'document' ? [...figma.root.children] : [page];
      this.scopePages = new Set(pages.map(p => p.id));
      for (let index = 0; index < pages.length; index++) {
        if (this.cancelled) break;
        const targetPage = pages[index];
        this.progress(`Loading ${targetPage.name}`, index, pages.length);
        await targetPage.loadAsync();
        const stack: SceneNode[] = options.scope === 'selection' ? [...selectedRoots] : [...targetPage.children];
        let sliceStart = Date.now();
        while (stack.length) {
          if (this.cancelled) break;
          const node = stack.pop()!;
          // Walk cooperatively, including excluded subtrees to report exact text counts.
          if ('children' in node) for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
          if (node.type === 'TEXT') {
            scanned++;
            try {
              const reason = policyReason(node, options);
              if (reason) throw new Error(reason);
              const snapshot = takeSnapshot(node);
              this.snapshots.set(node.id, snapshot);
              const missing = node.hasMissingFont;
              for (const segment of snapshot.segments) {
                const key = fontKey(segment.font);
                let row = usage.get(key);
                if (!row) { row = { key, font: segment.font, layers: 0, ranges: 0, missing: false, styled: false, ids: new Set() }; usage.set(key, row); }
                row.ids.add(node.id); row.ranges++; row.layers = row.ids.size;
                row.missing ||= missing && !this.catalog.has(loadKey(segment.font));
                row.styled ||= !!segment.styleId;
              }
            } catch (e) { const reason = textError(e); skipped[reason] = (skipped[reason] || 0) + 1; }
          }
          if (Date.now() - sliceStart >= 10) {
            this.progress(`Scanning ${targetPage.name}`, scanned, 0);
            await pause(); sliceStart = Date.now();
          }
        }
      }
      if (this.cancelled) { this.snapshots.clear(); this.send({ type: 'CANCELLED' }); return; }
      const fonts = [...usage.values()].map(({ ids: _ids, ...row }) => row).sort((a, b) => a.font.family.localeCompare(b.font.family) || a.font.style.localeCompare(b.font.style));
      this.inventory = { id: `inventory-${++this.serial}`, options: { ...options }, pageName: options.scope === 'document' ? 'Entire file' : page.name, fonts, layers: this.snapshots.size, ranges: fonts.reduce((sum, row) => sum + row.ranges, 0), scanned, skipped, duration: Date.now() - start };
      this.send({ type: 'INVENTORY', inventory: this.inventory });
    } finally { this.busy = false; }
  }

  createPlan(inventoryId: string, input: Mapping[]): void {
    if (this.busy) throw new Error('Wait for the current operation to finish.');
    if (!this.inventory || this.inventory.id !== inventoryId) throw new Error('This inventory has expired. Scan again.');
    this.plan = undefined;
    const sources = new Set(this.inventory.fonts.map(f => f.key));
    const mappings = new Map<string, FontRef>();
    for (const mapping of input) {
      if (!sources.has(mapping.source)) throw new Error('A mapping refers to a source outside this inventory.');
      if (!this.catalog.has(loadKey(mapping.target))) throw new Error(`The destination ${mapping.target.family} ${mapping.target.style} is unavailable. Refresh fonts.`);
      if (mappings.has(mapping.source)) throw new Error('Conflicting duplicate source mapping.');
      mappings.set(mapping.source, mapping.target);
    }
    const nodes: PlannedNode[] = [];
    const targets = new Set<string>();
    let ranges = 0, styledLayers = 0, variableRanges = 0;
    for (const snapshot of this.snapshots.values()) {
      const actions = compileActions(snapshot, mappings);
      if (!actions.length) continue;
      nodes.push({ snapshot, actions }); ranges += actions.length;
      if (snapshot.segments.some(s => s.styleId)) styledLayers++;
      for (const action of actions) targets.add(loadKey(action.target));
      variableRanges += snapshot.segments.filter(s => s.font.variationSettings && mappings.has(fontKey(s.font)) && fontKey(mappings.get(fontKey(s.font))!) !== fontKey(s.font)).length;
    }
    if (!nodes.length) throw new Error('Choose a different destination for at least one source font.');
    const review: Review = { id: `plan-${++this.serial}`, inventoryId, layers: nodes.length, ranges, fontsToLoad: targets.size, styledLayers, variableRanges, unmappedLayers: this.snapshots.size - nodes.length };
    this.plan = { review, nodes }; this.send({ type: 'REVIEW', review });
  }

  private async load(font: FontRef): Promise<void> {
    const key = loadKey(font);
    let promise = this.loads.get(key);
    if (!promise) {
      promise = figma.loadFontAsync({ family: font.family, style: font.style }).catch(e => { this.loads.delete(key); throw e; });
      this.loads.set(key, promise);
    }
    await promise;
  }

  async apply(planId: string): Promise<void> {
    if (this.busy) throw new Error('Wait for the current operation to finish.');
    if (!this.plan || this.plan.review.id !== planId || !this.inventory) throw new Error('This review has expired. Review your mappings again.');
    const plan = this.plan, options = this.inventory.options;
    this.plan = undefined; this.busy = true; this.cancelled = false;
    this.send({ type: 'BUSY', operation: 'apply' });
    const start = Date.now();
    const result: Result = { cancelled: false, changedLayers: 0, changedRanges: 0, skippedLayers: 0, failedLayers: 0, issues: [], duration: 0 };
    let undoOpened = false;
    try {
      const fonts = [...new Map(plan.nodes.flatMap(n => n.actions).map(a => [loadKey(a.target), a.target])).values()];
      let cursor = 0, loaded = 0;
      let loadError: unknown;
      await Promise.all(Array.from({ length: Math.min(4, fonts.length) }, async () => {
        while (cursor < fonts.length && !this.cancelled) {
          const font = fonts[cursor++];
          try { await this.load(font); loaded++; this.progress('Loading destination fonts', loaded, fonts.length); }
          catch (e) { loadError = e; this.cancelled = true; }
        }
      }));
      if (loadError) throw new Error(`No fonts changed. A destination font could not load: ${textError(loadError)}`);
      // No mutations occur unless every target load succeeds.
      let sliceStart = Date.now();
      for (let index = 0; index < plan.nodes.length && !this.cancelled; index++) {
        const { snapshot, actions } = plan.nodes[index];
        let changed = 0;
        try {
          const node = await figma.getNodeByIdAsync(snapshot.id);
          if (this.cancelled) break;
          if (!node || node.type !== 'TEXT') throw new SkipError('Layer was removed or is no longer text');
          const policy = policyReason(node, options);
          if (policy) throw new SkipError(policy);
          // A node moved outside a frozen selection/page is stale even if its text is identical.
          if (this.inventory) {
            let ancestor: BaseNode | null = node;
            while (ancestor && ancestor.type !== 'PAGE') ancestor = ancestor.parent;
            if (!ancestor || !this.scopePages.has(ancestor.id)) throw new SkipError('Layer moved outside the scanned pages');
          }
          if (options.scope === 'selection') {
            let ancestor: BaseNode | null = node;
            while (ancestor && !this.scopeRoots.has(ancestor.id)) ancestor = ancestor.parent;
            if (!ancestor) throw new SkipError('Layer moved outside the scanned selection');
          }
          let live: Snapshot;
          try { live = takeSnapshot(node); } catch (e) { throw new SkipError(textError(e)); }
          if (live.characters !== snapshot.characters || live.signature !== snapshot.signature) throw new SkipError('Text or font formatting changed after scan');
          if (!undoOpened) { figma.commitUndo(); undoOpened = true; }
          for (const action of actions) {
            if (snapshot.characters.length === 0) node.fontName = action.target;
            else node.setRangeFontName(action.start, action.end, action.target);
            changed++; result.changedRanges++;
            const assigned = snapshot.characters.length === 0 ? node.fontName : node.getRangeFontName(action.start, action.end);
            // A destination variable font may expand default axes. Compare explicit identity here.
            if (assigned === figma.mixed || assigned.family !== action.target.family || assigned.style !== action.target.style) throw new Error('Figma did not retain the requested destination font');
          }
        } catch (e) {
          if (e instanceof SkipError) result.skippedLayers++; else result.failedLayers++;
          result.issues.push({ id: snapshot.id, name: snapshot.name, reason: textError(e) });
        }
        if (changed) result.changedLayers++;
        if (Date.now() - sliceStart >= 10 || index === plan.nodes.length - 1) { this.progress('Replacing fonts', index + 1, plan.nodes.length); await pause(); sliceStart = Date.now(); }
      }
      result.cancelled = this.cancelled;
      result.duration = Date.now() - start;
      this.send({ type: 'RESULT', result });
    } finally {
      if (undoOpened) figma.commitUndo();
      this.busy = false;
      // Re-scan after any completed or partially applied job; never reuse old source states.
      this.inventory = undefined; this.snapshots.clear();
    }
  }
  private scopePages = new Set<string>();
  private scopeRoots = new Set<string>();
}
class SkipError extends Error {}
