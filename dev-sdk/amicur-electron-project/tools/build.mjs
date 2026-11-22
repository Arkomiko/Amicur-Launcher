import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

export async function buildLauncher({ outdir = 'build', sourcemap = false } = {}) {
  await mkdir(outdir, { recursive: true });
  const metadata = JSON.parse(await readFile('package.json', 'utf8'));
  const options = { outdir, sourcemap, bundle: true };
  await Promise.all([
    build({
      ...options,
      entryPoints: { main: 'src/main/main.ts', launcher: 'src/preload/launcher.ts', game: 'src/preload/game.ts' },
      platform: 'node',
      define: { __AMICUR_BUILD__: JSON.stringify(metadata.buildNumber ?? metadata.version) },
      target: 'node24',
      format: 'cjs',
      external: ['electron'],
    }),
    build({
      ...options,
      entryPoints: { interface: 'src/renderer/interface.ts', 'game-runtime': 'src/renderer/game.ts' },
      platform: 'browser',
      target: 'chrome140',
    }),
    cp('src/plugins', path.join(outdir, 'plugins'), { recursive: true }),
    cp('src/renderer/public', path.join(outdir, 'public'), { recursive: true }),
  ]);

  const localePacks = '../internal-build/locales';
  const localeDirectory = await stat(localePacks).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (localeDirectory?.isDirectory()) await cp(localePacks, path.join(outdir, 'locales'), { recursive: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildLauncher();
