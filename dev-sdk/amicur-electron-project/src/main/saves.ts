import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DownloadItem } from 'electron';
import type { SaveEntry, SaveScope } from '../shared/types.js';
import { object } from './mod-settings.js';
import type { GameContext } from './mods.js';
import { data, localDir, ordinaryFile, safeEntry, sharedSaves, tempPath } from './storage.js';

const validSave = /^[^<>:"/\\|?*\u0000-\u001f]{1,133}\.save(?:sbundle)?$/i;
export const saveNames: SaveScope[] = ['shared', 'release', 'original'];

function paths(game: GameContext): Record<SaveScope, string> {
  return { shared: sharedSaves, release: path.join(game.modRoot, 'multisaved-mod', 'saves'), original: path.join(game.root, 'saves') };
}

export async function listSaves(game: GameContext): Promise<SaveEntry[]> {
  const locations = paths(game);
  const entries = await Promise.all(saveNames.map(async scope => {
    const directory = locations[scope];
    try {
      const files = await fs.readdir(directory, { withFileTypes: true });
      return Promise.all(files.filter(file => file.isFile() && validSave.test(file.name)).map(async file => ({
        scope, name: file.name, modified: (await fs.stat(path.join(directory, file.name))).mtimeMs,
      })));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }));
  return entries.flat().sort((a, b) => b.modified - a.modified);
}

export async function readSave(game: GameContext, entry: SaveEntry): Promise<Uint8Array> {
  if (!saveNames.includes(entry?.scope) || typeof entry.name !== 'string' || !validSave.test(entry.name)) throw new Error('Invalid save file');
  const directory = paths(game)[entry.scope];
  const parent = entry.scope === 'shared' ? data : game.root;
  const base = await safeEntry(parent, path.relative(parent, directory));
  const real = await safeEntry(base, entry.name);
  if (!await ordinaryFile(path.join(base, entry.name)) || (await fs.stat(real)).size > 64 * 1024 * 1024) throw new Error('Invalid save file');
  return new Uint8Array(await fs.readFile(real));
}

export function handleSave(game: GameContext, item: DownloadItem, onSaved: () => void): void {
  const name = item.getFilename();
  if (!validSave.test(name) || !/^blob:amicur-game:\/\//.test(item.getURL())) {
    item.cancel();
    return;
  }
  const temporary = path.join(tempPath, randomUUID() + '.save');
  const destination = object(game.profile.modSettings['multisaved-mod']).destination;
  const useShared = game.profile.enabled.includes('multisaved-mod') && destination !== 'release';
  const folder = useShared ? sharedSaves : path.join(game.modRoot, 'multisaved-mod', 'saves');
  item.setSavePath(temporary);
  item.once('done', async (_event, state) => {
    try {
      if (state !== 'completed') return;
      if (!(await fs.lstat(folder).catch(() => null))?.isDirectory()) {
        if (folder === sharedSaves) throw new Error('Shared saves folder is unavailable');
        await localDir(game.modRoot, 'multisaved-mod/saves');
      }
      const extension = path.extname(name);
      const base = name.slice(0, -extension.length);
      for (let index = 0; ; index++) {
        const target = path.join(folder, base + (index ? ' (' + index + ')' : '') + extension);
        try {
          await fs.link(temporary, target);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
          if (!['EPERM', 'ENOTSUP', 'EXDEV', 'UNKNOWN'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
          try {
            await fs.copyFile(temporary, target, fs.constants.COPYFILE_EXCL);
            break;
          } catch (copyError) {
            if ((copyError as NodeJS.ErrnoException).code !== 'EEXIST') throw copyError;
          }
        }
      }
      onSaved();
    } catch (error) {
      console.error('Unable to store save', error);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  });
}
