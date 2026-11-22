import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { builtIn, validId } from './mods.js';
import { dirs, ordinaryFile, safeEntry, tempPath } from './storage.js';
import { extract } from './updates.js';

export async function installDropped(source: string, choose: (name: string) => Promise<string | null>) {
  if (typeof source !== 'string' || !path.isAbsolute(source)) throw new Error('Invalid file');
  const stage = await fs.mkdtemp(path.join(tempPath, 'mod-'));
  try {
    const info = await fs.lstat(source);
    const unpack = path.join(stage, 'files');
    if (info.isDirectory()) {
      const relative = path.relative(source, stage);
      if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new Error('Select the mod folder');
      if (!await ordinaryFile(path.join(source, 'mod-id.json'))) throw new Error('mod-id.json');
      await fs.cp(source, unpack, { recursive: true, filter: async file => {
        const stat = await fs.lstat(file);
        if (!stat.isFile() && !stat.isDirectory()) throw new Error('Unsupported file: ' + path.basename(file));
        return true;
      } });
    } else {
      if (!info.isFile() || path.extname(source).toLowerCase() !== '.zip') throw new Error('Select a ZIP or a mod folder');
      await fs.mkdir(unpack);
      await extract(source, unpack);
    }
    const roots = [];
    for (const root of [unpack, ...(await dirs(unpack)).map(dir => path.join(unpack, dir))]) {
      if (await ordinaryFile(path.join(root, 'mod-id.json'))) roots.push(root);
    }
    if (roots.length !== 1) throw new Error('Expected one mod-id.json');
    const manifest = JSON.parse(await fs.readFile(path.join(roots[0], 'mod-id.json'), 'utf8'));
    if (typeof manifest.id !== 'string' || !validId.test(manifest.id) || builtIn.has(manifest.id) || manifest.api !== 1 ||
        typeof manifest.script !== 'string' || !/^script\/(?:[\w-]+[\w.-]*\/)*[\w-]+[\w.-]*\.m?js$/.test(manifest.script) ||
        !await ordinaryFile(await safeEntry(roots[0], manifest.script))) throw new Error('Invalid mod-id.json');
    const directory = await choose([typeof manifest.name === 'string' ? manifest.name : manifest.id, manifest.version].filter(Boolean).join(' · '));
    if (!directory) return null;
    const target = path.join(directory, manifest.id);
    if (await fs.lstat(target).catch(() => null)) throw new Error('Mod already installed: ' + manifest.id);
    await fs.rename(roots[0], target);
    return manifest.id as string;
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}
