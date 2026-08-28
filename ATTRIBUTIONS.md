# Attributions

This is where I thank the people whose work made parts of CheevoDeck easier, faster, or possible at all — the Decky plugins I learned an approach from, the tools and reference data that ship inside it, and the platform and the site it all runs on.

Where a licence has terms attached, the entry names it and links to the text, and the ones a user should see are repeated on the About page inside the plugin. CheevoDeck's own licence is `LICENSE`.

## TabMaster — scrollable text region pattern

Every scrollable text region in CheevoDeck uses a scroll-container pattern copied from [**TabMaster**](https://github.com/Tormak9970/TabMaster) by **Travis Lane (Tormak)** and **Jessebofill**. Specifically, the combo of `ScrollPanelGroup` + an inner `Focusable` with a no-op `onActivate` and `noFocusRing={true}` came directly from their `DocsPage.tsx` long-form markdown viewer.

Three files carry the pattern itself — `CommentViewModal.tsx`, where it landed first; `GuidesReaderBody.tsx`; and `TextViewerModal.tsx`, the plain-text viewer for the help documents that ship with the plugin.

Between them they serve four reading surfaces, because `GuidesReaderBody` is rendered by both GameFAQs viewers rather than owning one: `GuidesQamReader.tsx` reads a guide in the side panel and `GuidesReaderModal.tsx` expands the same guide to full size, and both scroll through TabMaster's pattern. So the credit covers every long-text surface in the plugin, whether or not the file happens to import `ScrollPanelGroup` directly.

The component was a great help, and it allowed me to make the Guide Viewer exactly how I wanted to make it. Much appreciation! 

TabMaster also originally contributed the `ScrollPanel` / `ScrollPanelGroup` components to `@decky/ui`, so a double thanks for making the building block available in the first place.

TabMaster is dual-licensed GPL-3.0 / BSD 3-Clause, and CheevoDeck uses the pattern under BSD 3-Clause — carried in `LICENSE` along with their copyright line.

## Emuchievements — focusable external-link approach

CheevoDeck's `ExternalLink.tsx` — the underlined, gamepad-focusable link that points you at your RetroAchievements Web API Key from the credentials modals — was built after looking at how [**Emuchievements**](https://github.com/EmuDeck/Emuchievements) by **Witherking25 ('Kernel Panic')** does the same thing on its settings page.

The core shape — a `Focusable` wrapped around an external link that calls `Navigation.NavigateToExternalWeb` when you activate it — is the standard Decky idiom, and it already lived in CheevoDeck through `openExternalUrl`, so the link component itself is CheevoDeck's own code. The specific thing I took from reading theirs is the dismiss-before-navigate ordering: run the modal's `close` the instant before the handoff, so a `ModalRoot` overlay doesn't end up sitting on top of the page you just opened. Their link wires the same dismiss-then-navigate step (a dormant `onDismiss` hook in their case, since their credential entry is a full settings route with nothing layered over it).

No code was copied — `ExternalLink` is written from scratch against the same `@decky/ui` primitives. I just wanted to say where the idea came from and personally thank Emuchievements for it.

## DeckFAQs — reading GameFAQs through a Steam browser view

CheevoDeck's Guides feature reads walkthroughs live from GameFAQs. That's only possible because [**DeckFAQs**](https://github.com/hulkrelax/deckfaqs) by **hulkrelax** demonstrated the technique: GameFAQs sits behind Cloudflare, which Decky's stdlib-only Python can't clear, but Steam's CEF is a real Chrome, so loading the page in a `BrowserView` and scraping the rendered DOM passes natively, which DeckFAQs does with `executeInTab`. DeckFAQs proved that path works on a Deck and has shipped it for years.

The idea and the public SteamClient / `@decky/api` surfaces are what I borrowed which included loading a URL in a browser view, matching the loaded tab, and scraping it. CheevoDeck reads the tab over CDP rather than through `executeInTab`, which matches a tab by its title and comes back empty for a browser view, but that is a detail underneath the idea I took. The fetch pipeline, scrapers, game-resolution logic, render path, store, and UI are all written from scratch in my own style; none of DeckFAQs' source ships in CheevoDeck. I just wanted to give thanks because that technique has helped me out with writing my own implementation.

## scawp — Steam Deck built-in controller disable

CheevoDeck's Dolphin Mapper has an optional "Disable Steam Deck Controller" toggle that frees the built-in gamepad from a player slot so a docked Deck doesn't hog one. The idea, and the detail that the built-in controller lives at USB id `28de:1205`, came from reading [**scawp's Steam-Deck.Auto-Disable-Steam-Controller**](https://github.com/scawp/Steam-Deck.Auto-Disable-Steam-Controller).

No code was carried over. scawp's approach unbinds the controller's individual usbhid interfaces; on current SteamOS that path made things worse here (Steam reads the pad through hidraw, so the launch still deadlocked), so I reverted it and shipped a whole-device USB unbind instead,  making sure to show a warning rather than any automatic detection. What I took was the PID and the working knowledge of *what* to disable, never the *how*.

Nothing was copied, but I'd have been stuck a lot longer without their work. Thanks, scawp (© 2022).

## ra-scan — the ROM-scanning approach

Cheevo Check, the ROM-library scanner on CheevoDeck's Utilities page, exists because [**ra-scan**](https://github.com/TheDragonary/RetroAchievements-ROM-Scanner) by **TheDragonary** showed the shape of the problem: walk a ROM directory, work out which console a file belongs to from its folder, pull RetroAchievements' per-console hash lists, hash each file with RA's own hasher, and match locally.

**No code was copied.** CheevoDeck's implementation was written from a specification document rather than from their source, and it's a different thing structurally in every respect that has substance in it — a mixin / service / store split, its own isolated stores and freshness rules, batched invocation with resume-on-abort, zip introspection, one-archive-at-a-time extraction, a `dolphin-tool` path for GameCube and Wii containers, and a three-way result model. Several of those exist precisely *because* ra-scan gets them wrong. What's shared is the order of operations, which is dictated almost entirely by RAHasher's command line and RA's API: anyone writing against those two interfaces lands somewhere similar.

The systems table is CheevoDeck's own as well. **It's built from RAHasher's own `--help` output**, which covers roughly twice as many systems, and the folder aliases and extension lists were written from scratch around EmuDeck's directory names.

The reference saved me a great deal of time, same as Emuchievements above, so thank you!

## cdirip — the DiscJuggler container layout

Cheevo Check reads bare `.cdi` (DiscJuggler) disc images, which RAHasher cannot open on its own, by laying their tracks back out as cue+bin. Working out where those tracks are meant the descriptor at the end of the file had to be walked field by field, and [**cdirip**](https://github.com/jozip/cdirip) — originally **DeXT**'s, this fork **jozip**'s — is the reference implementation everyone uses for that.

**No code was copied.** CheevoDeck's `py_modules/cdi_reader.py` and cdirip's `cdi.c` share **zero lines of text**, no comments, no error strings, and none of its identifiers. What is unavoidably the same is the sequence of byte offsets — *skip four, read the ten-byte track mark twice, read the filename length, skip nineteen* — because that sequence **is the file format**. There is no second way to say where a field lives, and every correct reader of this container walks the same numbers.

The rest is not shared. cdirip is a C program that rips a `.cdi` to ISO and WAV with its own session loop, output writers and Nero conversion. CheevoDeck's is a stdlib Python class handing tracks to a recovery ladder: it validates that the track table's own arithmetic accounts for the file and refuses to emit anything when it doesn't, re-measures a declared pregap against what the file actually holds, and pads tracks out to their true disc addresses so a filesystem inside one can be found. None of those exist in cdirip; they exist because RAHasher is the consumer.

I also read **rcheevos**' `hash_disc.c` and `cdreader.c` — MIT, and the source RAHasher is built from — to learn *which* track RAHasher opens and what it looks for inside it. That's reading an interface to feed it correctly; nothing was carried over from there either. Just wanted to say thank you for the info that has saved me some time.

Reading work of cdrip is what made the reader possible at all.

## RAHasher — the bundled hashing tool

Cheevo Check ships [**RAHasher**](https://github.com/LeXofLeviafan/RAHasher) (**LeXofLeviafan**'s build, from RALibretro) at `bin/RAHasher` and runs it as a separate executable over its command line. It's the whole hard part of the feature and it's 1.2 MB: it knows RA's hashing rules for around seventy systems, reads CHD and zip natively, and is the only thing that can produce an answer RA will work with.

**RAHasher is GPL-3.0**, and unlike everything else on this page I actually distribute it, so this one genuinely asks something of me. The full licence text ships beside it as `bin/RAHasher.COPYING`, its copyright notices are intact, and `bin/RAHasher.PROVENANCE.md` pins the exact upstream release I ship (1.8.3) with checksums and a link, which is how the corresponding source stays available.

CheevoDeck's own source stays BSD-3. It invokes RAHasher as a separate process rather than linking against it, and GPLv3's mere-aggregation provision covers shipping it alongside a differently-licensed work. Its GPL terms cover that binary alone.

The underlying rcheevos is MIT, but the packaged tool is not, so the GPL is what governs here.

## chdman — the bundled disc tool

Cheevo Check's verification pass ships [**chdman**](https://github.com/mamedev/mame) at `bin/chdman` and runs it as a separate executable over its command line. It's MAME's CHD tool, and it does the one thing verification cannot do without: turn a compressed disc image back into the plain image a published catalogue describes. CHD is how most disc-based games end up being stored, so without it every one of them would be a blank spot in the results.

**I build it myself from a pinned MAME release tag** rather than repackaging someone else's build. EmuDeck bundles its own copy and there is no upstream release of chdman on its own to point at, so there was no third-party binary I could ship and still honestly promise source for. Building it means the tag I pin really is the corresponding source. Only the tool is built, not the emulator.

**chdman is GPL-2.0-only** — MAME's COPYING names version 2 with no "or later" clause — so it needs its own licence text rather than sharing RAHasher's GPL-3.0. That text ships beside it as `bin/chdman.COPYING`, and `bin/chdman.PROVENANCE.md` records the release tag, the exact build command and the binary's checksum.

Same arm's-length arrangement as RAHasher: a separate process over a command line, no linking, none of its code here. CheevoDeck's own source stays BSD-3.

## libretro-database — the bundled reference catalogues

Verification compares your files against hashes that ship with the plugin, in `dats/`. They come from [**libretro-database**](https://github.com/libretro/libretro-database), which is **CC BY-SA 4.0** — the first share-alike licence this project has taken on, and a deliberate choice.

One repository was picked over several on purpose. libretro mirrors No-Intro, TOSEC *and* Redump under a single stated licence.

**The data is modified.** Each DAT was parsed and re-emitted as gzipped JSON, with the md5 and sha1 columns and the remaining per-entry metadata dropped — what is left is a name, a size and a CRC32. That took 100 MB of DAT text down to 2.8 MB. `dats/PROVENANCE.md` pins the upstream commit, records a checksum per file and states the changes; the licence text ships beside it as `dats/LICENSE-CC-BY-SA-4.0.txt`.

Share-alike applies to `dats/` and travels with anyone who redistributes CheevoDeck. It does not reach the plugin's own source: the two are separate works shipped together, not an adaptation of the database.

## No-Intro, Redump and TOSEC — the reference data itself

The catalogues above are compiled by the [**No-Intro**](https://no-intro.org), [**Redump**](http://redump.org) and [**TOSEC**](https://www.tosecdev.org) projects. None of them states a licence, which is why the data reaches me through libretro's mirror rather than directly — but the work of establishing what a correct dump of a given game actually is, across tens of thousands of releases, is theirs. Verification has nothing to say without it.

## dolphin-tool — GameCube, Wii and WAD

Three of verification's six tiers, and the GameCube/Wii half of scanning, lean on `dolphin-tool` from the [**Dolphin**](https://dolphin-emu.org) flatpak. It reads the container formats those libraries are actually stored in (`.rvz`, `.wbfs`, `.gcz`, `.wia`, `.nkit`), returns the checksum of the *decompressed* image so the answer is directly comparable to a catalogue, and reports a WAD's integrity problems — which is the only route to saying anything at all about one.

Not distributed with CheevoDeck. It's the user's own Dolphin install, invoked through `flatpak run`, and when it isn't there those files are simply skipped, and the scan tells you they were.

## Font Awesome Free — icon paths

Most of CheevoDeck's glyphs are inline SVGs whose path data comes from [**Font Awesome Free**](https://fontawesome.com). Font Awesome Free is split-licensed: the icons (the SVG path data, which is what I used) are under [**CC BY 4.0**](https://creativecommons.org/licenses/by/4.0/); the fonts are SIL OFL 1.1 and the code is MIT, neither of which ships here. Only the path data was taken, so CC BY 4.0 is the license that applies.

CC BY asks that changes be indicated, so plainly: the paths were copied from Font Awesome Free and redrawn as standalone inline React SVG components. The original `viewBox` is kept, but the fills were swapped to `currentColor` so Decky's focus inversion can tint them, and no Font Awesome CSS, JavaScript, or webfont is bundled with the plugin.

The thirteen Font Awesome icons obtained through `react-icons` (`FaTrophy`, `FaHistory`, `FaSyncAlt`, `FaThumbtack`, `FaUnlock`, `FaRegCalendar`, and the seven quick-menu shortcut glyphs — `FaGamepad`, `FaClipboardCheck`, `FaNetworkWired`, `FaFileAlt`, `FaClock`, `FaExpandAlt`, `FaCompressArrowsAlt`) are CC BY 4.0 for the same reason, even though the `react-icons` package itself is MIT.

## Material Design Icons — two glyphs on the Welcome modal

The Welcome modal's profile cards carry three glyphs, and two of them are drawn from [**Material Design Icons**](https://github.com/google/material-design-icons) by **Google**, under the [**Apache License 2.0**](https://www.apache.org/licenses/LICENSE-2.0): the single person on the Balanced card is their `person`, and the pair on the Social card is their `group`, trimmed from a crowd of three to a pair. The trophy that fills the Basic card, and sits beside the person on Balanced, is mine.

Handled exactly like the Font Awesome paths above — path data only, original 24 viewBox kept, fills swapped to `currentColor`, and nothing from Google's package bundled with the plugin. Apache 2.0 asks that modifications be stated, so plainly: redrawn as standalone inline React SVG components, and the `group` glyph had its third figure removed.

Both are named in their own source comments too, the same way the Font Awesome glyphs are, and on the About page in front of the user.

## Simple Icons — the Ko-fi and Patreon marks

The two support links on the About page have brand marks drawn by [**Simple Icons**](https://simpleicons.org), who put them in the public domain under [**CC0 1.0**](https://creativecommons.org/publicdomain/zero/1.0/). CC0 means they asked for nothing at all in return, which is a generous thing to do and exactly why they get a thank-you here as well and a line on the About page too, where people will actually see it.

Handled the same way as the Font Awesome paths above: path data only, redrawn as inline React SVG components, original `viewBox` kept, fills swapped to `currentColor`. Nothing from the Simple Icons package itself ships with the plugin.

## @decky/ui (decky-frontend-lib)

Most of CheevoDeck's UI components — `Focusable`, `ModalRoot`, `DialogButton`, `PanelSection`, `TextField`, and the `ScrollPanelGroup` mentioned above all come from [**@decky/ui**](https://github.com/SteamDeckHomebrew/decky-frontend-lib), maintained by the **Steam Deck Homebrew** community. The library surfaces Steam's own React components via webpack lookup, so CheevoDeck visually fits in with the rest of the Quick Access Menu without re-implementing the look.

## Decky Loader

CheevoDeck runs on top of [**Decky Loader**](https://github.com/SteamDeckHomebrew/decky-loader), the plugin platform that makes all of this possible. Same Steam Deck Homebrew community.

## RetroAchievements

CheevoDeck reads from the [**RetroAchievements**](https://retroachievements.org) public Web API. Thanks to the RA team and the broader community of achievement developers and players that make the data worth reading.

## Dependency licenses

The runtime dependencies that ship as part of, or alongside, the built plugin:

```
react-icons   MIT       (icon sets keep their own licenses — the Font Awesome
                        icons used through it are CC BY 4.0, see above)
tslib         0BSD      (nothing required)
@decky/ui     LGPL-2.1  (loaded from the Decky runtime via the DFL global,
                        not bundled into dist/index.js)
@decky/api    LGPL-2.1  (bundled into dist/index.js)
```

The LGPL-2.1 text lives at <https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html>. `@decky/api` is bundled, so for completeness: CheevoDeck's own source is published in full under the BSD-3 license in `LICENSE`, and `@decky/api`'s source is public, so anyone can replace that library with their own build and rebuild the plugin. The binding version of these notices lives in `LICENSE`, which is the file guaranteed to ship in the plugin zip; this list is more of an informal copy of me wanting to express my gratitude.
