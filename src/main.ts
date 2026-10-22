import { FontEngine } from './engine';
import { isRequest, type FontRef, type Response } from './shared';

const send = (message: Response) => figma.ui.postMessage(message);
const engine = new FontEngine(send);
let fonts: FontRef[] | undefined;
let fontRequest: Promise<void> | undefined;
const context = () => send({ type: 'CONTEXT', selected: figma.currentPage.selection.length, pageName: figma.currentPage.name });
async function loadCatalog(refresh = false) {
  if (fontRequest) return fontRequest;
  if (fonts && !refresh) { send({ type: 'FONTS', fonts }); return; }
  fontRequest = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const available = await Promise.race([
      figma.listAvailableFontsAsync(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Figma did not return its font list within 20 seconds. Check that the editor is ready, then retry the connection.')), 20000); }),
    ]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
    fonts = available.map(f => ({ family: f.fontName.family, style: f.fontName.style })).sort((a, b) => a.family.localeCompare(b.family) || a.style.localeCompare(b.style));
    engine.setCatalog(fonts); send({ type: 'FONTS', fonts });
    console.info('[Font Replacer Pro 0.1.2] Font catalog ready:', fonts.length);
  })();
  try { await fontRequest; } finally { fontRequest = undefined; }
}
figma.on('selectionchange', context);
figma.on('currentpagechange', context);
figma.on('stylechange', () => { if (!engine.isBusy) engine.invalidate('Text styles changed. Scan again before replacing fonts.'); });
figma.ui.onmessage = async (value: unknown) => {
  if (!isRequest(value)) { send({ type: 'ERROR', message: 'Invalid plugin request.' }); return; }
  try {
    switch (value.type) {
      case 'INIT': console.info('[Font Replacer Pro 0.1.2] UI handshake received'); context(); await loadCatalog(); break;
      case 'REFRESH_FONTS':
        if (engine.isBusy) throw new Error('Wait for the current operation to finish.');
        await loadCatalog(true); break;
      case 'SCAN':
        if (engine.isBusy) throw new Error('Wait for the current operation to finish.');
        await loadCatalog(); await engine.scan(value.options); break;
      case 'PLAN': engine.createPlan(value.inventoryId, value.mappings); break;
      case 'APPLY': await engine.apply(value.planId); break;
      case 'CANCEL': engine.cancel(); break;
      case 'FOCUS': {
        if (engine.isBusy) throw new Error('Finish or cancel the operation before navigating.');
        const node = await figma.getNodeByIdAsync(value.id);
        if (!node || !('visible' in node)) throw new Error('This layer is no longer available.');
        let p: BaseNode | null = node;
        while (p && p.type !== 'PAGE') p = p.parent;
        if (p?.type === 'PAGE') await figma.setCurrentPageAsync(p);
        figma.currentPage.selection = [node]; figma.viewport.scrollAndZoomIntoView([node]); break;
      }
      case 'RESIZE': figma.ui.resize(Math.max(400, Math.min(900, Math.round(value.width))), Math.max(500, Math.min(1000, Math.round(value.height)))); break;
    }
  } catch (e) { send({ type: 'ERROR', message: e instanceof Error ? e.message : String(e) }); }
};
// Install the receiver before the iframe can send its first INIT message.
console.info('[Font Replacer Pro 0.1.2] Sandbox ready');
figma.showUI(__html__, { width: 460, height: 680, themeColors: true });
// Figma queues outbound messages until the iframe is ready. Bootstrap from
// the sandbox as well as responding to INIT, so startup is not dependent on
// the first UI-to-host message making the round trip.
context();
void loadCatalog().catch(e => send({ type: 'ERROR', message: e instanceof Error ? e.message : String(e) }));
