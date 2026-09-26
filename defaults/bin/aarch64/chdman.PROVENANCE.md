# chdman (ARM64) — where this binary came from

The ARM64 build of MAME's CHD tool, for SteamOS on ARM devices. Cheevo Check runs it instead of `../chdman` when the machine is ARM64 and the ARM64 RAHasher beside it starts.

| | |
|---|---|
| Version | **0.289** (ARM64 Linux) |
| Source tag | https://github.com/mamedev/mame/releases/tag/mame0289 (commit `f34f02505e32c1993c6a782b6814232cbfc74e36`), the same tag as the x86-64 build |
| Built in | `docker.io/library/debian:bookworm` (`sha256:704583dbf243593da87cf949fc0543ffeca24a28d36c2760dc9545410cb8ed02`), cross-compiled with `gcc-aarch64-linux-gnu` 12.2.0 against `libsdl2-dev:arm64` 2.26.5 |
| Built with | see below, then `aarch64-linux-gnu-strip -s` |
| sha256 (binary) | `54b0b33c8bf04804d30e7ba030b0bd3ede403e01187e3285d5c83c9190f24900` |
| License | GPL-2.0-only — full text in `chdman.COPYING` |

```
make TARGETOS=linux PLATFORM=arm64 PTR64=1 NOASM=1 \
    OVERRIDE_CC=aarch64-linux-gnu-gcc OVERRIDE_CXX=aarch64-linux-gnu-g++ OVERRIDE_LD=aarch64-linux-gnu-g++ \
    NO_X11=1 NO_OPENGL=1 NO_USE_XINPUT=1 NO_USE_PULSEAUDIO=1 NO_USE_PORTAUDIO=1 NO_USE_MIDI=1 USE_QTDEBUG=0 \
    TOOLS=1 NOWERROR=1 REGENIE=1 "LDOPTS=-Wl,--as-needed -static-libstdc++ -static-libgcc" \
    build/projects/sdl/mame/gmake-linux/Makefile
make -C build/projects/sdl/mame/gmake-linux config=release chdman
```

Built from the tag with no source changes. `NOWERROR=1` is MAME's own switch; GCC 12 raises a false `-Wrestrict` warning inside its own C++ library, and MAME otherwise treats warnings as errors. Only the tool is built, not the emulator.

**GPL-2.0-only**, the same license text as the x86-64 build, and the pinned tag is how the corresponding source stays available. **Don't ship a build from a tag that has since been deleted.**

## Runtime dependency

The C++ runtime is linked in, so it needs `libSDL2-2.0.so.0`, `libm` and `libc` (glibc 2.36 or newer) from the system and nothing else. SDL2 comes in through MAME's OSD layer for clipboard functions chdman never calls. Linking it statically would pull in X11, Wayland and the rest of SDL's video stack, so it stays dynamic. SteamOS has it because gamescope, the Game Mode compositor, links it too.

Checked before shipping by running it under `qemu-aarch64` against the x86-64 build: `info`, `verify`, `extractcd` on a PlayStation disc and a 19-track Dreamcast GD-ROM, and `extractdvd` on a PlayStation 2 disc. Every extracted file matched byte for byte.
