import { build, context } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const define = { __APP_VERSION__: JSON.stringify(version) };
const main = { entryPoints: ['src/main.ts'], bundle: true, outfile: 'dist/code.js', target: 'es2017', format: 'iife', legalComments: 'none', define };
const ui = {
  entryPoints: ['src/ui.ts'], bundle: true, write: false, target: 'es2020', format: 'iife', minify: true, define,
  plugins: [{ name: 'html', setup(build) { build.onEnd(async result => {
    if (result.errors.length) return;
    const [html, css] = await Promise.all([readFile('src/ui.html', 'utf8'), readFile('src/ui.css', 'utf8')]);
    await writeFile('dist/ui.html', html.replace('/* STYLES */', () => css).replace('/* SCRIPT */', () => result.outputFiles[0].text.replaceAll('</script', '<\\/script')));
  }); } }],
};
if (process.argv.includes('--watch')) {
  const contexts = await Promise.all([context(main), context(ui)]);
  await Promise.all(contexts.map(c => c.watch()));
  // esbuild watches imported JS; also watch the shell and CSS.
  const { watch } = await import('node:fs');
  for (const path of ['src/ui.html', 'src/ui.css']) watch(path, () => contexts[1].rebuild());
  console.log('Watching. Reopen the plugin in Figma after changes.');
} else {
  await Promise.all([build(main), build(ui)]);
  console.log('Built dist/code.js and dist/ui.html');
}
