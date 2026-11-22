# Amicur Launcher

Desktop launcher for the HTML releases of A Mirror’s Curse by amaty.

## Run on Windows

Start `Amicur_Launcher.exe` in a writable folder. It prepares its portable runtime locally. Add the game through the launcher or put an extracted release in `games/<any folder>/` with its `index.html` at the top level.

## Build

From `dev-sdk/amicur-electron-project/`, run `npm ci` and `npm run portable` on Windows x64 with Node.js and Go installed. The executable is written to `dev-sdk/out-dev/Amicur_Launcher.exe`. Run `npm start` to develop against an installed Electron runtime.

## Mods

Place a mod under `games/<release>/mods/` or `games/<release>/amicur.set/mods/` for one release. Use `data-launcher/plugins/defold-modpack/mods/` to make a mod available across releases. Activate it from the Mods page for each desired release. Use a manifest `mod-id.json` with fields `id`, `name`, `api` set to 1, and `script` pointing to a module such as `script/main.js`. Modules run in the game window. The game files and shared save folder are managed through the launcher.

## Translation

Run a release with the language mod active to generate the original catalogue in `games/<release>/amicur.set/mods/multilanguage-mod/local/original-source/`. Add entries to the desired locale’s `text.json`, using each generated key and an object with `sourceHash` (the original entry's `hash`) and `text` (the translated text). The catalogue includes `img/logo.png` and `img/banner.png` where present. Supply replacements in the target locale’s `img/` folder using those file names. The launcher uses the original string or image when a replacement is missing.

## Documentation

- Player guide - [English](GiDo/dock/lang/en-US/README.md) · [Русский](GiDo/dock/lang/ru-RU/README.md)
- Mod SDK - [English](GiDo/wiki/lang/en-US/README.md) · [Русский](GiDo/wiki/lang/ru-RU/README.md)
