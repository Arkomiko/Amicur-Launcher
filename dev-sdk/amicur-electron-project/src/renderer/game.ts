import { configureTools } from './story-tools.js';
import { applyInterfaceLabels, gameControlStyles, interfaceText } from './game-interface.js';
import { britishSpelling } from '../shared/british.js';
import { gameLanguages, type GameApi, type GameLanguage, type GameStrings, type SaveEntry } from '../shared/types.js';

interface Disk {
  save(name: string): void;
  load(event: Event): Promise<unknown>;
  import(event: Event): Promise<unknown>;
}

interface GameSave { disk?: Partial<Disk>; export?(name: string): void; import?(event: Event): void; }

interface StoryWindow extends Window {
  amicur: GameApi;
  SugarCube?: { Save?: GameSave; State?: { passage?: string } };
  Save?: GameSave;
}

const story = window as unknown as StoryWindow;
const api = story.amicur;
const languageNames: Record<GameLanguage, string> = {
  'en-US': 'English (Original)', 'ru-RU': 'Русский', 'en-GB': 'English (UK)', 'uk-UA': 'Українська', 'ja-JP': '日本語',
};
const normalized = (source: string) => source.replace(/\s+/g, ' ').trim();
const textState = new WeakMap<Text, { source: string; output: string }>();
const imageState = new WeakMap<HTMLImageElement, { source: string; output: string }>();
const reported = new Set<string>();
let pending: { passage: string; text: string }[] = [];
let reportTimer = 0;
let current: GameStrings;
let frame = 0;
let applyVersion = 0;
let rendering = false;
let panel: HTMLElement | undefined;
let manage: HTMLButtonElement;
let saveStatus: HTMLElement | undefined;
let saveRender = 0;

function disk(): Partial<Disk> | undefined {
  const save = story.SugarCube?.Save ?? story.Save;
  if (!save) return;
  if (save.disk) return save.disk;
  return {
    save: save.export ? name => save.export!(name) : undefined,
    load: save.import ? async event => { save.import!(event); } : undefined,
  };
}
const english = {
  language: 'Game language', saves: 'Shared saves', save: 'Save game', refresh: 'Refresh', shared: 'Shared',
  release: 'Release mod', original: 'Game folder', empty: 'No save files', close: 'Close',
  loading: 'Loading…', error: 'Could not load this save. Check that it is compatible with this release.',
  saving: 'Saving…', replaceBrowser: 'Replace the existing browser save slots with this bundle?',
};
function words() {
  const result = { ...english };
  for (const key of Object.keys(english) as (keyof typeof english)[]) {
    const id = key === 'language' ? 'multilanguage-mod' : 'multisaved-mod';
    result[key] = current.modText[id]?.[english[key]] ?? english[key];
  }
  return result;
}

function record(passage: string, text: string): void {
  if (text.length > 1600 || reported.size >= 7500 || !/\p{L}/u.test(text)) return;
  const key = passage + '\0' + text;
  if (reported.has(key)) return;
  reported.add(key);
  pending.push({ passage, text });
  if (reportTimer) return;
  reportTimer = window.setTimeout(() => {
    for (let index = 0; index < pending.length; index += 125) api.capture(pending.slice(index, index + 125));
    pending = [];
    reportTimer = 0;
  }, 800);
}

function apply(): void {
  if (rendering || !current) return;
  rendering = true;
  try {
    mountSaves();
    if (current.features.language) {
      updateSettingsMenu();
      applyInterfaceLabels(current.language);
    }
    const active = story.SugarCube?.State?.passage ?? document.querySelector('#passages [data-passage]')?.getAttribute('data-passage') ?? '';
    const translations = Object.hasOwn(current.byPassage, active) ? current.byPassage[active] : undefined;
    const tree = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        return parent && !parent.closest('script,style,tw-storydata,noscript,textarea,input,select,template,[contenteditable],[data-amicur-saves],[data-amicur-language],[data-story-tools]')
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    for (let node = tree.nextNode(); node; node = tree.nextNode()) {
      const target = node as Text;
      const prior = textState.get(target);
      const source = prior?.output === target.data ? prior.source : target.data;
      const key = normalized(source);
      if (!key) continue;
      const owner = target.parentElement?.closest<HTMLElement>('[data-amicur-mod]')?.dataset.amicurMod;
      if (owner) {
        const dict = current.modText[owner];
        const translated = dict && Object.hasOwn(dict, key) ? dict[key] : key;
        const output = source.replace(key, () => translated);
        textState.set(target, { source, output });
        if (target.data !== output) target.data = output;
        continue;
      }
      if (!current.features.language) continue;
      const sessionText = translations && Object.hasOwn(translations, key) ? translations[key] : undefined;
      const commonText = Object.hasOwn(current.text, key) ? current.text[key] : undefined;
      const alternative = current.language === 'en-GB' ? britishSpelling(key) : key;
      const uiText = interfaceText(target.parentElement!, key, current.language);
      const replacement = uiText ?? sessionText ?? commonText ?? (alternative === key ? undefined : alternative);
      if (!replacement) record(active, key);
      const leading = uiText !== undefined && /^[,.;!?]/.test(uiText) ? '' : source.match(/^\s*/)?.[0] ?? '';
      const output = replacement ? leading + replacement + (source.match(/\s*$/)?.[0] ?? '') : source;
      textState.set(target, { source, output });
      if (target.data !== output) target.data = output;
    }
    for (const image of document.images) {
      const raw = image.getAttribute('src');
      if (!raw) continue;
      const prior = imageState.get(image);
      const source = prior?.output === raw ? prior.source : raw;
      try {
        const uri = new URL(source, location.href);
        if (uri.protocol !== location.protocol || uri.host !== location.host) continue;
        const key = decodeURIComponent(uri.pathname).slice(1);
        const output = current.images[key] ?? source;
        imageState.set(image, { source, output });
        if (raw !== output) image.setAttribute('src', output);
      } catch {
        // A dynamic image may not have a URL yet.
      }
    }
  } finally {
    rendering = false;
  }
}

function schedule(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    apply();
  });
}

function button(name: string, action: () => void | Promise<void>): HTMLButtonElement {
  const control = document.createElement('button');
  control.type = 'button';
  control.textContent = name;
  control.addEventListener('click', () => void Promise.resolve().then(action).catch(error => {
    console.error(error);
    if (saveStatus) saveStatus.textContent = words().error;
  }));
  return control;
}

async function load(entry: SaveEntry): Promise<void> {
  const engine = disk();
  const bundle = entry.name.toLowerCase().endsWith('.savesbundle');
  if (bundle && !window.confirm(words().replaceBrowser)) return;
  const handle = bundle ? engine?.import : engine?.load;
  if (!handle) throw new Error('Save API is not available in this release');
  const data = await api.read(entry);
  const file = new File([Uint8Array.from(data)], entry.name);
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = document.createElement('input');
  input.type = 'file';
  input.files = transfer.files;
  const event = new Event('change');
  const done = new Promise<void>((resolve, reject) => {
    input.addEventListener('change', change => {
      void Promise.resolve().then(() => handle(change)).then(() => resolve(), reject);
    }, { once: true });
  });
  input.dispatchEvent(event);
  await done;
  if (panel?.isConnected) {
    panel.hidden = true;
    document.querySelector<HTMLButtonElement>('#ui-dialog-close')?.click();
  }
}

async function showSaves(): Promise<void> {
  const labels = words();
  if (!panel?.isConnected) return;
  const target = panel;
  const version = ++saveRender;
  target.hidden = false;
  target.replaceChildren();
  manage.setAttribute('aria-expanded', 'true');
  const title = document.createElement('strong');
  title.textContent = labels.saves;
  const toolbar = document.createElement('div');
  toolbar.className = 'amicur-toolbar';
  const save = button(labels.save, () => {
    const engine = disk();
    if (!engine?.save) throw new Error('Save API is unavailable');
    if (saveStatus) saveStatus.textContent = labels.saving;
    engine.save('Amicur-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-'));
  });
  save.disabled = !disk()?.save;
  toolbar.append(save, button(labels.refresh, showSaves), button(labels.close, () => {
    target.hidden = true;
    manage.setAttribute('aria-expanded', 'false');
    manage.focus();
  }));
  saveStatus = document.createElement('p');
  saveStatus.setAttribute('role', 'status');
  target.append(title, toolbar, saveStatus);
  saveStatus.textContent = labels.loading;
  const entries = await api.saves();
  if (version !== saveRender || !target.isConnected || target.hidden) return;
  saveStatus.textContent = entries.length ? '' : labels.empty;
  const list = document.createElement('ul');
  for (const entry of entries) {
    const row = document.createElement('li');
    row.append(button(entry.name + ' · ' + labels[entry.scope], () => load(entry)));
    list.append(row);
  }
  target.append(list);
}

function setStrings(next: GameStrings): void {
  current = next;
  configureTools(next);
  document.documentElement.dataset.amicurLocale = next.language;
  if (panel?.isConnected && !panel.hidden) void showSaves().catch(console.error);
  schedule();
}

function changeLanguage(value: GameLanguage): void {
  const version = ++applyVersion;
  void api.language(value).then(next => {
    if (version === applyVersion) setStrings(next);
  }).catch(error => {
    console.error(error);
    if (version === applyVersion) schedule();
  });
}

function newLanguageSelect(): HTMLSelectElement {
  const select = document.createElement('select');
  for (const id of gameLanguages) select.add(new Option(languageNames[id], id));
  select.addEventListener('change', () => changeLanguage(select.value as GameLanguage));
  return select;
}

function updateSettingsMenu(): void {
  const panel = document.querySelector('#ui-dialog-body.settings');
  if (!panel) return;
  let field = document.querySelector<HTMLElement>('[data-amicur-language]');
  if (!field) {
    field = document.createElement('label');
    field.dataset.amicurLanguage = '';
    field.append(document.createElement('span'), newLanguageSelect());
    panel.prepend(field);
  }
  const select = field.querySelector('select')!;
  const label = field.querySelector('span')!;
  const name = words().language;
  if (label.textContent !== name) label.textContent = name;
  if (select.value !== current.language) select.value = current.language;
}

function mountSaves(): void {
  const dialog = document.querySelector('#ui-dialog-body.saves');
  if (!current.features.saves || !dialog) return;
  if (!dialog.querySelector('[data-amicur-saves]')) {
    const section = document.createElement('div');
    section.dataset.amicurSaves = '';
    panel = document.createElement('section');
    panel.hidden = true;
    const group = panel;
    manage = button(words().saves, async () => {
      if (!group.hidden) {
        group.hidden = true;
        manage.setAttribute('aria-expanded', 'false');
      } else {
        await showSaves();
      }
    });
    manage.setAttribute('aria-expanded', 'false');
    section.append(manage, panel);
    dialog.prepend(section);
  }
  if (manage.textContent !== words().saves) manage.textContent = words().saves;
}

function setup(): void {
  const style = document.createElement('style');
  style.textContent = gameControlStyles;
  document.head.append(style);

  new MutationObserver(schedule).observe(document.body, { childList: true, characterData: true, attributes: true, attributeFilter: ['src'], subtree: true });
  document.addEventListener(':passagedisplay', schedule);
  api.subscribe(() => {
    const version = ++applyVersion;
    void api.strings().then(next => { if (version === applyVersion) setStrings(next); }).catch(console.error);
  });
  void api.strings().then(setStrings).catch(console.error);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
else setup();
