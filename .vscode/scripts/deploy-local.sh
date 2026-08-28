#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="${1:-/home/deck/homebrew/plugins/decky-cheevodeck}"

echo "Stopping Decky and preparing plugin folder..."
sudo /usr/bin/systemctl stop plugin_loader.service
sudo /usr/bin/mkdir -p "$PLUGIN_DIR"
sudo /usr/bin/chown -R "$(id -un):$(id -gn)" "$PLUGIN_DIR"

echo "Deploying to ${PLUGIN_DIR}..."
rsync -rlv --delete --delete-excluded \
  --no-owner --no-group --omit-dir-times \
  --chmod=D0755,F0644 \
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
  ./ "$PLUGIN_DIR/"

echo "Restarting Decky..."
sudo /usr/bin/systemctl restart plugin_loader.service

echo "==> Done."
