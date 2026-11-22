# Amicur Launcher

Run `Amicur_Launcher.exe` in a writable folder. The first-run setup lets you choose a language, appearance, and update settings.

Use Games to check for a new release or open the `games/` folder. To add a release manually, extract it to its own folder with `index.html` at the top level. You can choose any folder name.

Use Mods to choose the game language and enabled mods for a release. Each game runs in a separate window.

The arrow beside Play opens actions for the selected release. Launch without mods applies once. Update downloads a new official itch.io release into a separate folder. Delete moves the selected release to the Recycle Bin after confirmation.

Drop a mod folder or ZIP on the Mods tab and choose one release or all releases. Enable the mod for a release and apply your changes. Open the mod error report on the same tab to copy it for the author.

Optional fields in `mod-id.json` include `tested` (tested game versions), `requires` (required mod IDs), `conflicts` (incompatible mod IDs), and a `version` string. Example: `"tested": ["0.35"], "requires": ["multisaved-mod"]`. Dependencies load first. Untested game versions can still launch.

Enable Dialogue history, Quick saves and Scene bookmarks independently. All three appear in the game's Saves menu. Alt+H opens the current session history, Alt+B opens bookmarks, F5 creates a quick save and F9 restores the latest one. Each release keeps its own bookmarks and three quick saves.

Shared saves are stored in `data-launcher/saves/shared/`.
