import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Use Windows x64 to create the portable package');

const require = createRequire(import.meta.url);
const work = path.resolve('../internal-build');
const output = path.resolve('../out-dev');
const executable = path.join(output, 'Amicur_Launcher.exe');
const stage = path.join(work, 'packaged-app');
const temp = path.join(work, 'go-temp');
const payload = path.resolve('bootstrap/payload.zip');
const icon = path.resolve('src/renderer/public/mirror.ico');
const windowsResources = path.resolve('bootstrap/mirror_windows_amd64.syso');
await Promise.all([mkdir(temp, { recursive: true }), mkdir(output, { recursive: true })]);

function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, {
    cwd, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp, GOTMPDIR: temp, GOCACHE: path.join(work, 'go-cache'), GOMODCACHE: path.join(work, 'go-mod') },
  });
  if (result.error || result.status !== 0) throw result.error ?? new Error(command + ' exited with ' + result.status);
}

for (const variable of ['TMPDIR', 'TEMP', 'TMP']) process.env[variable] = temp;
process.env.ELECTRON_CACHE ??= path.join(work, 'cache', 'electron');
const electron = require('electron');
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
await rm(stage, { recursive: true, force: true });
await cp(path.dirname(electron), stage, { recursive: true });
await rename(path.join(stage, 'electron.exe'), path.join(stage, 'amicur-runtime.exe'));
await rm(path.join(stage, 'resources', 'default_app.asar'), { force: true });
const resources = path.join(stage, 'resources', 'app');
await mkdir(resources, { recursive: true });
const appBuild = path.join(resources, 'build');
await cp('build', appBuild, { recursive: true });
await writeFile(path.join(resources, 'package.json'), JSON.stringify({
  name: metadata.name,
  productName: "A Mirror's Curse Launcher",
  version: metadata.buildNumber ?? metadata.version,
  main: 'build/main.js',
}));
try {
  await rm(payload, { force: true });
  run('tar.exe', ['-a', '-cf', payload, '-C', stage, '.']);
  run('go', ['run', 'github.com/akavel/rsrc@v0.10.2', '-arch', 'amd64', '-ico', icon, '-o', windowsResources]);
  run('go', ['build', '-trimpath', '-buildvcs=false', '-ldflags=-H windowsgui -s -w', '-o', executable, '.'], path.resolve('bootstrap'));
} finally {
  await Promise.all([rm(payload, { force: true }), rm(windowsResources, { force: true })]);
}

if (process.argv.includes('--start')) {
  const launcher = spawn(executable, { cwd: output, detached: true, stdio: 'ignore' });
  await once(launcher, 'spawn');
  launcher.unref();
}
