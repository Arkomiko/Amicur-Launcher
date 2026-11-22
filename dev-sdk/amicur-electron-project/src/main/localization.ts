import { britishSpelling } from '../shared/british.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { parse, parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { gameLanguages, type GameLanguage, type GameStrings } from '../shared/types.js';
import { localDir, ordinaryFile, readJson, writeJson } from './storage.js';
import { modDictionary } from './mod-locales.js';
import { mods, languagesMod, savesMod, type GameContext } from './mods.js';

type Node = DefaultTreeAdapterMap['node'];
interface Entry { passage: string; source: string; hash: string }
interface Catalog { index: string; entries: Record<string, Entry>; images: string[] }
interface Translation { sourceHash: string; text: string }
const graphics = ['img/logo.png', 'img/banner.png'];
const names: Record<GameLanguage, string> = {
  'en-US': 'English (Original)', 'ru-RU': 'Русский', 'en-GB': 'English (UK)', 'uk-UA': 'Українська', 'ja-JP': '日本語',
};
const catalogQueue = new Map<string, Promise<Catalog>>();

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

function collectText(node: Node, visit: (text: string) => void): void {
  if (node.nodeName === '#text' && 'value' in node) visit(node.value);
  if ('tagName' in node && ['script', 'style', 'tw-storydata', 'noscript', 'template'].includes(node.tagName)) return;
  if ('childNodes' in node) node.childNodes.forEach(child => collectText(child, visit));
}

function scanStory(node: Node, add: (passage: string, key: string, text: string) => void): void {
  if ('tagName' in node && node.tagName === 'tw-passagedata') {
    const passage = node.attrs.find(attr => attr.name === 'name')?.value ?? '';
    const id = digest(passage).slice(0, 16);
    let segment = 0;
    let marked = node.childNodes.map(child => 'value' in child ? child.value : '').join('');
    marked = marked.replace(/\/%[\s\S]*?%\/|<!--[\s\S]*?-->|<<\s*(script|run|set)\b[\s\S]*?<\/\1>>/gi, ' ');
    marked = marked.replace(/<<(?:link|button|linkreplace|linkappend|linkprepend)\s+["']([^"']+)["'][\s\S]*?>>/gi, '\n$1\n');
    marked = marked.replace(/\[\[([^\]]+)\]\]/g, (_, link: string) => {
      const separator = /->|\||<-/.exec(link);
      if (!separator) return '\n' + link + '\n';
      return '\n' + (separator[0] === '<-' ? link.slice(separator.index + 2) : link.slice(0, separator.index)) + '\n';
    });
    marked = marked.replace(/<<[\s\S]*?>>/g, '\n');
    collectText(parseFragment(marked), text => {
      for (const line of text.split(/\r?\n/)) add(passage, id + ':' + segment++, line);
    });
    return;
  }
  if ('childNodes' in node) node.childNodes.forEach(child => scanStory(child, add));
}

async function catalogFile(game: GameContext): Promise<string> {
  const directory = await localDir(game.modRoot, languagesMod + '/local/original-source');
  return path.join(directory, 'text.json');
}

export function indexGame(game: GameContext): Promise<Catalog> {
  const pending = catalogQueue.get(game.root);
  if (pending) return pending;
  const task = buildCatalog(game).finally(() => catalogQueue.delete(game.root));
  catalogQueue.set(game.root, task);
  return task;
}

async function buildCatalog(game: GameContext): Promise<Catalog> {
  const file = await catalogFile(game);
  const raw = await fs.readFile(path.join(game.root, 'index.html'), 'utf8');
  const index = digest(raw);
  const cache = await readJson<Catalog | null>(file, null);
  if (cache?.index === index) return cache;
  const entries: Record<string, Entry> = {};
  const add = (passage: string, key: string, text: string) => {
    const source = normalize(text);
    if (/[\p{L}]/u.test(source) && source.length <= 6000) entries[key] = { passage, source, hash: digest(source) };
  };
  const tree = parse(raw);
  let chrome = 0;
  collectText(tree, text => add('', 'interface:' + chrome++, text));
  scanStory(tree, add);
  const images: string[] = [];
  for (const image of graphics) if (await ordinaryFile(path.join(game.root, image))) images.push(image);
  const catalog = { index, entries, images };
  await writeJson(file, catalog);
  await writeJson(path.join(path.dirname(file), 'id.json'), { id: 'original-source', generated: true, schema: 1 });
  return catalog;
}

export async function createLanguagePacks(game: GameContext, contentHash: string): Promise<void> {
  for (const language of gameLanguages) {
    const directory = await localDir(game.modRoot, languagesMod + '/local/' + language);
    await localDir(directory, 'img');
    if (!await ordinaryFile(path.join(directory, 'id.json'))) {
      await writeJson(path.join(directory, 'id.json'), { id: language, name: names[language], schema: 1 });
    }
    const translation = path.join(directory, 'text.json');
    if (!await ordinaryFile(translation)) {
      const included = await readJson<Record<string, Translation>>(
        path.join(__dirname, 'locales', contentHash, language + '.json'), {},
      );
      await writeJson(translation, included);
    }
  }
}

const captures = new Map<string, Promise<void>>();
export function capture(game: GameContext, entries: unknown): void {
  if (!game.profile.enabled.includes(languagesMod) || !Array.isArray(entries)) return;
  const previous = captures.get(game.root) ?? Promise.resolve();
  const current = previous.then(async () => {
    const file = await catalogFile(game);
    const directory = path.dirname(file);
    const target = path.join(directory, 'runtime.json');
    const saved = await readJson<Record<string, Entry>>(target, {});
    let count = Object.keys(saved).length;
    let changed = false;
    for (const entry of entries.slice(0, 150)) {
      if (count >= 7500 || typeof entry?.passage !== 'string' || typeof entry?.text !== 'string') continue;
      const passage = entry.passage.slice(0, 200);
      const source = normalize(entry.text);
      if (!source || source.length > 1600 || !/\p{L}/u.test(source)) continue;
      const hash = digest(source);
      const key = 'runtime:' + digest(passage + '\0' + source).slice(0, 32);
      if (Object.hasOwn(saved, key)) continue;
      saved[key] = { passage, source, hash };
      count++;
      changed = true;
    }
    if (changed) await writeJson(target, saved);
  }).catch(error => { console.error('Unable to record runtime strings', error); });
  captures.set(game.root, current);
  void current.finally(() => { if (captures.get(game.root) === current) captures.delete(game.root); });
}

const ru: Record<string, string> = {
  'A Mirror’s Curse': 'Проклятие зеркала',
  'A Mirror\u0027s Curse': 'Проклятие зеркала',
  'New Game': 'Новая игра', 'Continue': 'Продолжить', 'Settings': 'Настройки',
  'Start': 'Начать', 'Options': 'Параметры', 'Main Menu': 'Главное меню',
  'Load': 'Загрузить', 'Save': 'Сохранить', 'Saves': 'Сохранения',
  'Save to Disk': 'Сохранить на диск', 'Load from Disk': 'Загрузить с диска',
  'Credits': 'Авторы', 'Changelog': 'Список изменений', 'Restart': 'Начать заново',
  'Back': 'Назад', 'Cancel': 'Отмена', 'Close': 'Закрыть', 'Confirm': 'Подтвердить',
  'Yes': 'Да', 'No': 'Нет', 'Next': 'Далее', 'Previous': 'Назад',
  'Inventory': 'Инвентарь', 'Journal': 'Дневник', 'Map': 'Карта', 'Help': 'Справка',
  'Morning': 'Утро', 'Afternoon': 'День', 'Evening': 'Вечер', 'Night': 'Ночь',
  'Monday': 'Понедельник', 'Tuesday': 'Вторник', 'Wednesday': 'Среда', 'Thursday': 'Четверг',
  'Friday': 'Пятница', 'Saturday': 'Суббота', 'Sunday': 'Воскресенье',
};

export async function strings(game: GameContext): Promise<GameStrings> {
  const active = (await mods(game)).filter(mod => mod.enabled && !mod.problem);
  const ids = active.map(mod => mod.id);
  const language = ids.includes(languagesMod) ? game.profile.language : 'en-US';
  const modText = Object.fromEntries(await Promise.all(active.map(async mod => [mod.id, await modDictionary(mod.directory, language)])));
  const features = { tools: ids.filter(id => ['dialogue-history', 'quick-save', 'scene-bookmarks'].includes(id)), language: ids.includes(languagesMod), saves: ids.includes(savesMod) };
  const text: Record<string, string> = Object.create(null);
  const byPassage: GameStrings['byPassage'] = Object.create(null);
  const images: Record<string, string> = Object.create(null);
  if (!features.language || language === 'en-US') return { language, text, byPassage, images, modText, features };

  const catalog = await indexGame(game);
  const source = await catalogFile(game);
  const built = path.join(game.modRoot, languagesMod, 'local', language);
  const bundled = await readJson<Record<string, Translation>>(
    path.join(__dirname, 'locales', catalog.index, language + '.json'), {},
  );
  const manual = await readJson<Record<string, Translation>>(path.join(built, 'text.json'), {});
  const runtime = await readJson<Record<string, Entry>>(path.join(path.dirname(source), 'runtime.json'), {});
  if (language === 'ru-RU') Object.assign(text, ru);
  for (const [key, entry] of Object.entries({ ...catalog.entries, ...runtime })) {
    const candidate = manual?.[key] ?? bundled?.[key];
    const current = candidate?.sourceHash === entry.hash && typeof candidate.text === 'string' && candidate.text.trim();
    const replacement = current ? candidate.text : language === 'en-GB' ? britishSpelling(entry.source) : entry.source;
    if (replacement === entry.source) continue;
    if (entry.passage) {
      const passage = byPassage[entry.passage] ??= Object.create(null);
      passage[entry.source] = replacement;
    } else {
      text[entry.source] = replacement;
    }
  }
  for (const image of catalog.images) {
    const name = path.basename(image);
    if (await ordinaryFile(path.join(built, 'img', name))) images[image] = '/__amicur/locale/' + language + '/' + name;
  }
  return { language, text, byPassage, images, modText, features };
}
