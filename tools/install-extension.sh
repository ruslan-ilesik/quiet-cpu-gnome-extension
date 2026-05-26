#!/bin/bash
set -e

UUID="cpu-quiet@lesikr.com"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
SCHEMA_DIR="$HOME/.local/share/glib-2.0/schemas"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== Installing extension: $UUID ==="

# Remove old installation if exists
rm -rf "$EXTENSION_DIR"

# Create extension directory
mkdir -p "$EXTENSION_DIR"

# Copy all extension files from the correct source
cp "$PROJECT_ROOT/extension/extension.js" "$EXTENSION_DIR/"
cp "$PROJECT_ROOT/extension/metadata.json" "$EXTENSION_DIR/"
cp "$PROJECT_ROOT/extension/prefs.js" "$EXTENSION_DIR/"
cp "$PROJECT_ROOT/extension/stylesheet.css" "$EXTENSION_DIR/"


# Copy schemas
mkdir -p "$SCHEMA_DIR"
cp "$PROJECT_ROOT/extension/schemas/org.gnome.shell.extensions.cpuquiet.gschema.xml" "$SCHEMA_DIR/"
glib-compile-schemas "$SCHEMA_DIR"

echo "=== Installation complete ==="
echo "Now restart GNOME Shell (Alt+F2, r) then enable the extension with:"
echo "gnome-extensions enable cpu-quiet@lesikr.com"