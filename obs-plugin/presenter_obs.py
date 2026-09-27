#!/usr/bin/env python3
"""
Presenter OBS Studio Integration Plugin / Script
------------------------------------------------
Automatically discovers the running Presenter presentation server port,
creates dedicated OBS scenes for Scripture and Song outputs, and keeps
the Browser Sources synchronized in real time.

Features:
- Automatic Port Detection: probes localhost and reads discovery files
  (handles standard port 1000, Linux fallback 8642, or any custom PORT).
- Auto Scene Setup: creates "Presenter - Scripture" and "Presenter - Songs"
  scenes containing preconfigured 1080p transparent browser sources.
- Auto-Sync: if Presenter is restarted on another port, the script
  automatically updates the browser source URLs without interrupting the stream.
- Refresh action: reload browser caches with one click.
- Works natively inside OBS Studio (Tools -> Scripts) across Windows, Linux & macOS.
- Can also be run directly from terminal to verify connectivity.
"""

import sys
import os
import json
import socket
import urllib.request
import urllib.error
import tempfile
import glob

# Try importing the OBS Python API module
try:
    import obspython as obs
    IN_OBS = True
except ImportError:
    obs = None
    IN_OBS = False

# Script Configuration Constants
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 1000
COMMON_PORTS = [1000, 8642, 3000, 8080, 8000, 5000, 8888]

SCRIPTURE_SCENE_NAME = "Presenter - Scripture"
SONG_SCENE_NAME = "Presenter - Songs"
SCRIPTURE_SOURCE_NAME = "Presenter Scripture Browser"
SONG_SOURCE_NAME = "Presenter Song Browser"

SCRIPTURE_PATH = "/output"
SONG_PATH = "/song"

DEFAULT_WIDTH = 1920
DEFAULT_HEIGHT = 1080
DEFAULT_FPS = 30
DEFAULT_CSS = "body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }"

# Global state for OBS script
class ScriptState:
    host = DEFAULT_HOST
    port = DEFAULT_PORT
    auto_detect = True
    auto_update = True
    width = DEFAULT_WIDTH
    height = DEFAULT_HEIGHT
    fps = DEFAULT_FPS
    last_detected_port = None
    status_message = "Initializing..."
    is_connected = False
    timer_active = False

state = ScriptState()


# ==============================================================================
# Port Detection & Network Verification
# ==============================================================================

def get_discovery_file_candidates():
    """
    Returns candidate paths for Presenter's discovery JSON metadata file.
    """
    candidates = []

    # Standard OS temp directory
    try:
        candidates.append(os.path.join(tempfile.gettempdir(), "presenter_info.json"))
    except Exception:
        pass

    # Current working directory
    try:
        candidates.append(os.path.abspath(".presenter_info.json"))
        candidates.append(os.path.abspath("presenter_info.json"))
    except Exception:
        pass

    # Parent directory (in case script is in obs-plugin/)
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        candidates.append(os.path.join(script_dir, "..", ".presenter_info.json"))
        candidates.append(os.path.join(script_dir, "..", "presenter_info.json"))
    except Exception:
        pass

    # Windows AppData / WSL discovery
    try:
        if os.name == "nt":
            local_app_data = os.environ.get("LOCALAPPDATA")
            if local_app_data:
                candidates.append(os.path.join(local_app_data, "Temp", "presenter_info.json"))
        elif os.path.exists("/mnt/c/Users"):
            # Running inside WSL or Linux accessing Windows temp
            for p in glob.glob("/mnt/c/Users/*/AppData/Local/Temp/presenter_info.json"):
                candidates.append(p)
    except Exception:
        pass

    return candidates


def check_discovery_file(host):
    """
    Attempts to read port from local discovery files and verifies server response.
    """
    for file_path in get_discovery_file_candidates():
        try:
            norm_path = os.path.normpath(file_path)
            if os.path.isfile(norm_path):
                with open(norm_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    detected_port = data.get("port")
                    if detected_port and isinstance(detected_port, int):
                        if verify_presenter_server(host, detected_port, timeout=0.3):
                            return detected_port
        except Exception:
            continue
    return None


def is_port_open(host, port, timeout=0.15):
    """
    Fast TCP socket check to see if a port is listening before sending HTTP requests.
    """
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (socket.timeout, ConnectionRefusedError, OSError):
        return False


def verify_presenter_server(host, port, timeout=0.4):
    """
    Verifies that the server running on host:port is indeed Presenter by querying
    either /api/network or /api/output/status.
    """
    # Try /api/network first
    try:
        url = f"http://{host}:{port}/api/network"
        req = urllib.request.Request(url, headers={"User-Agent": "Presenter-OBS-Plugin/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            if response.status == 200:
                body = response.read().decode("utf-8")
                payload = json.loads(body)
                if "port" in payload or ("urls" in payload and "scriptureOutput" in payload["urls"]):
                    return True
    except Exception:
        pass

    # Fallback to /api/output/status
    try:
        url = f"http://{host}:{port}/api/output/status"
        req = urllib.request.Request(url, headers={"User-Agent": "Presenter-OBS-Plugin/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            if response.status == 200:
                body = response.read().decode("utf-8")
                payload = json.loads(body)
                if "scripture" in payload and "song" in payload:
                    return True
    except Exception:
        pass

    return False


def scan_for_presenter_port(host=DEFAULT_HOST):
    """
    Scans for an active Presenter instance:
    1. Checks discovery files for an instant match.
    2. Probes the most common default ports (1000, 8642, 3000, 8080, etc.).
    3. Scans port ranges (1000..1010, 8640..8650).
    """
    # 1. Fast discovery file check
    file_port = check_discovery_file(host)
    if file_port is not None:
        return file_port

    # 2. Probe common ports
    for p in COMMON_PORTS:
        if is_port_open(host, p, timeout=0.15):
            if verify_presenter_server(host, p, timeout=0.3):
                return p

    # 3. Probing port ranges near default and fallback
    ranges_to_scan = list(range(1001, 1011)) + list(range(8640, 8651))
    for p in ranges_to_scan:
        if p in COMMON_PORTS:
            continue
        if is_port_open(host, p, timeout=0.1):
            if verify_presenter_server(host, p, timeout=0.25):
                return p

    return None


def get_server_urls(host, port):
    """
    Constructs the target URLs for Scripture and Song browser sources.
    """
    return {
        "scripture": f"http://{host}:{port}{SCRIPTURE_PATH}",
        "song": f"http://{host}:{port}{SONG_PATH}",
        "control": f"http://{host}:{port}/",
        "song_control": f"http://{host}:{port}/song-control",
    }


# ==============================================================================
# OBS Scene & Browser Source Management
# ==============================================================================

def get_or_create_scene(scene_name):
    """
    Finds an existing OBS scene or creates a new one.
    Returns (scene, scene_source) or (None, None).
    Remember to call obs.obs_source_release(scene_source) when completely done.
    """
    if not IN_OBS:
        return None, None

    # Check if scene source already exists
    scene_source = obs.obs_get_source_by_name(scene_name)
    if scene_source is not None:
        scene = obs.obs_scene_from_source(scene_source)
        return scene, scene_source

    # Otherwise create a new scene
    scene = obs.obs_scene_create(scene_name)
    if scene is not None:
        scene_source = obs.obs_scene_get_source(scene)
        # obs_scene_get_source returns a borrowed or new ref; increment if needed
        # In OBS API obs_scene_create created the source with refcount 1.
        return scene, scene_source

    return None, None


def refresh_browser_source(source):
    """
    Calls the browser source's internal 'refresh' procedure to reload its page.
    """
    if not IN_OBS or source is None:
        return
    try:
        proc_handler = obs.obs_source_get_proc_handler(source)
        if proc_handler:
            cd = obs.calldata_create()
            obs.proc_handler_call(proc_handler, "refresh", cd)
            obs.calldata_destroy(cd)
    except Exception as e:
        print(f"[Presenter OBS] Error refreshing source: {e}")


def setup_browser_scene(scene_name, source_name, url, width, height, fps):
    """
    Ensures the specified scene exists and contains the configured browser source.
    If the source already exists, its URL and dimensions are updated.
    """
    if not IN_OBS:
        return False

    scene, scene_source = get_or_create_scene(scene_name)
    if scene is None:
        print(f"[Presenter OBS] Could not get or create scene: '{scene_name}'")
        return False

    try:
        # Check if browser source already exists
        source = obs.obs_get_source_by_name(source_name)
        if source is None:
            # Create new browser source
            s_data = obs.obs_data_create()
            obs.obs_data_set_string(s_data, "url", url)
            obs.obs_data_set_int(s_data, "width", width)
            obs.obs_data_set_int(s_data, "height", height)
            obs.obs_data_set_int(s_data, "fps", fps)
            # Ensure WebSocket does not disconnect when switching scenes
            obs.obs_data_set_bool(s_data, "restart_when_active", False)
            obs.obs_data_set_bool(s_data, "shutdown", False)
            obs.obs_data_set_string(s_data, "css", DEFAULT_CSS)

            source = obs.obs_source_create("browser_source", source_name, s_data, None)
            obs.obs_data_release(s_data)

            if source is not None:
                obs.obs_scene_add(scene, source)
                print(f"[Presenter OBS] Created '{source_name}' in scene '{scene_name}' -> {url}")
            else:
                print(f"[Presenter OBS] Failed to create browser source '{source_name}'")
        else:
            # Source exists: update its settings
            s_data = obs.obs_source_get_settings(source)
            current_url = obs.obs_data_get_string(s_data, "url")
            needs_update = False

            if current_url != url:
                obs.obs_data_set_string(s_data, "url", url)
                needs_update = True

            if obs.obs_data_get_int(s_data, "width") != width:
                obs.obs_data_set_int(s_data, "width", width)
                needs_update = True

            if obs.obs_data_get_int(s_data, "height") != height:
                obs.obs_data_set_int(s_data, "height", height)
                needs_update = True

            if obs.obs_data_get_int(s_data, "fps") != fps:
                obs.obs_data_set_int(s_data, "fps", fps)
                needs_update = True

            # Ensure background persistence
            if obs.obs_data_get_bool(s_data, "shutdown") is not False:
                obs.obs_data_set_bool(s_data, "shutdown", False)
                needs_update = True

            if needs_update:
                obs.obs_source_update(source, s_data)
                refresh_browser_source(source)
                print(f"[Presenter OBS] Updated '{source_name}' -> {url}")

            obs.obs_data_release(s_data)

            # Ensure source is linked inside this scene
            scene_item = obs.obs_scene_find_source(scene, source_name)
            if scene_item is None:
                obs.obs_scene_add(scene, source)
                print(f"[Presenter OBS] Added existing source '{source_name}' to scene '{scene_name}'")

        if source is not None:
            obs.obs_source_release(source)

        return True
    finally:
        if scene_source is not None:
            obs.obs_source_release(scene_source)


def update_source_url_if_present(source_name, new_url):
    """
    Updates the URL of an existing browser source anywhere in OBS without recreating it.
    """
    if not IN_OBS:
        return
    source = obs.obs_get_source_by_name(source_name)
    if source is not None:
        try:
            s_data = obs.obs_source_get_settings(source)
            current_url = obs.obs_data_get_string(s_data, "url")
            if current_url != new_url:
                obs.obs_data_set_string(s_data, "url", new_url)
                obs.obs_source_update(source, s_data)
                refresh_browser_source(source)
                print(f"[Presenter OBS] Auto-synced '{source_name}' URL to {new_url}")
            obs.obs_data_release(s_data)
        finally:
            obs.obs_source_release(source)


def refresh_all_presenter_sources():
    """
    Triggers a reload on both Scripture and Song browser sources.
    """
    if not IN_OBS:
        return
    for s_name in [SCRIPTURE_SOURCE_NAME, SONG_SOURCE_NAME]:
        src = obs.obs_get_source_by_name(s_name)
        if src is not None:
            refresh_browser_source(src)
            obs.obs_source_release(src)
            print(f"[Presenter OBS] Refreshed '{s_name}'")


def create_or_update_all_scenes():
    """
    Creates or updates both dedicated Presenter scenes with correct URLs.
    """
    urls = get_server_urls(state.host, state.port)
    ok_scripture = setup_browser_scene(
        SCRIPTURE_SCENE_NAME,
        SCRIPTURE_SOURCE_NAME,
        urls["scripture"],
        state.width,
        state.height,
        state.fps,
    )
    ok_song = setup_browser_scene(
        SONG_SCENE_NAME,
        SONG_SOURCE_NAME,
        urls["song"],
        state.width,
        state.height,
        state.fps,
    )
    return ok_scripture and ok_song


# ==============================================================================
# Auto-Detection Timer & Status Management
# ==============================================================================

def check_presenter_status():
    """
    Periodic check to test if Presenter is responding, or discover new port if changed.
    """
    current_port = state.port

    # First test if currently configured port is still alive
    if verify_presenter_server(state.host, current_port, timeout=0.2):
        if not state.is_connected or state.last_detected_port != current_port:
            state.is_connected = True
            state.last_detected_port = current_port
            state.status_message = f"🟢 Connected to Presenter at http://{state.host}:{current_port}"
            print(f"[Presenter OBS] {state.status_message}")
        return

    # If not alive and auto-detect is enabled, search for new port
    if state.auto_detect:
        new_port = scan_for_presenter_port(state.host)
        if new_port is not None:
            port_changed = (state.port != new_port)
            state.port = new_port
            state.last_detected_port = new_port
            state.is_connected = True
            state.status_message = f"🟢 Connected to Presenter at http://{state.host}:{new_port}"
            print(f"[Presenter OBS] Detected Presenter on port {new_port}")

            if port_changed and state.auto_update:
                urls = get_server_urls(state.host, new_port)
                update_source_url_if_present(SCRIPTURE_SOURCE_NAME, urls["scripture"])
                update_source_url_if_present(SONG_SOURCE_NAME, urls["song"])
                print(f"[Presenter OBS] Auto-updated browser sources to port {new_port}")
            return

    # Not found
    state.is_connected = False
    state.status_message = f"🔴 Presenter server not detected on {state.host} (Searching...)"


def timer_callback():
    """
    Called every few seconds by OBS timer.
    """
    try:
        check_presenter_status()
    except Exception as e:
        print(f"[Presenter OBS] Error in timer callback: {e}")


# ==============================================================================
# OBS Script Callbacks
# ==============================================================================

def script_description():
    return """
<h2>Presenter OBS Integration</h2>
<p>Automatically detects the Presenter server port and creates dedicated browser scenes for <b>Scripture Output</b> and <b>Song Output</b>.</p>
<ul>
  <li><b>Auto-Detect:</b> Automatically discovers port 1000, fallback 8642, or any custom port.</li>
  <li><b>Auto-Sync:</b> If the server restarts on another port, browser sources update automatically.</li>
  <li><b>Dedicated Scenes:</b> Generates <i>Presenter - Scripture</i> and <i>Presenter - Songs</i> with 1080p transparency.</li>
</ul>
<p><i>Click <b>'Create / Update Presenter Scenes'</b> below to add scenes to OBS.</i></p>
"""


def btn_scan_clicked(props, prop):
    """
    Handler for 'Scan / Detect Port Now' button.
    """
    print("[Presenter OBS] Manual port scan initiated...")
    found_port = scan_for_presenter_port(state.host)
    if found_port is not None:
        state.port = found_port
        state.is_connected = True
        state.last_detected_port = found_port
        state.status_message = f"🟢 Found Presenter at http://{state.host}:{found_port}"
        print(f"[Presenter OBS] Found Presenter on port {found_port}!")
        if state.auto_update:
            urls = get_server_urls(state.host, found_port)
            update_source_url_if_present(SCRIPTURE_SOURCE_NAME, urls["scripture"])
            update_source_url_if_present(SONG_SOURCE_NAME, urls["song"])
    else:
        state.is_connected = False
        state.status_message = f"🔴 No Presenter server found on {state.host}"
        print(f"[Presenter OBS] No Presenter server found on {state.host}")
    return True


def btn_setup_clicked(props, prop):
    """
    Handler for 'Create / Update Presenter Scenes' button.
    """
    print("[Presenter OBS] Creating/updating Presenter scenes & sources...")
    check_presenter_status()
    success = create_or_update_all_scenes()
    if success:
        print("[Presenter OBS] Successfully set up Presenter scenes!")
    else:
        print("[Presenter OBS] Error setting up scenes. Check OBS log for details.")
    return True


def btn_refresh_clicked(props, prop):
    """
    Handler for 'Refresh Browser Sources' button.
    """
    print("[Presenter OBS] Refreshing browser sources...")
    refresh_all_presenter_sources()
    return True


def script_properties():
    """
    Builds the UI properties panel inside OBS Studio Tools -> Scripts.
    """
    props = obs.obs_properties_create()

    # Connection Status Banner
    p_status = obs.obs_properties_add_text(
        props, "status_text", "Connection Status", obs.OBS_TEXT_INFO
    )

    # Server Configuration
    obs.obs_properties_add_bool(props, "auto_detect", "Auto-detect Server Port")
    obs.obs_properties_add_text(props, "host", "Server Host", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_int(props, "port", "Server Port", 1, 65535, 1)

    # Output Resolution & Framerate
    obs.obs_properties_add_int(props, "width", "Source Width (px)", 640, 3840, 1)
    obs.obs_properties_add_int(props, "height", "Source Height (px)", 360, 2160, 1)
    obs.obs_properties_add_int(props, "fps", "Source FPS", 15, 60, 1)

    # Auto sync URLs when port changes
    obs.obs_properties_add_bool(props, "auto_update", "Auto-update Browser Sources on Port Change")

    # Action Buttons
    obs.obs_properties_add_button(props, "btn_scan", "🔍 Scan / Detect Port Now", btn_scan_clicked)
    obs.obs_properties_add_button(props, "btn_setup", "🎬 Create / Update Presenter Scenes", btn_setup_clicked)
    obs.obs_properties_add_button(props, "btn_refresh", "🔄 Refresh Browser Sources", btn_refresh_clicked)

    return props


def script_defaults(settings):
    """
    Default settings applied when script is first added.
    """
    obs.obs_data_set_default_bool(settings, "auto_detect", True)
    obs.obs_data_set_default_string(settings, "host", DEFAULT_HOST)
    obs.obs_data_set_default_int(settings, "port", DEFAULT_PORT)
    obs.obs_data_set_default_int(settings, "width", DEFAULT_WIDTH)
    obs.obs_data_set_default_int(settings, "height", DEFAULT_HEIGHT)
    obs.obs_data_set_default_int(settings, "fps", DEFAULT_FPS)
    obs.obs_data_set_default_bool(settings, "auto_update", True)


def script_update(settings):
    """
    Called when script settings are modified in the OBS UI.
    """
    state.auto_detect = obs.obs_data_get_bool(settings, "auto_detect")
    state.host = obs.obs_data_get_string(settings, "host") or DEFAULT_HOST
    state.port = obs.obs_data_get_int(settings, "port") or DEFAULT_PORT
    state.width = obs.obs_data_get_int(settings, "width") or DEFAULT_WIDTH
    state.height = obs.obs_data_get_int(settings, "height") or DEFAULT_HEIGHT
    state.fps = obs.obs_data_get_int(settings, "fps") or DEFAULT_FPS
    state.auto_update = obs.obs_data_get_bool(settings, "auto_update")

    # If auto-detect is enabled, run initial check immediately
    if state.auto_detect:
        check_presenter_status()


def script_load(settings):
    """
    Called when the script is loaded into OBS Studio.
    """
    print("[Presenter OBS] Presenter OBS Integration Script loaded.")
    script_update(settings)

    # Register background timer: checks every 4000ms (4 seconds)
    if not state.timer_active:
        obs.timer_add(timer_callback, 4000)
        state.timer_active = True


def script_unload():
    """
    Called when the script is unloaded from OBS Studio.
    """
    if state.timer_active:
        obs.timer_remove(timer_callback)
        state.timer_active = False
    print("[Presenter OBS] Presenter OBS Integration Script unloaded.")


# ==============================================================================
# Standalone CLI Mode for Testing & Verification
# ==============================================================================

def main_cli():
    """
    Allows executing `python3 presenter_obs.py` from terminal to test port detection.
    """
    print("=" * 60)
    print(" Presenter OBS Integration - CLI Diagnostic & Discovery Tool")
    print("=" * 60)
    print(f"Scanning target host: {DEFAULT_HOST}...")

    port = scan_for_presenter_port(DEFAULT_HOST)
    if port:
        urls = get_server_urls(DEFAULT_HOST, port)
        print(f"\n[SUCCESS] Presenter server detected on port: {port}")
        print("-" * 60)
        print(f"  Scripture Output : {urls['scripture']}")
        print(f"  Song Output      : {urls['song']}")
        print(f"  Control Panel    : {urls['control']}")
        print(f"  Song Control     : {urls['song_control']}")
        print("-" * 60)
        print("\nScenes that will be created in OBS:")
        print(f"  1. Scene: '{SCRIPTURE_SCENE_NAME}'")
        print(f"     Source: '{SCRIPTURE_SOURCE_NAME}' ({urls['scripture']})")
        print(f"  2. Scene: '{SONG_SCENE_NAME}'")
        print(f"     Source: '{SONG_SOURCE_NAME}' ({urls['song']})")
        print("\nTo load into OBS Studio:")
        print("  1. In OBS Studio, go to Tools -> Scripts")
        print("  2. If Python is not configured, set Python path under 'Python Settings'")
        print(f"  3. On the 'Scripts' tab, click '+' and select this file:")
        print(f"     {os.path.abspath(__file__)}")
        print("  4. Click 'Create / Update Presenter Scenes'")
    else:
        print(f"\n[INFO] Presenter is not currently running on {DEFAULT_HOST}.")
        print("Start Presenter server with:")
        print("  bun run src/index.ts")
        print("Then rerun this script or load it into OBS.")

    print("=" * 60)


if __name__ == "__main__":
    if not IN_OBS:
        main_cli()
