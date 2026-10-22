import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const dir = await mkdtemp(join(tmpdir(), 'font-replacer-tests-'));
try {
  await build({ entryPoints: ['src/ui.ts', 'src/main.ts'], bundle: true, outdir: dir, format: 'iife' });
  await build({ entryPoints: ['tests/engine.test.mjs', 'tests/startup.test.mjs'], bundle: true, outdir: dir, outExtension: { '.js': '.mjs' }, platform: 'node', format: 'esm', target: 'node22' });
  const result = spawnSync(process.execPath, ['--test', join(dir, 'engine.test.mjs'), join(dir, 'startup.test.mjs')], { stdio: 'inherit' });
  process.exitCode = result.status || 0;
} finally { await rm(dir, { recursive: true, force: true }); }
