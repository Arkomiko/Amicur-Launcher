import type { GameApi, GameStrings } from '../shared/types.js';

interface Engine {
  Save: { base64: { save(): string; load(data: string): Promise<void> } };
  Engine: { show(): void };
  State: { passage: string };
}
interface Snapshot { id: string; kind: string; name: string; scene: string; date: number; data: string; version: string }
const engine = () => (window as unknown as { SugarCube: Engine }).SugarCube;
let settings: GameStrings;
let installed = false;
let panel: HTMLDialogElement;
let status: HTMLElement;
let database: Promise<IDBDatabase> | undefined;
let lastPassage: HTMLElement | null;
let history: { scene: string; text: string; choice: string }[] = [];
let openTool = '';
const label = (id: string, source: string) => settings.modText[id]?.[source] ?? source;
const has = (id: string) => settings.features.tools.includes(id);

function db() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('amicur-story-tools', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('saves', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
  return database;
}
async function snapshots(): Promise<Snapshot[]> {
  const store = (await db()).transaction('saves').objectStore('saves');
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result as Snapshot[]).sort((a,b) => b.date - a.date));
    request.onerror = () => reject(request.error);
  });
}
async function save(kind: string, name: string) {
  const data = engine().Save.base64.save();
  const record: Snapshot = { id: crypto.randomUUID(), kind, name, scene: engine().State.passage, version: document.title, date: Date.now(), data };
  const tx = (await db()).transaction('saves', 'readwrite');
  const store = tx.objectStore('saves');
  store.add(record);
  if (kind === 'quick-save') {
    const request = store.getAll();
    request.onsuccess = () => {
      const recent = (request.result as Snapshot[]).filter(item => item.kind === kind).sort((a,b) => b.date - a.date);
      for (const old of recent.slice(3)) store.delete(old.id);
    };
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  status.textContent = label(kind, 'Saved');
  if (!panel.open) {
    const toast = document.createElement('output');
    toast.dataset.storyTools = '';
    toast.style.cssText = 'position:fixed;bottom:1rem;right:1rem;z-index:10000;background:Canvas;color:CanvasText;padding:.6rem 1rem;border-radius:.4rem';
    toast.textContent = label('quick-save', 'Quick save created');
    document.body.append(toast);
    setTimeout(() => toast.remove(), 2000);
  }
}
async function restore(item: Snapshot) {
  await engine().Save.base64.load(item.data);
  engine().Engine.show();
  panel.close();
  document.querySelector<HTMLButtonElement>('#ui-dialog-close')?.click();
}
function persistHistory() {
  try { sessionStorage.setItem('amicur-history', JSON.stringify(history)); } catch { /* Keep the current session in memory. */ }
}
function capture() {
  if (!has('dialogue-history')) return;
  const passage = document.querySelector<HTMLElement>('#passages .passage:last-child');
  if (!passage || !passage.innerText.trim()) return;
  const scene = passage.dataset.passage || engine()?.State.passage || '';
  const narrative = passage.cloneNode(true) as HTMLElement;
  narrative.querySelectorAll('a.link-internal,button,input,select,style,script,[role=button],[hidden],[aria-hidden=true]').forEach(node => node.remove());
  narrative.querySelectorAll('br,p,div,blockquote,li').forEach(node => node.append('\n'));
  const text = (narrative.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim().slice(0, 8000);
  if (lastPassage === passage && history.length) {
    if (history.at(-1)!.text === text) return;
    history.at(-1)!.text = text;
  } else {
    history.push({ scene, text, choice: '' });
    history = history.slice(-100);
    lastPassage = passage;
  }
  persistHistory();
}

function button(title: string, action: () => void | Promise<void>, id: string) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = title;
  b.onclick = () => void Promise.resolve().then(action).catch(error => failure(id, error));
  return b;
}
function failure(id: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  status.textContent = message;
  (window as unknown as { amicur: GameApi }).amicur.error(id, 'runtime', message);
  if (!panel.open) { panel.replaceChildren(status, closeButton(id)); panel.showModal(); }
}
function closeButton(id: string) { return button(label(id, 'Close'), () => panel.close(), id); }
async function show(id: string) {
  openTool = id;
  capture();
  panel.replaceChildren();
  const heading = document.createElement('h2');
  heading.textContent = title(id);
  panel.append(heading, closeButton(id));
  if (!panel.open) panel.showModal();
  status.textContent = '';
  panel.append(status);
  if (id === 'dialogue-history') {
    for (const entry of history.toReversed()) {
      const p = document.createElement('p');
      p.textContent = [entry.scene, entry.text, entry.choice && label('dialogue-history', 'Choice: ') + entry.choice].filter(Boolean).join('\n');
      panel.append(p);
    }
    return;
  }
  if (id === 'scene-bookmarks') {
    const input = document.createElement('input');
    input.placeholder = label(id, 'Bookmark name');
    input.setAttribute('aria-label', input.placeholder);
    input.maxLength = 100;
    panel.append(input, button(label(id, 'Add bookmark'), async () => {
      await save(id, input.value.trim() || engine().State.passage); await show(id);
    }, id));
  } else panel.append(button(label(id, 'Quick save (F5)'), async () => { await save(id, ''); await show(id); }, id));
  const items = (await snapshots()).filter(item => item.kind === id);
  if (panel.querySelector('h2') !== heading) return;
  for (const item of items) {
    const row = document.createElement('p');
    row.append(button([item.name, item.scene, item.version, new Date(item.date).toLocaleString(settings.language)].filter(Boolean).join(' · '), () => restore(item), id));
    panel.append(row);
  }
}
function title(id: string) {
  if (id === 'dialogue-history') return label(id, 'Dialogue history');
  if (id === 'quick-save') return label(id, 'Quick saves');
  return label(id, 'Scene bookmarks');
}
function mount() {
  const host = document.querySelector('#ui-dialog-body.saves');
  if (!host || host.querySelector('[data-story-tools]')) return;
  const bar = document.createElement('div');
  bar.dataset.storyTools = '';
  for (const id of settings.features.tools) bar.append(button(title(id), () => show(id), id));
  host.prepend(bar);
}
export function configureTools(next: GameStrings) {
  settings = next;
  if (!next.features.tools.length) return;
  if (installed) { document.querySelector('#ui-dialog-body.saves [data-story-tools]')?.remove(); mount(); if (panel.open && openTool) void show(openTool); return; }
  installed = true;
  try { history = JSON.parse(sessionStorage.getItem('amicur-history') || '[]'); } catch { history = []; }
  panel = document.createElement('dialog');
  panel.dataset.storyTools = '';
  panel.style.cssText = 'max-width:min(38rem,88vw);max-height:75vh;overflow:auto;white-space:pre-line;padding:1rem;color:CanvasText;background:Canvas';
  status = document.createElement('p');
  status.setAttribute('role', 'status');
  document.body.append(panel);
  let frame = 0;
  new MutationObserver(() => {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; capture(); mount(); });
  }).observe(document.body, { subtree: true, characterData: true, childList: true });
  document.addEventListener('click', event => {
    const choice = event.target instanceof Element && event.target.closest('#passages a, #passages button');
    if (has('dialogue-history') && choice) {
      capture();
      if (history.length) { history.at(-1)!.choice = choice.textContent?.trim() || ''; persistHistory(); }
    }
  }, true);
  document.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    const quick = has('quick-save') && ['f5', 'f9'].includes(key) && !event.ctrlKey && !event.altKey;
    const id = key === 'h' ? 'dialogue-history' : key === 'b' ? 'scene-bookmarks' : '';
    if (!quick && !(id && event.altKey && has(id))) return;
    event.preventDefault();
    if (event.repeat) return;
    const action = async () => {
      if (!quick) return show(id);
      if (key === 'f5') return save('quick-save', '');
      const latest = (await snapshots()).find(item => item.kind === 'quick-save');
      if (!latest) return show('quick-save');
      await restore(latest);
    };
    void action().catch(error => failure(quick ? 'quick-save' : id, error));
  }, true);
  capture(); mount();
}
