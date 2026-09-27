# Presenter OBS Studio Integration Plugin

This script seamlessly connects **Presenter** with **OBS Studio**. It automatically detects the active server port and creates or updates dedicated, transparent browser scenes for Scripture and Worship Song presentations.

---

## Features

- **Automatic Port Detection**:
  - Automatically identifies whether Presenter is running on standard port `1000`, Linux unprivileged fallback `8642`, or any custom port configured via `PORT`.
  - Uses both local discovery metadata and instant HTTP port probes.
- **Dedicated Scenes for OBS**:
  - `Presenter - Scripture`: Preconfigured with a 1080p transparent browser source (`/output`).
  - `Presenter - Songs`: Preconfigured with a 1080p transparent browser source (`/song`).
- **Dynamic Port Re-syncing**:
  - If the Presenter server is restarted on a different port during service, the script detects the change and automatically updates the browser source URLs in OBS without you having to re-add them.
- **Zero-Flicker Transitions**:
  - Configured with background persistence (`shutdown = false`) so the WebSocket connection remains live between scene switches.
- **Cross-Platform**:
  - Runs natively inside OBS Studio across Windows, macOS, and Linux without compiling any C/C++ code.

---

## Quick Setup Guide

### 1. Prerequisites (Python in OBS)

OBS Studio requires Python 3 to be selected in its settings:

- **Windows**:
  1. Install [Python 3.10, 3.11, or 3.12](https://www.python.org/downloads/windows/) (64-bit). *Ensure you check "Add Python to environment variables" during installation.*
  2. In OBS Studio, go to **Tools** > **Scripts** > **Python Settings** tab.
  3. Browse to your Python install folder (e.g., `C:\Users\<YourUser>\AppData\Local\Programs\Python\Python311` or `C:\Program Files\Python311`).
- **macOS**:
  - In OBS Studio, go to **Tools** > **Scripts** > **Python Settings** and ensure your Python 3 framework path is selected (e.g. `/usr/local/opt/python@3.11/Frameworks/Python.framework/Versions/3.11` or `/Library/Frameworks/Python.framework/Versions/3.11`).
- **Linux**:
  - Install Python 3: `sudo apt install python3` (or your distribution's equivalent). OBS on Linux will detect it automatically.

---

### 2. Loading the Script into OBS

1. Start your **Presenter** server:
   ```bash
   bun run src/index.ts
   ```
2. In **OBS Studio**, open the top menu: **Tools** > **Scripts**.
3. Under the **Scripts** tab, click the **`+`** (Add) button in the lower-left.
4. Select the file:
   ```
   Presenter/obs-plugin/presenter_obs.py
   ```
5. You will see the **Presenter OBS Integration** panel appear on the right with a real-time status indicator:
   ```
   🟢 Connected to Presenter at http://127.0.0.1:8642
   ```

---

### 3. Creating the Scenes in OBS

Click the button:

```
🎬 Create / Update Presenter Scenes
```

OBS will automatically create two scenes in your Scene list:
1. **`Presenter - Scripture`**:
   - Contains source: **`Presenter Scripture Browser`**
   - URL: `http://127.0.0.1:<PORT>/output`
   - Resolution: `1920x1080` (30 FPS)
   - Background: Transparent
2. **`Presenter - Songs`**:
   - Contains source: **`Presenter Song Browser`**
   - URL: `http://127.0.0.1:<PORT>/song`
   - Resolution: `1920x1080` (30 FPS)
   - Background: Transparent (ideal for lower-thirds and lyrics overlays)

---

## Script Controls & Configuration

Inside **Tools** > **Scripts** with `presenter_obs.py` selected:

| Control | Description |
|---|---|
| **Connection Status** | Live status indicator (`🟢 Connected` / `🔴 Searching`). |
| **Auto-detect Server Port** | When checked (default), automatically probes and finds the port. |
| **Server Host** | Defaults to `127.0.0.1`. Set to Presenter's LAN IP if running on another computer. |
| **Server Port** | Current active port (auto-filled when detected, or can be set manually). |
| **Source Width / Height** | Dimensions for the browser source (defaults to `1920x1080`). |
| **Source FPS** | Framerate for the browser rendering (defaults to `30`). |
| **Auto-update on Port Change** | When enabled, if the server restarts on a new port, OBS URLs update automatically. |
| **🔍 Scan / Detect Port Now** | Manually force an instant port detection. |
| **🎬 Create / Update Presenter Scenes** | Generates or updates the two dedicated OBS scenes. |
| **🔄 Refresh Browser Sources** | Forces OBS to reload and refresh the browser sources. |

---

## Overlaying onto Camera Feeds

Since the browser sources have transparent backgrounds, you can also embed them directly on top of your live camera mix:

1. In any existing camera scene (e.g. `Main Camera`), click **`+`** in the Sources panel.
2. Choose **Add Existing** under **Browser**.
3. Select **`Presenter Scripture Browser`** or **`Presenter Song Browser`**.
4. The lyrics/scripture will overlay cleanly over your video stream.

---

## Command-Line Verification Tool

You can also test port detection from the terminal before opening OBS:

```bash
python3 obs-plugin/presenter_obs.py
```

Output:
```
============================================================
 Presenter OBS Integration - CLI Diagnostic & Discovery Tool
============================================================
Scanning target host: 127.0.0.1...

[SUCCESS] Presenter server detected on port: 8642
------------------------------------------------------------
  Scripture Output : http://127.0.0.1:8642/output
  Song Output      : http://127.0.0.1:8642/song
  Control Panel    : http://127.0.0.1:8642/
  Song Control     : http://127.0.0.1:8642/song-control
------------------------------------------------------------
```
