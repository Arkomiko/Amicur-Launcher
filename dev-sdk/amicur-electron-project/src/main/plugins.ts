import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { data, dirs, isWithin, localDir, ordinaryFile, readJson, sharedSaves, tempPath, writeJson } from './storage.js';

export const pluginsPath = path.join(data, 'plugins');
export const defaultPack = path.join(pluginsPath, 'defold-modpack');
const validId = /^[a-z0-9][a-z0-9-]{0,63}$/;
async function directory(file: string) {
  try {
    if (!(await fs.lstat(file)).isDirectory()) throw new Error('Expected directory: ' + file);
    return true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
async function copyMissing(source: string, target: string) {
  await fs.cp(source, target, { recursive: true, force: false, errorOnExist: false, filter: async file => {
    const info = await fs.lstat(file);
    if (info.isSymbolicLink()) throw new Error('Linked package entry: ' + file);
    const dest = path.join(target, path.relative(source, file));
    const existing = await fs.lstat(dest).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
    if (existing?.isSymbolicLink()) throw new Error('Linked destination: ' + dest);
    return info.isDirectory() ? !existing || existing.isDirectory() : info.isFile() && !existing;
  } });
}
export async function migrateDirectory(base: string, oldName: string, newName: string) {
  const old = path.resolve(base, oldName), target = path.resolve(base, newName);
  if (!isWithin(base, old) || !isWithin(base, target)) throw new Error('Invalid migration path');
  if (!await directory(old)) return;
  await localDir(base, path.dirname(newName));
  if (!await directory(target)) await fs.rename(old, target);
  else {
    await copyMissing(old, target);
    const backups = await localDir(base, base === data ? 'migration-backups' : 'amicur.set/migration-backups');
    const backup = await fs.mkdtemp(path.join(backups, 'legacy-'));
    await fs.rename(old, path.join(backup, path.basename(old)));
  }
}
export async function initializePlugins() {
  await localDir(data, 'plugins');
  await migrateDirectory(data, 'mods/multisaved-mod/saves', 'saves/shared');
  await localDir(data, path.relative(data, sharedSaves));
  await migrateDirectory(data, 'mods', 'plugins/defold-modpack/mods');
  const marker = path.join(pluginsPath, '.initialized.json');
  if (!await ordinaryFile(marker)) {
    await copyMissing(path.join(__dirname, 'plugins/defold-modpack'), defaultPack);
    await writeJson(marker, { version: 1 });
  }
}
export async function deployModpacks(loader: string, modRoot: string) {
  const file = path.join(loader, 'modpacks.json');
  const receipt = new Set(await readJson<string[]>(file, []));
  let changed = false;
  for (const plugin of await dirs(pluginsPath)) {
    if (!validId.test(plugin)) continue;
    const base = path.join(pluginsPath, plugin);
    const manifest = await readJson<{ id: string; api: number; type: string; enabled?: boolean } | null>(path.join(base, 'plugin.json'), null);
    if (manifest?.id !== plugin || manifest.api !== 1 || manifest.type !== 'modpack' || manifest.enabled === false) continue;
    for (const id of await dirs(path.join(base, 'mods'))) {
      const key = plugin + '/' + id;
      const source = path.join(base, 'mods', id);
      if (receipt.has(key) || !validId.test(id) || !await ordinaryFile(path.join(source, 'mod-id.json'))) continue;
      const target = path.join(modRoot, id);
      if (!await directory(target)) {
        const stage = await fs.mkdtemp(path.join(tempPath, 'modpack-'));
        try { await copyMissing(source, path.join(stage, id)); await fs.rename(path.join(stage, id), target); }
        finally { await fs.rm(stage, { recursive: true, force: true }); }
      } else if (await directory(path.join(source, 'local'))) {
        await copyMissing(path.join(source, 'local'), path.join(target, 'local'));
      }
      receipt.add(key); changed = true;
    }
  }
  if (changed) await writeJson(file, [...receipt]);
}
