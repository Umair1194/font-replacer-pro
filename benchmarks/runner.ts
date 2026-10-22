import { FontEngine } from '../src/engine';
import { defaultOptions, fontKey, type Response } from '../src/shared';

const source = { family: 'Source', style: 'Regular' }, other = { family: 'Unchanged', style: 'Regular' }, target = { family: 'Target', style: 'Regular' };
console.log('EMULATED API BENCHMARK: these numbers do not measure Figma or compare against Uwarp.');
for (const size of [1000, 10000]) {
  const samples: { scan: number; plan: number; apply: number }[] = [];
  for (let run = 0; run < 5; run++) {
    const root = { id: 'root', type: 'DOCUMENT', children: [] as unknown[] };
    const page = { id: 'page', type: 'PAGE', name: 'Benchmark', selection: [], parent: root, children: [] as unknown[], loadAsync: async () => {} };
    root.children.push(page);
    const nodes = new Map<string, unknown>();
    for (let i = 0; i < size; i++) {
      const node = { id: String(i), type: 'TEXT', name: 'Benchmark text', parent: page, visible: true, locked: false, characters: 'Benchmark text', fontName: i % 10 === 0 ? source : other, boundVariables: {}, textStyleId: '', hasMissingFont: false,
        getStyledTextSegments() { return [{ start: 0, end: this.characters.length, fontName: this.fontName, boundVariables: {}, textStyleId: '' }]; },
        setRangeFontName(_start: number, _end: number, font: typeof source) { this.fontName = font; },
        getRangeFontName() { return this.fontName; },
      };
      nodes.set(node.id, node); page.children.push(node);
    }
    (globalThis as unknown as { figma: unknown }).figma = { mixed: Symbol('mixed'), root, currentPage: page, loadFontAsync: async () => {}, getNodeByIdAsync: async (id: string) => nodes.get(id), commitUndo() {} };
    let invId = '', planId = '', changed = 0;
    const send = (message: Response) => {
      if (message.type === 'INVENTORY') invId = message.inventory.id;
      if (message.type === 'REVIEW') planId = message.review.id;
      if (message.type === 'RESULT') changed = message.result.changedLayers;
    };
    const engine = new FontEngine(send); engine.setCatalog([source, other, target]);
    const start = Date.now(); await engine.scan(defaultOptions); const scanned = Date.now();
    await engine.createPlan(invId, [{ source: fontKey(source), target }]); const planned = Date.now();
    await engine.apply(planId); const applied = Date.now();
    if (changed !== size / 10) throw new Error('Benchmark output failed correctness check');
    samples.push({ scan: scanned - start, plan: planned - scanned, apply: applied - planned });
  }
  const median = (key: keyof typeof samples[number]) => [...samples].map(s => s[key]).sort((a, b) => a - b)[2];
  console.log(JSON.stringify({ textNodes: size, mappedNodes: size / 10, runs: samples.length, medianMs: { scan: median('scan'), plan: median('plan'), apply: median('apply') }, samples }));
}
