import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { open, type Entry, type ZipFile } from 'yauzl';
import { dirs, games, gamesPath, ordinaryFile, tempPath, writeJson } from './storage.js';

export const itchUrl = 'https://amaty.itch.io/a-mirrors-curse';
export const releasesUrl = 'https://github.com/Arkomiko/Amicur-Launcher/releases';
const zipLimit = 1024 * 1024 * 1024;
const installedLimit = 4 * zipLimit;
const number = /^\d+(?:\.\d+){1,3}$/;

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];

interface Publication {
  version: string;
  upload: string;
  csrf: string;
  cookies: string;
}

function element(node: Node, find: (node: Element) => boolean): Element | undefined {
  if ('tagName' in node && find(node)) return node;
  if ('childNodes' in node) {
    for (const child of node.childNodes) {
      const item = element(child, find);
      if (item) return item;
    }
  }
}

function attr(node: Element, key: string): string {
  return node.attrs.find(value => value.name === key)?.value ?? '';
}

function hasClass(node: Element, name: string): boolean {
  return attr(node, 'class').split(/\s+/).includes(name);
}

function allUploads(node: Node): Element[] {
  if ('tagName' in node && hasClass(node, 'upload')) return [node];
  return 'childNodes' in node ? node.childNodes.flatMap(allUploads) : [];
}

export async function publication(): Promise<Publication> {
  const response = await fetch(itchUrl, { signal: AbortSignal.timeout(20000) });
  if (!response.ok || new URL(response.url).hostname !== 'amaty.itch.io') throw new Error('Unable to read itch.io release');
  const tree = parse(await response.text());
  const csrfMeta = element(tree, node => node.tagName === 'meta' && attr(node, 'name') === 'csrf_token');
  const csrf = csrfMeta && attr(csrfMeta, 'value');
  if (!csrf) throw new Error('itch.io download page is unavailable');
  const uploads = allUploads(tree).flatMap(upload => {
    const download = element(upload, node => node.tagName === 'a' && hasClass(node, 'download_btn'));
    const title = element(upload, node => node.tagName === 'strong' && hasClass(node, 'name'));
    if (!download || !title) return [];
    const name = attr(title, 'title');
    const id = attr(download, 'data-upload_id');
    const match = /^A Mirror.s Curse\s+(?:v)?(\d+(?:\.\d+){1,3})\b.*\.zip$/i.exec(name);
    return match && /^\d+$/.test(id) ? [{ version: match[1], upload: id }] : [];
  });
  uploads.sort((a, b) => compare(b.version, a.version));
  if (uploads.length === 0) throw new Error('No public game ZIP found');
  return { ...uploads[0], csrf, cookies: response.headers.getSetCookie().map(item => item.split(';')[0]).join('; ') };
}

function compare(a: string, b: string): number {
  const parts = (version: string) => version.split('.').map(Number);
  const x = parts(a);
  const y = parts(b);
  for (let index = 0; index < Math.max(x.length, y.length); index++) {
    const difference = (x[index] ?? 0) - (y[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function launcherVersionParts(value: string): number[] | undefined {
  const build = /^(\d+)\.(\d+)\.(?:(\d+)\.)?(\d{4})-(\d{4})([abr]?)$/.exec(value);
  if (build) {
    const [, major, minor, variation, date, time, channel] = build;
    return [+major, +minor, 1, Number(variation ?? 0), +date, +time, channel === 'a' ? 0 : channel === 'b' ? 1 : 2];
  }
  if (number.test(value)) {
    const [major, minor, ...rest] = value.split('.').map(Number);
    return [major, minor, 0, ...rest];
  }
}

export async function launcherRelease(installed: string): Promise<string | undefined> {
  const response = await fetch('https://api.github.com/repos/Arkomiko/Amicur-Launcher/releases/latest', {
    headers: { accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return;
  const release = await response.json() as { tag_name?: string };
  const version = release.tag_name?.replace(/^v/i, '');
  const next = version && launcherVersionParts(version);
  const current = launcherVersionParts(installed);
  if (next && current && compare(next.join('.'), current.join('.')) > 0) return version;
}

export async function alreadyInstalled(version: string): Promise<boolean> {
  return (await games()).some(game => game.version === version);
}

function allowedDownload(raw: string, base?: URL): URL {
  const url = new URL(raw, base);
  const trusted = ['amaty.itch.io', 'itch.io', 'itch.zone', 'itchio-mirror.cb031a832f44726753d6267436f3b414.r2.cloudflarestorage.com'];
  if (url.protocol !== 'https:' || url.port || url.username || url.password
    || (!trusted.includes(url.hostname) && !url.hostname.endsWith('.itch.zone'))) throw new Error('Unexpected itch.io download host');
  return url;
}

async function download(publication: Publication, file: string): Promise<void> {
  const loc = itchUrl + '/file/' + publication.upload + '?source=view_game&as_props=1';
  const reply = await fetch(loc, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { origin: 'https://amaty.itch.io', referer: itchUrl, cookie: publication.cookies },
    body: new URLSearchParams({ csrf_token: publication.csrf }),
  });
  if (!reply.ok) throw new Error('itch.io refused the download');
  const issued = await reply.json() as { url?: string; lightbox?: unknown; external?: boolean };
  if (!issued.url || issued.lightbox || issued.external) throw new Error('This download requires opening itch.io');
  let url = allowedDownload(issued.url);
  const signal = AbortSignal.timeout(15 * 60 * 1000);
  for (let redirect = 0; redirect < 5; redirect++) {
    const response = await fetch(url, { signal, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const target = response.headers.get('location');
      await response.body?.cancel();
      if (!target) throw new Error('Invalid download redirect');
      url = allowedDownload(target, url);
      continue;
    }
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > zipLimit) throw new Error('Invalid download');
    let size = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, next) {
        size += chunk.length;
        next(size > zipLimit ? new Error('Game ZIP exceeds size limit') : null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body as ReadableStream<Uint8Array>), limit, createWriteStream(file, { flags: 'wx' }), { signal });
    return;
  }
  throw new Error('Too many itch.io redirects');
}

function archivePath(entry: Entry): string {
  const parts = entry.fileName.replace(/\/$/, '').split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[<>:"\\|?*\x00-\x1f]|[. ]$/.test(part)
    || /^(?:con|aux|nul|prn|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Unsafe ZIP entry');
  if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) throw new Error('ZIP contains a symbolic link');
  return parts.join(path.sep);
}

export async function extract(file: string, destination: string): Promise<void> {
  const zip = await new Promise<ZipFile>((resolve, reject) => open(file, { lazyEntries: true, strictFileNames: true }, (error, archive) => {
    if (error || !archive) reject(error ?? new Error('Invalid ZIP'));
    else resolve(archive);
  }));
  try {
    if (zip.entryCount > 50000) throw new Error('Too many ZIP entries');
    let size = 0;
    await new Promise<void>((resolve, reject) => {
      zip.once('error', reject);
      zip.once('end', resolve);
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          size += entry.uncompressedSize;
          if (size > installedLimit) throw new Error('Extracted game exceeds size limit');
          const relative = archivePath(entry);
          const target = path.join(destination, relative);
          if (entry.fileName.endsWith('/')) {
            await fs.mkdir(target, { recursive: true });
          } else {
            await fs.mkdir(path.dirname(target), { recursive: true });
            const stream = await new Promise<NodeJS.ReadableStream>((done, fail) => zip.openReadStream(entry, (error, input) => {
              if (error || !input) fail(error ?? new Error('Invalid ZIP stream'));
              else done(input);
            }));
            await pipeline(stream, createWriteStream(target, { flags: 'wx' }));
          }
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

export async function install(publication: Publication): Promise<void> {
  const stage = await fs.mkdtemp(path.join(tempPath, 'release-'));
  try {
    const archive = path.join(stage, 'game.zip');
    const unpack = path.join(stage, 'files');
    await fs.mkdir(unpack);
    await download(publication, archive);
    await extract(archive, unpack);
    const candidates = [unpack, ...(await dirs(unpack)).map(name => path.join(unpack, name))];
    const matches = [];
    for (const candidate of candidates) if (await ordinaryFile(path.join(candidate, 'index.html'))) matches.push(candidate);
    if (matches.length !== 1) throw new Error('The official ZIP has no unique game index');
    const used = (await dirs(gamesPath)).map(name => name.toLowerCase());
    const preferred = 'v' + publication.version;
    const folder = used.includes(preferred.toLowerCase()) ? preferred + '-' + randomUUID().slice(0, 8) : preferred;
    await writeJson(path.join(matches[0], 'amicur.set', 'release.json'), { version: publication.version, source: itchUrl });
    await fs.rename(matches[0], path.join(gamesPath, folder));
  } finally {
    await fs.rm(stage, { force: true, recursive: true });
  }
}
