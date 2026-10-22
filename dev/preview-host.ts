import { FontEngine } from '../src/engine';
import { fontKey, isRequest, type FontRef, type Response } from '../src/shared';

// Development only. Not included in either plugin bundle.
const catalog: FontRef[] = [
  ...['Regular', 'Medium', 'Semi Bold', 'Bold', 'Italic'].map(style => ({ family: 'Inter', style })),
  ...['Regular', 'Medium', 'SemiBold', 'Bold', 'Italic'].map(style => ({ family: 'Roboto', style })),
  ...['Regular', 'Medium', 'SemiBold', 'Bold'].map(style => ({ family: 'DM Sans', style })),
  ...['Regular', 'Bold', 'Italic'].map(style => ({ family: 'Georgia', style })),
  ...['Regular', 'Medium', 'Bold'].map(style => ({ family: 'IBM Plex Sans', style })),
  ...Array.from({ length: 140 }, (_, i) => ({ family: `Fixture Sans ${String(i + 1).padStart(3, '0')}`, style: 'Regular' })),
];
type DevSegment = { start: number; end: number; fontName: FontRef; textStyleId: string; boundVariables: object };
const mixed = Symbol('mixed');
const nodes = new Map<string, unknown>();
const page = { id: 'page:1', name: 'Website / Exploration', type: 'PAGE', children: [] as unknown[], selection: [], parent: null as unknown, loadAsync: async () => {} };
const root = { id: 'root', type: 'DOCUMENT', children: [page], parent: null }; page.parent = root;
for (let i = 0; i < 128; i++) {
  const source: FontRef = i < 82 ? { family: 'Inter', style: i % 4 === 0 ? 'Bold' : 'Regular' } : i < 116 ? { family: 'Georgia', style: 'Regular' } : { family: 'Roboto', style: 'Medium' };
  if (i === 0 || i === 1) { source.style = 'Regular'; source.variationSettings = { wght: i === 0 ? 450 : 650 }; }
  if (i === 2) { source.family = 'Legacy Grotesk'; source.style = 'Regular'; }
  const chars = i % 2 ? 'A better way to work together.' : 'Everything starts with a little curiosity.';
  const node = {
    id: `text:${i}`, type: 'TEXT', name: i % 2 ? 'Hero / Heading' : 'Body / Description', parent: page,
    characters: chars, visible: true, locked: i >= 125, textStyleId: '', boundVariables: {}, hasMissingFont: i === 2,
    segments: [{ start: 0, end: chars.length, fontName: source, textStyleId: i < 10 ? 'preview-text-style' : '', boundVariables: {} }] as DevSegment[],
    get fontName(): FontRef | symbol { return this.segments.every(s => fontKey(s.fontName) === fontKey(this.segments[0].fontName)) ? this.segments[0].fontName : mixed; },
    set fontName(font: FontRef | symbol) { if (typeof font === 'object') this.segments = [{ start: 0, end: this.characters.length, fontName: font, textStyleId: '', boundVariables: {} }]; },
    getStyledTextSegments() { return this.segments.map(s => ({ ...s })); },
    setRangeFontName(start: number, end: number, font: FontRef) {
      this.segments = this.segments.flatMap(s => {
        if (s.end <= start || s.start >= end) return [s];
        const pieces: DevSegment[] = [];
        if (s.start < start) pieces.push({ ...s, end: start });
        pieces.push({ ...s, start: Math.max(start, s.start), end: Math.min(end, s.end), fontName: font });
        if (s.end > end) pieces.push({ ...s, start: end });
        return pieces;
      });
    },
    getRangeFontName(start: number, end: number) { const segments = this.segments.filter(s => s.start < end && s.end > start); return segments.every(s => fontKey(s.fontName) === fontKey(segments[0].fontName)) ? segments[0].fontName : mixed; },
  };
  nodes.set(node.id, node); page.children.push(node);
}
(globalThis as unknown as { figma: unknown }).figma = { mixed, currentPage: page, root, skipInvisibleInstanceChildren: false, getNodeByIdAsync: async (id: string) => nodes.get(id), commitUndo: () => {}, loadFontAsync: async () => new Promise(resolve => setTimeout(resolve, 100)) };
const iframe = document.querySelector('iframe')!;
const previewOptions = new URLSearchParams(window.location.search);
const themePreview = () => {
  const doc = iframe.contentDocument;
  if (!doc || previewOptions.get('theme') !== 'dark') return;
  doc.documentElement.classList.add('figma-dark');
  for (const [key, value] of Object.entries({ '--figma-color-bg': '#2c2c2c', '--figma-color-bg-secondary': '#363636', '--figma-color-text': '#f5f5f5', '--figma-color-text-secondary': '#b9b9be', '--figma-color-border': '#494949' })) doc.documentElement.style.setProperty(key, value);
};
iframe.addEventListener('load', themePreview);
if (previewOptions.get('width') === '400') iframe.style.width = '400px';
const send = (message: Response) => iframe.contentWindow?.postMessage({ pluginMessage: message }, window.location.origin);
let operationId: string | undefined;
const engine = new FontEngine(message => send({ ...message, requestId: operationId })); engine.setCatalog(catalog);
window.addEventListener('message', async event => {
  if (event.source !== iframe.contentWindow || !isRequest(event.data?.pluginMessage)) return;
  const request = event.data.pluginMessage;
  try {
    if (['SCAN', 'PLAN', 'APPLY'].includes(request.type)) {
      if (engine.isBusy) throw new Error('Operation already running');
      operationId = request.requestId;
    }
    switch (request.type) {
      case 'INIT': send({ type: 'CONTEXT', selected: 0, pageName: page.name, pages: [{ id: page.id, name: page.name }] }); send({ type: 'FONTS', fonts: catalog }); break;
      case 'REFRESH_FONTS': send({ type: 'FONTS', fonts: catalog }); break;
      case 'SCAN': await engine.scan(request.options); break;
      case 'PLAN': await engine.createPlan(request.inventoryId, request.mappings); break;
      case 'APPLY': await engine.apply(request.planId); break;
      case 'CANCEL': engine.cancel(); break;
      case 'RESIZE': iframe.style.width = `${Math.max(400, Math.min(900, request.width))}px`; iframe.style.height = `${Math.max(500, Math.min(1000, request.height))}px`; break;
      case 'FOCUS': break;
      case 'SAVE_RECENTS': break;
    }
  } catch (e) { send({ type: 'ERROR', requestId: request.requestId, area: 'operation', message: e instanceof Error ? e.message : String(e) }); }
});
