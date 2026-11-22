import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, net, protocol, session, shell, type IpcMainEvent, type IpcMainInvokeEvent, type Session } from 'electron';
import * as fs from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { modDictionary } from './mod-locales.js';
import { initializePlugins, pluginsPath, defaultPack } from './plugins.js';
import { launchActions } from '../shared/types.js';
import { releaseSettings, gameDir, localDir, readJson, writeJson, data, games, gamesPath, loadSettings, normalizeSettings, prefsPath, releaseVersion, safeEntry, sharedSaves, tempPath, writeSettings } from './storage.js';
import { languagesMod, mods, prepareGame, updateProfile, versionOptions, type GameContext } from './mods.js';
import { formatProblems, resolveMods } from '../shared/compatibility.js';
import { installDropped } from './mod-install.js';
import { capture, createLanguagePacks, indexGame, strings } from './localization.js';
import { handleSave, listSaves, readSave } from './saves.js';
import { alreadyInstalled, install, itchUrl, launcherRelease, publication, releasesUrl } from './updates.js';
import { presentation } from './presentation.js';
import type { SaveEntry, Settings, UpdateStatus } from '../shared/types.js';

declare const __AMICUR_BUILD__: string;
const profilePath = path.join(data, 'profile');
const logPath = path.join(data, 'logs');
const crashPath = path.join(data, 'crash');
for (const directory of [profilePath, tempPath, prefsPath, logPath, crashPath, gamesPath]) {
  mkdirSync(directory, { recursive: true });
}
for (const key of ['TEMP', 'TMP', 'TMPDIR']) process.env[key] = tempPath;
app.setPath('temp', tempPath);
app.setPath('userData', profilePath);
app.setPath('sessionData', profilePath);
app.setPath('downloads', tempPath);
app.setPath('logs', logPath);
app.setPath('crashDumps', crashPath);
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('disable-crash-reporter');
app.setName("A Mirror's Curse Launcher");

const gameScheme = 'amicur-game';
protocol.registerSchemesAsPrivileged([{
  scheme: gameScheme, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
}]);

interface RunningGame { names: Map<string, string>; clean: boolean; window: BrowserWindow; context: GameContext }
const running = new Map<string, RunningGame>();
let launcher: BrowserWindow | null = null;
let currentSettings: Settings;
let status: UpdateStatus = { game: 'idle' };
let updateTask: Promise<UpdateStatus> | undefined;

function notify(): void {
  if (launcher && !launcher.isDestroyed()) launcher.webContents.send('launcher:changed');
}

function update(mode: 'auto' | 'check' | 'download' = 'auto'): Promise<UpdateStatus> {
  if (updateTask) return updateTask;
  updateTask = (async () => {
    const settings = currentSettings;
    const wantGame = settings.autoGame || mode !== 'auto';
    const wantLauncher = settings.notifyLauncher || mode !== 'auto';
    const launcherCheck = wantLauncher ? launcherRelease(__AMICUR_BUILD__).catch(() => undefined) : Promise.resolve(undefined);
    if (wantGame) {
      status = { ...status, game: 'checking' };
      notify();
      try {
        const release = await publication();
        if (await alreadyInstalled(release.version)) {
          status = { ...status, game: 'current', version: release.version };
        } else if (settings.autoGame || mode === 'download') {
          status = { ...status, game: 'downloading', version: release.version };
          notify();
          await install(release);
          status = { ...status, game: 'installed', version: release.version };
        } else {
          status = { ...status, game: 'available', version: release.version };
        }
      } catch (error) {
        console.error('Game update unavailable', error);
        status = { ...status, game: 'unavailable' };
      }
    } else {
      status = { ...status, game: 'idle' };
    }
    status = { ...status, launcher: await launcherCheck };
    notify();
    return status;
  })().finally(() => { updateTask = undefined; });
  return updateTask;
}

function restrict(target: BrowserWindow): void {
  target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  target.webContents.on('will-navigate', event => event.preventDefault());
  target.webContents.on('will-attach-webview', event => event.preventDefault());
}

function restrictSession(target: Session): void {
  target.setPermissionRequestHandler((_contents, _permission, respond) => respond(false));
  target.setPermissionCheckHandler(() => false);
}

function createLauncher(): void {
  if (launcher) {
    if (launcher.isMinimized()) launcher.restore();
    launcher.focus();
    return;
  }
  restrictSession(session.defaultSession);
  launcher = new BrowserWindow({
    width: 1140, height: 780, minWidth: 720, minHeight: 600, backgroundColor: '#9895c2', icon: path.join(__dirname, 'public', 'mirror.ico'),
    title: "A Mirror's Curse Launcher", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'launcher.js'), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  restrict(launcher);
  launcher.once('closed', () => { launcher = null; });
  void launcher.loadFile(path.join(__dirname, 'public', 'index.html'));
}

const gamePolicy = [
  "default-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self' data:", "media-src 'self' blob: data:",
  "object-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ');

async function setGameIcon(target: BrowserWindow, root: string, origin: string, favicons: string[]): Promise<void> {
  for (const favicon of favicons.slice(0, 12)) {
    try {
      const url = new URL(favicon);
      if (url.protocol !== gameScheme + ':' || url.host !== new URL(origin).host) continue;
      const relative = decodeURIComponent(url.pathname).slice(1);
      if (!relative || relative.includes('\\') || relative.includes(':')
        || relative.split('/').some(part => ['__amicur', 'amicur.set', 'modloader', 'mods', 'saves'].includes(part.toLowerCase()))) continue;
      const file = await safeEntry(root, relative);
      const info = await fs.stat(file);
      if (!info.isFile() || info.size > 8 * 1024 * 1024) continue;
      const icon = nativeImage.createFromPath(file);
      if (icon.isEmpty()) continue;
      if (!target.isDestroyed()) target.setIcon(icon);
      return;
    } catch {
      // Try the next icon if the selected release does not contain this one.
    }
  }
}

async function loadGame(folder: string, clean: boolean): Promise<void> {
  const existing = running.get(folder);
  if (existing) {
    if (existing.clean !== clean) throw new Error(currentSettings.locale === 'ru-RU' ? 'Закрой окно этой версии перед сменой режима запуска.' : 'Close this game window before changing launch mode.');
    existing.window.focus();
    return;
  }
  const game = await prepareGame(folder, clean);
  if (running.has(folder)) {
    running.get(folder)?.window.focus();
    return;
  }
  if ([...running.values()].some(item => item.context.profile.id === game.profile.id)) {
    throw new Error('This release has a copied modloader profile. Give the copy a fresh profile.');
  }
  if (!clean && game.profile.enabled.includes(languagesMod)) {
    const catalog = await indexGame(game);
    await createLanguagePacks(game, catalog.index);
  }
  if (running.has(folder)) {
    running.get(folder)?.window.focus();
    return;
  }
  const installed = clean ? [] : await mods(game);
  const plan = resolveMods(installed, new Set(clean ? [] : game.profile.enabled));
  if (plan.problems.length) {
    const message = formatProblems(plan.problems, currentSettings.locale);
    await recordError(game, 'modloader', 'compatibility', message);
    throw new Error(message);
  }
  const enabled = plan.ordered.map(id => installed.find(mod => mod.id === id)!).filter(mod => mod.entry);
  const version = await releaseVersion(game.root);
  const baseTitle = "A Mirror's Curse";
  const gameTitle = version ? baseTitle + ' [' + version + ']' : baseTitle;
  const context = session.fromPartition('persist:game-' + game.profile.id);
  const origin = gameScheme + '://' + game.profile.id;
  restrictSession(context);
  if (context.protocol.isProtocolHandled(gameScheme)) context.protocol.unhandle(gameScheme);
  const runtime = await fs.readFile(path.join(__dirname, 'game-runtime.js'), 'utf8');
  const icons = await fs.readFile(path.join(__dirname, 'public', 'game-icons.css'), 'utf8');
  const offlineFonts = await fs.readFile(path.join(__dirname, 'public', 'game-fonts.css'), 'utf8');

  context.protocol.handle(gameScheme, async request => {
    try {
      const url = new URL(request.url);
      if (url.host !== game.profile.id || request.method !== 'GET') return new Response(null, { status: 403 });
      const relative = decodeURIComponent(url.pathname).slice(1);
      if (relative === 'index.html' || relative === '') {
        const raw = await fs.readFile(await safeEntry(game.root, 'index.html'), 'utf8');
        const html = raw.replace(/https:\/\/fonts\.googleapis\.com\/css2\?[^"'\s<>]+/g, '/__amicur/fonts.css')
          .replaceAll('https://cdn.linearicons.com/free/1.0.0/icon-font.min.css', '/__amicur/icons.css');
        const scripts = enabled.map(mod => ({ id: mod.id, requires: mod.requires ?? [], url: '/__amicur/mod/' + mod.id + '/' + mod.entry }));
        const injection = clean ? '' : '<script defer src="/__amicur/game.js"></script><script defer src="/__amicur/loader.js" data-mods="' +
          encodeURIComponent(JSON.stringify(scripts)) + '"></script>';
        const patched = /<\/head\s*>/i.test(html) ? html.replace(/<\/head\s*>/i, injection + '$&') : injection + html;
        return new Response(patched, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': gamePolicy } });
      }

      if (relative === '__amicur/icons.css') return new Response(icons, { headers: { 'content-type': 'text/css; charset=utf-8' } });
      const offlineFont = /^__amicur\/fonts\/([a-zA-Z0-9_.-]+\.woff2)$/.exec(relative);
      if (offlineFont) {
        const file = await safeEntry(path.join(__dirname, 'public', 'fonts'), offlineFont[1]);
        return new Response(await fs.readFile(file), { headers: { 'content-type': 'font/woff2' } });
      }
      if (relative === '__amicur/fonts.css') return new Response(offlineFonts, { headers: { 'content-type': 'text/css; charset=utf-8' } });
      if (!clean && relative === '__amicur/loader.js') return new Response(await fs.readFile(path.join(__dirname, 'public/mod-loader.js')), { headers: { 'content-type': 'text/javascript' } });
      if (!clean && relative === '__amicur/game.js') return new Response(runtime, { headers: { 'content-type': 'text/javascript; charset=utf-8' } });
      const locale = /^__amicur\/locale\/(en-US|ru-RU|en-GB|uk-UA|ja-JP)\/(logo|banner)\.png$/.exec(relative);
      const module = /^__amicur\/mod\/([a-z0-9-]+)\/((?:script\/)[a-zA-Z0-9_./-]+)$/.exec(relative);
      let resource: string;
      if (!clean && locale && game.profile.enabled.includes(languagesMod) && locale[1] === game.profile.language) {
        const source = languagesMod + '/local/' + locale[1] + '/img/' + locale[2] + '.png';
        resource = await safeEntry(game.modRoot, source);
      } else if (module) {
        const mod = enabled.find(value => value.id === module[1]);
        if (!mod || module[2].split('/').some(part => part === '..' || part === '.')) return new Response(null, { status: 404 });
        resource = await safeEntry(await safeEntry(mod.directory, 'script'), module[2].slice('script/'.length));
      } else {
        if (!relative || relative.startsWith('__amicur/') || relative.includes('\\') || relative.includes(':')
          || /(^|\/)(?:amicur\.set|modloader|mods|saves)(\/|$)/i.test(relative)) return new Response(null, { status: 404 });
        resource = await safeEntry(game.root, relative);
      }
      if (!(await fs.stat(resource)).isFile()) return new Response(null, { status: 404 });
      if (module && /\.(?:m?js)$/i.test(resource)) return new Response(await fs.readFile(resource), { headers: { 'content-type': 'text/javascript' } });
      return net.fetch(pathToFileURL(resource).href, { headers: request.headers });
    } catch {
      return new Response(null, { status: 404 });
    }
  });

  const window = new BrowserWindow({
    width: 1280, height: 850, minWidth: 680, minHeight: 540, backgroundColor: '#17131a',
    title: gameTitle, autoHideMenuBar: true, show: false,
    webPreferences: {
      session: context, preload: clean ? undefined : path.join(__dirname, 'game.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
    },
  });
  restrict(window);
  window.on('page-title-updated', event => event.preventDefault());
  window.webContents.on('page-favicon-updated', (_event, favicons) => {
    void setGameIcon(window, game.root, origin, favicons);
  });
  const item: RunningGame = { window, context: game, clean, names: new Map(installed.map(mod => [mod.id, mod.name])) };
  running.set(folder, item);
  const save: (event: Electron.Event, item: Electron.DownloadItem, contents: Electron.WebContents) => void = (_event, item, contents) => {
    if (contents === window.webContents) handleSave(game, item, () => contents.send('game:changed'));
    else item.cancel();
  };
  if (!clean) context.on('will-download', save);
  window.once('closed', () => {
    context.removeListener('will-download', save);
    running.delete(folder);
    notify();
  });
  try {
    await window.loadURL(origin + '/index.html');
    const favicons = await window.webContents.executeJavaScript(
      'document.title = ' + JSON.stringify(gameTitle) + '; Array.from(document.querySelectorAll("link[rel~=icon]"), link => link.href)',
    ) as string[];
    await setGameIcon(window, game.root, origin, favicons);
    if (window.isDestroyed()) return;
    window.show();
    notify();
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
}

function checkLauncher(event: IpcMainInvokeEvent): void {
  if (event.sender !== launcher?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Invalid launcher request');
}

function checkGame(event: IpcMainInvokeEvent | IpcMainEvent): GameContext {
  for (const { window, context } of running.values()) {
    if (event.sender === window.webContents && event.senderFrame === event.sender.mainFrame) return context;
  }
  throw new Error('Invalid game request');
}

const locks = new Set<string>();
async function exclusive<T>(folder: string, work: () => Promise<T>) {
  const key = folder.toLowerCase();
  if (locks.has(key)) throw new Error(currentSettings.locale === 'ru-RU' ? 'Дождись завершения операции.' : 'Wait for the current operation.');
  locks.add(key);
  try { return await work(); } finally { locks.delete(key); }
}
const reportWrites = new Map<string, Promise<void>>();
function recordError(game: GameContext, id: string, stage: string, message: string) {
  const file = path.join(game.root, 'amicur.set', 'errors.json');
  const previous = reportWrites.get(file) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const rows = await readJson<string[]>(file, []);
    const version = await releaseVersion(game.root);
    const ru = currentSettings.locale === 'ru-RU';
    const names: Record<string, string> = ru
      ? { import: 'Загрузка скрипта', runtime: 'Выполнение скрипта', compatibility: 'Проверка зависимостей' }
      : { import: 'Script import', runtime: 'Script runtime', compatibility: 'Dependency check' };
    const name = running.get(game.folder)?.names.get(id);
    const entry = [
      new Date().toISOString(), (ru ? 'Игра: ' : 'Game: ') + [game.folder, version].filter(Boolean).join(' · '),
      (ru ? 'Мод: ' : 'Mod: ') + (name && name !== id ? name + ' (' + id + ')' : id),
      (ru ? 'Этап: ' : 'Stage: ') + (names[stage] ?? stage), message.slice(0, 4000)
    ].join('\n');
    await writeJson(file, [...rows.slice(-29), entry]);
    if (launcher && !launcher.isDestroyed()) launcher.webContents.send('launcher:mod-error', game.folder);
  });
  reportWrites.set(file, task);
  void task.finally(() => { if (reportWrites.get(file) === task) reportWrites.delete(file); }).catch(console.error);
  return task;
}
ipcMain.on('game:error', (event, id, stage, message) => {
  const game = checkGame(event);
  if (typeof id === 'string' && game.profile.enabled.includes(id) && ['import', 'runtime'].includes(stage) && typeof message === 'string')
    void recordError(game, id, stage, message).catch(console.error);
});
ipcMain.handle('launcher:report', async (event, folder: string, copy: boolean) => {
  checkLauncher(event);
  const file = path.join(await gameDir(folder), 'amicur.set', 'errors.json');
  await reportWrites.get(file);
  const report = (await readJson<string[]>(file, [])).toReversed().join('\n\n');
  if (copy && report) clipboard.writeText(report);
  return report;
});
ipcMain.handle('launcher:drop', (event, source: string, folder: string) => {
  checkLauncher(event);
  return exclusive(folder, async () => {
    const game = await prepareGame(folder);
    const ru = currentSettings.locale === 'ru-RU';
    return installDropped(source, async name => {
      const result = await dialog.showMessageBox(launcher!, {
        message: name, detail: ru ? 'Куда установить мод?' : 'Where should this mod be installed?',
        buttons: ru ? ['Только для ' + folder, 'Для всех версий', 'Отмена'] : ['Only for ' + folder, 'All releases', 'Cancel'], cancelId: 2
      });
      if (result.response === 2) return null;
      if (result.response === 0) return game.modRoot;
      const pack = await readJson<{ id?: string; enabled?: boolean } | null>(path.join(defaultPack, 'plugin.json'), null);
      if (pack?.id !== 'defold-modpack' || pack.enabled === false)
        throw new Error(ru ? 'Для установки во все версии включи defold-modpack.' : 'Enable defold-modpack to install into all releases.');
      return localDir(defaultPack, 'mods');
    });
  });
});
ipcMain.handle('launcher:release-setting', async (event, folder: string, action: string) => {
  checkLauncher(event);
  const game = await prepareGame(folder);
  const override = launchActions.find(value => value === action);
  if (!override && action !== 'inherit') throw new Error('Unknown launch action');
  await writeJson(path.join(game.root, 'amicur.set/launcher.json'), { afterLaunch: override });
});
ipcMain.handle('launcher:release', (event, action, folder: string, name: string) => {
  checkLauncher(event);
  return exclusive(folder, async () => {
    const root = await gameDir(folder);
    const ru = currentSettings.locale === 'ru-RU';
    if (action === 'folder') {
      const error = await shell.openPath(root);
      if (error) throw new Error(error);
      return true;
    }
    if (running.has(folder)) throw new Error(ru ? 'Сначала закрой окно игры.' : 'Close the game window first.');
    if ((await fs.lstat(path.join(gamesPath, folder))).isSymbolicLink()) throw new Error(ru ? 'Папка является ссылкой.' : 'This folder is a link.');
    if (action === 'delete') {
      const result = await dialog.showMessageBox(launcher!, {
        type: 'question', message: ru ? 'Переместить «' + folder + '» в корзину?' : 'Move “' + folder + '” to the Recycle Bin?',
        detail: ru ? 'Вместе с версией будут перемещены её моды и локальные сохранения.' : 'This includes its local mods and save files.',
        buttons: ru ? ['Отмена', 'В корзину'] : ['Cancel', 'Move to Recycle Bin'], defaultId: 0, cancelId: 0
      });
      if (result.response !== 1) return false;
      await shell.trashItem(root);
    } else if (action === 'rename') {
      if (typeof name !== 'string' || !name.trim() || /[<>:"/\\|?*\x00-\x1f]|[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
        throw new Error(ru ? 'Недопустимое имя папки.' : 'Invalid folder name.');
      if (folder === name) return true;
      const target = path.join(gamesPath, name);
      if (folder.toLowerCase() !== name.toLowerCase() && await fs.lstat(target).catch(() => null))
        throw new Error(ru ? 'Папка с таким именем уже существует.' : 'That folder name is already in use.');
      const version = await releaseVersion(root);
      if (version && !await fs.stat(path.join(root, 'amicur.set/release.json')).catch(() => null))
        await writeJson(path.join(root, 'amicur.set/release.json'), { version });
      await fs.rename(root, target);
    } else throw new Error('Unknown release action');
    return true;
  });
});

const getContext = (folder: string) => running.get(folder)?.context ?? prepareGame(folder);

ipcMain.handle('launcher:state', async event => {
  checkLauncher(event);
  const library = await games();
  for (const release of library) {
    try {
      const game = await prepareGame(release.folder);
      release.version = await releaseVersion(game.root);
      Object.assign(release, await releaseSettings(game.root));
    } catch (error) { console.error('Release preparation failed', release.folder, error); }
  }
  return { settings: currentSettings, games: library, updates: status, presentation: await presentation(), version: __AMICUR_BUILD__ };
});
ipcMain.handle('launcher:settings', async (event, settings: Settings) => {
  checkLauncher(event);
  const next = normalizeSettings(settings);
  await writeSettings(next);
  const shouldUpdate = next.ready && (!currentSettings.ready || next.autoGame !== currentSettings.autoGame
    || next.notifyLauncher !== currentSettings.notifyLauncher);
  currentSettings = next;
  if (shouldUpdate) void update();
});
ipcMain.handle('launcher:options', async (event, folder: string) => {
  checkLauncher(event);
  return versionOptions(await getContext(folder), running.has(folder));
});
ipcMain.handle('launcher:options-save', async (event, folder: string, language: unknown, enabled: unknown, settings: unknown) => {
  checkLauncher(event);
  const game = await getContext(folder);
  const active = running.get(folder);
  if (active && Array.isArray(enabled)) {
    const oldIds = game.profile.enabled.toSorted().join(',');
    const newIds = enabled.toSorted().join(',');
    if (oldIds !== newIds) throw new Error('Close this game window before changing its mods');
  }
  if (Array.isArray(enabled)) {
    const problems = resolveMods(await mods(game), new Set(enabled.filter((id): id is string => typeof id === 'string'))).problems;
    if (problems.length) throw new Error(formatProblems(problems, currentSettings.locale));
  }
  await updateProfile(game, language, enabled, settings);
  if (active) active.window.webContents.send('game:changed');
  return versionOptions(game, Boolean(active));
});
ipcMain.handle('launcher:launch', async (event, folder: string, clean = false) => {
  checkLauncher(event);
  const sourceWindow = launcher;
  const action = (await releaseSettings(await gameDir(folder))).afterLaunch ?? currentSettings.afterLaunch;
  await exclusive(folder, () => loadGame(folder, clean === true));
  if (action === 'keep') return;
  setImmediate(() => {
    if (!sourceWindow || sourceWindow.isDestroyed() || !running.has(folder)) return;
    if (action === 'minimize') sourceWindow.minimize();
    else sourceWindow.close();
  });
});
ipcMain.handle('launcher:update', (event, download: unknown) => {
  checkLauncher(event);
  return update(download === true ? 'download' : 'check');
});
ipcMain.handle('launcher:open', async (event, place: unknown, folder: string) => {
  checkLauncher(event);
  if (place === 'author') return shell.openExternal('https://github.com/Arkomiko');
  if (place === 'itch' || place === 'releases') return shell.openExternal(place === 'itch' ? itchUrl : releasesUrl);
  if (place !== 'games' && place !== 'mods' && place !== 'shared-mods') throw new Error('Unknown folder');
  const target = place === 'games' ? gamesPath : place === 'shared-mods' ? pluginsPath : (await getContext(folder)).modRoot;
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
});
ipcMain.handle('game:strings', event => strings(checkGame(event)));
ipcMain.handle('game:mod-locale', async (event, id: unknown) => {
  const game = checkGame(event);
  const installed = await mods(game);
  const language = installed.some(mod => mod.id === languagesMod && mod.enabled) ? game.profile.language : 'en-US';
  const mod = installed.find(mod => mod.id === id && mod.enabled);
  return { language, strings: mod ? await modDictionary(mod.directory, language) : {} };
});
ipcMain.handle('game:mod-settings', async (event, id: unknown) => {
  const game = checkGame(event);
  if (typeof id !== 'string' || !game.profile.enabled.includes(id)) return {};
  return (await mods(game)).find(mod => mod.id === id && mod.enabled)?.values ?? {};
});
ipcMain.handle('game:language', async (event, language: unknown) => {
  const game = checkGame(event);
  if (!game.profile.enabled.includes(languagesMod)) throw new Error('Language mod is disabled');
  await updateProfile(game, language);
  event.sender.send('game:changed');
  notify();
  return strings(game);
});
ipcMain.on('game:capture', (event, entries: unknown) => {
  try { capture(checkGame(event), entries); } catch { /* Invalid or closed game sender. */ }
});
ipcMain.handle('game:saves', event => {
  const game = checkGame(event);
  if (!game.profile.enabled.includes('multisaved-mod')) throw new Error('Shared save mod is disabled');
  return listSaves(game);
});
ipcMain.handle('game:read', (event, save: SaveEntry) => {
  const game = checkGame(event);
  if (!game.profile.enabled.includes('multisaved-mod')) throw new Error('Shared save mod is disabled');
  return readSave(game, save);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => createLauncher());
  app.whenReady().then(async () => {
    await initializePlugins();
    currentSettings = await loadSettings();
    createLauncher();
    if (currentSettings.ready) void update();
    const timer = setInterval(() => { if (currentSettings.ready) void update(); }, 4 * 60 * 60 * 1000);
    timer.unref();
  }).catch(error => {
    dialog.showErrorBox('Amicur Launcher', String(error));
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
}
