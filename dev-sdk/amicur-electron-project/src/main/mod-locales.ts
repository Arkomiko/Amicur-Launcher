import * as fs from 'node:fs/promises';
import { safeEntry } from './storage.js';
import type { GameLanguage } from '../shared/types.js';

async function dictionary(root: string, language: GameLanguage): Promise<Record<string, string>> {
  try {
    const file = await safeEntry(root, 'local/' + language + '/strings.json');
    const json: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!json || typeof json !== 'object' || Array.isArray(json)) return {};
    return Object.fromEntries(Object.entries(json).filter(([key, value]) =>
      key !== '__proto__' && typeof value === 'string' && value.trim()));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Invalid mod locale', language, root);
    return {};
  }
}
export async function modDictionary(root: string, language: GameLanguage) {
  const english = await dictionary(root, 'en-US');
  return language === 'en-US' ? english : { ...english, ...await dictionary(root, language) };
}
