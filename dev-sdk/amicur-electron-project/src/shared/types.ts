import type { ModRules } from './compatibility.js';
import type { Language, messages } from './launcher-copy.js';

export const gameLanguages = ['en-US', 'ru-RU', 'en-GB', 'uk-UA', 'ja-JP'] as const;
export const themes = ['Amicur', 'mono-dark', 'mono-light'] as const;
export const fonts = ['system', 'serif', 'readable'] as const;
export const launchActions = ['keep', 'minimize', 'close'] as const;
export type LaunchAction = typeof launchActions[number];
export type GameLanguage = typeof gameLanguages[number];

export interface Settings {
  ready: boolean;
  locale: 'en-US' | 'ru-RU';
  theme: string;
  font: typeof fonts[number];
  scale: number;
  autoGame: boolean;
  notifyLauncher: boolean;
  afterLaunch: LaunchAction;
}

export interface Game {
  afterLaunch?: LaunchAction;
  folder: string;
  version: string | null;
}

export type ModValue = boolean | number | string;
export type ModSettings = Record<string, Record<string, ModValue>>;

interface ModFieldLabel { id: string; label: string }
export type ModField = ModFieldLabel & (
  { type: 'boolean'; default: boolean } |
  { type: 'number'; default: number } |
  { type: 'string'; default: string } |
  { type: 'choice'; default: string; choices: { value: string; label: string }[] }
);

export interface Mod extends ModRules {
  id: string;
  name: string;
  enabled: boolean;
  source: 'builtin' | 'shared' | 'release';
  description?: string;
  fields: ModField[];
  values: Record<string, ModValue>;
}

export interface VersionOptions {
  language: GameLanguage;
  mods: Mod[];
  running: boolean;
}

export interface UpdateStatus {
  game: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'installed' | 'unavailable';
  version?: string;
  launcher?: string;
}

export interface Presentation {
  strings: Record<Language, Partial<typeof messages['en-US']>>;
  themes: Record<string, {
    name: Record<Language, string>;
    tone: 'dark' | 'light';
    colours: Record<string, string>;
    backgrounds: { from: number; to: number; url: string }[];
  }>;
}

export interface LauncherApi {
  state(): Promise<{ settings: Settings; games: Game[]; updates: UpdateStatus; presentation: Presentation; version: string }>;
  settings(settings: Settings): Promise<void>;
  options(folder: string): Promise<VersionOptions>;
  optionsSave(folder: string, language: GameLanguage, mods: string[], values?: ModSettings): Promise<VersionOptions>;
  onModError(callback: (folder: string) => void): void;
  dropMod(file: File, folder: string): Promise<string | null>;
  releaseSetting(folder: string, action: string): Promise<void>;
  release(action: 'folder' | 'rename' | 'delete', folder: string, name?: string): Promise<boolean>;
  report(folder: string, copy?: boolean): Promise<string>;
  launch(folder: string, clean?: boolean): Promise<void>;
  open(place: 'games' | 'mods' | 'shared-mods' | 'itch' | 'releases' | 'author', folder?: string): Promise<void>;
  update(install?: boolean): Promise<UpdateStatus>;
  subscribe(callback: () => void): () => void;
}

export type SaveScope = 'shared' | 'release' | 'original';

export interface SaveEntry {
  scope: SaveScope;
  name: string;
  modified: number;
}

export interface GameStrings {
  language: GameLanguage;
  text: Record<string, string>;
  byPassage: Record<string, Record<string, string>>;
  images: Record<string, string>;
  modText: Record<string, Record<string, string>>;
  features: { language: boolean; saves: boolean; tools: string[] };
}

export interface GameApi {
  strings(): Promise<GameStrings>;
  modLocale(id: string): Promise<{ language: GameLanguage; strings: Record<string, string> }>;
  modSettings(id: string): Promise<Record<string, ModValue>>;
  language(language: GameLanguage): Promise<GameStrings>;
  subscribe(callback: () => void): () => void;
  error(id: string, stage: string, message: string): void;
  capture(entries: { passage: string; text: string }[]): void;
  saves(): Promise<SaveEntry[]>;
  read(save: SaveEntry): Promise<Uint8Array>;
}
