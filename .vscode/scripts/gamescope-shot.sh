#!/usr/bin/env bash
# A composited screenshot of game mode: game, Steam UI and the QAM together.
#
# Steam's own screenshot key grabs the running game's backbuffer, so everything
# gamescope draws on top of it is missing: the whole Steam UI, and the QAM with
# it. gamescope's screenshot is a capture of the composited output instead,
# which is the layer the panel actually lives in.
#
# CDP was tried first and does not work: Valve's CEF accepts Page.enable and
# then never answers Page.captureScreenshot, on every target, with and without
# a clip. Don't spend an evening on it again.
#
# Run this over SSH rather than pressing Super+S on a keyboard. The point is
# that nothing touches the device. The panel keeps the exact page, focus ring
# and scroll position you posed, where a keypress risks Steam moving focus at
# the moment of capture.
#
# Resolution is whatever gamescope is compositing at, so shoot on the machine
# wired to the 4K panel rather than the handheld.
#
# The Snapshot shortcut does the same capture from inside the plugin. This one
# needs no plugin, no game running and no button, so it stays the fallback for
# when the action itself is what is broken.
#
# Usage:  ./gamescope-shot.sh main-page
#         ./gamescope-shot.sh guides-reader ~/shots

set -euo pipefail

NAME="${1:-shot}"
DIR="${2:-$HOME/shots}"
RUNTIME="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

mkdir -p "$DIR"
OUT="$DIR/${NAME}.png"

# gamescopectl talks to gamescope over its own wayland socket, and an SSH
# session inherits none of the session's environment. The socket is named
# gamescope-N and lives in the runtime dir, so find it rather than hardcoding a
# number that changes if gamescope restarts.
SOCKET=""
for s in "$RUNTIME"/gamescope-*; do
    [ -S "$s" ] || continue
    SOCKET="$(basename "$s")"
    break
done

if [ -z "$SOCKET" ]; then
    echo "No gamescope socket in $RUNTIME. Is the device in game mode?" >&2
    exit 1
fi

export XDG_RUNTIME_DIR="$RUNTIME" GAMESCOPE_WAYLAND_DISPLAY="$SOCKET"

# gamescopectl forwards a console command to the compositor, so an unknown name
# gets "Command not found." from gamescope rather than from the shell, and it
# still exits 0, which is why a bad name used to look like a missing file.
# `help` lists what this build actually accepts.
if [ "$NAME" = "help" ]; then
    gamescopectl help
    exit 0
fi

CMD="${GAMESCOPE_SHOT_CMD:-screenshot}"
set +e
OUTPUT="$(gamescopectl "$CMD" "$OUT" 2>&1)"
set -e
echo "$OUTPUT"
if printf '%s' "$OUTPUT" | grep -qi "command not found"; then
    echo "gamescope rejected the console command '$CMD'." >&2
    echo "Run '$0 help' to list the real names, then re-run with" >&2
    echo "GAMESCOPE_SHOT_CMD=<name> $0 $NAME" >&2
    exit 1
fi

# gamescope writes asynchronously, so the file is not there the instant the
# command returns.
for _ in $(seq 20); do
    [ -s "$OUT" ] && break
    sleep 0.25
done

if [ -s "$OUT" ]; then
    echo "$OUT  ($(stat -c %s "$OUT") bytes)"
else
    echo "gamescopectl returned but $OUT never appeared" >&2
    exit 1
fi
