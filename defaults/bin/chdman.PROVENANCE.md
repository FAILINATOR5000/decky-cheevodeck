# chdman — where this binary came from

`chdman` is MAME's CHD tool. Cheevo Check's verification pass shells out to it to
unpack a disc image back into something a published catalogue can be compared
against; nothing in CheevoDeck's own source links against it.

| | |
|---|---|
| Version | **0.289** (x64 Linux) |
| Source tag | https://github.com/mamedev/mame/releases/tag/mame0289 |
| Built from | that tag, in a clean Arch container, `make -C build/projects/sdl/mame/gmake-linux config=release64 chdman` |
| sha256 (binary) | `465c44bfef7416cd45655c7c511f5ca67064f73e56ea58cac82e81bb1154d67c` |
| Licence | GPL-2.0-only — full text in `chdman.COPYING` |

**I built this myself rather than repackaging somebody else's.** That's the
whole reason for the "Built from" row: GPL-2.0 asks that the corresponding
source for *the binary I ship* stays reachable, and that's only cleanly
true for a build I made from a tag I pinned. Shipping someone else's build would
mean promising source for a build I didn't make.

The binary is stripped (`strip -s`), which is why it is around 2.4 MB rather than
the 7 MB it comes out of the compiler at. Stripping removes debug symbols and
nothing else; it is not a modification to the program.

**GPL-2.0-only, not "or later".** MAME's COPYING says "under the terms of the GNU
General Public License version 2, as provided in docs/legal/GPL-2.0" with no "or
later" clause. This is a *different licence text* from the GPL-3.0 shipped for
RAHasher, which is why there are two COPYING files in this folder rather than one.

Pinning the release tag above is how the source-availability requirement is met:
CheevoDeck's releases and MAME's source both live on GitHub. **Don't ship a build from a
tag that has since been deleted** — the pointer has to stay reachable for as long
as the binary is out there.

`chdman.COPYING` has to travel with the binary, not just sit in the repo. Same
warning as RAHasher's: if a future packaging change drops `bin/` from the release
zip, the repo stays compliant and every release stops being.

## Runtime dependency

The build links `libSDL2-2.0.so.0`, which comes in through MAME's OSD layer
rather than from chdman itself. SteamOS ships it at `/usr/lib/libSDL2-2.0.so.0`,
so it resolves on the target device — confirmed with `ldd` on a Steam Deck.
Everything else it needs is libstdc++, libm, libgcc and libc.
