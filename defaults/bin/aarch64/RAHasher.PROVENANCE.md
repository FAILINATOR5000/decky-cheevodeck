# RAHasher (ARM64) — where this binary came from

The ARM64 build of RAHasher, for SteamOS on ARM devices. Cheevo Check runs it instead of `../RAHasher` when the machine is ARM64 and this binary starts; everywhere else the x86-64 one runs as before.

| | |
|---|---|
| Version | **1.8.3** (ARM64 Linux) |
| Source tag | https://github.com/LeXofLeviafan/RAHasher/releases/tag/1.8.3 (commit `a09f37797a155330240f62377e4dc5586046ebb2`, submodules as pinned by that commit) |
| Built in | `docker.io/library/debian:bookworm` (`sha256:704583dbf243593da87cf949fc0543ffeca24a28d36c2760dc9545410cb8ed02`), cross-compiled with `gcc-aarch64-linux-gnu` 12.2.0 |
| Built with | `make -f Makefile.RAHasher ARCH=arm64 HAVE_CHD=1 CC=aarch64-linux-gnu-gcc CXX=aarch64-linux-gnu-g++ LDFLAGS="-static -march=armv8-a"`, then `aarch64-linux-gnu-strip -s` |
| sha256 (binary) | `88097547e470f61148dd1de656a36778414ead9991ea8f692598280e82bb433c` |
| License | GPL-3.0 — full text in `RAHasher.COPYING` |

**I built this one myself.** The upstream releases carry x64 and x86 builds only, so there is no ARM64 binary to repackage. The source is the same tag the x86-64 binary comes from, unmodified: the ARM64 target is already in upstream's own makefile, and nothing was patched to build it. That tag and the command above are the corresponding source GPL-3.0 asks for. **Don't ship a build from a tag that has since been deleted.**

It is statically linked, so it needs nothing from the system it runs on. That includes glibc (LGPL-2.1), which is fine inside a GPL program whose whole source is published. Stripping removes debug symbols and nothing else.

Checked before shipping by running it under `qemu-aarch64` against the x86-64 build on the same files: carts, zips, a raw ROM, a cue/bin, and CHDs for PlayStation, Sega CD, Saturn, Dreamcast, PlayStation 2 and PSP. Every hash matched, as did the multi-file output and the handling of a missing file.
