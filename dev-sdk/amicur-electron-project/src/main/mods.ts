import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { modDictionary } from './mod-locales.js';
import { deployModpacks, migrateDirectory } from './plugins.js';
import { randomUUID } from 'node:crypto';
import { data, dirs, gameDir, gameLanguage, localDir, ordinaryFile, readJson, safeEntry, writeJson } from './storage.js';
import { modFields, object, values } from './mod-settings.js';
import type { GameLanguage, Mod, ModField, VersionOptions } from '../shared/types.js';

export const languagesMod = 'multilanguage-mod';
export const savesMod = 'multisaved-mod';
const savesFields: ModField[] = [{
  id: 'destination', label: 'Save location', type: 'choice', default: 'shared',
  choices: [{ value: 'shared', label: 'Shared saves' }, { value: 'release', label: 'This release' }],
}];
export const builtIn = new Map([[languagesMod, 'Game languages'], [savesMod, 'Shared saves'],
  ['dialogue-history', 'Dialogue history'], ['quick-save', 'Quick saves'], ['scene-bookmarks', 'Scene bookmarks']]);
export const validId = /^[a-z0-9][a-z0-9-]{0,63}$/;

interface Profile {
  id: string;
  language: GameLanguage;
  enabled: string[];
  modSettings: Record<string, unknown>;
}

export interface GameContext {
  folder: string;
  root: string;
  modRoot: string;
  profile: Profile;
}

interface InstalledMod extends Mod {
  entry?: string;
  directory: string;
}

const preparations = new Map<string, { clean: boolean; pending: Promise<GameContext> }>();

export function prepareGame(folder: string, clean = false): Promise<GameContext> {
  const current = preparations.get(folder);
  if (current) {
    if (current.clean && !clean) return current.pending.then(() => prepareGame(folder));
    return current.pending;
  }
  const pending = prepare(folder, clean).finally(() => preparations.delete(folder));
  preparations.set(folder, { clean, pending });
  return pending;
}

async function prepare(folder: string, clean: boolean): Promise<GameContext> {
  const root = await gameDir(folder);
  await migrateDirectory(root, 'modloader', 'amicur.set');
  const loader = await localDir(root, 'amicur.set');
  await migrateDirectory(root, 'mods', 'amicur.set/mods');
  const modRoot = clean ? path.join(loader, 'mods') : await localDir(loader, 'mods');
  if (!clean) await localDir(loader, 'cache');
  if (!clean) await deployModpacks(loader, modRoot);
  if (!await ordinaryFile(path.join(loader, 'launcher.json'))) await writeJson(path.join(loader, 'launcher.json'), {});
  const profileFile = path.join(loader, 'profile.json');
  let profile = await readJson<Profile | null>(profileFile, null);
  if (!profile || typeof profile.id !== 'string' || !/^[0-9a-f-]{36}$/.test(profile.id)) {
    profile = { id: randomUUID(), language: 'en-US', enabled: [languagesMod, savesMod], modSettings: {} };
    await writeJson(profileFile, profile);
  }
  profile = {
    id: profile.id,
    language: gameLanguage(profile.language),
    modSettings: object(profile.modSettings),
    enabled: Array.isArray(profile.enabled) ? profile.enabled.filter(id => typeof id === 'string') : [...builtIn.keys()],
  };
  if (!clean) {
    const present = new Set<string>();
    for (const id of builtIn.keys()) if (await ordinaryFile(path.join(modRoot, id, 'mod-id.json'))) present.add(id);
    profile.enabled = profile.enabled.filter(id => !builtIn.has(id) || present.has(id));
  }
  return { folder, root, modRoot, profile };
}

export async function mods(game: GameContext): Promise<InstalledMod[]> {
  const installed = new Map<string, InstalledMod>();
  {
    const base = game.modRoot;
    for (const id of await dirs(base)) {
      if (!validId.test(id)) continue;
      const directory = await safeEntry(base, id);
      const file = path.join(directory, 'mod-id.json');
      const enabled = game.profile.enabled.includes(id);
      if (builtIn.has(id) && await ordinaryFile(file)) {
        const fields = id === savesMod ? savesFields : [];
        installed.set(id, { id, name: builtIn.get(id)!, enabled, source: 'builtin', directory, fields,
          values: values(fields, game.profile.modSettings[id]) });
        continue;
      }
      if (builtIn.has(id) || !await ordinaryFile(file)) continue;
      const manifest = await readJson<{ id: string; name?: string; description?: string; settings?: unknown; script: string; api: number; tested?: unknown; requires?: unknown; conflicts?: unknown; version?: unknown } | null>(file, null);
      const invalid = (problem: string) => installed.set(id, { id, name: id, enabled, source: 'release', directory, fields: [], values: {}, problem });
      if (manifest?.id !== id || manifest.api !== 1 || typeof manifest.script !== 'string') { invalid('mod-id.json: id / api / script'); continue; }
      const entry = manifest.script;
      if (!/^script\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.m?js$/.test(entry)) { invalid('script: ' + entry); continue; }
      if (entry.split('/').some(part => part === '.' || part === '..')) { invalid('script: ' + entry); continue; }
      try {
        if (!await ordinaryFile(await safeEntry(directory, entry))) throw new Error(entry);
        for (const key of ['tested', 'requires', 'conflicts'] as const) {
          const list = manifest[key];
          if (list !== undefined && (!Array.isArray(list) || !list.every(value => typeof value === 'string' && (key === 'tested' ? /^\d+(?:\.\d+){1,3}$/.test(value) : validId.test(value))))) throw new Error('mod-id.json: ' + key);
        }
        const fields = modFields(manifest.settings);
        const englishFile = path.join(directory, 'local/en-US/strings.json');
        if (!await ordinaryFile(englishFile)) {
          await localDir(directory, 'local/en-US');
          await fs.writeFile(englishFile, '{}\n', { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        }
        installed.set(id, {
          id, name: typeof manifest.name === 'string' ? manifest.name.slice(0, 100) || id : id,
          description: typeof manifest.description === 'string' ? manifest.description.slice(0, 300) : undefined,
          source: 'release',
          fields, values: values(fields, game.profile.modSettings[id]),
          tested: manifest.tested as string[] | undefined, requires: manifest.requires as string[] | undefined,
          conflicts: manifest.conflicts as string[] | undefined, version: typeof manifest.version === 'string' ? manifest.version : undefined,
          enabled, entry, directory,
        });
      } catch (error) {
        invalid(error instanceof Error ? error.message : String(error));
      }
    }
  }
  return [...installed.values()];
}

export async function versionOptions(game: GameContext, running: boolean): Promise<VersionOptions> {
  const installed = await mods(game);
  const language = installed.some(mod => mod.id === languagesMod && mod.enabled) ? game.profile.language : 'en-US';
  const localized = await Promise.all(installed.map(async ({ directory, entry, ...mod }) => {
    const dict = await modDictionary(directory, language);
    const tr = (s: string) => Object.hasOwn(dict, s) ? dict[s] : s;
    return { ...mod, name: dict['mod.name'] ?? tr(mod.name), description: dict['mod.description'] ?? (mod.description && tr(mod.description)),
      fields: mod.fields.map(field => field.type === 'choice'
        ? { ...field, label: tr(field.label), choices: field.choices.map(choice => ({ ...choice, label: tr(choice.label) })) }
        : { ...field, label: tr(field.label) }) };
  }));
  return { language: game.profile.language, running, mods: localized };
}

const profileWrites = new Map<string, Promise<void>>();

export function updateProfile(game: GameContext, language: unknown, enabled?: unknown, settings?: unknown): Promise<void> {
  const previous = profileWrites.get(game.root) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const installed = Array.isArray(enabled) || settings !== undefined ? await mods(game) : [];
    const ids = Array.isArray(enabled)
      ? installed.filter(mod => enabled.includes(mod.id)).map(mod => mod.id)
      : game.profile.enabled;
    const modSettings = { ...game.profile.modSettings };
    const input = object(settings);
    for (const mod of installed) {
      if (mod.fields.length && Object.hasOwn(input, mod.id)) {
        modSettings[mod.id] = values(mod.fields, { ...object(modSettings[mod.id]), ...object(input[mod.id]) });
      }
    }
    const changed: Profile = { id: game.profile.id, language: gameLanguage(language), enabled: ids, modSettings };
    await writeJson(path.join(game.root, 'amicur.set', 'profile.json'), changed);
    game.profile = changed;
  });
  profileWrites.set(game.root, task);
  const clear = () => { if (profileWrites.get(game.root) === task) profileWrites.delete(game.root); };
  void task.then(clear, clear);
  return task;
}
