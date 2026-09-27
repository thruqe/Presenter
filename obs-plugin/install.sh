#!/usr/bin/env bash
set -e

echo "======================================================="
echo " Presenter OBS Plugin - Linux / macOS Installer"
echo "======================================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    OBS_SCRIPTS_DIR="$HOME/Library/Application Support/obs-studio/basic/scripts"
else
    OBS_SCRIPTS_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/obs-studio/basic/scripts"
fi

mkdir -p "$OBS_SCRIPTS_DIR"

echo "Copying presenter_obs.py to: $OBS_SCRIPTS_DIR"
cp -f "$SCRIPT_DIR/presenter_obs.py" "$OBS_SCRIPTS_DIR/presenter_obs.py"
chmod +x "$OBS_SCRIPTS_DIR/presenter_obs.py" 2>/dev/null || true

echo ""
echo "[SUCCESS] presenter_obs.py installed to:"
echo "  $OBS_SCRIPTS_DIR/presenter_obs.py"
echo ""
echo "Next Steps in OBS Studio:"
echo "  1. Open OBS Studio"
echo "  2. Go to Tools -> Scripts"
echo "  3. On the 'Scripts' tab, click '+'"
echo "  4. Select: $OBS_SCRIPTS_DIR/presenter_obs.py"
echo "  5. Click 'Create / Update Presenter Scenes'"
echo "======================================================="
