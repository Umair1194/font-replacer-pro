import { fontKey, loadKey, type FontRef, type ScanOptions, type Inventory, type FontUsage, type Mapping, type Review, type Result, type Response } from './shared';
import { bounded, Cancelled, pause, type Token } from './operations';

interface Segment { start: number; end: number; font: FontRef; key: string; styleId: string; bindings: string }
interface Snapshot { id: string; name: string; characters: string; segments: Segment[] }
interface Action { start: number; end: number; target: FontRef }
interface PlannedNode { snapshot: Snapshot; actions: Action[] }
interface Plan { review: Review; nodes: PlannedNode[]; targets: FontRef[] }
const textError = (e: unknown) => e instanceof Error ? e.message : String(e);
const copyFont = (f: FontRef): FontRef => ({ family: f.family, style: f.style, ...(f.variationSettings ? { variationSettings: { ...f.variationSettings } } : {}) });
const bindingKey = (bindings: object | undefined) => JSON.stringify(Object.entries(bindings || {}).sort(([a], [b]) => a.localeCompare(b)));
export function hasFontBinding(value: object | undefined): boolean {
  const bindings = value as Record<string, unknown> | undefined;
  return !!bindings && ['fontFamily', 'fontStyle', 'fontWeight'].some(k => bindings[k] !== undefined);
}
function ownPolicy(node: BaseNode, o: ScanOptions): string | undefined {
  if ('locked' in node && node.locked && !o.includeLocked) return 'Locked layer or ancestor';
  if ('visible' in node && !node.visible && !o.includeHidden) return 'Hidden layer or ancestor';
  if (node.type === 'INSTANCE' && !o.includeInstances) return 'Instance text';
  if ((node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') && !o.includeComponents) return 'Main component text';
}
export function policyReason(node: SceneNode, o: ScanOptions): string | undefined {
  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    const reason = ownPolicy(current, o); if (reason) return reason;
    current = current.parent;
  }
}
export function normalizeRoots(nodes: readonly SceneNode[]): SceneNode[] {
  const ids = new Set(nodes.map(n => n.id)), seen = new Set<string>();
  return nodes.filter(node => {
    if (seen.has(node.id)) return false; seen.add(node.id);
    let p = node.parent;
    while (p && p.type !== 'PAGE' && p.type !== 'DOCUMENT') { if (ids.has(p.id)) return false; p = p.parent; }
    return true;
  });
}
export function takeSnapshot(node: TextNode): Snapshot {
  const characters = node.characters;
  if (hasFontBinding(node.boundVariables)) throw new Error('Font variable binding');
  const segments: Segment[] = [];
  if (!characters.length) {
    if (node.fontName === figma.mixed) throw new Error('Empty text has no uniform font');
    const font = copyFont(node.fontName);
    segments.push({ start: 0, end: 0, font, key: fontKey(font), styleId: typeof node.textStyleId === 'string' ? node.textStyleId : '', bindings: bindingKey(node.boundVariables) });
  } else {
    for (const s of node.getStyledTextSegments(['fontName', 'textStyleId', 'boundVariables'])) {
      if (hasFontBinding(s.boundVariables)) throw new Error('Font variable binding');
      const font = copyFont(s.fontName);
      segments.push({ start: s.start, end: s.end, font, key: fontKey(font), styleId: s.textStyleId, bindings: bindingKey(s.boundVariables) });
    }
  }
  return { id: node.id, name: node.name, characters, segments };
}
function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return a.characters === b.characters && a.segments.length === b.segments.length && a.segments.every((s, i) => {
    const t = b.segments[i]; return s.start === t.start && s.end === t.end && s.key === t.key && s.styleId === t.styleId && s.bindings === t.bindings;
  });
}
export function compileActions(snapshot: Snapshot, mappings: Map<string, FontRef>): Action[] {
  const actions: Action[] = []; let prior: Segment | undefined;
  for (const s of snapshot.segments) {
    const target = mappings.get(s.key);
    if (target && fontKey(target) !== s.key) {
      const previous = actions[actions.length - 1];
      if (previous && previous.end === s.start && loadKey(previous.target) === loadKey(target) && fontKey(previous.target) === fontKey(target) && prior?.styleId === s.styleId && prior.bindings === s.bindings) previous.end = s.end;
      else actions.push({ start: s.start, end: s.end, target });
    }
    prior = s;
  }
  return actions;
}
export class FontEngine {
  private snapshots = new Map<string, Snapshot>();
  private bySource = new Map<string, Set<string>>();
  private inventory?: Inventory;
  private plan?: Plan;
  private serial = 0;
  private token: Token = { cancelled: false };
  private loads = new Map<string, Promise<void>>();
  private catalog = new Set<string>();
  private busy = false;
  private lastProgress = 0;
  private dirty = false;
  private scanDuration = 0;
  private scopePages = new Set<string>();
  private scopeRoots = new Set<string>();
  private styleIds = new Set<string>();
  constructor(private send: (message: Response) => void, private config = { waitMs: 20000, sliceMs: 10, progressMs: 80 }) {}
  get isBusy() { return this.busy; }
  cancel() { this.token.cancelled = true; }
  setCatalog(fonts: FontRef[]) { this.catalog = new Set(fonts.map(loadKey)); }
  /** Invalidation preserves source rules in the UI; refresh is required before review. */
  invalidate(reason: string) { if (this.busy) return; this.dirty = true; this.plan = undefined; this.send({ type: 'INVALIDATED', reason }); }
  usesStyle(ids: Set<string>) { return [...ids].some(id => this.styleIds.has(id)); }
  isScopePage(id: string) { return !!this.inventory && this.scopePages.has(id); }
  private begin(operation: 'scan' | 'plan' | 'apply') {
    if (this.busy) throw new Error('Wait for the current operation to finish.');
    this.busy = true; this.token = { cancelled: false }; this.lastProgress = 0; this.send({ type: 'BUSY', operation });
  }
  private progress(stage: string, done: number, total: number, force = false) {
    if (force || Date.now() - this.lastProgress >= this.config.progressMs) { this.lastProgress = Date.now(); this.send({ type: 'PROGRESS', stage, done, total }); }
  }
  private clearInventory() { this.inventory = undefined; this.snapshots.clear(); this.bySource.clear(); this.styleIds.clear(); }

  async scan(options: ScanOptions): Promise<void> {
    this.begin('scan'); this.plan = undefined; this.clearInventory(); this.dirty = false;
    const token = this.token, start = Date.now();
    const skipped: Record<string, number> = {}, excludedContainers: Record<string, number> = {};
    const usage = new Map<string, FontUsage>(); let scanned = 0;
    const onlyIds = options.onlyNodeIds ? new Set(options.onlyNodeIds) : undefined;
    // Complete traversal remains available for exact skipped-text counting.
    figma.skipInvisibleInstanceChildren = options.fastScan !== false && !options.includeHidden;
    try {
      const page = figma.currentPage, roots = normalizeRoots(page.selection);
      this.scopeRoots = new Set(roots.map(n => n.id));
      if (options.scope === 'selection' && !roots.length) throw new Error('Select text, frames, or groups in Figma, then scan again.');
      let pages = options.scope === 'document' ? [...figma.root.children] : options.scope === 'pages' ? figma.root.children.filter(p => options.pageIds?.includes(p.id)) : [page];
      if (!pages.length) throw new Error('Choose at least one existing page to scan.');
      if (options.scope === 'pages' && new Set(options.pageIds).size !== pages.length) throw new Error('The page selection changed. Choose the pages again.');
      this.scopePages = new Set(pages.map(p => p.id));
      for (let index = 0; index < pages.length; index++) {
        if (token.cancelled) throw new Cancelled();
        const p = pages[index]; this.progress(`Loading ${p.name}`, index, pages.length, true);
        await bounded(p.loadAsync(), token, this.config.waitMs, 'Page loading');
        const stack = (options.scope === 'selection' ? roots : [...p.children]).map(node => ({ node, inherited: options.scope === 'selection' ? policyReason(node, options) : undefined as string | undefined }));
        let slice = Date.now();
        while (stack.length) {
          if (token.cancelled) throw new Cancelled();
          const { node, inherited } = stack.pop()!, reason = inherited || ownPolicy(node, options);
          if (reason && node.type !== 'TEXT' && options.fastScan !== false) {
            excludedContainers[reason] = (excludedContainers[reason] || 0) + 1;
          } else {
            if ('children' in node) { const children = node.children; for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], inherited: reason }); }
            if (node.type === 'TEXT' && (!onlyIds || onlyIds.has(node.id))) {
              scanned++;
              if (reason) skipped[reason] = (skipped[reason] || 0) + 1;
              else {
                try {
                  const snapshot = takeSnapshot(node), missing = node.hasMissingFont;
                  this.snapshots.set(node.id, snapshot);
                  for (const segment of snapshot.segments) {
                    if (segment.styleId) this.styleIds.add(segment.styleId);
                    let ids = this.bySource.get(segment.key);
                    if (!ids) { ids = new Set(); this.bySource.set(segment.key, ids); }
                    ids.add(node.id);
                    let row = usage.get(segment.key);
                    if (!row) { row = { key: segment.key, font: segment.font, layers: 0, ranges: 0, missing: false, styled: false, sampleId: node.id }; usage.set(segment.key, row); }
                    row.layers = ids.size; row.ranges++; row.missing ||= missing && !this.catalog.has(loadKey(segment.font)); row.styled ||= !!segment.styleId;
                  }
                } catch (e) { const why = textError(e); skipped[why] = (skipped[why] || 0) + 1; }
              }
            }
          }
          if (Date.now() - slice >= this.config.sliceMs) { this.progress(`Scanning ${p.name}`, scanned, 0); await pause(); slice = Date.now(); }
        }
      }
      const fonts = [...usage.values()].sort((a, b) => a.font.family.localeCompare(b.font.family) || a.font.style.localeCompare(b.font.style) || a.key.localeCompare(b.key));
      this.scanDuration = Date.now() - start;
      const scopeName = options.scope === 'document' ? 'Entire file' : options.scope === 'pages' ? `${pages.length} selected ${pages.length === 1 ? 'page' : 'pages'}` : page.name;
      this.inventory = { id: `inventory-${++this.serial}`, options: { ...options, pageIds: options.pageIds ? [...options.pageIds] : undefined, onlyNodeIds: options.onlyNodeIds ? [...options.onlyNodeIds] : undefined }, pageName: onlyIds ? `Remaining work · ${scopeName}` : scopeName, fonts, layers: this.snapshots.size, ranges: fonts.reduce((s, f) => s + f.ranges, 0), scanned, skipped, excludedContainers, duration: this.scanDuration };
      this.send({ type: 'INVENTORY', inventory: this.inventory });
    } catch (e) {
      this.clearInventory();
      if (e instanceof Cancelled) this.send({ type: 'CANCELLED', operation: 'scan' }); else throw e;
    } finally { this.busy = false; }
  }

  async createPlan(inventoryId: string, input: Mapping[]): Promise<void> {
    if (!this.inventory || this.inventory.id !== inventoryId || this.dirty) throw new Error('Refresh the font inventory before reviewing these mappings.');
    this.begin('plan'); this.plan = undefined;
    const token = this.token, start = Date.now(), inv = this.inventory;
    try {
      const mappings = new Map<string, FontRef>(), affected = new Set<string>();
      for (const mapping of input) {
        if (!this.bySource.has(mapping.source)) throw new Error('A source is outside this inventory. Refresh before reviewing.');
        if (!this.catalog.has(loadKey(mapping.target))) throw new Error(`Destination ${mapping.target.family} ${mapping.target.style} is unavailable. Refresh fonts or choose another destination.`);
        if (mappings.has(mapping.source)) throw new Error('Conflicting duplicate source mapping.');
        mappings.set(mapping.source, copyFont(mapping.target));
        if (mapping.source !== fontKey(mapping.target)) for (const id of this.bySource.get(mapping.source)!) affected.add(id);
      }
      const nodes: PlannedNode[] = [], targets = new Map<string, FontRef>();
      let ranges = 0, styledLayers = 0, variableRanges = 0, done = 0, slice = Date.now();
      for (const id of affected) {
        if (token.cancelled) throw new Cancelled();
        const snapshot = this.snapshots.get(id)!, actions = compileActions(snapshot, mappings);
        if (actions.length) {
          nodes.push({ snapshot, actions }); ranges += actions.length;
          if (snapshot.segments.some(s => s.styleId)) styledLayers++;
          for (const action of actions) targets.set(loadKey(action.target), action.target);
          for (const s of snapshot.segments) if (s.font.variationSettings && mappings.has(s.key) && fontKey(mappings.get(s.key)!) !== s.key) variableRanges++;
        }
        done++;
        if (Date.now() - slice >= this.config.sliceMs) { this.progress('Preparing review', done, affected.size); await pause(); slice = Date.now(); }
      }
      if (!nodes.length) throw new Error('Choose a different destination for at least one source font.');
      const effective = input.filter(m => m.source !== fontKey(m.target));
      const review: Review = { id: `plan-${++this.serial}`, inventoryId, layers: nodes.length, ranges, fontsToLoad: targets.size, styledLayers, variableRanges, unmappedLayers: this.snapshots.size - nodes.length, mappedStyles: effective.length, unmappedStyles: inv.fonts.length - effective.length, mappings: effective, duration: Date.now() - start };
      this.plan = { review, nodes, targets: [...targets.values()] }; this.send({ type: 'REVIEW', review });
    } catch (e) { if (e instanceof Cancelled) this.send({ type: 'CANCELLED', operation: 'plan' }); else throw e; }
    finally { this.busy = false; }
  }

  private async load(font: FontRef, token: Token): Promise<void> {
    const key = loadKey(font); let promise = this.loads.get(key);
    if (!promise) { promise = figma.loadFontAsync({ family: font.family, style: font.style }); this.loads.set(key, promise); }
    try { await bounded(promise, token, this.config.waitMs, `${font.family} ${font.style}`); }
    catch (e) { if (this.loads.get(key) === promise) this.loads.delete(key); throw e; }
  }
  async apply(planId: string): Promise<void> {
    if (!this.plan || this.plan.review.id !== planId || !this.inventory || this.dirty) throw new Error('This review expired. Refresh and review your mappings again.');
    const plan = this.plan, options = this.inventory.options; this.begin('apply'); this.plan = undefined;
    const token = this.token, start = Date.now();
    const result: Result = { cancelled: false, changedLayers: 0, changedRanges: 0, verifiedRanges: 0, verificationFailures: 0, plannedLayers: plan.nodes.length, processedLayers: 0, remainingLayers: plan.nodes.length, skippedLayers: 0, failedLayers: 0, issues: [], duration: 0, timings: { scan: this.scanDuration, plan: plan.review.duration, load: 0, apply: 0, verification: 0 } };
    let undoOpened = false, fatal: unknown;
    const retryIds = new Set(plan.nodes.map(n => n.snapshot.id));
    try {
      let cursor = 0, loaded = 0; const loadStart = Date.now(); let loadError: unknown;
      await Promise.all(Array.from({ length: Math.min(4, plan.targets.length) }, async () => {
        while (cursor < plan.targets.length && !token.cancelled && !loadError) {
          const font = plan.targets[cursor++];
          try { await this.load(font, token); loaded++; this.progress('Loading destination fonts', loaded, plan.targets.length); }
          catch (e) { if (!(e instanceof Cancelled)) { loadError = e; token.cancelled = true; } }
        }
      }));
      result.timings.load = Date.now() - loadStart;
      if (loadError) throw new Error(`No fonts changed. ${textError(loadError)}`);
      if (token.cancelled) throw new Cancelled();
      let slice = Date.now(); const applyStart = Date.now();
      for (const { snapshot, actions } of plan.nodes) {
        if (token.cancelled) break;
        let changed = 0;
        try {
          const node = await bounded(figma.getNodeByIdAsync(snapshot.id), token, this.config.waitMs, 'Layer lookup');
          if (token.cancelled) throw new Cancelled();
          if (!node || node.type !== 'TEXT') throw new SkipError('Layer was removed or is no longer text');
          const reason = policyReason(node, options); if (reason) throw new SkipError(reason);
          let p: BaseNode | null = node;
          while (p && p.type !== 'PAGE') p = p.parent;
          if (!p || !this.scopePages.has(p.id)) throw new SkipError('Layer moved outside the scanned pages');
          if (options.scope === 'selection') {
            let ancestor: BaseNode | null = node; while (ancestor && !this.scopeRoots.has(ancestor.id)) ancestor = ancestor.parent;
            if (!ancestor) throw new SkipError('Layer moved outside the scanned selection');
          }
          let live: Snapshot; try { live = takeSnapshot(node); } catch (e) { throw new SkipError(textError(e)); }
          if (!sameSnapshot(snapshot, live)) throw new SkipError('Text or font formatting changed after scan');
          if (!undoOpened) { figma.commitUndo(); undoOpened = true; }
          // No await inside a node: finish its original ranges before yielding.
          for (const action of actions) {
            if (!snapshot.characters.length) node.fontName = action.target; else node.setRangeFontName(action.start, action.end, action.target);
            changed++; result.changedRanges++;
            const verifyStart = Date.now();
            let verified = false;
            try {
              const assigned = !snapshot.characters.length ? node.fontName : node.getRangeFontName(action.start, action.end);
              verified = assigned !== figma.mixed && assigned.family === action.target.family && assigned.style === action.target.style && Object.entries(action.target.variationSettings || {}).every(([axis, value]) => assigned.variationSettings?.[axis] === value);
            } catch (e) { throw new VerificationError(`Font write completed, but read-back failed: ${textError(e)}`); }
            finally { result.timings.verification! += Date.now() - verifyStart; }
            if (!verified) throw new VerificationError('Font write completed, but the destination could not be verified');
            result.verifiedRanges++;
          }
          retryIds.delete(snapshot.id);
        } catch (e) {
          if (e instanceof Cancelled) break;
          const kind = e instanceof SkipError ? 'skipped' : e instanceof VerificationError ? 'verification' : 'failed';
          if (kind === 'verification') result.verificationFailures++;
          if (kind === 'skipped') result.skippedLayers++; else result.failedLayers++;
          result.issues.push({ id: snapshot.id, name: snapshot.name, reason: textError(e), kind });
        }
        if (changed) result.changedLayers++;
        result.processedLayers++;
        if (Date.now() - slice >= this.config.sliceMs) { this.progress('Replacing fonts', result.processedLayers, plan.nodes.length); await pause(); slice = Date.now(); }
      }
      result.timings.apply = Math.max(0, Date.now() - applyStart - result.timings.verification!);
    } catch (e) { if (!(e instanceof Cancelled)) fatal = e; }
    finally {
      // Even a host undo-history failure must release the operation and snapshots.
      try { if (undoOpened) figma.commitUndo(); }
      catch (e) { result.warning = `Edits were made, but Figma could not finalize undo history: ${textError(e)}`; }
      finally { this.busy = false; this.clearInventory(); }
    }
    if (fatal) throw fatal;
    result.cancelled = token.cancelled; result.remainingLayers = result.plannedLayers - result.processedLayers; result.duration = Date.now() - start; result.retryNodeIds = [...retryIds];
    this.progress('Finished', result.processedLayers, result.plannedLayers, true); this.send({ type: 'RESULT', result });
  }
}
class SkipError extends Error {}
class VerificationError extends Error {}
