# Architecture

CheevoDeck is a RetroAchievements tracking and management system that runs as a [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin on SteamOS. A Python backend talks to the RetroAchievements API; a React frontend renders into the Steam Quick Access Menu.

Roughly 90% of it lives inside the QAM side panel rather than a full-screen modal. That one decision shapes most of what follows.

## Layout

```
main.py              backend entry — the Plugin class, 18 mixins merged in
py_modules/
  mixins/            domain method groups; organisational only, MRO-merged into Plugin
  services/          long-running tick loops and on-demand workers
  *_store.py         persistence, ULID-keyed per user or global
  ra_client.py       the RetroAchievements HTTP client
src/
  index.tsx          frontend entry, registers the QAM panel
  pages/             27 screens, each taking a `state` + `actions` prop pair
  hooks/             43 hooks, 27 of them useXController — state and IPC per feature
  components/        109 components in 19 feature folders
  resume/            readers for state persisted across a panel teardown
  locales/           8 languages; every key exists in all 8
  routes.ts          one row per view: back-button focus key, mount policy, back handler
  api.ts             the IPC surface, 419 typed thunks
  types.ts           shared types, including the ViewKey union
defaults/            files packaged to the device: RAHasher, chdman, 53 dat catalogues
docs/                this file, and the banner images
```

## Frontend

Four layers, and the direction of travel is one way.

| Layer | Holds | Does not hold |
|---|---|---|
| `AchievementsRoot.tsx` | the `view` state, every controller, the back handler | feature logic |
| `hooks/useXController` | one feature's state and its IPC calls | rendering |
| `pages/` | one screen's markup | its own state |
| `components/` | one widget | knowledge of which page it is on |

A page receives `state` and `actions` and renders. A controller owns the state and the IPC. The root composes controllers and passes their output down; it is the only place that knows what a "page" is, because the panel supplies no router to know it.

The root is large for that reason, and grows only when a feature is genuinely global. A local feature should cost it nothing: adding a button to a friend row cost 2 lines, while adding gamepad shortcuts that work from every screen cost 211. Both are correct.

Section markers make it navigable: `grep -n '^\s*// ' src/pages/AchievementsRoot.tsx` lists every region in file order.

## Views and routing

`ViewKey` is a string union in `types.ts`. `ROUTES` in `routes.ts` is typed `Record<ViewKey, RouteRow>`, so the compiler requires a row for every view — a new screen cannot be added without declaring where its back button goes, whether it stays mounted, and what B does.

Each view is a sibling inside a single `<Focusable key={view}>`. The key is what gives each navigation a fresh focus scope; without it a screen inherits the previous one's cursor position.

## Backend

```
Plugin (main.py)
  └─ 18 mixins            419 IPC methods, grouped by domain, merged by MRO
       └─ services        24 of them; 9 run on a shared tick loop, the rest on demand
            └─ stores     19; JSON on disk, ULID-keyed per account or global
                 └─ ra_client.py → RetroAchievements API
```

Mixins are organisational only. They carry no state and are merged into one `Plugin` class, so a method's home is about where a reader would look for it, not about isolation.

Services are where anything long-running lives: polling for new achievement sets, trickling social activity, watching ROM folders, mounting SMB shares. The nine that tick share `_tick_common.py`, which owns the backoff, the quiet gate and the debug-logging policy.

Stores are the only things that touch disk. The backend runs as root, so every file it writes is chowned back to the user — otherwise the plugin locks itself out of its own data.

## Bundled binaries and data

Cheevo Check — the feature that tells you whether your ROMs are the ones RetroAchievements recognises — cannot work from Python alone. Two upstream tools ship with the plugin, along with the reference catalogues they are checked against.

| | Version | Licence | Role |
|---|---|---|---|
| `RAHasher` (1.2 MB) | 1.8.3 | GPL-3.0 | computes a ROM's RetroAchievements hash |
| `chdman` (2.4 MB) | 0.289 | GPL-2.0-only | unpacks CHD disc images so they can be hashed |
| `dats/` (53 files) | libretro-database, pinned commit | CC BY-SA 4.0 | 147,914 known-good entries across 53 systems |

**They are shelled out to, never linked against.** That is a licensing decision as much as a technical one: a GPL binary invoked as a subprocess does not pull the plugin's own source under the GPL, and linking would. Each binary ships with its full licence text in `*.COPYING` and a `*.PROVENANCE.md` recording the exact upstream release, its SHA-256, and for `chdman` the build command used — GPL asks that the corresponding source be identifiable, and a pinned version with a hash is how that promise is kept.

The two licences are genuinely different. MAME's is GPL-2.0 with no "or later" clause, so `chdman.COPYING` is not the same text as `RAHasher.COPYING` and the two cannot be merged into one file.

The catalogues are generated by `tools/build_dat_index.py` from a pinned `libretro-database` commit, never hand-edited. Their upstream data comes from No-Intro, Redump and TOSEC.

At runtime the loader looks in `bin/` first and falls back to `defaults/bin/`, because packaging moves `defaults/` up a level on the device while a run straight from the repo does not.

## A request, end to end

```
  page          controller         api.ts        main.py / mixin       service        store
   │                │                 │                │                  │             │
   ├─ onPress ─────►│                 │                │                  │             │
   │                ├─ thunk ────────►│                │                  │             │
   │                │                 ├─ IPC ─────────►│                  │             │
   │                │                 │                ├─ _ra_slot() ────►│             │
   │                │                 │                │                  ├─ read ─────►│
   │                │                 │                │                  │◄─ cached ───┤
   │                │                 │                │                  ├─ HTTP → RA  │
   │                │                 │                │                  ├─ write ────►│
   │                │◄─ payload ──────┴────────────────┴──────────────────┘             │
   ├─ re-render ◄───┤
```

## Identity

ULID is the primary key for everything stored: settings, notes, tracked lists, caches. The account's own ULID comes from `activeUlid` in the config, never from a username, because a RetroAchievements user can rename and the ULID cannot.

Two deliberate exceptions are addressed by name, because RA's own URLs are: avatar CDN paths (`media.retroachievements.org/UserPic/<Name>.png`) and profile links.

## Rate limiting

RetroAchievements returns 429 readily, so requests go through a semaphore in `main.py`.

| Lane | For | Rule |
|---|---|---|
| `_ra_semaphore`, taken via `_ra_slot()` | API calls | one slot per user-initiated task, never one per item |
| `_image_semaphore` | CDN media | a separate lane, so artwork never starves an API call |

Per-item parallelism happens *inside* a slot — a thread pool or a sequential loop. Fanning out N IPC calls that each take their own slot is what trips the limit, and it is the mistake this design exists to prevent.

## Constraints

| Constraint | Why |
|---|---|
| Python is stdlib only | the Decky runtime bundles no third-party packages; `xml.etree` is absent, so RSS is parsed by regex |
| No negative CSS margins | a SteamOS update broke them |
| No bare `document` | the plugin bundle runs in a different realm from the panel it renders into |
| Gamepad focus, not DOM focus | read `onGamepadFocus`, never `onFocus`; they are separate systems |
| Locale parity | 8 files; a new string is an 8-file change |

## Build

Node with pnpm, and Python 3.11 to match Decky's bundled runtime.

```
pnpm install         everything below except ruff comes from this
pnpm run build       rollup via @decky/rollup, esbuild underneath → dist/index.js
npx tsc --noEmit     strict, noUnusedLocals, noUnusedParameters
npx knip             unused exports, files and dependencies; baseline is zero
```

**`ruff` is not a project dependency** and has to be installed separately — `pipx install ruff`, or `uvx ruff check main.py py_modules/` to run it without installing. The configuration is in the repo (`ruff.toml`), so however it is installed it picks up the right rules: a narrow selection of real-defect families, with the simplification families deliberately off. The current baseline is six findings, all triaged and left in place.

**There is no test suite.** `npm test` is a stub that exits 1. The gate is the checks above plus running the plugin on a device, which is worth knowing before offering a change: nothing here can tell you a behavioural regression happened.

Deploying rsyncs the repo to the device and restarts Decky, excluding `src/`, `docs/`, `node_modules/` and the dot-directories — what runs on the device is the bundle in `dist/`, never the source. Packaging a release works the other way round: `.vscode/scripts/package.sh` copies an explicit ten-entry payload into `out/CheevoDeck-<version>.zip`.
