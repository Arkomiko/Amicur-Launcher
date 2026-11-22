# Mod development

Name the mod folder after its identifier. In `mod-id.json`, set `id`, display `name`, `api` to 1, and `script` to a path such as `script/main.js`. The entry loads as a JavaScript module in the game window. Keep relative module imports inside `script/`.

Store release-specific mods in `games/<release>/amicur.set/mods/` and shared mods in `data-launcher/plugins/defold-modpack/mods/`. Enable the mod per release from the launcher.

Each release generates its localization catalogue in `amicur.set/mods/multilanguage-mod/local/original-source/`. Use an entry's `hash` as its `sourceHash` in the translation file. Store the translated string in `text`.

## Mod settings

Install mods in `data-launcher/plugins/defold-modpack/mods/`, `games/<release>/mods/`, or `games/<release>/amicur.set/mods/`. In Mods, choose a release on the left. Use the checkbox to enable a mod and select its name to open its settings. Apply saves the profile for the selected release.

A mod declares fields in the `settings` object in `mod-id.json`. Each field requires `type` and `default`. Supported types are `boolean`, `string`, `number`, and `choice`. An optional `label` controls display. For `choice`, provide a `choices` object that maps stored values to labels. Read the profile with `await window.amicur.modSettings("mod-id")`.

## Custom themes

Create a folder under `data-launcher/theme/` with `theme.json` and any image assets. A theme supports `name`, a `tone` of `dark` or `light`, `colours`, and a `backgrounds` array. Each image entry has start and end times `from` and `to` in 24-hour notation and an `image` path relative to the theme folder. Intervals can cross midnight and use the computer’s local clock. If intervals overlap, the first entry wins. Restart the launcher and select the theme in Settings.

## Mod language and release packs

Write original labels and descriptions in English. Put the English dictionary in `local/en-US/strings.json` and translations in `local/<locale>/strings.json`. Example: `{"Open journal": "Открыть дневник"}`. The manager reads `mod.name`, `mod.description` and English field and choice labels. Mark your UI container with `data-amicur-mod="my-mod"` for automatic text updates. For dynamic strings and attributes use `await window.amicur.modLocale("my-mod")`, fall back with `strings[key] ?? englishText`, and subscribe through `window.amicur.subscribe(callback)`. Missing translations fall back to English. Without an active language mod, the game and its mods use English.

Launcher plugins live under `data-launcher/plugins/<id>/plugin.json`. A declarative pack declares `id`, `api: 1`, `type: "modpack"` and `enabled`. The bundled `defold-modpack` installs its `mods/` into each release. The `amicur.set/modpacks.json` receipt preserves per-release removals. The release stores its launch settings in `launcher.json` and its ID, language, enabled mods and mod settings in `profile.json`, both inside `amicur.set`.
