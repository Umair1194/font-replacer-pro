import test from 'node:test';
import assert from 'node:assert/strict';
import { FontEngine, compileActions, normalizeRoots, policyReason, takeSnapshot } from '../src/engine';
import { defaultOptions, fontKey, isRequest, matchStyle } from '../src/shared';

const A = { family: 'Alpha', style: 'Regular' }, B = { family: 'Beta', style: 'Regular' }, C = { family: 'Gamma', style: 'Regular' };
let serial = 0;
let mock;
function setup() {
  const nodes = new Map();
  const root = { id: 'root', type: 'DOCUMENT', parent: null, children: [] };
  function page(name = 'Page 1') { const p = { id: `page-${++serial}`, type: 'PAGE', name, children: [], selection: [], parent: root, loadAsync: async () => { p.loaded = true; } }; root.children.push(p); return p; }
  const p = page();
  const api = { root, currentPage: p, mixed: Symbol('mixed'), getNodeByIdAsync: async id => nodes.get(id) || null, loadFontAsync: async font => { api.loads.push(font); }, loads: [], undo: 0, commitUndo: () => { api.undo++; } };
  globalThis.figma = api;
  function append(node, parent) { node.parent = parent; parent.children.push(node); nodes.set(node.id, node); return node; }
  function frame(parent = p, extra = {}) { return append({ id: `frame-${++serial}`, type: 'FRAME', children: [], visible: true, locked: false, ...extra }, parent); }
  function text(chars = 'Hello world', segments = [{ start: 0, end: chars.length, fontName: A }], parent = p, extra = {}) {
    const n = { id: `text-${++serial}`, type: 'TEXT', name: 'Example', visible: true, locked: false, characters: chars, boundVariables: {}, textStyleId: '', hasMissingFont: false, writes: 0, segments: segments.map(s => ({ textStyleId: '', boundVariables: {}, ...s })), ...extra };
    Object.defineProperty(n, 'fontName', { get() { return n.segments.every(s => fontKey(s.fontName) === fontKey(n.segments[0].fontName)) ? n.segments[0].fontName : api.mixed; }, set(font) { n.segments = [{ start: 0, end: n.characters.length, fontName: font, textStyleId: '', boundVariables: {} }]; n.writes++; } });
    n.getStyledTextSegments = () => n.segments.map(s => ({ ...s }));
    n.setRangeFontName = (start, end, font) => {
      if (n.failAt === n.writes + 1) throw new Error('Simulated write failure');
      assert.ok(start >= 0 && end <= n.characters.length && start < end);
      n.segments = n.segments.flatMap(s => {
        if (s.end <= start || s.start >= end) return [s];
        const parts = [];
        if (s.start < start) parts.push({ ...s, end: start });
        parts.push({ ...s, start: Math.max(s.start, start), end: Math.min(s.end, end), fontName: font });
        if (s.end > end) parts.push({ ...s, start: end });
        return parts;
      }); n.writes++;
    };
    n.getRangeFontName = (start, end) => {
      const s = n.segments.filter(s => s.start < end && s.end > start);
      return s.every(v => fontKey(v.fontName) === fontKey(s[0].fontName)) ? s[0].fontName : api.mixed;
    };
    return append(n, parent);
  }
  const messages = [];
  const engine = new FontEngine(m => messages.push(m)); engine.setCatalog([A, B, C]);
  mock = { api, nodes, p, page, frame, text, engine, messages };
  return mock;
}
async function scan(m, options = defaultOptions) { await m.engine.scan(options); return m.messages.findLast(v => v.type === 'INVENTORY').inventory; }
async function plan(m, inv, mappings) { await m.engine.createPlan(inv.id, mappings); return m.messages.findLast(v => v.type === 'REVIEW').review; }
async function apply(m, r) { await m.engine.apply(r.id); return m.messages.findLast(v => v.type === 'RESULT').result; }

test('font keys are collision-safe and axis-order independent', () => {
  assert.equal(fontKey({ ...A, variationSettings: { wght: 500, wdth: 80 } }), fontKey({ ...A, variationSettings: { wdth: 80, wght: 500 } }));
  assert.notEqual(fontKey(A), fontKey({ ...A, variationSettings: { wght: 400 } }));
  assert.notEqual(fontKey({ family: 'A|B', style: 'C' }), fontKey({ family: 'A', style: 'B|C' }));
});
test('style matching is conservative and never silently falls back to regular', () => {
  assert.equal(matchStyle({ ...A, style: 'SemiBold' }, [{ ...B, style: 'Semi Bold' }]).style, 'Semi Bold');
  assert.equal(matchStyle({ ...A, style: 'Bold Italic' }, [B]), undefined);
  assert.equal(matchStyle({ ...A, style: 'Book' }, [B]), undefined);
  assert.equal(matchStyle({ ...A, style: 'semi_bold' }, [{ ...B, style: 'Semi Bold' }, { ...B, style: 'Semi-Bold' }]), undefined);
});
test('request validation rejects unknown messages, malformed maps, and unsafe dimensions', () => {
  assert.equal(isRequest({ type: 'SCAN', options: defaultOptions }), true);
  assert.equal(isRequest({ type: 'PLAN', inventoryId: 'a', mappings: [{ source: 'x', target: B }] }), true);
  assert.equal(isRequest({ type: 'PLAN', inventoryId: 'a', mappings: [{ source: 'x', target: { family: 'X' } }] }), false);
  assert.equal(isRequest({ type: 'RESIZE', width: Infinity, height: 600 }), false);
  assert.equal(isRequest({ type: 'EVAL', code: 'something' }), false);
});
test('selection roots deduplicate both explicit duplicates and nested roots', () => {
  const m = setup(), group = m.frame(), t = m.text('Hi', undefined, group);
  assert.deepEqual(normalizeRoots([t, group, group]), [group]);
});
test('policy follows hidden/locked ancestors and protects instances/components', () => {
  const m = setup(), frame = m.frame(m.p, { locked: true }), t = m.text('Hi', undefined, frame);
  assert.match(policyReason(t, defaultOptions), /Locked/);
  assert.equal(policyReason(t, { ...defaultOptions, includeLocked: true }), undefined);
  frame.locked = false; frame.visible = false;
  assert.equal(policyReason(t, defaultOptions), undefined);
  assert.match(policyReason(t, { ...defaultOptions, includeHidden: false }), /Hidden/);
  frame.visible = true; frame.type = 'INSTANCE'; assert.match(policyReason(t, defaultOptions), /Instance/);
  frame.type = 'COMPONENT'; assert.match(policyReason(t, defaultOptions), /component/);
});
test('scan counts a mixed node once per font, and excludes font-variable bindings', async () => {
  const m = setup();
  m.text('abcdef', [{ start: 0, end: 2, fontName: A }, { start: 2, end: 4, fontName: B }, { start: 4, end: 6, fontName: A }]);
  m.text('Bound', undefined, m.p, { boundVariables: { fontFamily: { id: 'variable' } } });
  const inv = await scan(m);
  assert.equal(inv.layers, 1); assert.equal(inv.fonts.length, 2); assert.equal(inv.fonts.find(f => f.font.family === 'Alpha').ranges, 2);
  assert.equal(inv.fonts.find(f => f.font.family === 'Alpha').layers, 1); assert.equal(inv.skipped['Font variable binding'], 1);
});
test('scan includes directly selected text without silently expanding empty selection', async () => {
  const m = setup(), t = m.text(); m.text(); m.p.selection = [t];
  assert.equal((await scan(m, { ...defaultOptions, scope: 'selection' })).layers, 1);
  m.p.selection = []; await assert.rejects(() => m.engine.scan({ ...defaultOptions, scope: 'selection' }), /Select text/);
});
test('document scope loads individual pages and scans both', async () => {
  const m = setup(), p2 = m.page('Second'); m.text(); m.text('Other', undefined, p2);
  assert.equal((await scan(m, { ...defaultOptions, scope: 'document' })).layers, 2);
  assert.equal(p2.loaded, true);
});
test('simultaneous A→B and B→C mappings do not cascade, preserving text/range boundaries', async () => {
  const m = setup(), t = m.text('ABCDEF', [{ start: 0, end: 3, fontName: A, textStyleId: 'style-a' }, { start: 3, end: 6, fontName: B }]);
  const inv = await scan(m), r = await plan(m, inv, [{ source: fontKey(A), target: B }, { source: fontKey(B), target: C }]);
  const result = await apply(m, r);
  assert.deepEqual(t.segments.map(s => s.fontName.family), ['Beta', 'Gamma']); assert.equal(t.characters, 'ABCDEF');
  assert.equal(t.segments[0].textStyleId, 'style-a'); assert.equal(result.changedLayers, 1); assert.equal(result.changedRanges, 2); assert.equal(m.api.undo, 2);
});
test('a missing source is replaced by loading only the destination once', async () => {
  const m = setup(); const nodes = Array.from({ length: 5 }, () => m.text('Missing', undefined, m.p, { hasMissingFont: true }));
  m.engine.setCatalog([B, C]);
  const inv = await scan(m), r = await plan(m, inv, [{ source: fontKey(A), target: B }]);
  assert.equal(inv.fonts[0].missing, true);
  const result = await apply(m, r);
  assert.equal(result.changedLayers, 5); assert.deepEqual(m.api.loads, [B]); assert.equal(nodes[0].fontName.family, 'Beta');
});
test('mixed fonts preserve unmatched source ranges', async () => {
  const m = setup(), t = m.text('Hello world', [{ start: 0, end: 5, fontName: A }, { start: 5, end: 11, fontName: C }]);
  const inv = await scan(m), r = await plan(m, inv, [{ source: fontKey(A), target: B }]); await apply(m, r);
  assert.deepEqual(t.segments.map(s => [s.start, s.end, s.fontName.family]), [[0, 5, 'Beta'], [5, 11, 'Gamma']]);
});
test('empty text uses a node-level font assignment, never an invalid empty range', async () => {
  const m = setup(), t = m.text(''); const inv = await scan(m), r = await plan(m, inv, [{ source: fontKey(A), target: B }]);
  assert.equal((await apply(m, r)).changedLayers, 1); assert.equal(t.fontName.family, 'Beta');
});
test('same-length text edits after scanning are detected before writing', async () => {
  const m = setup(), t = m.text('Alpha'); const inv = await scan(m), r = await plan(m, inv, [{ source: fontKey(A), target: B }]);
  t.characters = 'Other'; const result = await apply(m, r);
  assert.equal(t.writes, 0); assert.equal(result.skippedLayers, 1); assert.match(result.issues[0].reason, /changed after scan/);
});
test('nodes moved outside the frozen selection are skipped', async () => {
  const m = setup(), group = m.frame(), other = m.frame(), t = m.text('Hello', undefined, group); m.p.selection = [group];
  const inv = await scan(m, { ...defaultOptions, scope: 'selection' }), r = await plan(m, inv, [{ source: fontKey(A), target: B }]);
  t.parent = other; const result = await apply(m, r); assert.equal(result.skippedLayers, 1); assert.equal(t.writes, 0);
});
test('font-load failure occurs before all writes and can be retried', async () => {
  const m = setup(), t = m.text(); let fail = true;
  m.api.loadFontAsync = async () => { if (fail) throw new Error('Font unavailable'); };
  const inv = await scan(m), r = await plan(m, inv, [{ source: fontKey(A), target: B }]);
  await assert.rejects(() => m.engine.apply(r.id), /No fonts changed/); assert.equal(t.writes, 0); assert.equal(m.engine.isBusy, false);
  fail = false; const inv2 = await scan(m), r2 = await plan(m, inv2, [{ source: fontKey(A), target: B }]);
  assert.equal((await apply(m, r2)).changedLayers, 1);
});
test('cancel during font loading leaves the document unchanged', async () => {
  const m = setup(), t = m.text(); m.api.loadFontAsync = async () => m.engine.cancel();
  const inv = await scan(m), r = await plan(m, inv, [{ source: fontKey(A), target: B }]); const result = await apply(m, r);
  assert.equal(result.cancelled, true); assert.equal(result.changedLayers, 0); assert.equal(t.writes, 0); assert.equal(m.api.undo, 0);
});
test('partial write failures report completed ranges and changed layers truthfully', async () => {
  const m = setup(), t = m.text('AB', [{ start: 0, end: 1, fontName: A }, { start: 1, end: 2, fontName: B }], m.p, { failAt: 2 });
  const inv = await scan(m), r = await plan(m, inv, [{ source: fontKey(A), target: B }, { source: fontKey(B), target: C }]); const result = await apply(m, r);
  assert.equal(result.failedLayers, 1); assert.equal(result.changedLayers, 1); assert.equal(result.changedRanges, 1); assert.equal(t.segments[0].fontName.family, 'Beta');
});
test('no-op plans and duplicate mappings are rejected', async () => {
  const m = setup(); m.text(); const inv = await scan(m);
  await assert.rejects(() => plan(m, inv, [{ source: fontKey(A), target: A }]), /different destination/);
  await assert.rejects(() => plan(m, inv, [{ source: fontKey(A), target: B }, { source: fontKey(A), target: C }]), /duplicate/);
});
test('adjacent assignments merge only when style boundaries agree', () => {
  const m = setup(), t = m.text('ABC', [{ start: 0, end: 1, fontName: A }, { start: 1, end: 2, fontName: A }, { start: 2, end: 3, fontName: A, textStyleId: 'separate' }]);
  const actions = compileActions(takeSnapshot(t), new Map([[fontKey(A), B]]));
  assert.deepEqual(actions.map(a => [a.start, a.end]), [[0, 2], [2, 3]]);
});
test('a consumed plan cannot be applied twice', async () => {
  const m = setup(); m.text(); const inv = await scan(m), r = await plan(m, inv, [{ source: fontKey(A), target: B }]); await apply(m, r);
  await assert.rejects(() => m.engine.apply(r.id), /expired/);
});
test('cancel during replacement preserves the completed node and stops before the next write', async () => {
  const m = setup(); m.text(); m.text(); const inv = await scan(m), r = await plan(m, inv, [{ source: fontKey(A), target: B }]);
  let calls = 0;
  m.api.getNodeByIdAsync = async id => { if (++calls === 2) m.engine.cancel(); return m.nodes.get(id); };
  const result = await apply(m, r);
  assert.equal(result.cancelled, true); assert.equal(result.changedLayers, 1); assert.equal(result.changedRanges, 1); assert.equal(m.api.undo, 2);
});
test('deleted nodes are reported as skipped and do not stop healthy nodes', async () => {
  const m = setup(), removed = m.text(); m.text(); const inv = await scan(m), r = await plan(m, inv, [{ source: fontKey(A), target: B }]);
  m.nodes.delete(removed.id); const result = await apply(m, r);
  assert.equal(result.skippedLayers, 1); assert.equal(result.changedLayers, 1); assert.equal(result.failedLayers, 0);
});
test('moving text to a newly created page does not expand a frozen document scope', async () => {
  const m = setup(), t = m.text(); const inv = await scan(m, { ...defaultOptions, scope: 'document' }), r = await plan(m, inv, [{ source: fontKey(A), target: B }]);
  t.parent = m.page('Created after scan'); const result = await apply(m, r);
  assert.equal(result.skippedLayers, 1); assert.equal(result.changedLayers, 0);
});
test('range-level font-weight bindings are excluded even without a node binding', async () => {
  const m = setup(); m.text('Bound', [{ start: 0, end: 5, fontName: A, boundVariables: { fontWeight: { id: 'wght' } } }]);
  const inv = await scan(m); assert.equal(inv.layers, 0); assert.equal(inv.skipped['Font variable binding'], 1);
});

test('fast scan prunes excluded subtrees without inventing skipped text counts', async () => {
  const m = setup(), group = m.frame(m.p, { type: 'INSTANCE' }); let childReads = 0;
  m.text('Excluded', undefined, group);
  const children = group.children; Object.defineProperty(group, 'children', { get() { childReads++; return children; } });
  const fast = await scan(m, { ...defaultOptions, fastScan: true });
  assert.equal(fast.layers, 0); assert.equal(fast.excludedContainers['Instance text'], 1); assert.equal(childReads, 0);
  const exact = await scan(m, { ...defaultOptions, fastScan: false });
  assert.equal(exact.skipped['Instance text'], 1); assert.equal(exact.excludedContainers['Instance text'], undefined);
});
test('selected-pages scope loads only requested pages and rejects stale page IDs', async () => {
  const m = setup(), second = m.page('Second'), third = m.page('Third'); m.text(); m.text('Second', undefined, second); m.text('Third', undefined, third);
  const inv = await scan(m, { ...defaultOptions, scope: 'pages', pageIds: [second.id] });
  assert.equal(inv.layers, 1); assert.equal(second.loaded, true); assert.equal(third.loaded, undefined); assert.equal(m.p.loaded, undefined);
  await assert.rejects(() => scan(m, { ...defaultOptions, scope: 'pages', pageIds: ['removed'] }), /Choose at least one/);
});
test('unresolved font loads time out without writes and expired loads do not poison retries', async () => {
  const m = setup(), t = m.text(), messages = [];
  m.engine = new FontEngine(v => messages.push(v), { waitMs: 25, sliceMs: 10, progressMs: 80 }); m.engine.setCatalog([A, B]); m.messages = messages;
  let resolveOld; m.api.loadFontAsync = () => new Promise(resolve => { resolveOld = resolve; });
  const inv = await scan(m), r = await plan(m, inv, [{ source: fontKey(A), target: B }]);
  await assert.rejects(() => m.engine.apply(r.id), /timed out/); assert.equal(t.writes, 0); assert.equal(m.engine.isBusy, false);
  m.api.loadFontAsync = async () => {};
  const inv2 = await scan(m), r2 = await plan(m, inv2, [{ source: fontKey(A), target: B }]);
  resolveOld(); assert.equal((await apply(m, r2)).verifiedRanges, 1);
});
test('cancel interrupts a never-resolving font wait and accounts for unprocessed work', async () => {
  const m = setup(); m.text(); m.text(); m.api.loadFontAsync = () => new Promise(() => {});
  const inv = await scan(m), r = await plan(m, inv, [{ source: fontKey(A), target: B }]);
  const job = m.engine.apply(r.id); setTimeout(() => m.engine.cancel(), 5); await job;
  const result = m.messages.findLast(x => x.type === 'RESULT').result;
  assert.equal(result.cancelled, true); assert.equal(result.plannedLayers, 2); assert.equal(result.processedLayers, 0); assert.equal(result.remainingLayers, 2); assert.equal(m.engine.isBusy, false);
});
test('write verification errors are distinguished from completed and verified writes', async () => {
  const m = setup(), t = m.text(); t.getRangeFontName = () => A;
  const inv = await scan(m), r = await plan(m, inv, [{ source: fontKey(A), target: B }]), result = await apply(m, r);
  assert.equal(result.changedRanges, 1); assert.equal(result.verifiedRanges, 0); assert.equal(result.verificationFailures, 1); assert.equal(result.issues[0].kind, 'verification');
});
test('undo finalization failure releases the engine and preserves the result', async () => {
  const m = setup(); m.text(); let commits = 0;
  m.api.commitUndo = () => { if (++commits === 2) throw new Error('Undo unavailable'); };
  const inv = await scan(m), r = await plan(m, inv, [{ source: fontKey(A), target: B }]), result = await apply(m, r);
  assert.equal(result.changedLayers, 1); assert.match(result.warning, /Undo unavailable/); assert.equal(m.engine.isBusy, false); assert.equal((await scan(m)).layers, 1);
});
test('planning is cooperative and cancellation preserves the inventory for another review', async () => {
  const m = setup(); for (let i = 0; i < 20; i++) m.text();
  const messages = []; m.messages = messages;
  m.engine = new FontEngine(v => messages.push(v), { waitMs: 50, sliceMs: 0, progressMs: 0 }); m.engine.setCatalog([A, B]);
  const inv = await scan(m); const job = m.engine.createPlan(inv.id, [{ source: fontKey(A), target: B }]); m.engine.cancel(); await job;
  assert.equal(messages.at(-1).type, 'CANCELLED'); assert.equal(messages.at(-1).operation, 'plan');
  const r = await plan(m, inv, [{ source: fontKey(A), target: B }]); assert.equal(r.layers, 20);
});
test('source index limits planning to affected snapshots', async () => {
  const m = setup(); m.text('Alpha'); for (let i = 0; i < 1000; i++) m.text('Gamma', [{ start: 0, end: 5, fontName: C }]);
  const inv = await scan(m), r = await plan(m, inv, [{ source: fontKey(A), target: B }]);
  assert.equal(r.layers, 1); assert.equal(r.unmappedLayers, 1000); assert.equal(r.mappedStyles, 1); assert.equal(r.unmappedStyles, 1);
});
test('invalidation keeps source data but blocks review until refresh', async () => {
  const m = setup(); m.text('Styled', [{ start: 0, end: 6, fontName: A, textStyleId: 'text-style-1' }]);
  const inv = await scan(m); assert.equal(m.engine.usesStyle(new Set(['paint-style'])), false); assert.equal(m.engine.usesStyle(new Set(['text-style-1'])), true);
  m.engine.invalidate('Text changed'); await assert.rejects(() => plan(m, inv, [{ source: fontKey(A), target: B }]), /Refresh/);
  const refreshed = await scan(m); assert.equal((await plan(m, refreshed, [{ source: fontKey(A), target: B }])).layers, 1);
});
test('retry scopes exclude successful A→B layers when another B→C layer fails', async () => {
  const m = setup(), a = m.text('A'), b = m.text('B', [{ start: 0, end: 1, fontName: B }], m.p, { failAt: 1 });
  const inv = await scan(m), r = await plan(m, inv, [{ source: fontKey(A), target: B }, { source: fontKey(B), target: C }]), result = await apply(m, r);
  assert.equal(result.changedLayers, 1); assert.deepEqual(result.retryNodeIds, [b.id]);
  b.failAt = undefined;
  const remaining = await scan(m, { ...defaultOptions, onlyNodeIds: result.retryNodeIds });
  assert.equal(remaining.layers, 1); assert.match(remaining.pageName, /Remaining work/);
  const retry = await plan(m, remaining, [{ source: fontKey(B), target: C }]); await apply(m, retry);
  assert.equal(a.fontName.family, 'Beta'); assert.equal(b.fontName.family, 'Gamma');
});
