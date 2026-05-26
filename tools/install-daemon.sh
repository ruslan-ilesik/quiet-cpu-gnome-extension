#!/bin/bash
set -e  # exit on error

sudo apt install -y libglib2.0-dev

# Get the directory where this script lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=== Building daemon ==="
cd "$PROJECT_ROOT/daemon"
rm -rf CMakeCache.txt CMakeFiles/ Makefile
cmake .
make -j

sudo systemctl stop cpu-quiet

echo "=== Installing binary ==="
sudo cp cpu-quiet-daemon /usr/local/bin/

echo "=== Installing D-Bus policy ==="
sudo cp "$PROJECT_ROOT/system/org.lesikr.cpuquiet.conf" /etc/dbus-1/system.d/
sudo systemctl reload dbus

echo "=== Installing systemd service ==="
sudo cp "$PROJECT_ROOT/system/cpu-quiet.service" /etc/systemd/system/
sudo systemctl daemon-reload

echo "=== Enabling and starting service ==="
sudo systemctl enable cpu-quiet
sudo systemctl restart cpu-quiet

echo "=== Status ==="
sudo systemctl status cpu-quiet --no-pager

echo "=== D-Bus test ==="
sleep 2
dbus-send --system --print-reply --dest=org.lesikr.cpuquiet /org/cpuquiet org.lesikr.cpuquiet.GetStatus