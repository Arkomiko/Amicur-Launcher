import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { watch } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import electron from 'electron';
import { buildLauncher } from './build.mjs';

const development = path.resolve('../internal-build/development');
const outdir = path.join(development, 'build');
const root = process.env.AMICUR_ROOT || path.resolve('../..');
const temp = path.join(root, 'data-launcher', 'temp');
const { name, version, buildNumber = version } = JSON.parse(await readFile('package.json', 'utf8'));
await Promise.all([mkdir(development, { recursive: true }), mkdir(temp, { recursive: true })]);
await writeFile(path.join(development, 'package.json'), JSON.stringify({ name, version: buildNumber, main: 'build/main.js' }));

const watcher = watch('src', { recursive: true });
let electronProcess;
let timer;
let rebuilding = false;
let pending = false;
let closing = false;

async function stopElectron() {
  const child = electronProcess;
  if (!child) return;
  electronProcess = undefined;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}

function close(code = 0) {
  if (closing) return;
  closing = true;
  watcher.close();
  clearTimeout(timer);
  process.exitCode = code;
  void stopElectron();
}

function startElectron() {
  const child = spawn(electron, [development], {
    stdio: 'inherit',
    env: { ...process.env, AMICUR_ROOT: root, TEMP: temp, TMP: temp, TMPDIR: temp },
  });
  electronProcess = child;
  child.once('error', error => {
    electronProcess = undefined;
    console.error(error);
    close(1);
  });
  child.once('exit', code => {
    if (electronProcess !== child) return;
    electronProcess = undefined;
    close(code ?? 1);
  });
}

function schedule() {
  if (closing) return;
  pending = true;
  clearTimeout(timer);
  timer = setTimeout(rebuild, 180);
}

async function rebuild() {
  if (closing || rebuilding) return;
  rebuilding = true;
  pending = false;
  try {
    await buildLauncher({ outdir, sourcemap: true });
    if (closing) return;
    await stopElectron();
    if (closing) return;
    startElectron();
    console.log('Development build ready. Watching src for changes.');
  } catch (error) {
    console.error(error);
  } finally {
    rebuilding = false;
    if (pending) schedule();
  }
}

watcher.on('change', schedule);
watcher.on('error', error => {
  console.error(error);
  close(1);
});
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
await rebuild();
