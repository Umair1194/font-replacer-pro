import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const host = await build({ entryPoints: ['dev/preview-host.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020' });
const html = `<!doctype html><html><head><meta charset="UTF-8"><title>Font Replacer Pro · development preview</title><style>body{margin:0;background:#efedf4;font:12px system-ui;display:grid;justify-content:center;align-content:start;min-height:100vh}header{display:flex;justify-content:space-between;gap:40px;padding:20px 0;color:#777180;font-size:10px;letter-spacing:.3px}header strong{color:#423950;font-weight:600}iframe{border:1px solid #ded9e6;border-radius:13px;background:white;box-shadow:0 15px 60px #3f2c6614;width:460px;height:680px;margin-bottom:24px}p{color:#777180;font-size:10px;text-align:center;margin:0 0 18px}</style></head><body><header><strong>FONT REPLACER PRO</strong><span>Development preview · sample document</span></header><iframe title="Font Replacer Pro plugin" src="/plugin"></iframe><p>UI + real replacement engine with an emulated Figma document.</p><script>${host.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
const server = createServer(async (req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(html); }
  if (req.url === '/plugin') {
    try { res.setHeader('Content-Type', 'text/html'); res.end(await readFile('dist/ui.html')); }
    catch { res.writeHead(500); res.end('Run npm run build first.'); }
    return;
  }
  res.writeHead(404); res.end('Not found');
});
server.listen(4317, '127.0.0.1', () => console.log('Development preview: http://127.0.0.1:4317 (sample data; no real Figma document)'));
