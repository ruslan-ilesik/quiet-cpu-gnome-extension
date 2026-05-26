# ⚠️ AI‑Generated Code – Use at Your Own Risk

**This software was entirely written by an AI with just human guidelines.** 
No human developer has reviewed or tested the code for correctness, security, or performance. but it is running on my laptop LOL .
It may contain bugs, security issues, or simply not work as expected.  

You are strongly advised to **inspect every line** before compiling or installing anything.

---

# CPU Quiet Mode – GNOME Shell Extension

A thermal throttling daemon + GNOME Shell extension that limits CPU frequency based on temperature, helping to keep your system quiet and cool.

## Features

- Real‑time CPU temperature & frequency monitoring in the top panel.
- Toggle throttling on/off from the indicator menu.
- Adjustable settings:  
  - **Min frequency** (MHz) – lowest allowed speed.  
  - **Throttle start** (°C) – temperature at which throttling begins.  
  - **Max temperature** (°C) – temperature at which min frequency is forced.
- Persistent configuration across reboots.
- Works on modern GNOME Shell (versions 45–48, Wayland & X11).

## Architecture

Two components communicate via D‑Bus:

1. **Daemon** (`cpu-quiet-daemon`) – runs as a systemd service, reads sensors, applies frequency limits.
2. **GNOME Shell extension** – provides the UI and calls the daemon.

## Installation

### 1. Build and install the daemon

```bash
git clone https://github.com/your-username/cpu-quiet-mode.git
cd cpu-quiet-mode
bash tools/install-daemon.sh
bash tools/install-extension.sh