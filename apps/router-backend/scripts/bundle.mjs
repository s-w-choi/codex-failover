import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const repoRoot = resolve(__dirname, '../../..');

const external = [
  '@hono/node-server',
  'hono',
  'dotenv',
  'electron',
];

await build({
  entryPoints: [
    join(projectRoot, 'src/cli.ts'),
    join(projectRoot, 'src/index.ts'),
  ],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: join(projectRoot, 'dist'),
  external,
});

const trayDist = join(repoRoot, 'apps/router-tray/dist');
const trayOut = join(projectRoot, 'dist/tray');
mkdirSync(trayOut, { recursive: true });
cpSync(trayDist, trayOut, { recursive: true });
