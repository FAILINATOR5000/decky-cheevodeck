[← All tutorials](../tutorials.md)

# Manage Emulators Page

Manage Emulators is where you install, update and remove the emulators CheevoDeck works with, all from Game Mode without ever opening Desktop Mode. It's in **Utilities**, and it's the same place **Fix It** on the [Play Together](play-together.md) page installs things from, so anything **Fix It** set up for you shows up here too.

## The Rows

**RetroArch (Flatpak)** is at the top, with **Cores by System** right under it once RetroArch is set up (it has to be opened once on its own first). That one is folded up, so press **A** to open it, and each system folds the same way, showing how many of its cores you have, like **Game Boy · 10 of 13 cores installed**, and how many updates it has. Every core gets its own row, and **A** on a core installs or updates it the same as any other row.

After that, every emulator has two rows: one for its **Flatpak** and one for its **AppImage**, for Dolphin, PCSX2, DuckStation, PPSSPP, RMG and melonDS. They're the same emulator packaged two different ways. A Flatpak installs through Flathub and keeps its settings in `~/.var/app`, and an AppImage is a single file in `~/Applications`. The two don't share settings, so if you switch from one to the other, your settings don't come along. Cheevo Check needs Dolphin's Flatpak to read GameCube and Wii files, even if you play with the AppImage.

Under each name is the installed version, or the full path if it's an AppImage you pointed to yourself. On the right is its status:

- **Installed** (green): good to go. A nightly or dev build that's newer than the stable release counts as installed too.
- **Update Found** (gold): a newer stable release is out.
- **Not Installed** (red): it isn't on your device. An AppImage you pointed to that's been moved or deleted shows **Not Found** instead.
- **Couldn't check for updates** (gray): the check failed, usually because you're offline or GitHub's hourly limit kicked in. If it had already found an update before that, **Update All** still counts it.

While something is installing or updating, a progress bar takes the place of the status, and while the page refreshes, every emulator row shows a moving bar until the check comes back.

## The Buttons

The buttons work the same on every row, and the bottom of the screen always shows them:

- **A Install/Update:** installs the emulator if it's not installed (Flatpaks from Flathub, AppImages from the emulator's GitHub release into `~/Applications`), or updates it if there's an update. If there's nothing to do, it tells you why, like when it's already up to date.
- **X Uninstall:** asks first, and the window tells you exactly what goes. A Flatpak keeps its settings folder, and an AppImage or a core is deleted along with any backups of it. It also warns you if a Steam shortcut uses that install, since the shortcut will stop working.
- **Y Update All Cores:** works from anywhere on the page and updates every installed core that doesn't match RetroArch's latest core build, the same place RetroArch's own updater gets them from.
- **L1 Backup/Restore:** for AppImages and cores. See [Backups](#backups) below.
- **R1 Point to AppImage:** for AppImage rows. If you keep an AppImage somewhere other than `~/Applications`, this opens a file picker so you can point the row at it, and the file stays right where it is. If the file you pick looks like a different emulator, it asks before using it. Press **R1** again on a row you've pointed somewhere and it goes back to normal.
- **R2 Non-Steam Shortcut:** adds the emulator to Steam, with a window to name it and pick a collection, the same one **Fix It** uses. If there's already a shortcut, it lets you know. Cores don't get one, since they run inside RetroArch.

If a button can't do anything on the row you're on, a little window pops up telling you why instead of nothing happening.

## Updating Everything

**Refresh** at the top checks GitHub, Flathub and RetroArch's core list all at once. **Update All** right under it updates every row that says **Update Found** plus every core with an update in one press, and it shows how many there are. When there's nothing to update, it says **Everything is up to date.** It skips anything newer than the stable release, so a nightly you installed yourself is left alone.

Installs and updates run one after another, and each row shows its own progress bar, so you can queue up a bunch and keep browsing. If the emulator is running, it has to be closed first before it can be updated, uninstalled or restored (for a core, that means closing RetroArch), and the page tells you.

If something fails, a note shows up under **Update All** saying what couldn't be installed or updated and why, like not enough free space or no internet, and nothing about that emulator was changed.

If you swapped an AppImage by hand or installed something outside of CheevoDeck, press **Refresh** and the page picks it up.

## Backups

**Keep Backups** is on by default. When something updates, the version you had right before it is kept so you can go back to it if the new one gives you trouble. Each update replaces the last backup, so there's one per emulator or core. With it off, the old copy is still held onto while the update runs, so a failed update puts it back, but it's thrown away once the update finishes. Backups are kept for AppImages and cores. Flatpaks don't keep them here.

Press **L1** on a row to see its backups. **Restore** swaps the backup with the version you have now, so a restore can be undone the same way, and **Delete** removes a backup after asking first. If you deleted an AppImage by hand but its backup is still around, **L1** on its **Not Installed** row can put it back.

## What It Doesn't Touch

Nothing on this page touches your ROMs, your saves or EmuDeck's launchers. Steam ROM Manager isn't on this page either, but if a game has no shortcut and you have neither EmuDeck nor Steam ROM Manager, **Fix It** on the [Play Together](play-together.md) page offers to install it.
