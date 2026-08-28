#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

PLUGIN_DIR_NAME="decky-cheevodeck"
OUT_DIR="$REPO_ROOT/out"
STAGE_DIR="$OUT_DIR/stage"

PAYLOAD=(
    main.py
    plugin.json
    package.json
    LICENSE
    THIRD-PARTY-LICENSES
    README.md
    ATTRIBUTIONS.md
    dist
    py_modules
    defaults
)

VERSION="$(node -p "require('./package.json').version")"
ASSET_NAME="CheevoDeck-${VERSION}.zip"

if [[ -n "$(git status --porcelain)" ]]; then
    if [[ "${PACKAGE_ALLOW_DIRTY:-}" != "1" ]]; then
        echo "Working tree is dirty. A release asset has to come from a clean tree." >&2
        git status --short >&2
        echo "Set PACKAGE_ALLOW_DIRTY=1 to package it anyway." >&2
        exit 1
    fi
    echo "WARNING: packaging a dirty working tree."
fi

if [[ "${PACKAGE_SKIP_BUILD:-}" == "1" ]]; then
    echo "Skipping the build, using dist/ as it stands."
else
    echo "Building ${VERSION}..."
    pnpm run build
fi

for path in "${PAYLOAD[@]}"; do
    if [[ ! -e "$path" ]]; then
        echo "Payload is missing ${path}, refusing to package." >&2
        exit 1
    fi
done

echo "Staging ${PLUGIN_DIR_NAME}/..."
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/$PLUGIN_DIR_NAME"

for path in "${PAYLOAD[@]}"; do
    cp -R "$path" "$STAGE_DIR/$PLUGIN_DIR_NAME/"
done

find "$STAGE_DIR" -type d -name '__pycache__' -prune -exec rm -rf {} +
find "$STAGE_DIR" -type f \( -name '*.pyc' -o -name '*.log' -o -name '.DS_Store' \) -delete

find "$STAGE_DIR" -type d -exec chmod 755 {} +
find "$STAGE_DIR" -type f -exec chmod 644 {} +
chmod 755 "$STAGE_DIR/$PLUGIN_DIR_NAME/defaults/bin/chdman" "$STAGE_DIR/$PLUGIN_DIR_NAME/defaults/bin/RAHasher"

echo "Writing ${ASSET_NAME}..."
rm -f "$OUT_DIR/$ASSET_NAME"
(cd "$STAGE_DIR" && zip -q -r "$OUT_DIR/$ASSET_NAME" "$PLUGIN_DIR_NAME")
rm -rf "$STAGE_DIR"

echo
echo "  asset    ${OUT_DIR}/${ASSET_NAME}"
echo "  version  ${VERSION}"
echo "  size     $(du -h "$OUT_DIR/$ASSET_NAME" | cut -f1)"
echo "  sha256   $(sha256sum "$OUT_DIR/$ASSET_NAME" | cut -d' ' -f1)"
echo "  entries  $(unzip -l "$OUT_DIR/$ASSET_NAME" | tail -1 | awk '{print $2}')"
echo
echo "==> Done. Upload it as ${ASSET_NAME}; the checker derives that name from the tag."
