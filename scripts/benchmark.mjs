import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const dir = await mkdtemp(join(tmpdir(), 'font-replacer-benchmark-'));
try {
  await build({ entryPoints: ['benchmarks/runner.ts'], outfile: join(dir, 'runner.mjs'), bundle: true, platform: 'node', format: 'esm' });
  const result = spawnSync(process.execPath, [join(dir, 'runner.mjs')], { stdio: 'inherit' });
  process.exitCode = result.status || 0;
} finally { await rm(dir, { force: true, recursive: true }); }
