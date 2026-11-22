import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fonts, gameLanguages, launchActions, type Game, type GameLanguage, type Settings } from '../shared/types.js';

export const root = process.env.AMICUR_ROOT || path.resolve(__dirname, '../../..');
export const data = path.join(root, 'data-launcher');
export const gamesPath = path.join(root, 'games');
export const tempPath = path.join(data, 'temp');
export const prefsPath = path.join(data, 'settings');
export const sharedSaves = path.join(data, 'saves', 'shared');

const defaults: Settings = {
  ready: false, locale: 'en-US', theme: 'Amicur', font: 'system', scale: 100,
  autoGame: false, notifyLauncher: true, afterLaunch: 'keep',
};

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return fallback;
    throw error;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = path.join(tempPath, randomUUID() + '.json');
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

export function isWithin(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

export async function safeEntry(directory: string, relative: string): Promise<string> {
  const file = path.join(directory, relative);
  if (!isWithin(directory, file)) throw new Error('Invalid path');
  const [realDirectory, realFile] = await Promise.all([fs.realpath(directory), fs.realpath(file)]);
  if (!isWithin(realDirectory, realFile)) throw new Error('Invalid linked path');
  return realFile;
}

export async function dirs(directory: string): Promise<string[]> {
  try {
    return (await fs.readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function ordinaryFile(file: string): Promise<boolean> {
  try {
    return (await fs.lstat(file)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export function gameLanguage(value: unknown): GameLanguage {
  return gameLanguages.find(language => language === value) ?? 'en-US';
}

export function normalizeSettings(value: Partial<Settings> | null): Settings {
  const input = value ?? {};
  return {
    ready: input.ready === true,
    locale: input.locale === 'ru-RU' ? 'ru-RU' : defaults.locale,
    theme: typeof input.theme === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(input.theme) ? input.theme : defaults.theme,
    font: fonts.find(font => font === input.font) ?? defaults.font,
    scale: typeof input.scale === 'number' && Number.isFinite(input.scale)
      ? Math.min(140, Math.max(85, Math.round(input.scale))) : defaults.scale,
    autoGame: input.autoGame === true,
    notifyLauncher: input.notifyLauncher !== false,
    afterLaunch: launchActions.find(action => action === input.afterLaunch) ?? defaults.afterLaunch,
  };
}

const settingsFile = path.join(prefsPath, 'launcher.json');
export const loadSettings = async () => normalizeSettings(await readJson(settingsFile, defaults));
export const writeSettings = (settings: Settings) => writeJson(settingsFile, normalizeSettings(settings));

const knownVersions = new Map<string, { mtime: number; size: number; version: string | null }>();

async function detectVersion(directory: string): Promise<string | null> {
  const index = path.join(directory, 'index.html');
  const stats = await fs.stat(index);
  const cached = knownVersions.get(index);
  if (cached && cached.mtime === stats.mtimeMs && cached.size === stats.size) return cached.version;
  const raw = await fs.readFile(index, 'utf8');
  const version = /(?:&lt;|<){2}set\s+\$ver\s*=\s*(\d+(?:\.\d+){1,3})(?=(?:&gt;|>){2}|\s)/i.exec(raw)?.[1] ?? /\bVersion\s+(\d+(?:\.\d+){1,3})(?=\s|&lt;|<)/i.exec(raw)?.[1] ?? null;
  knownVersions.set(index, { mtime: stats.mtimeMs, size: stats.size, version });
  return version;
}

export async function releaseVersion(directory: string): Promise<string | null> {
  const metadata = await readJson<{ version?: string } | null>(path.join(directory, 'amicur.set', 'release.json'), null);
  if (typeof metadata?.version === 'string' && /^\d+(?:\.\d+){1,3}$/.test(metadata.version)) return metadata.version;
  const folder = path.basename(directory);
  const named = /^(?:v|A Mirror['’]s Curse\s+v?)(\d+(?:\.\d+){1,3})(?:\s+.*)?$/i.exec(folder)?.[1];
  return (await detectVersion(directory)) ?? named ?? null;
}

export async function releaseSettings(root: string) {
  const prefs = await readJson<{ afterLaunch?: Settings['afterLaunch'] }>(path.join(root, 'amicur.set/launcher.json'), {});
  return { afterLaunch: launchActions.find(action => action === prefs?.afterLaunch) };
}

export async function games(): Promise<Game[]> {
  const candidates = await dirs(gamesPath);
  const found = await Promise.all(candidates.map(async folder => {
    const directory = path.join(gamesPath, folder);
    if (!await ordinaryFile(path.join(directory, 'index.html'))) return null;
    return { folder, version: await releaseVersion(directory), ...await releaseSettings(directory) } as Game;
  }));
  return found.filter((game): game is Game => game !== null).sort((a, b) => a.folder.localeCompare(b.folder, undefined, { numeric: true }));
}

export async function gameDir(folder: string): Promise<string> {
  if (typeof folder !== 'string' || !folder || folder === '.' || folder === '..' || /[\\/:]/.test(folder)) throw new Error('Invalid release');
  if (!(await dirs(gamesPath)).includes(folder)) throw new Error('Release folder not found');
  const directory = await safeEntry(gamesPath, folder);
  if (!await ordinaryFile(path.join(directory, 'index.html'))) throw new Error('index.html not found');
  return directory;
}

export async function localDir(directory: string, relative: string): Promise<string> {
  const destination = path.join(directory, relative);
  if (!isWithin(directory, destination)) throw new Error('Invalid directory');
  let current = directory;
  for (const part of path.relative(directory, destination).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    await fs.mkdir(current).catch(error => {
      if (error.code !== 'EEXIST') throw error;
    });
    if (!(await fs.lstat(current)).isDirectory()) throw new Error('Invalid linked directory');
  }
  return destination;
}
