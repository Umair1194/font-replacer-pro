import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

function uiHarness() {
  const elements = new Map(), timers = new Map(), sent = [];
  let nextTimer = 0, now = 0;
  const get = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', get innerHTML() { return this._html || ''; }, set innerHTML(value) { this._html = value; this.textContent = value.replace(/<[^>]*>/g, ''); }, disabled: false, hidden: false, open: false, toggleAttribute() {}, setAttribute() {}, querySelectorAll: () => [] });
    return elements.get(id);
  };
  const parent = { postMessage: value => sent.push(value.pluginMessage) }, window = {};
  runInNewContext(ui, { window, parent, console: { info() {} }, document: { getElementById: get, querySelectorAll: () => [] }, Date: class extends Date { static now() { return now; } }, setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) });
  return { get, sent, parent, window, timers, receive: (message, source = null) => window.onmessage({ source, data: { pluginMessage: message } }), advance(ms) { now += ms; const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); } };
}
const fonts = { type: 'FONTS', fonts: [{ family: 'Inter', style: 'Regular' }] };
test('native Figma replies with null source finish startup and enable scanning', () => {
  const h = uiHarness(); assert.equal(h.get('primary').disabled, true);
  h.receive({ type: 'CONTEXT', selected: 0, pageName: 'Native Figma page' }); h.receive(fonts);
  assert.equal(h.get('context').textContent, 'Native Figma page');
  assert.match(h.get('primary').textContent, /Scan current page/); assert.equal(h.get('primary').disabled, false); assert.equal(h.timers.size, 0);
});
test('Figma relay-window replies and direct browser-parent replies both complete startup', () => {
  const h = uiHarness(); h.receive({ type: 'CONTEXT', selected: 0, pageName: 'Relayed Figma page' }, {}); h.receive(fonts, {});
  assert.equal(h.get('context').textContent, 'Relayed Figma page'); assert.equal(h.get('primary').disabled, false);
  h.receive(fonts, h.parent); assert.equal(h.get('primary').disabled, false);
});
test('lost INIT is retried and a missing bridge becomes an actionable retry state', () => {
  const h = uiHarness(); assert.equal(h.sent.length, 1);
  h.advance(1000); assert.equal(h.sent.length, 2);
  h.advance(25000); assert.match(h.get('primary').textContent, /Retry connection/); assert.equal(h.get('primary').disabled, false);
  h.get('primary').onclick(); assert.equal(h.sent.at(-1).type, 'INIT'); assert.equal(h.get('primary').disabled, true);
  h.receive({ type: 'CONTEXT', selected: 0, pageName: 'Recovered' }); h.receive(fonts); assert.equal(h.get('primary').disabled, false);
});
test('font enumeration errors expose Retry rather than an indefinitely disabled button', () => {
  const h = uiHarness(); h.receive({ type: 'ERROR', message: 'Font list unavailable' });
  assert.match(h.get('primary').textContent, /Retry connection/); assert.equal(h.get('primary').disabled, false); assert.equal(h.timers.size, 0);
});
test('sandbox receiver is installed before showUI and immediate INIT receives both responses', async () => {
  const sent = [];
  const api = { ui: { postMessage: m => sent.push(m) }, currentPage: { selection: [], name: 'Immediate host' }, on() {}, listAvailableFontsAsync: async () => [{ fontName: { family: 'Inter', style: 'Regular' } }], showUI() { assert.equal(typeof api.ui.onmessage, 'function'); api.ready = api.ui.onmessage({ type: 'INIT' }); } };
  runInNewContext(main, { figma: api, __html__: '', setTimeout, clearTimeout });
  await api.ready;
  assert.equal(sent[0].type, 'CONTEXT'); assert.ok(sent.some(m => m.type === 'FONTS'));
});
test('sandbox font timeout reports an error and ignores a late font-list result', async () => {
  const sent = [];
  let expire, resolveFonts;
  const api = { ui: { postMessage: m => sent.push(m) }, currentPage: { selection: [], name: 'Slow host' }, on() {}, listAvailableFontsAsync: () => new Promise(resolve => { resolveFonts = resolve; }), showUI() { api.ready = api.ui.onmessage({ type: 'INIT' }); } };
  runInNewContext(main, { figma: api, __html__: '', setTimeout: fn => { expire = fn; return 1; }, clearTimeout() {} });
  expire(); await api.ready;
  assert.equal(sent.at(-1).type, 'ERROR'); assert.match(sent.at(-1).message, /20 seconds/);
  resolveFonts([{ fontName: { family: 'Inter', style: 'Regular' } }]); await Promise.resolve(); await Promise.resolve();
  assert.equal(sent.filter(m => m.type === 'FONTS').length, 0);
  api.listAvailableFontsAsync = async () => [{ fontName: { family: 'Inter', style: 'Regular' } }];
  await api.ui.onmessage({ type: 'INIT' }); assert.equal(sent.at(-1).type, 'FONTS');
});
test('sandbox bootstraps the compiled UI through a forwarding window without any INIT delivery', async () => {
  const h = uiHarness();
  const relay = {};
  const api = { ui: { postMessage: m => h.receive(m, relay) }, currentPage: { selection: [], name: 'Host-initiated connection' }, on() {}, listAvailableFontsAsync: async () => [{ fontName: { family: 'Inter', style: 'Regular' } }], showUI() {} };
  runInNewContext(main, { figma: api, __html__: '', setTimeout, clearTimeout });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.get('context').textContent, 'Host-initiated connection'); assert.equal(h.get('primary').disabled, false); assert.equal(h.timers.size, 0);
});

test('malformed host payloads do not replace a healthy interface state', () => {
  const h = uiHarness(); h.receive({ type: 'CONTEXT', selected: 0, pageName: 'Healthy page' }); h.receive(fonts);
  const label = h.get('primary').textContent;
  h.receive({ type: 'FONTS', fonts: [{ family: null, style: 42 }] });
  h.receive({ type: 'RESULT', result: { changedLayers: -1 } });
  assert.equal(h.get('primary').textContent, label); assert.equal(h.get('context').textContent, 'Healthy page');
});
test('scan can begin while the destination font catalog is still loading', () => {
  const h = uiHarness(); h.receive({ type: 'CONTEXT', selected: 0, pageName: 'Available scope' });
  assert.equal(h.get('primary').disabled, false); h.get('primary').onclick();
  const scan = h.sent.at(-1); assert.equal(scan.type, 'SCAN'); assert.match(scan.requestId, /operation-/);
  h.receive({ type: 'PROGRESS', requestId: 'operation-obsolete', stage: 'Obsolete scan', done: 1, total: 10 });
  assert.notEqual(h.get('progress-title').textContent, 'Obsolete scan');
  h.receive({ type: 'ERROR', requestId: 'operation-obsolete', area: 'operation', message: 'Old operation failed' });
  assert.equal(h.get('notice').textContent, '');
});
test('unrelated style changes do not invalidate the inventory', async () => {
  const events = new Map(), sent = [];
  const api = { ui: { postMessage: m => sent.push(m) }, currentPage: { selection: [], name: 'Style fixture' }, on: (name, callback) => events.set(name, callback), listAvailableFontsAsync: async () => [], showUI() {} };
  runInNewContext(main, { figma: api, __html__: '', setTimeout, clearTimeout });
  await new Promise(resolve => setImmediate(resolve));
  events.get('stylechange')({ styleChanges: [{ id: 'unrelated-paint', type: 'STYLE_PROPERTY_CHANGE', style: { type: 'PAINT' } }] });
  assert.equal(sent.some(m => m.type === 'INVALIDATED'), false);
});
