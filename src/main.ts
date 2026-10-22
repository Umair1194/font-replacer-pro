import { FontEngine } from './engine';
import { isRequest, type FontRef, type Response } from './shared';
import { VERSION } from './version';

const send = (message: Response) => figma.ui.postMessage(message);
let operationId: string | undefined;
const engine = new FontEngine(message => send({ ...message, requestId: operationId }));
let fonts: FontRef[] | undefined, fontRequest: Promise<void> | undefined;
const context = () => send({ type: 'CONTEXT', selected: figma.currentPage.selection.length, pageName: figma.currentPage.name, pages: figma.root?.children.map(p => ({ id: p.id, name: p.name })) || [] });
async function loadCatalog(refresh = false) {
  if (fontRequest) return fontRequest;
  if (fonts && !refresh) return;
  fontRequest = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const available = await Promise.race([
      figma.listAvailableFontsAsync(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Figma did not return its font list within 20 seconds. Check the editor, then retry the connection.')), 20000); }),
    ]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
    fonts = available.map(f => ({ family: f.fontName.family, style: f.fontName.style })).sort((a, b) => a.family.localeCompare(b.family) || a.style.localeCompare(b.style));
    engine.setCatalog(fonts);
  })();
  try { await fontRequest; } finally { fontRequest = undefined; }
}
async function catalog(refresh = false) { await loadCatalog(refresh); send({ type: 'FONTS', fonts: fonts || [] }); }
const subscribed = new Set<string>();
function observeLoadedPages() {
  // Observe loaded pages without forcing a whole-file load. Writes retain per-node validation.
  for (const page of figma.root?.children || []) {
    if (subscribed.has(page.id)) continue;
    try {
      page.on('nodechange', event => {
        if (engine.isBusy || !engine.isScopePage(page.id)) return;
        const relevant = event.nodeChanges.some(c => c.type !== 'PROPERTY_CHANGE' || c.properties.some(p => ['characters', 'fontName', 'textStyleId', 'boundVariables', 'parent', 'visible', 'locked'].includes(p)));
        if (relevant) engine.invalidate('Text or scope changed. Refresh to revalidate your saved mappings.');
      });
      subscribed.add(page.id);
    } catch { /* Unloaded pages are subscribed after the next scan. */ }
  }
}
figma.on('selectionchange', context);
figma.on('currentpagechange', context);
figma.on('stylechange', event => {
  if (!engine.isBusy && engine.usesStyle(new Set(event.styleChanges.map(c => c.id)))) engine.invalidate('A text style used by this inventory changed. Refresh to keep and revalidate your mappings.');
});
figma.ui.onmessage = async (value: unknown) => {
  if (!isRequest(value)) { send({ type: 'ERROR', message: 'Invalid plugin request.', area: 'navigation' }); return; }
  const requestId = value.requestId;
  const operation = ['SCAN', 'PLAN', 'APPLY'].includes(value.type);
  try {
    if (operation && engine.isBusy) throw new Error('Wait for the current operation to finish.');
    if (operation) operationId = requestId;
    switch (value.type) {
      case 'INIT':
        context(); await catalog();
        if (figma.clientStorage) {
          try { const saved = await figma.clientStorage.getAsync('recent-font-families'); if (Array.isArray(saved)) send({ type: 'RECENTS', families: saved.filter(f => typeof f === 'string').slice(0, 8) }); } catch { /* Preferences must not block startup. */ }
        }
        break;
      case 'REFRESH_FONTS': await catalog(true); break;
      case 'SAVE_RECENTS': if (figma.clientStorage) await figma.clientStorage.setAsync('recent-font-families', value.families.slice(0, 8)); break;
      case 'SCAN':
        // Inventory reads do not wait for slow font enumeration. Replacements still require a catalog.
        await engine.scan(value.options); observeLoadedPages(); break;
      case 'PLAN': await engine.createPlan(value.inventoryId, value.mappings); break;
      case 'APPLY': await engine.apply(value.planId); break;
      case 'CANCEL': engine.cancel(); break;
      case 'FOCUS': {
        if (engine.isBusy) throw new Error('Finish or cancel before navigating.');
        const node = await figma.getNodeByIdAsync(value.id);
        if (!node || !('visible' in node)) throw new Error('This layer is no longer available.');
        let page: BaseNode | null = node;
        while (page && page.type !== 'PAGE') page = page.parent;
        if (page?.type === 'PAGE') await figma.setCurrentPageAsync(page);
        figma.currentPage.selection = [node]; figma.viewport.scrollAndZoomIntoView([node]); break;
      }
      case 'RESIZE': figma.ui.resize(Math.max(400, Math.min(900, Math.round(value.width))), Math.max(500, Math.min(1000, Math.round(value.height)))); break;
    }
  } catch (e) { send({ type: 'ERROR', requestId, area: operation ? 'operation' : value.type === 'INIT' || value.type === 'REFRESH_FONTS' ? 'startup' : 'navigation', message: e instanceof Error ? e.message : String(e) }); }
};
console.info(`[Font Replacer Pro ${VERSION}] Sandbox ready`);
figma.showUI(__html__, { width: 480, height: 700, themeColors: true });
context();
void catalog().catch(e => send({ type: 'ERROR', area: 'startup', message: e instanceof Error ? e.message : String(e) }));
