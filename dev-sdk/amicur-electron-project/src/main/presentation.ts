import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { themes, type Presentation } from '../shared/types.js';
import { messages, type Language } from '../shared/launcher-copy.js';
import { data, dirs, localDir, ordinaryFile, readJson, safeEntry, writeJson } from './storage.js';

interface ThemeFile {
  id?: string;
  name?: string | Partial<Record<Language, string>>;
  tone?: 'dark' | 'light';
  colours?: Record<string, unknown>;
  backgrounds?: unknown;
}

const builtIn = path.join(__dirname, 'public', 'themes');
const allowedColours = new Set(['back', 'rail', 'surface', 'lift', 'edge', 'text', 'subtle', 'ink', 'accent', 'on-accent', 'shadow', 'wallpaper-top', 'wallpaper-bottom', 'cover-tint', 'cover-ink']);
const oldDefaults: Record<string, string[]> = {
  Amicur: ['#f0adc7', '#94bbe9'],
  'mono-dark': ['#e7e7ec'],
  'mono-light': ['#75496d'],
};

function imagePath(value: unknown): value is string {
  return typeof value === 'string' && /^[\p{L}\p{N}_ .\-/]+\.(?:png|jpe?g|webp|avif)$/iu.test(value)
    && value.split('/').every(part => part !== '.' && part !== '..' && part.length > 0);
}

function minutes(time: unknown): number | undefined {
  const parts = typeof time === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time) : null;
  if (parts) return Number(parts[1]) * 60 + Number(parts[2]);
}

async function installTheme(id: string): Promise<void> {
  const source = path.join(builtIn, id);
  const defaults = await readJson<ThemeFile>(path.join(source, 'theme.json'), {});
  const folder = await localDir(data, 'theme/' + id);
  const file = path.join(folder, 'theme.json');
  const existing = await readJson<ThemeFile | null>(file, null);
  if (!existing || (existing.tone !== 'dark' && existing.tone !== 'light')) {
    const colours = { ...existing?.colours };
    if (typeof colours.accent === 'string' && oldDefaults[id]?.includes(colours.accent.toLowerCase())) delete colours.accent;
    delete colours.ambient;
    await writeJson(file, { ...defaults, ...existing, tone: defaults.tone, colours: { ...defaults.colours, ...colours } });
  }
  for (const background of Array.isArray(defaults.backgrounds) ? defaults.backgrounds : []) {
    if (!imagePath(background?.image)) continue;
    const target = path.join(folder, background.image);
    if (await ordinaryFile(target)) continue;
    await localDir(folder, path.dirname(background.image));
    await fs.copyFile(await safeEntry(source, background.image), target, fs.constants.COPYFILE_EXCL).catch(error => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
}

async function readTheme(folder: string, id: string): Promise<Presentation['themes'][string] | undefined> {
  const config = await readJson<ThemeFile | null>(await safeEntry(folder, 'theme.json'), null);
  if (!config) return;
  const colours: Record<string, string> = {};
  for (const [key, value] of Object.entries(config.colours ?? {})) {
    if (allowedColours.has(key) && typeof value === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value)) colours[key] = value;
  }
  const backgrounds: Presentation['themes'][string]['backgrounds'] = [];
  for (const entry of Array.isArray(config.backgrounds) ? config.backgrounds.slice(0, 48) : []) {
    const from = minutes(entry?.from);
    const to = minutes(entry?.to);
    if (from === undefined || to === undefined || !imagePath(entry?.image)) continue;
    try {
      const file = await safeEntry(folder, entry.image);
      if (await ordinaryFile(file)) backgrounds.push({ from, to, url: pathToFileURL(file).href });
    } catch {
      // Keep the configured base colour if a theme image is missing.
    }
  }
  function name(language: Language) {
    const label = typeof config!.name === 'string' ? config!.name : config!.name?.[language];
    return typeof label === 'string' && label.trim() ? label.slice(0, 80) : id;
  }
  return { name: { 'en-US': name('en-US'), 'ru-RU': name('ru-RU') }, tone: config.tone === 'light' ? 'light' : 'dark', colours, backgrounds };
}

let seedingThemes: Promise<void> | undefined;

export async function presentation(): Promise<Presentation> {
  const strings = {} as Presentation['strings'];
  const themeData: Presentation['themes'] = Object.create(null);
  for (const locale of Object.keys(messages) as Language[]) {
    const folder = await localDir(data, 'language/' + locale);
    await localDir(folder, 'img');
    const idFile = path.join(folder, 'id.json');
    const textFile = path.join(folder, 'text.json');
    if (!await ordinaryFile(idFile)) await writeJson(idFile, { id: locale, name: locale === 'ru-RU' ? 'Русский' : 'English' });
    if (!await ordinaryFile(textFile)) await writeJson(textFile, messages[locale]);
    const raw = await readJson<Record<string, unknown> | null>(textFile, {});
    if (raw?.publisher === (locale === 'ru-RU' ? 'Игра от amaty' : 'Game by amaty')) {
      raw.publisher = messages[locale].publisher;
      await writeJson(textFile, raw);
    }
    strings[locale] = Object.fromEntries(Object.entries(raw ?? {}).filter(([key, value]) =>
      Object.hasOwn(messages[locale], key) && typeof value === 'string' && value.length > 0 && value.length < 2000));
  }

  seedingThemes ??= Promise.all(themes.map(installTheme)).then(() => {}).catch(error => {
    seedingThemes = undefined;
    throw error;
  });
  await seedingThemes;
  const directory = path.join(data, 'theme');
  const all = await dirs(directory);
  for (const id of new Set([...themes, ...all])) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) continue;
    const folder = await safeEntry(directory, id).catch(() => undefined);
    if (!folder || !await ordinaryFile(path.join(folder, 'theme.json'))) continue;
    const item = await readTheme(folder, id);
    if (item) themeData[id] = item;
  }
  return { strings, themes: themeData };
}
