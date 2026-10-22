import { FontEngine } from '../src/engine';
import { fontKey, isRequest, type FontRef, type Response } from '../src/shared';

// Development only. Not included in either plugin bundle.
const catalog: FontRef[] = [
  ...['Regular', 'Medium', 'Semi Bold', 'Bold', 'Italic'].map(style => ({ family: 'Inter', style })),
  ...['Regular', 'Medium', 'SemiBold', 'Bold', 'Italic'].map(style => ({ family: 'Roboto', style })),
  ...['Regular', 'Medium', 'SemiBold', 'Bold'].map(style => ({ family: 'DM Sans', style })),
  ...['Regular', 'Bold', 'Italic'].map(style => ({ family: 'Georgia', style })),
  ...['Regular', 'Medium', 'Bold'].map(style => ({ family: 'IBM Plex Sans', style })),
];
type DevSegment = { start: number; end: number; fontName: FontRef; textStyleId: string; boundVariables: object };
const mixed = Symbol('mixed');
const nodes = new Map<string, unknown>();
const page = { id: 'page:1', name: 'Website / Exploration', type: 'PAGE', children: [] as unknown[], selection: [], parent: null as unknown, loadAsync: async () => {} };
const root = { id: 'root', type: 'DOCUMENT', children: [page], parent: null }; page.parent = root;
for (let i = 0; i < 128; i++) {
  const source = i < 82 ? { family: 'Inter', style: i % 4 === 0 ? 'Bold' : 'Regular' } : i < 116 ? { family: 'Georgia', style: 'Regular' } : { family: 'Roboto', style: 'Medium' };
  const chars = i % 2 ? 'A better way to work together.' : 'Everything starts with a little curiosity.';
  const node = {
    id: `text:${i}`, type: 'TEXT', name: i % 2 ? 'Hero / Heading' : 'Body / Description', parent: page,
    characters: chars, visible: true, locked: i >= 125, textStyleId: '', boundVariables: {}, hasMissingFont: false,
    segments: [{ start: 0, end: chars.length, fontName: source, textStyleId: '', boundVariables: {} }] as DevSegment[],
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
const send = (message: Response) => iframe.contentWindow?.postMessage({ pluginMessage: message }, window.location.origin);
const engine = new FontEngine(send); engine.setCatalog(catalog);
window.addEventListener('message', async event => {
  if (event.source !== iframe.contentWindow || !isRequest(event.data?.pluginMessage)) return;
  const request = event.data.pluginMessage;
  try {
    switch (request.type) {
      case 'INIT': send({ type: 'CONTEXT', selected: 0, pageName: page.name }); send({ type: 'FONTS', fonts: catalog }); break;
      case 'REFRESH_FONTS': send({ type: 'FONTS', fonts: catalog }); break;
      case 'SCAN': await engine.scan(request.options); break;
      case 'PLAN': engine.createPlan(request.inventoryId, request.mappings); break;
      case 'APPLY': await engine.apply(request.planId); break;
      case 'CANCEL': engine.cancel(); break;
      case 'RESIZE': iframe.style.width = `${Math.max(400, Math.min(900, request.width))}px`; iframe.style.height = `${Math.max(500, Math.min(1000, request.height))}px`; break;
      case 'FOCUS': break;
    }
  } catch (e) { send({ type: 'ERROR', message: e instanceof Error ? e.message : String(e) }); }
});
