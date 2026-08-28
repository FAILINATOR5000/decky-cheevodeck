#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/../deploy-settings.json"

CFG_USER=""
CFG_HOST=""
CFG_PORT=""
CFG_DIR=""
CFG_KEY=""

if [[ -f "$CONFIG_FILE" ]]; then
  eval "$(python3 - "$CONFIG_FILE" <<'READ_SETTINGS'
import json, re, shlex, sys


def strip_comments(text):
    """VS Code lets you comment this file, so the script has to accept them too."""
    out = []
    i = 0
    in_string = False
    while i < len(text):
        ch = text[i]
        if in_string:
            out.append(ch)
            if ch == "\\" and i + 1 < len(text):
                out.append(text[i + 1])
                i += 2
                continue
            if ch == '"':
                in_string = False
            i += 1
        elif ch == '"':
            in_string = True
            out.append(ch)
            i += 1
        elif text.startswith("//", i):
            while i < len(text) and text[i] != "\n":
                i += 1
        else:
            out.append(ch)
            i += 1
    return "".join(out)


text = strip_comments(open(sys.argv[1]).read())
text = re.sub(r",(\s*[}\]])", r"\1", text)

try:
    cfg = json.loads(text)
except ValueError as err:
    sys.stderr.write(f"deploy-settings.json isn't valid JSON ({err}), ignoring it\n")
    raise SystemExit(0)

for var, key in (
    ("CFG_USER", "steamDeckUserName"),
    ("CFG_HOST", "steamDeckHost"),
    ("CFG_PORT", "steamDeckPort"),
    ("CFG_DIR", "steamDeckRemotePluginDir"),
    ("CFG_KEY", "sshKey"),
):
    print(f"{var}={shlex.quote(str(cfg.get(key, '')))}")
READ_SETTINGS
)"
fi

STEAM_DECK_USER="${1:-${CFG_USER:-deck}}"
STEAM_DECK_HOST="${2:-${CFG_HOST:-}}"
STEAM_DECK_PORT="${3:-${CFG_PORT:-22}}"
STEAM_DECK_PLUGIN_DIR="${4:-${CFG_DIR:-}}"
SSH_KEY="${5:-${CFG_KEY:-}}"

if [[ -z "$STEAM_DECK_HOST" || -z "$STEAM_DECK_PLUGIN_DIR" ]]; then
  echo "No Deck to deploy to. Copy .vscode/deploy-settings.example.json to .vscode/deploy-settings.json and fill it in." >&2
  exit 1
fi

SSH_ARGS=(-p "$STEAM_DECK_PORT")

if [[ -n "$SSH_KEY" ]]; then
  SSH_ARGS+=(-i "$SSH_KEY")
fi

run_remote() {
  ssh "${SSH_ARGS[@]}" "${STEAM_DECK_USER}@${STEAM_DECK_HOST}" "$@"
}

run_sudo_remote() {
  ssh -tt "${SSH_ARGS[@]}" "${STEAM_DECK_USER}@${STEAM_DECK_HOST}" "$@"
}

echo "Stopping Decky and preparing remote plugin folder..."
run_sudo_remote \
  "sudo /usr/bin/systemctl stop plugin_loader.service && sudo /usr/bin/mkdir -p '${STEAM_DECK_PLUGIN_DIR}' && sudo /usr/bin/chown -R ${STEAM_DECK_USER}:${STEAM_DECK_USER} '${STEAM_DECK_PLUGIN_DIR}'"

echo "Deploying to ${STEAM_DECK_USER}@${STEAM_DECK_HOST}:${STEAM_DECK_PLUGIN_DIR}..."
rsync -rlv --delete --delete-excluded \
  --no-owner --no-group --omit-dir-times \
  --chmod=D0755,F0644 \
  -e "ssh ${SSH_ARGS[*]}" \
  --exclude ".git" \
  --exclude ".github" \
  --exclude ".gitignore" \
  --exclude ".editorconfig" \
  --exclude ".vscode" \
  --exclude "docs" \
  --exclude "node_modules" \
  --exclude "src" \
  --exclude "__pycache__" \
  --exclude "*.pyc" \
  --exclude "*.log" \
  --exclude ".DS_Store" \
  ./ "${STEAM_DECK_USER}@${STEAM_DECK_HOST}:${STEAM_DECK_PLUGIN_DIR}/"

echo "Restarting Decky..."
run_sudo_remote \
  "sudo /usr/bin/systemctl restart plugin_loader.service"

echo "==> Done."
