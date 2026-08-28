# RAHasher — where this binary came from

`RAHasher` is RetroAchievements' own hashing tool, built by LeXofLeviafan from
RALibretro. Cheevo Check shells out to it to work out a ROM's RA hash; nothing in
CheevoDeck's own source links against it.

| | |
|---|---|
| Version | **1.8.3** (x64 Linux) |
| Release | https://github.com/LeXofLeviafan/RAHasher/releases/tag/1.8.3 |
| Asset | `RAHasher-x64-Linux-1.8.3.zip` |
| sha256 (zip) | `bb98dcb38f6491aafd3450be4024b7e5465c13a0ca72bfe17d315780771be337` |
| sha256 (binary) | `3c0bb41be61cb42d7edb17791c7be9083ce644427799302c993f15d9d8822329` |
| Licence | GPL-3.0 — full text in `RAHasher.COPYING` |

The hashes are here so anyone can confirm what is actually in this folder without
having to trust the filename.

GPLv3 wants the corresponding source available, and pinning the exact upstream
release tag above is how I satisfy that: CheevoDeck's releases and RAHasher's
source both live on GitHub, so §6(d)'s network-location provision is met by the
link. **Don't ship a build from a tag that has since been deleted** — the
pointer has to stay reachable for as long as the binary is out there.

`RAHasher.COPYING` has to travel with the binary, not just sit in the repo. If a
future change to how the plugin is packaged drops `bin/` from the zip, the repo
stays compliant and every release stops being — and nothing surfaces that until
somebody asks for the source.
