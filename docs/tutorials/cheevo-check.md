[← All tutorials](../tutorials.md)

# Cheevo Check Page

Cheevo Check is a useful tool that checks your game collection and tells you which games are compatible with RetroAchievements, as well as optionally verifying that your games are proper dumps against known good data.

From the results data, it's able to identify your ROM collection and integrate with the Steam Library Badges feature with 100% certainty. In other words, running a basic RA check scan (Verify Dump not needed) is a prerequisite for Steam Library Badges. After your first scan, you will start seeing your achievement progress on your non-Steam game pages, provided that you have the feature enabled, which can be found in Cheevo Check as well as in the [Options](options.md) page under the **Steam Library Badges** toggle. Flip it and run a scan, and you are good to go! Or you can run a scan, then flip it on. It doesn't matter which order!

Anyway, this tool is essential, as it is a way for you to check if your games are compatible with RA. It will tell you many other things, so that you have the right data to make decisions and get the right files so they work with RA.

When **Verify Dump** is toggled on, you will get even more info after a scan. This is useful if you want to check if your files are sound and not corrupted. And don't worry, if it isn't a valid dump, it doesn't mean it is corrupted! ROM hacks, English patches, etc. change the hash of the file, so naturally it won't be considered corrupted. Luckily, Cheevo Check is very smart and able to determine what is most likely to be corrupted vs not.

## How it Works

To run the basic out-of-the-box Cheevo Check scan, just select **Scan** and then select the base folder for your entire ROM collection. Please do note that your folders should preferably be named the way EmuDeck or ES-DE folders are named. So if you are using EmuDeck or ES-DE, you are already good! Otherwise, see the [Folder Naming Conventions](#folder-naming-conventions) section below.

Anyway, once you select the base folder, the scan will begin. It first pulls all the necessary data from RetroAchievements for each system. Then it checks your files under each system against known RA hashes to determine which bucket they are categorized under.

While it's running, you are perfectly fine closing the side window, going back and looking at your achievements, etc., as it runs in the background. You can even sleep your Deck if needed and it will resume upon turning back on. Now, if you have a huge library and need to leave your Deck sitting for a while running the scan unattended, I recommend toggling the **Darken Screen** option below to **On** and then closing the QAM. This prevents OLED burn-in. Also, expect each scan after to become faster as your local hashes are cached. So when you add new games, the scan shouldn't take too long.

Once the scan finishes, upon scrolling down you will see the status for your games, and it throws them into these buckets:

- **Supported Games:** These games were tested to be 100% supported by RA. Congrats!
- **No Achievements:** These games were recognized by RA and the hashes match, yay! BUT! There are no achievements for this set yet.
- **Unsupported Files:** RetroAchievements doesn't recognize these dumps at all. A different dump of the same game may well work. If you select the button for the list of these unsupported files, press **A** over the games in the list for it to open the browser and search if it exists on RA yet. If it does, it means you for sure have a wrong dump. If it doesn't exist on RA yet, your dump is probably fine and once RA adds your game, it will probably work.
- **Couldn't Scan:** Uh-oh! This usually means the file is corrupt!
- **Archive Name Mismatches:** Files whose archive is named one thing and holds another. This is actually a bonus bucket. These files are already categorized in the buckets above. This is just additional info for you to ensure you have the right files.

Now, you can take the results even further to super-user mode by toggling on **Verify Dump** before the scan. This, in addition to checking against RA, checks against known good dumps from No-Intro, Redump, etc. This adds even more buckets, so here they are:

- **Verified:** The files match a known good dump exactly, byte-for-byte. Congrats!
- **Recognized — Full Hash:** Nothing in No-Intro, Redump, or TOSEC matched these, but RetroAchievements did. The systems within this category are hashes of the FULL file on RA, so this means it's NOT corrupt! This usually means it's a patched ROM, like translation patches or other ROM hacks. Congrats!
- **Recognized — Partial Hash:** Nothing in No-Intro, Redump, or TOSEC matched these, but RetroAchievements did. The systems within this category are hashes of the PARTIAL file on RA, so it's a weaker signal to determine if it is corrupt or not. It's probably fine, and since it didn't match the dump databases, it's most likely a ROM hack, patched ROM, or translation patched ROM. If that's the case, the ROM is more than likely fine!
- **Doesn't Match Its Name:** The name and size match a known dump, but the contents don't, and RetroAchievements doesn't recognize these either. It's the one result worth checking, since a damaged or incomplete download looks just like this. A Switch file here failed its own internal checksums, which means real damage.
- **Not Recognized:** Nothing in No-Intro, Redump, or TOSEC matches this. Also, nothing in RA matches this. This means it is almost always a ROM hack that isn't on RA yet, and naturally ROM hacks and translations won't be included in the above databases. So if it's a ROM hack, it's fine.
- **Can't Verify:** The file simply could not be verified. It doesn't mean it's bad, but one of the following reasons could be why it couldn't be verified: trimmed padding, nothing published for that system, or a disc that wouldn't rebuild. Anything that could be a real problem is sorted to the top of the list.

## Useful Settings

- **Darken Screen:** If you have a huge library and need to leave your Deck sitting for a while running the scan unattended, I recommend toggling the Darken Screen option to **On** and then closing the QAM. This prevents OLED burn-in.
- **Temporarily Disable Services:** Turning this on is the same toggle that's in your Quick Menu: **Standby**. This turns off most social services, reducing queries to the RA database. Useful to turn on during the first phase of a scan, where it downloads tons of data from RA. This avoids too many queries happening at once. Make sure to turn your services back on once downloading is complete, because if you don't, you will be wondering why some features are not working.
- **Steam Library Badges:** Your achievement progress can show up right on the game pages in your Steam library, on anything you've added as a non-Steam shortcut with Steam ROM Manager. Press up from the Play button to select the badge, then press **A** to open the full game info for it. For it to work, you will need to run a Cheevo Check scan on your library, as this feature depends on knowing which games are RA compatible. Rescan if you add new games.
- **Cache Local Hashes:** Skips re-checking files that look unchanged. Faster, but it won't notice a file that has quietly gone bad. It saves the most on archives and on libraries kept on an SD card or a network share.
- **Extract to RAM:** Unpacks archives into memory instead of onto the drive. Best left off unless you have RAM to spare: a disc game inside a zip or a 7z can be several gigabytes, and that memory comes out of whatever you're playing. Anything too big to fit falls back to the drive on its own, so nothing gets skipped either way.
- **Verify Dump:** Also checks every file against the published dump lists — No-Intro, Redump and TOSEC — not just against RetroAchievements. Catches damage that RA's own check can't see, because for discs and DS cards RA only hashes a small part of the file. Adds minutes to a scan — a lot more if you have a big disc library.
- **Speed:** How hard the check leans on your drive. **Gentle** keeps a game playable while it runs; **Full Speed** gets it done and lets the drive take the hit.
- **Ignore Discs When Verifying Dump:** Discs are nearly all of the time this check takes — a cartridge is over in milliseconds, a disc takes a minute of reading gigabytes. Turn this on and discs are left out of it and everything else still gets checked. Your achievements are unaffected either way: the normal scan reads discs as it always has, and this only skips the extra byte-for-byte check.
- **Ignore Large Carts When Verifying Dump:** For 3DS and Switch cards. This is if you just want to skip these massive files and want to scan everything else in your library for verifying dumps.
- **Clear Local Cache:** Makes the next scan re-check every file from scratch. On a big library full of archives that can take hours.
- **Save Report:** Writes everything the scan found into a text file you can read anywhere. Pick a folder and it saves as cheevocheck_report with today's date. Saving again the same day replaces it.

## Offline Scan

The only difference here is that this uses your already downloaded RA hashes from your previous scans, which skips the RA download. Only do this if you scanned recently and don't want to re-download it again from RA. Also, if you have added games for a new system since, you should skip this and do a standard **Scan**, as the data for the new system will need to be downloaded from RA.

## Folder Naming Conventions

Cheevo Check works out which system a game belongs to from the name of the folder it's in. Capital letters, spaces and punctuation don't matter, so "Mega CD", "mega-cd" and "MEGACD" all work. A maker's name in front works too, so "Sega Saturn" and "Nintendo 64" are fine.

Folder names recognized for each system:

| System | Folder names |
| --- | --- |
| 32X | `sega32x`, `32x`, `mega32x`, `megadrive32x`, `genesis32x`, `sega32xjp`, `sega32xna` |
| 3DO Interactive Multiplayer | `3do`, `panasonic3do` |
| Amstrad CPC | `amstradcpc`, `cpc` |
| Apple II | `appleii`, `apple2` |
| Arcade | `arcade`, `mame`, `mameadvmame`, `mamemame4all`, `fbneo`, `fba`, `neogeo`, `cps`, `cps1`, `cps2`, `cps3`, `atomiswave`, `naomi`, `naomi2`, `naomigd`, `model2`, `model3` |
| Arcadia 2001 | `arcadia2001`, `arcadia`, `emersonarcadia2001` |
| Arduboy | `arduboy` |
| Atari 2600 | `atari2600`, `2600` |
| Atari 7800 | `atari7800`, `7800` |
| Atari Jaguar | `atarijaguar`, `jaguar` |
| Atari Jaguar CD | `atarijaguarcd`, `jaguarcd` |
| Atari Lynx | `atarilynx`, `lynx` |
| ColecoVision | `coleco`, `colecovision` |
| Dreamcast | `dreamcast`, `dc` |
| Elektor TV Games Computer | `elektor`, `elektortvgamescomputer` |
| Fairchild Channel F | `channelf`, `fairchildchannelf` |
| Famicom Disk System | `fds`, `famicomdisksystem` |
| Game & Watch | `gameandwatch`, `gw` |
| Game Boy | `gb`, `gameboy`, `sgb` |
| Game Boy Advance | `gba`, `gameboyadvance` |
| Game Boy Color | `gbc`, `gameboycolor`, `gameboycolour` |
| Game Gear | `gamegear`, `gg` |
| GameCube | `gc`, `gamecube`, `ngc`, `dolphin` (needs Dolphin installed for anything other than .iso and .gcm files) |
| Genesis/Mega Drive | `genesis`, `megadrive`, `genesismegadrive`, `megadrivegenesis`, `md`, `gen`, `gendesktop`, `megadrivejp`, `genesiswide` |
| Intellivision | `intellivision`, `intv` |
| Interton VC 4000 | `vc4000`, `intertonvc4000` |
| Magnavox Odyssey 2 | `odyssey2`, `videopac`, `magnavoxodyssey2` |
| Master System | `mastersystem`, `sms`, `segamastersystem` |
| Mega Duck | `megaduck`, `cougarboy` |
| MSX | `msx`, `msx1`, `msx2` |
| Neo Geo CD | `neogeocd`, `ngcd`, `neogeocdjp` |
| Neo Geo Pocket | `ngp`, `ngpc`, `neogeopocket`, `neogeopocketcolor` |
| NES/Famicom | `nes`, `famicom`, `fc`, `nintendoentertainmentsystem` |
| Nintendo 64 | `n64`, `nintendo64` |
| Nintendo DS | `nds`, `ds`, `nintendods` |
| Nintendo DSi | `dsi`, `nintendodsi` |
| PC Engine CD/TurboGrafx-CD | `pcenginecd`, `pcecd`, `tg16cd`, `turbografxcd`, `tg-cd` |
| PC Engine/TurboGrafx-16 | `pcengine`, `pce`, `tg16`, `turbografx16`, `supergrafx`, `sgx` |
| PC-8000/8800 | `pc88`, `pc8800`, `pc8000`, `pc-8800`, `pc-8000` |
| PC-FX | `pcfx`, `pc-fx` |
| PlayStation | `psx`, `ps1`, `playstation`, `playstation1`, `playstationone`, `psone` |
| PlayStation 2 | `ps2`, `playstation2` |
| PlayStation Portable | `psp`, `playstationportable` |
| Pokemon Mini | `pokemini`, `pokemonmini` |
| Saturn | `saturn`, `segasaturn`, `ss`, `saturnjp` |
| Sega CD | `segacd`, `megacd`, `scd`, `mega-cd`, `megacdjp` |
| SG-1000 | `sg1000`, `sg-1000` |
| SNES/Super Famicom | `snes`, `sfc`, `superfamicom`, `supernintendo`, `supernintendoentertainmentsystem`, `supernes`, `snesmsu1`, `snesna`, `sneshd` |
| Uzebox | `uzebox` |
| Vectrex | `vectrex` |
| Virtual Boy | `virtualboy`, `vb` |
| WASM-4 | `wasm4` |
| Watara Supervision | `watarasupervision`, `supervision` |
| Wii | `wii`, `wiiware`, `primehacks` (needs Dolphin installed for anything other than .iso and .gcm files) |
| WonderSwan | `wonderswan`, `wonderswancolor`, `ws`, `wsc` |

Dump check only (RetroAchievements has no sets for these, so they're only checked when Verify Dump is on):

| System | Folder names |
| --- | --- |
| Nintendo 3DS | `n3ds`, `3ds`, `nintendo3ds` |
| Nintendo Switch | `switch`, `nintendoswitch`, `nsw` |
| PlayStation 3 | `ps3`, `playstation3` |
| Xbox | `xbox`, `microsoftxbox` |
| Xbox 360 | `xbox360`, `microsoftxbox360` |
