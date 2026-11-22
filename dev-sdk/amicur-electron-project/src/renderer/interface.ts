import { formatProblems, resolveMods } from '../shared/compatibility.js';
import { messages } from '../shared/launcher-copy.js';
import { fonts, gameLanguages, launchActions, type Game, type LaunchAction, type GameLanguage, type LauncherApi, type Mod, type ModField, type ModSettings, type ModValue, type Settings, type UpdateStatus, type VersionOptions } from '../shared/types.js';

declare global { interface Window { launcher: LauncherApi } }
const app = document.getElementById('app')!;
const notice = document.getElementById('notice')!;
const api = window.launcher;
let state: Awaited<ReturnType<LauncherApi['state']>>;
let draft: Settings;
let page: 'games' | 'mods' | 'settings' = 'games';
let selected = '';
let step = 0;
let busy = false;
let noticeTimer: number;
let renderId = 0;
let viewTransition: ViewTransition | undefined;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
interface ModDraft { language: GameLanguage; enabled: Set<string>; values: ModSettings }
const modDrafts = new Map<string, ModDraft>();
const expandedMods = new Map<string, string>();

const names: Record<GameLanguage, string> = {
  'en-US': 'English (Original)', 'ru-RU': 'Русский', 'en-GB': 'English (UK)', 'uk-UA': 'Українська', 'ja-JP': '日本語',
};
type CopyKey = keyof typeof messages['en-US'];
const translate = (key: CopyKey) => {
  const locale = draft?.locale ?? 'en-US';
  return state?.presentation.strings[locale]?.[key] ?? messages[locale][key];
};
const escape = (value: string) => value.replace(/[&<>"']/g, character => {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return entities[character];
});
const t = (key: CopyKey) => escape(translate(key));
const mirror = '<img src="mirror.svg" alt="">';
const gear = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="m10 2-.8 2.7-2 .9L4.5 5 2 9.3l1.9 2v2.1l-1.9 2 2.5 4.3 2.7-.6 2 .9.8 2h4l.8-2.6 2-.9 2.7.6 2.5-4.3-1.9-2v-2.1l1.9-2L19.5 5l-2.7.6-2-.9L14 2z"/><circle cx="12" cy="12" r="3.1"/></svg>';
const chevron = '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m4 6 4 4 4-4"/></svg>';

function msg(text: string): void {
  notice.textContent = text;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => { notice.hidden = true; }, 4300);
}
function on(id: string, action: (element: HTMLElement) => void | Promise<void>): void {
  const target = document.getElementById(id);
  if (!target) return;
  target.addEventListener('click', () => void Promise.resolve().then(() => action(target)).catch(error => {
    console.error(error);
    msg(errorText(error));
  }));
}

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}
function modal(title: string) {
  const dialog = document.createElement('dialog');
  dialog.className = 'launcher-dialog';
  const heading = document.createElement('h2');
  heading.textContent = title;
  dialog.append(heading);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  return dialog;
}
function modalButton(key: CopyKey, fn: () => void) {
  const button = document.createElement('button');
  button.textContent = translate(key);
  button.onclick = fn;
  return button;
}
async function showReport(folder: string) {
  const report = await api.report(folder);
  const dialog = modal(translate('reportTitle') + ' · ' + folder);
  const body = document.createElement('pre');
  body.textContent = report || translate('noErrors');
  dialog.append(body);
  if (report) dialog.append(modalButton('copyReport', () => { void api.report(folder, true).catch(error => msg(errorText(error))); }));
  dialog.append(modalButton('closeReport', () => dialog.close()));
  dialog.showModal();
}
function renameDialog(folder: string) {
  const dialog = modal(translate('renameGame'));
  const field = document.createElement('input');
  field.setAttribute('aria-label', translate('folderName'));
  field.value = folder;
  const form = document.createElement('form');
  form.append(field, modalButton('confirmRename', () => {}));
  form.onsubmit = async event => {
    event.preventDefault();
    try {
      await api.release('rename', folder, field.value);
      modDrafts.delete(folder); selected = field.value;
      dialog.close(); await refresh();
    } catch (error) { field.setCustomValidity(errorText(error)); field.reportValidity(); }
  };
  field.oninput = () => field.setCustomValidity('');
  dialog.append(form, modalButton('cancelAction', () => dialog.close()));
  dialog.showModal(); field.select();
}

function animateChange(type: 'page' | 'appearance', change: () => void): void {
  viewTransition?.skipTransition();
  if (reducedMotion.matches || !document.startViewTransition) {
    change();
    return;
  }
  const transition = document.startViewTransition({ types: [type], update: change });
  viewTransition = transition;
  void transition.ready.catch(() => {});
  void transition.finished.catch(error => console.error(error)).finally(() => {
    if (viewTransition === transition) viewTransition = undefined;
  });
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable ||
    target.matches('textarea, input:is([type=text], [type=number], [type=search], :not([type]))'));
}

for (const type of ['selectstart', 'copy', 'cut', 'dragstart', 'contextmenu']) {
  document.addEventListener(type, event => {
    if (!isEditable(event.target)) event.preventDefault();
  });
}

function selectedTheme() {
  const themes = state.presentation.themes;
  return Object.hasOwn(themes, draft.theme) ? themes[draft.theme] : themes.Amicur;
}

function updateWallpaper(): void {
  if (!draft) return;
  const theme = selectedTheme();
  const now = new Date();
  const minute = now.getHours() * 60 + now.getMinutes();
  const entry = theme?.backgrounds.find(({ from, to }) =>
    from === to || (from < to ? minute >= from && minute < to : minute >= from || minute < to));
  const html = document.documentElement;
  html.toggleAttribute('data-wallpaper', Boolean(entry));
  if (entry) html.style.setProperty('--wallpaper', 'url(' + JSON.stringify(entry.url) + ')');
  else html.style.removeProperty('--wallpaper');
}

function style(): void {
  const theme = selectedTheme();
  const html = document.documentElement;
  html.lang = draft.locale;
  html.dataset.theme = draft.theme;
  html.dataset.tone = theme?.tone ?? 'dark';
  html.dataset.font = draft.font;
  const root = html.style;
  for (const key of Array.from(root)) if (key.startsWith('--')) root.removeProperty(key);
  for (const [key, colour] of Object.entries(theme?.colours ?? {})) root.setProperty('--' + key, colour);
  root.fontSize = draft.scale + '%';
  updateWallpaper();
}

function select(id: string, label: string, options: readonly string[], current: string, name: (option: string) => string): string {
  return '<label class="field"><span>' + label + '</span><select id="' + id + '">' +
    options.map(option => '<option value="' + escape(option) + '"' + (option === current ? ' selected' : '') + '>' + escape(name(option)) + '</option>').join('') +
    '</select></label>';
}

function languageField(): string {
  return select('locale', t('language'), ['en-US', 'ru-RU'], draft.locale, lang => lang === 'ru-RU' ? 'Русский' : 'English');
}
function appearanceFields(): string {
  return '<div class="row">' + select('theme', t('theme'), Object.keys(state.presentation.themes), draft.theme,
    value => state.presentation.themes[value].name[draft.locale]) +
    select('font', t('font'), fonts, draft.font, value => t(value as typeof fonts[number])) + '</div>' +
    '<label class="field"><span>' + t('scale') + ' <output id="scale-value">' + draft.scale +
    '%</output></span><input id="scale" type="range" min="85" max="140" value="' + draft.scale + '"></label>';
}
function check(id: string, label: string, checked: boolean): string {
  return '<label class="check"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '><span>' + label + '</span></label>';
}
function updateFields(): string {
  return check('autoGame', t('gameAuto'), draft.autoGame) + check('notifyLauncher', t('launcherAuto'), draft.notifyLauncher);
}

function bindSettings(): void {
  const edits = [
    ['locale', (value: string) => { draft.locale = value === 'ru-RU' ? 'ru-RU' : 'en-US'; render(); }],
    ['theme', (value: string) => { draft.theme = value; animateChange('appearance', style); }],
    ['font', (value: string) => { draft.font = value as Settings['font']; animateChange('appearance', style); }],
    ['after-launch', (value: string) => { draft.afterLaunch = value as LaunchAction; }],
  ] as const;
  for (const [id, handler] of edits) {
    const field = document.getElementById(id) as HTMLSelectElement | null;
    field?.addEventListener('change', () => handler(field.value));
  }
  const scale = document.getElementById('scale') as HTMLInputElement | null;
  scale?.addEventListener('input', () => {
    draft.scale = Number(scale.value);
    document.getElementById('scale-value')!.textContent = draft.scale + '%';
    style();
  });
  for (const key of ['autoGame', 'notifyLauncher'] as const) {
    const field = document.getElementById(key) as HTMLInputElement | null;
    field?.addEventListener('change', () => { draft[key] = field.checked; });
  }
}

function wizard(): void {
  const sections = [
    '<h2>' + t('setupLanguage') + '</h2>' + languageField(),
    '<h2>' + t('appearance') + '</h2>' + appearanceFields(),
    '<h2>' + t('updates') + '</h2>' + updateFields(),
  ];
  app.innerHTML = '<main class="wizard"><section class="panel" aria-label="' + t('welcome') + '">' +
    '<div class="panel-head"><h1>' + t('welcome') + '</h1></div><div class="panel-body stack">' + '<div class="brand">' + mirror + '<span>Amicur</span></div>' +
    '<div class="steps" aria-hidden="true">' + sections.map((_, index) => '<span class="' + (index <= step ? 'active' : '') + '"></span>').join('') + '</div>' +
    sections[step] + '<div class="row between"><button class="quiet" id="back"' + (step ? '' : ' disabled') + '>' + t('back') +
    '</button><button class="primary" id="next">' + t(step === 2 ? 'finish' : 'next') + '</button></div></div></section></main>';
  bindSettings();
  on('back', () => { step--; render(); });
  on('next', async element => {
    if (step < 2) { step++; render(); return; }
    (element as HTMLButtonElement).disabled = true;
    try {
      const ready = { ...draft, ready: true };
      await api.settings(ready);
      draft = ready;
      await refresh();
    } finally {
      (element as HTMLButtonElement).disabled = false;
    }
  });
}

function appendReleases(): void {
  const select = document.getElementById('release') as HTMLSelectElement | null;
  if (!select) return;
  select.add(new Option(translate('unknown'), '', false, !selected));
  for (const game of state.games) {
    const hasVersion = game.folder.split(/\s+/).some(label => label === game.version || label === 'v' + game.version);
    const label = game.version && !hasVersion ? game.folder + ' · ' + game.version : game.folder;
    select.add(new Option(label, game.folder, false, game.folder === selected));
  }
  select.addEventListener('change', () => { selected = select.value; render(); });
}

function releaseField(): string {
  return '<label class="field"><span>' + t('release') + '</span><select id="release" class="release-select"></select></label>';
}

function updatePanel(status: UpdateStatus): string {
  return '<section class="panel"><header class="panel-head"><h2>' + t('updates') + '</h2></header>' +
    '<div class="panel-body stack"><p id="update-status" aria-live="polite"></p><div class="actions">' +
    '<button class="quiet" id="check"' + (status.game === 'checking' || status.game === 'downloading' ? ' disabled' : '') + '>' + t('check') + '</button>' +
    (status.game === 'available' ? '<button class="primary" id="download-game">' + t('downloadGame') + '</button>' : '') +
    '<button class="quiet" id="itch">' + t('itch') + '</button></div>' +
    (status.launcher ? '<div class="row between"><p id="launcher-version"></p><button id="releases">' + t('releases') + '</button></div>' : '') +
    '</div></section>';
}

function gamePage(): string {
  return '<div class="library"><section class="cover"><h1 class="sr-only">A Mirror’s Curse</h1><img class="cover-art" src="art/game-logo.png" alt="">' +
    '<p class="credit">' + t('publisher') + '</p></section>' +
    '<div class="stack"><section class="panel"><header class="panel-head"><h2>' + t('launch') + '</h2></header>' +
    '<div class="panel-body stack">' + (state.games.length ? '<div class="row launch-fields">' + releaseField() +
    '<button class="primary" id="play"' + (selected && !busy ? '' : ' disabled') + '>' + t('play') + '</button><button id="launch-more" popovertarget="launch-options" aria-label="' + t('launchMenu') + '"' + (!selected || busy ? ' disabled' : '') + '>▾</button>' +
    '<div id="launch-options" popover>' + (['startGame','cleanGame','gameFolder','renameGame','deleteGame','updateGame'] as const)
      .map(key => '<button id="action-' + key + '">' + t(key) + '</button>').join('') + '</div></div>' + (selected ? select('release-action', t('releaseAction'), ['inherit', ...launchActions], state.games.find(game => game.folder === selected)?.afterLaunch ?? 'inherit', value => translate(value === 'inherit' ? 'inheritLauncher' : value as LaunchAction)) : '') :
    '<h3>' + t('empty') + '</h3><p>' + t('instructions') + '</p>') +
    '<div class="actions"><button class="quiet" id="games-folder">' + t('openGames') + '</button><button class="quiet" id="refresh">' +
    t('refresh') + '</button></div></div></section>' + updatePanel(state.updates) + '</div></div>';
}

function modPage(id: number): string {
  if (selected) void api.options(selected).then(options => { if (id === renderId) fillMods(options); }).catch(error => {
    console.error(error);
    if (id === renderId) {
      const options = document.getElementById('version-options');
      if (options) options.textContent = translate('failed');
    }
  });
  return '<div class="mod-workspace"><aside class="panel release-sidebar"><header class="panel-head"><h2>' + t('releasesList') +
    '</h2></header><div id="mod-releases" class="panel-body release-list"></div></aside>' +
    '<section class="panel"><header class="panel-head"><h1>' + t('mods') + '</h1></header><div class="panel-body">' +
    '<div id="version-options" class="stack"><p>' + t(selected ? 'modLoading' : 'noMods') + '</p></div></div></section></div>';
}

function fillReleaseList(): void {
  const list = document.getElementById('mod-releases');
  if (!list) return;
  for (const game of state.games) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.release = game.folder;
    if (selected === game.folder) button.setAttribute('aria-current', 'true');
    const name = document.createElement('span');
    name.textContent = game.version ?? game.folder;
    button.append(name);
    if (game.version && game.folder !== 'v' + game.version) {
      const folder = document.createElement('small');
      folder.textContent = game.folder;
      button.append(folder);
    }
    button.addEventListener('click', () => {
      if (selected !== game.folder) { selected = game.folder; render(); }
    });
    list.append(button);
  }
}

function settingControl(field: ModField, mod: Mod, value: ModValue, update: (value: ModValue) => void): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = field.type === 'boolean' ? 'check' : 'field';
  const title = document.createElement('span');
  title.textContent = field.label;
  if (field.type === 'choice') {
    const input = document.createElement('select');
    input.setAttribute('aria-label', title.textContent);
    for (const choice of field.choices) {
      const text = choice.label;
      input.add(new Option(text, choice.value));
    }
    input.value = String(value);
    input.addEventListener('change', () => update(input.value));
    label.append(title, input);
    return label;
  }
  const input = document.createElement('input');
  input.type = field.type === 'boolean' ? 'checkbox' : field.type === 'number' ? 'number' : 'text';
  input.checked = value === true;
  input.value = String(value);
  input.maxLength = 512;
  if (field.type === 'number') input.step = 'any';
  input.addEventListener('input', () => {
    if (field.type === 'boolean') update(input.checked);
    else if (field.type === 'string') update(input.value);
    else if (Number.isFinite(input.valueAsNumber)) update(input.valueAsNumber);
  });
  if (field.type === 'number') input.addEventListener('blur', () => {
    if (!Number.isFinite(input.valueAsNumber)) input.value = String(field.default);
    update(input.valueAsNumber);
  });
  label.append(...(field.type === 'boolean' ? [input, title] : [title, input]));
  return label;
}

function modRow(mod: Mod, selection: ModDraft, folder: string, changed: () => void): HTMLElement {
  const row = document.createElement('article');
  row.className = 'mod-row';
  const header = document.createElement('div');
  header.className = 'mod-head';
  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'mod-name';
  title.innerHTML = chevron;
  const name = document.createElement('span');
  name.textContent = mod.name;
  title.append(name);
  const control = document.createElement('label');
  control.className = 'mod-control';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = selection.enabled.has(mod.id);
  input.setAttribute('aria-label', name.textContent);
  input.addEventListener('change', () => {
    if (input.checked) selection.enabled.add(mod.id);
    else selection.enabled.delete(mod.id);
    changed();
  });
  control.append(input);
  header.append(title, control);

  const disclosure = document.createElement('div');
  disclosure.className = 'mod-disclosure';
  disclosure.id = 'details-' + mod.id;
  const clip = document.createElement('div');
  clip.className = 'mod-disclosure-content';
  const details = document.createElement('div');
  details.className = 'mod-details stack';
  clip.append(details);
  disclosure.append(clip);

  function setOpen(button: HTMLButtonElement, panel: HTMLElement, open: boolean): void {
    button.setAttribute('aria-expanded', String(open));
    panel.toggleAttribute('data-open', open);
    panel.inert = !open;
  }

  title.setAttribute('aria-controls', disclosure.id);
  setOpen(title, disclosure, expandedMods.get(folder) === mod.id);
  title.addEventListener('click', () => {
    const open = !disclosure.hasAttribute('data-open');
    const previouslyOpen = row.parentElement?.querySelector<HTMLButtonElement>('.mod-name[aria-expanded=true]');
    if (open && previouslyOpen) {
      setOpen(previouslyOpen, document.getElementById(previouslyOpen.getAttribute('aria-controls')!)!, false);
    }
    setOpen(title, disclosure, open);
    if (open) expandedMods.set(folder, mod.id);
    else expandedMods.delete(folder);
  });
  const description = mod.description;
  if (mod.source !== 'builtin' || description) {
    const info = document.createElement('p');
    info.className = 'small';
    const source = mod.source !== 'builtin' ? mod.id + ' · ' + translate(mod.source === 'shared' ? 'fromShared' : 'fromRelease') : '';
    info.textContent = [source, description].filter(Boolean).join(' · ');
    details.append(info);
  }
  if (mod.source !== 'builtin') {
    const info = document.createElement('p');
    const version = state.games.find(game => game.folder === folder)?.version;
    info.textContent = [
      mod.version, translate(version && mod.tested?.includes(version) ? 'checkedVersion' : 'untested'),
      mod.tested?.join(', '), mod.requires?.length && translate('dependencies') + ': ' + mod.requires.join(', '),
      mod.conflicts?.length && translate('conflicting') + ': ' + mod.conflicts.join(', '), mod.problem,
    ].filter(Boolean).join(' · ');
    details.append(info);
  }
  if (mod.id === 'multilanguage-mod') {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = select('game-language', t('gameLanguage'), gameLanguages, selection.language, lang => names[lang as GameLanguage]);
    const language = wrapper.querySelector('select')!;
    language.addEventListener('change', () => {
      selection.language = language.value as GameLanguage;
      changed();
    });
    details.append(wrapper);
  } else if (mod.fields.length) {
    for (const field of mod.fields) {
      details.append(settingControl(field, mod, selection.values[mod.id][field.id], value => {
        selection.values[mod.id][field.id] = value;
        changed();
      }));
    }
  } else {
    const empty = document.createElement('p');
    empty.className = 'small';
    empty.textContent = translate('noModSettings');
    details.append(empty);
  }
  row.append(header, disclosure);
  return row;
}

function fillMods(options: VersionOptions): void {
  const found = document.getElementById('version-options');
  if (!found) return;
  const region = found;
  const folder = selected;
  const id = renderId;
  const saved = new Set(options.mods.filter(mod => mod.enabled).map(mod => mod.id));
  const previous = modDrafts.get(folder);
  const selection: ModDraft = {
    language: previous?.language ?? options.language,
    enabled: options.running || !previous ? new Set(saved) : new Set(options.mods.filter(mod => previous.enabled.has(mod.id)).map(mod => mod.id)),
    values: Object.fromEntries(options.mods.map(mod => [mod.id, { ...mod.values, ...previous?.values[mod.id] }])),
  };
  region.innerHTML = '<div class="mod-list" id="mod-list"></div><p class="small">' + t('dropHelp') +
    '</p><div class="actions"><button class="quiet" id="mods-folder">' + t('openMods') +
    '</button><button class="quiet" id="shared-mods-folder">' + t('pluginsFolder') + '</button><button class="quiet" id="refresh">' + t('refresh') + '</button><button id="mod-report">' + t('reportTitle') + '</button></div>' +
    (options.running ? '<p class="small">' + t('runningMods') + '</p>' : '') +
    '<div class="actions between mod-footer"><p class="small" id="mod-status" aria-live="polite"></p><div class="actions">' +
    '<button class="quiet" id="reset-mods" disabled>' + t('discard') + '</button><button class="primary" id="save-mods" disabled>' + t('apply') + '</button></div></div>';

  const list = region.querySelector('#mod-list')!;
  for (const mod of options.mods.toSorted((a, b) => Number(b.source === 'builtin') - Number(a.source === 'builtin'))) {
    list.append(modRow(mod, selection, folder, changed));
  }
  const save = region.querySelector<HTMLButtonElement>('#save-mods')!;
  const reset = region.querySelector<HTMLButtonElement>('#reset-mods')!;
  const status = region.querySelector('#mod-status')!;
  const toggles = region.querySelectorAll<HTMLInputElement>('.mod-control input');
  const fields = region.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.mod-details input, .mod-details select');
  let saving = false;

  function changed() {
    toggles.forEach(input => { input.disabled = saving || options.running; });
    fields.forEach(field => { field.disabled = saving; });
    const dirty = selection.language !== options.language || options.mods.some(mod =>
      selection.enabled.has(mod.id) !== saved.has(mod.id) ||
      mod.fields.some(field => selection.values[mod.id][field.id] !== mod.values[field.id]));
    const problems = resolveMods(options.mods, selection.enabled).problems;
    save.disabled = !dirty || saving || problems.length > 0;
    reset.disabled = !dirty || saving;
    status.textContent = problems.length ? formatProblems(problems, draft.locale) : translate(dirty ? 'pending' : 'noChanges');
    if (dirty) modDrafts.set(folder, selection);
    else modDrafts.delete(folder);
  }
  changed();
  on('save-mods', async () => {
    saving = true;
    changed();
    try {
      const updated = await api.optionsSave(folder, selection.language, [...selection.enabled], selection.values);
      modDrafts.delete(folder);
      if (id === renderId) fillMods(updated);
      msg(translate('saved'));
    } finally {
      if (id === renderId && region.contains(save)) { saving = false; changed(); }
    }
  });
  on('reset-mods', () => { modDrafts.delete(folder); fillMods(options); });
  on('mod-report', () => showReport(folder));
  on('mods-folder', () => api.open('mods', folder));
  on('shared-mods-folder', () => api.open('shared-mods'));
  on('refresh', () => refresh());
}

function settingsPage(): string {
  return '<section class="panel page-panel"><header class="panel-head"><h1>' + t('settings') + '</h1></header>' +
    '<div class="panel-body stack">' + languageField() + appearanceFields() +
    select('after-launch', t('afterLaunch'), launchActions, draft.afterLaunch, value => translate(value as LaunchAction)) +
    updateFields() + '<div><button id="save-settings" class="primary">' + t('save') + '</button></div></div></section>';
}

function render(): void {
  const id = ++renderId;
  style();
  if (!draft.ready) { wizard(); return; }
  const active = (key: typeof page) => page === key ? ' aria-current="page"' : '';
  const body = page === 'games' ? gamePage() : page === 'mods' ? modPage(id) : settingsPage();
  app.innerHTML = '<header class="topbar"><nav class="topbar-inner" aria-label="Amicur"><button id="nav-games" class="brand"' + active('games') +
    '>' + mirror + '<span>' + t('home') + '</span></button><button id="nav-mods"' + active('mods') + '>' + t('mods') +
    '</button><button class="settings-button" id="nav-settings" aria-label="' + t('settings') +
    '" title="' + t('settings') + '"' + active('settings') + '>' + gear + '</button></nav></header><main>' + body + '</main>';
  for (const key of ['games', 'mods', 'settings'] as const) on('nav-' + key, button => {
    if (page === key) return;
    const restoreFocus = document.activeElement === button;
    page = key;
    animateChange('page', () => {
      render();
      app.scrollTo(0, 0);
      if (restoreFocus) document.getElementById('nav-' + page)?.focus({ preventScroll: true });
    });
  });
  const override = document.getElementById('release-action') as HTMLSelectElement | null;
  override?.addEventListener('change', () => {
    const game = state.games.find(game => game.folder === selected);
    if (!game) return;
    const action = override.value;
    void api.releaseSetting(game.folder, action).then(() => { game.afterLaunch = launchActions.find(value => value === action); })
      .catch(error => { override.value = game.afterLaunch ?? 'inherit'; msg(errorText(error)); });
  });
  appendReleases();
  fillReleaseList();
  bindSettings();
  const detail = document.getElementById('update-status');
  if (detail) detail.textContent = translate(state.updates.game) + (state.updates.version ? ' · ' + state.updates.version : '');
  const newer = document.getElementById('launcher-version');
  if (newer) newer.textContent = translate('launcherNew') + ' · ' + state.updates.launcher;
  on('games-folder', () => api.open('games'));
  on('itch', () => api.open('itch'));
  on('releases', () => api.open('releases'));
  on('refresh', () => refresh());
  on('check', async () => { await api.update(); await refresh(); });
  on('download-game', async () => { await api.update(true); await refresh(); });
  const launch = async (clean = false) => {
    if (busy) return;
    busy = true;
    render();
    try { await api.launch(selected, clean); msg(translate('gameOpened')); }
    finally { busy = false; render(); }
  };
  on('play', () => launch());
  on('action-startGame', () => launch());
  on('action-cleanGame', () => launch(true));
  on('action-gameFolder', async () => { await api.release('folder', selected); });
  on('action-renameGame', () => renameDialog(selected));
  on('action-deleteGame', async () => { if (await api.release('delete', selected)) { modDrafts.delete(selected); await refresh(); } });
  on('action-updateGame', async () => { await api.update(true); await refresh(); });
  const menu = document.getElementById('launch-options');
  menu?.addEventListener('beforetoggle', event => {
    if ((event as ToggleEvent).newState !== 'open') return;
    const rect = document.getElementById('launch-more')!.getBoundingClientRect();
    menu.style.left = Math.max(8, rect.right - 224) + 'px';
    menu.style.top = Math.max(8, Math.min(rect.bottom + 4, innerHeight - 290)) + 'px';
  });
  menu?.addEventListener('click', () => menu.hidePopover());
  on('save-settings', async () => { await api.settings(draft); msg(translate('saved')); });
}

async function refresh(): Promise<void> {
  state = await api.state();
  document.getElementById('current-version')!.textContent = state.version;
  draft ??= { ...state.settings };
  if (!Object.hasOwn(state.presentation.themes, draft.theme)) draft.theme = 'Amicur';
  if (!state.games.some((game: Game) => game.folder === selected)) selected = state.games[0]?.folder ?? '';
  render();
}

document.addEventListener('dragover', event => {
  if (event.dataTransfer?.types.includes('Files')) {
    event.preventDefault(); event.dataTransfer.dropEffect = page === 'mods' && selected ? 'copy' : 'none';
  }
});
document.addEventListener('drop', async event => {
  event.preventDefault();
  if (page !== 'mods' || !selected) return;
  const folder = selected;
  try {
    for (const file of Array.from(event.dataTransfer?.files ?? [])) {
      const id = await api.dropMod(file, folder);
      if (id) msg(translate('installedMod') + ': ' + id);
    }
  } catch (error) { msg(errorText(error)); }
  finally { await refresh(); }
});
document.getElementById('author-link')!.addEventListener('click', event => {
  event.preventDefault();
  void api.open('author').catch(error => msg(errorText(error)));
});
api.onModError(folder => {
  msg(translate('modError') + ' · ' + folder);
  const action = modalButton('reportTitle', () => { void showReport(folder); });
  notice.append(' ', action);
});
api.subscribe(() => { void refresh().catch(() => msg(translate('failed'))); });
void refresh().catch(error => { console.error(error); msg(messages['en-US'].failed); });

window.setInterval(updateWallpaper, 15000);
window.addEventListener('focus', updateWallpaper);
