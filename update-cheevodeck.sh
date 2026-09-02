#!/usr/bin/env bash
set -euo pipefail

RELEASE_JSON=""
WORK_DIR=""

finish() {
    rm -f "${RELEASE_JSON}"
    rm -rf "${WORK_DIR}"
    printf "\nPress Enter to close this window."
    read -r _ || true
}
trap finish EXIT

REPO="FAILINATOR5000/decky-cheevodeck"
PLUGIN_DIR_NAME="decky-cheevodeck"
SERVICE="${DECKY_SERVICE:-}"

if [[ ${EUID} -eq 0 ]]; then
    echo "Run this as your normal user, not with sudo. It asks for the password itself." >&2
    exit 1
fi

for tool in curl unzip python3 systemctl; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "Missing ${tool}, which this script needs." >&2
        exit 1
    fi
done

if [[ -z "${SERVICE}" ]]; then
    for unit in plugin_loader decky-loader; do
        if systemctl list-unit-files "${unit}.service" >/dev/null 2>&1 \
                && systemctl cat "${unit}.service" >/dev/null 2>&1; then
            SERVICE="${unit}"
            break
        fi
    done
fi
if [[ -z "${SERVICE}" ]]; then
    echo "Couldn't find Decky's service. Set DECKY_SERVICE to its name and run this again." >&2
    exit 1
fi

HOMEBREW_DIR="${DECKY_HOME:-}"
if [[ -z "${HOMEBREW_DIR}" ]]; then
    loader_path="$(ps -eo args= 2>/dev/null | grep -m1 -oE '\S+/services/PluginLoader' || true)"
    if [[ -n "${loader_path}" ]]; then
        HOMEBREW_DIR="${loader_path%/services/PluginLoader}"
    fi
fi
HOMEBREW_DIR="${HOMEBREW_DIR:-$HOME/homebrew}"
PLUGIN_DIR="${HOMEBREW_DIR}/plugins/${PLUGIN_DIR_NAME}"

if [[ ! -d "${HOMEBREW_DIR}/plugins" ]]; then
    echo "No Decky plugins folder at ${HOMEBREW_DIR}/plugins. Is Decky Loader installed?" >&2
    exit 1
fi

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
case "${SCRIPT_PATH}" in
    "${PLUGIN_DIR}"/*)
        echo "This script is sitting inside ${PLUGIN_DIR}, which it is about to replace." >&2
        echo "Copy it somewhere else, your Desktop for instance, and run it from there." >&2
        exit 1
        ;;
esac

installed_version() {
    if [[ -f "${PLUGIN_DIR}/package.json" ]]; then
        python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('version',''))" \
            "${PLUGIN_DIR}/package.json" 2>/dev/null || true
    fi
}

version_is_newer() {
    python3 - "$1" "$2" <<'PY'
import sys

def parse(raw):
    raw = (raw or "").strip().lstrip("vV")
    parts = raw.split(".")
    if not parts or not all(p.isdigit() for p in parts):
        return None
    return tuple(int(p) for p in parts)

new, old = parse(sys.argv[1]), parse(sys.argv[2])
if new is None:
    sys.exit(2)
if old is None:
    sys.exit(0)
sys.exit(0 if new > old else 1)
PY
}

echo "Checking GitHub for the latest release..."
RELEASE_JSON="$(mktemp)"

if ! curl -fsSL -H "Accept: application/vnd.github+json" \
        "https://api.github.com/repos/${REPO}/releases/latest" -o "$RELEASE_JSON"; then
    echo "Couldn't reach GitHub. Check your connection and try again." >&2
    exit 1
fi

read -r LATEST_VERSION ASSET_URL < <(python3 - "$RELEASE_JSON" <<'PY'
import json, sys

data = json.load(open(sys.argv[1]))
tag = (data.get("tag_name") or "").strip()
version = tag.lstrip("vV")
wanted = "CheevoDeck-%s.zip" % version
assets = data.get("assets") or []

match = next((a for a in assets if a.get("name") == wanted), None)
if match is None:
    match = next((a for a in assets
                  if (a.get("name") or "").startswith("CheevoDeck-")
                  and (a.get("name") or "").endswith(".zip")), None)

print(version, match.get("browser_download_url") if match else "")
PY
)

if [[ -z "${LATEST_VERSION}" || -z "${ASSET_URL}" ]]; then
    echo "The latest release has no CheevoDeck-<version>.zip attached, so there is nothing to install." >&2
    exit 1
fi

CURRENT_VERSION="$(installed_version)"
echo "Installed: ${CURRENT_VERSION:-none}"
echo "Latest:    ${LATEST_VERSION}"

if [[ "${1:-}" != "--force" ]]; then
    set +e
    version_is_newer "${LATEST_VERSION}" "${CURRENT_VERSION}"
    verdict=$?
    set -e
    if [[ ${verdict} -eq 1 ]]; then
        echo "Already up to date. Pass --force to reinstall anyway."
        exit 0
    fi
fi

WORK_DIR="$(mktemp -d)"
ZIP_PATH="${WORK_DIR}/CheevoDeck-${LATEST_VERSION}.zip"

echo "Downloading ${LATEST_VERSION}..."
curl -fL --progress-bar "${ASSET_URL}" -o "${ZIP_PATH}"

if ! unzip -tqq "${ZIP_PATH}" >/dev/null 2>&1; then
    echo "The downloaded file isn't a readable zip. Nothing was changed." >&2
    exit 1
fi

if ! unzip -Z1 "${ZIP_PATH}" | grep -q "^${PLUGIN_DIR_NAME}/"; then
    echo "That zip doesn't contain a ${PLUGIN_DIR_NAME} folder. Nothing was changed." >&2
    exit 1
fi

echo
echo "Ready to install ${LATEST_VERSION} into ${PLUGIN_DIR}."
echo "Your settings and data will not be touched and is left alone."
echo

sudo -v

echo "Stopping Decky so nothing is running while the files change..."
sudo systemctl stop "${SERVICE}"

echo "Removing the old version..."
sudo rm -rf "${PLUGIN_DIR}"

echo "Installing the new one..."
sudo unzip -qo "${ZIP_PATH}" -d "${HOMEBREW_DIR}/plugins"
sudo chown -R root:root "${PLUGIN_DIR}"

echo "Starting Decky back up..."
sudo systemctl start "${SERVICE}"

echo
echo "CheevoDeck ${LATEST_VERSION} is installed. You are good to go!"
