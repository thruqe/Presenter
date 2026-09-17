import { dlopen, FFIType, ptr } from "bun:ffi";
import { Resvg } from "@resvg/resvg-js";
import { Transformer } from "@napi-rs/image";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

/**
 * NDI status report structure for API and UI consumers.
 */
export interface NdiStatus {
    available: boolean;
    version: string;
    sources: string[];
    browserRenderer: boolean;
    error: string | null;
    bufferStats?: { scriptureNonZero: number; songNonZero: number };
}

const WIDTH = 1920;
const HEIGHT = 1080;
const BYTES_PER_PIXEL = 4; // RGBA
const FRAME_BUFFER_SIZE = WIDTH * HEIGHT * BYTES_PER_PIXEL;

let ndiLib: any = null;
let scriptureSender: any = null;
let songSender: any = null;
let isNdiAvailable = false;
let ndiVersion = "";
let ndiError: string | null = null;
let isBrowserRendererActive = false;

// Active pixel buffers broadcast continuously to NDI (RGBA)
const scriptureBuffer = new Uint8Array(FRAME_BUFFER_SIZE);
const songBuffer = new Uint8Array(FRAME_BUFFER_SIZE);

// Interpolation / transition buffers
const scriptureFromBuffer = new Uint8Array(FRAME_BUFFER_SIZE);
const scriptureTargetBuffer = new Uint8Array(FRAME_BUFFER_SIZE);
const songFromBuffer = new Uint8Array(FRAME_BUFFER_SIZE);
const songTargetBuffer = new Uint8Array(FRAME_BUFFER_SIZE);
const emptyBuffer = new Uint8Array(FRAME_BUFFER_SIZE);

// Transition state tracking
let scriptureTransitioning = false;
let scriptureTransitionStart = 0;
let scriptureTransitionDuration = 350;

let songTransitioning = false;
let songTransitionStart = 0;
let songTransitionDuration = 350;

// Pre-allocated NDI video frame structures (72 bytes)
let scriptureFrameStruct: Uint8Array | null = null;
let songFrameStruct: Uint8Array | null = null;
let streamInterval: ReturnType<typeof setInterval> | null = null;

interface CdpClient {
    ws: WebSocket;
    send(method: string, params?: Record<string, unknown>): Promise<any>;
    close(): void;
}

// Headless Chrome CDP variables
let chromeProc: ChildProcess | null = null;
let chromeUserDataDir: string | null = null;
let scriptureCdp: CdpClient | null = null;
let songCdp: CdpClient | null = null;

/**
 * Locate NDI dynamic shared library across supported operating systems.
 */
function findNdiLibrary(): string | null {
    const platform = process.platform;
    const candidates: string[] = [];

    if (platform === "linux") {
        candidates.push(
            "/usr/local/lib/libndi.so.6",
            "/usr/local/lib/libndi.so",
            "/usr/lib/libndi.so.6",
            "/usr/lib/libndi.so",
            "/usr/lib/x86_64-linux-gnu/libndi.so.6",
            "/usr/lib/x86_64-linux-gnu/libndi.so",
            "libndi.so.6",
            "libndi.so"
        );
    } else if (platform === "win32") {
        if (process.env.NDI_RUNTIME_DIR_V6) {
            candidates.push(path.join(process.env.NDI_RUNTIME_DIR_V6, "Processing.NDI.Lib.x64.dll"));
        }
        if (process.env.ProgramFiles) {
            candidates.push(
                path.join(process.env.ProgramFiles, "NDI", "NDI 6 Runtime", "v6", "Processing.NDI.Lib.x64.dll"),
                path.join(process.env.ProgramFiles, "NDI", "NDI 6 SDK", "Bin", "x64", "Processing.NDI.Lib.x64.dll"),
                path.join(process.env.ProgramFiles, "NewTek", "NDI 5 Runtime", "v5", "Processing.NDI.Lib.x64.dll")
            );
        }
        candidates.push("Processing.NDI.Lib.x64.dll");
    } else if (platform === "darwin") {
        if (process.env.NDI_RUNTIME_DIR_V6) {
            candidates.push(path.join(process.env.NDI_RUNTIME_DIR_V6, "libndi.dylib"));
        }
        candidates.push(
            "/usr/local/lib/libndi.dylib",
            "/Library/NDI SDK for Apple/lib/macOS/libndi.dylib",
            "libndi.dylib"
        );
    }

    for (const c of candidates) {
        if (c.includes("/") || c.includes("\\")) {
            if (existsSync(c)) return c;
        } else {
            return c;
        }
    }
    return null;
}

/**
 * Locate Chrome / Chromium executable on host machine.
 */
function findBrowserExecutable(): string | null {
    const platform = process.platform;
    const candidates: string[] = [];

    if (platform === "linux") {
        candidates.push(
            "/usr/sbin/chromium-browser",
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/google-chrome",
            "/snap/bin/chromium",
            "/var/lib/flatpak/exports/bin/org.chromium.Chromium",
            "/usr/lib64/chromium-browser/chromium-browser",
            "/usr/lib64/chromium-browser/headless_shell"
        );
        for (const bin of ["chromium-browser", "chromium", "google-chrome-stable", "google-chrome"]) {
            try {
                const res = spawnSync("which", [bin], { encoding: "utf-8" });
                if (res.status === 0 && res.stdout.trim()) {
                    candidates.push(res.stdout.trim());
                }
            } catch {}
        }
    } else if (platform === "win32") {
        const pf = process.env.ProgramFiles || "C:\\Program Files";
        const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
        const local = process.env.LOCALAPPDATA || "";
        candidates.push(
            path.join(pf, "Google/Chrome/Application/chrome.exe"),
            path.join(pf86, "Google/Chrome/Application/chrome.exe"),
            path.join(local, "Google/Chrome/Application/chrome.exe"),
            path.join(pf, "Microsoft/Edge/Application/msedge.exe"),
            path.join(pf86, "Microsoft/Edge/Application/msedge.exe"),
            path.join(local, "Microsoft/Edge/Application/msedge.exe")
        );
        for (const bin of ["chrome.exe", "msedge.exe", "chromium.exe"]) {
            try {
                const res = spawnSync("where", [bin], { encoding: "utf-8" });
                if (res.status === 0 && res.stdout.trim()) {
                    const first = res.stdout.trim().split(/\r?\n/)[0];
                    if (first) candidates.push(first);
                }
            } catch {}
        }
    } else if (platform === "darwin") {
        candidates.push(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
        );
    }

    for (const c of candidates) {
        if (existsSync(c)) return c;
    }
    return null;
}

/**
 * Construct 72-byte NDIlib_video_frame_v2_t structure pointing to a pixel buffer.
 */
function createFrameStruct(pixelBuffer: Uint8Array): Uint8Array {
    const struct = new Uint8Array(72);
    const view = new DataView(struct.buffer);
    view.setInt32(0, WIDTH, true);                     // xres
    view.setInt32(4, HEIGHT, true);                    // yres
    view.setUint32(8, 0x41424752, true);               // FourCC = RGBA
    view.setInt32(12, 30, true);                       // frame_rate_N (30 fps)
    view.setInt32(16, 1, true);                        // frame_rate_D
    view.setFloat32(20, 16.0 / 9.0, true);             // picture_aspect_ratio
    view.setInt32(24, 1, true);                        // frame_format_type (progressive)
    view.setBigInt64(32, 0n, true);                    // timecode
    view.setBigUint64(40, BigInt(ptr(pixelBuffer)), true); // p_data
    view.setInt32(48, WIDTH * BYTES_PER_PIXEL, true);  // line_stride_in_bytes
    view.setBigUint64(56, 0n, true);                   // p_metadata
    view.setBigInt64(64, 0n, true);                    // timestamp
    return struct;
}

/**
 * Create an NDI sender instance with the specified broadcast name.
 */
function createNdiSender(name: string): any {
    const settings = new Uint8Array(24);
    const view = new DataView(settings.buffer);
    const nameBuf = Buffer.from(name + "\0");
    view.setBigUint64(0, BigInt(ptr(nameBuf)), true);
    view.setBigUint64(8, 0n, true); // p_groups = null
    view.setUint8(16, 0);           // clock_video = false (non-blocking)
    view.setUint8(17, 0);           // clock_audio = false
    return ndiLib.symbols.NDIlib_send_create(ptr(settings));
}

/**
 * Smooth cubic easeInOut blending between two RGBA buffers.
 */
function blendBuffers(from: Uint8Array, to: Uint8Array, out: Uint8Array, progress: number): void {
    const t = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    const invT = 1 - t;
    const len = out.length;

    for (let i = 0; i < len; i += 4) {
        const fromA = from[i + 3] ?? 0;
        const toA = to[i + 3] ?? 0;

        if (fromA === 0 && toA === 0) {
            out[i] = 0;
            out[i + 1] = 0;
            out[i + 2] = 0;
            out[i + 3] = 0;
            continue;
        }

        out[i] = (((from[i] ?? 0) * invT + (to[i] ?? 0) * t)) | 0;
        out[i + 1] = (((from[i + 1] ?? 0) * invT + (to[i + 1] ?? 0) * t)) | 0;
        out[i + 2] = (((from[i + 2] ?? 0) * invT + (to[i + 2] ?? 0) * t)) | 0;
        out[i + 3] = ((fromA * invT + toA * t)) | 0;
    }
}

/**
 * Start smooth alpha transition for scripture NDI feed.
 */
function startScriptureTransition(target: Uint8Array, duration = 350): void {
    scriptureFromBuffer.set(scriptureBuffer);
    if (target !== scriptureTargetBuffer) {
        scriptureTargetBuffer.set(target);
    }
    scriptureTransitionDuration = duration;
    scriptureTransitionStart = performance.now();
    scriptureTransitioning = true;
}

/**
 * Start smooth alpha transition for song NDI feed.
 */
function startSongTransition(target: Uint8Array, duration = 350): void {
    songFromBuffer.set(songBuffer);
    if (target !== songTargetBuffer) {
        songTargetBuffer.set(target);
    }
    songTransitionDuration = duration;
    songTransitionStart = performance.now();
    songTransitioning = true;
}

/**
 * Establish direct 1-to-1 CDP WebSocket client to a specific target page.
 */
function createCdpClient(name: string, url: string): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
        let ws: WebSocket;
        try {
            ws = new WebSocket(url);
        } catch (e) {
            return reject(e);
        }

        let msgId = 1;
        const pending = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void; timeout: ReturnType<typeof setTimeout> }>();

        const connectTimeout = setTimeout(() => {
            reject(new Error(`[NDI ${name}] WebSocket connection timed out to ${url}`));
        }, 6000);

        ws.onopen = () => {
            clearTimeout(connectTimeout);
            resolve({
                ws,
                send(method: string, params: Record<string, unknown> = {}): Promise<any> {
                    return new Promise((res, rej) => {
                        if (ws.readyState !== WebSocket.OPEN) {
                            return rej(new Error(`[NDI ${name}] WebSocket not open (state=${ws.readyState})`));
                        }
                        const id = msgId++;
                        const timeout = setTimeout(() => {
                            pending.delete(id);
                            rej(new Error(`[NDI ${name}] CDP ${method} timed out`));
                        }, 6000);

                        pending.set(id, { resolve: res, reject: rej, timeout });
                        ws.send(JSON.stringify({ id, method, params }));
                    });
                },
                close() {
                    try {
                        ws.close();
                    } catch {}
                }
            });
        };

        ws.onerror = (err) => {
            clearTimeout(connectTimeout);
            reject(err);
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(String(event.data));
                if (typeof data.id === "number" && pending.has(data.id)) {
                    const entry = pending.get(data.id)!;
                    pending.delete(data.id);
                    clearTimeout(entry.timeout);
                    if (data.error) {
                        entry.reject(new Error(data.error.message || JSON.stringify(data.error)));
                    } else {
                        entry.resolve(data.result);
                    }
                }
            } catch {}
        };
    });
}

/**
 * Capture rendered screenshot from Scripture page in headless Chrome.
 */
async function captureScriptureScreenshot(): Promise<boolean> {
    if (!scriptureCdp) return false;
    try {
        await scriptureCdp.send("Page.bringToFront");
        const res = await scriptureCdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
        if (res && res.data) {
            const buf = Buffer.from(res.data, "base64");
            const transformer = new Transformer(buf);
            const raw = await transformer.rawPixels();
            scriptureTargetBuffer.set(raw);
            startScriptureTransition(scriptureTargetBuffer);
            return true;
        }
    } catch (err) {
        console.error("[NDI] Error capturing scripture screenshot:", err);
    }
    return false;
}

/**
 * Capture rendered screenshot from Song page in headless Chrome.
 */
async function captureSongScreenshot(): Promise<boolean> {
    if (!songCdp) return false;
    try {
        await songCdp.send("Page.bringToFront");
        const res = await songCdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
        if (res && res.data) {
            const buf = Buffer.from(res.data, "base64");
            const transformer = new Transformer(buf);
            const raw = await transformer.rawPixels();
            songTargetBuffer.set(raw);
            startSongTransition(songTargetBuffer);
            return true;
        }
    } catch (err) {
        console.error("[NDI] Error capturing song screenshot:", err);
    }
    return false;
}

/**
 * Initialize headless Chrome instance for exact browser output rendering.
 */
async function initHeadlessBrowser(port: number): Promise<boolean> {
    const browserBin = findBrowserExecutable();
    if (!browserBin) {
        console.warn("[NDI] No Chrome/Chromium executable found; using high-fidelity vector fallback.");
        return false;
    }

    try {
        chromeUserDataDir = mkdtempSync(path.join(tmpdir(), "presenter-chrome-"));
        chromeProc = spawn(browserBin, [
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--run-all-compositor-stages-before-draw",
            "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            "--disable-backgrounding-occluded-windows",
            `--user-data-dir=${chromeUserDataDir}`,
            "--remote-debugging-port=0",
            "about:blank"
        ], { stdio: "ignore" });

        const devtoolsFile = path.join(chromeUserDataDir, "DevToolsActivePort");
        let cdpPort = 0;

        for (let i = 0; i < 50; i++) {
            await Bun.sleep(100);
            try {
                if (existsSync(devtoolsFile)) {
                    const content = readFileSync(devtoolsFile, "utf-8").trim().split("\n");
                    if (content.length >= 2) {
                        const p = parseInt(content[0] ?? "", 10);
                        if (!isNaN(p) && p > 0) {
                            cdpPort = p;
                            break;
                        }
                    }
                }
            } catch {}
        }

        if (!cdpPort) {
            throw new Error("Could not detect Chrome DevTools port");
        }

        // Create Scripture and Song output tabs via Chrome HTTP JSON API
        const sTargetRes = await fetch(`http://127.0.0.1:${cdpPort}/json/new?http://127.0.0.1:${port}/output?ndi=1`, { method: "PUT" });
        const sTargetData = await sTargetRes.json() as { webSocketDebuggerUrl?: string };

        const songTargetRes = await fetch(`http://127.0.0.1:${cdpPort}/json/new?http://127.0.0.1:${port}/song?ndi=1`, { method: "PUT" });
        const songTargetData = await songTargetRes.json() as { webSocketDebuggerUrl?: string };

        if (!sTargetData?.webSocketDebuggerUrl || !songTargetData?.webSocketDebuggerUrl) {
            throw new Error("Failed to retrieve WebSocket debugger URLs for pages");
        }

        scriptureCdp = await createCdpClient("Scripture", sTargetData.webSocketDebuggerUrl);
        songCdp = await createCdpClient("Song", songTargetData.webSocketDebuggerUrl);

        // Configure transparent background override and standard 1080p metrics
        await Promise.all([
            scriptureCdp.send("Page.enable"),
            scriptureCdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } }),
            scriptureCdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }),
            songCdp.send("Page.enable"),
            songCdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } }),
            songCdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }),
        ]);

        isBrowserRendererActive = true;
        console.log(`[NDI] Headless browser renderer initialized (pages connected on port ${cdpPort})`);
        return true;
    } catch (err) {
        console.error("[NDI] Failed to initialize headless browser; falling back to SVG vector renderer:", err);
        isBrowserRendererActive = false;
        return false;
    }
}

/**
 * Fallback XML escape helper for safe SVG generation.
 */
function escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case "<": return "&lt;";
            case ">": return "&gt;";
            case "&": return "&amp;";
            case "'": return "&apos;";
            case '"': return "&quot;";
            default: return c;
        }
    });
}

/**
 * Fallback word wrap text into balanced lines for screen display.
 */
function wrapText(text: string, maxCharsPerLine = 44): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let currentLine = "";
    for (const word of words) {
        if ((currentLine + " " + word).trim().length > maxCharsPerLine) {
            if (currentLine) lines.push(currentLine.trim());
            currentLine = word;
        } else {
            currentLine = (currentLine + " " + word).trim();
        }
    }
    if (currentLine) lines.push(currentLine.trim());
    return lines;
}

/**
 * Vector SVG fallback rendering for Scripture verse.
 */
function renderScriptureFallback(book: string, chapter: number, verse: number, text: string): void {
    const lines = wrapText(text, 46);
    const ref = `${book} ${chapter}:${verse}`;

    const fontSize = lines.length > 5 ? 38 : lines.length > 3 ? 46 : 56;
    const lineHeight = fontSize * 1.36;
    const refFontSize = Math.max(28, Math.floor(fontSize * 0.68));
    const totalHeight = lines.length * lineHeight + refFontSize + 40;
    const startY = Math.max(120, (HEIGHT - totalHeight) / 2 + fontSize);

    const tspans = lines
        .map((l, i) => `<tspan x="960" y="${startY + i * lineHeight}">${escapeXml(l)}</tspan>`)
        .join("");
    const refY = startY + (lines.length - 1) * lineHeight + refFontSize + 36;

    const svg = `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="3" stdDeviation="7" flood-color="black" flood-opacity="0.95"/>
          <feDropShadow dx="0" dy="1" stdDeviation="3" flood-color="black" flood-opacity="0.8"/>
        </filter>
      </defs>
      <text filter="url(#shadow)" x="960" font-family="'ChurchSerif', 'Book Antiqua', 'Palatino Linotype', 'Georgia', 'Liberation Serif', 'Noto Serif', serif" font-size="${fontSize}" font-weight="bold" fill="white" text-anchor="middle">
        ${tspans}
      </text>
      <text filter="url(#shadow)" x="960" y="${refY}" font-family="'ChurchSerif', 'Book Antiqua', 'Palatino Linotype', 'Georgia', 'Liberation Serif', 'Noto Serif', serif" font-size="${refFontSize}" font-weight="bold" fill="#e8d9a0" text-anchor="middle">
        ${escapeXml(ref)}
      </text>
    </svg>`;

    try {
        const resvg = new Resvg(svg);
        const image = resvg.render();
        scriptureTargetBuffer.set(image.pixels);
        startScriptureTransition(scriptureTargetBuffer);
    } catch (err) {
        console.error("[NDI] Error rendering fallback scripture frame:", err);
    }
}

/**
 * Vector SVG fallback rendering for Song lyrics.
 */
function renderSongFallback(mode: string, text: string): void {
    const rawLines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!rawLines.length) {
        startSongTransition(emptyBuffer, 300);
        return;
    }

    if (mode === "lower") {
        // In lower-third mode: collapse all newlines into single spaces (matching HTML white-space: normal),
        // let text flow on a single straight line, and only word wrap when hitting the screen edge margins.
        const continuous = text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
        if (!continuous) {
            startSongTransition(emptyBuffer, 300);
            return;
        }

        const lines = wrapText(continuous, 56);
        const fontSize = lines.length > 3 ? 42 : lines.length > 2 ? 48 : 58;
        const lineHeight = fontSize * 1.38;
        const bottomY = HEIGHT - 52;
        const startY = bottomY - (lines.length - 1) * lineHeight;

        const tspans = lines
            .map((l, i) => `<tspan x="960" y="${startY + i * lineHeight}">${escapeXml(l)}</tspan>`)
            .join("");

        const svg = `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="3" stdDeviation="8" flood-color="black" flood-opacity="0.95"/>
              <feDropShadow dx="0" dy="1" stdDeviation="3" flood-color="black" flood-opacity="0.8"/>
            </filter>
          </defs>
          <text filter="url(#shadow)" x="960" font-family="'ChurchSerif', 'Book Antiqua', 'Palatino Linotype', 'Georgia', 'Liberation Serif', 'Noto Serif', serif" font-size="${fontSize}" font-weight="bold" fill="white" text-anchor="middle">
            ${tspans}
          </text>
        </svg>`;

        try {
            const resvg = new Resvg(svg);
            const image = resvg.render();
            songTargetBuffer.set(image.pixels);
            startSongTransition(songTargetBuffer);
        } catch (err) {
            console.error("[NDI] Error rendering fallback song lower frame:", err);
        }
    } else {
        const fontSize = rawLines.length > 6 ? 36 : rawLines.length > 4 ? 44 : 54;
        const lineHeight = fontSize * 1.38;
        const totalHeight = rawLines.length * lineHeight;
        const startY = (HEIGHT - totalHeight) / 2 + fontSize * 0.85;

        const tspans = rawLines
            .map((l, i) => `<tspan x="960" y="${startY + i * lineHeight}">${escapeXml(l)}</tspan>`)
            .join("");

        const svg = `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="black" flood-opacity="0.95"/>
            </filter>
          </defs>
          <text filter="url(#shadow)" x="960" font-family="'ChurchSerif', 'Book Antiqua', 'Palatino Linotype', 'Georgia', 'Liberation Serif', 'Noto Serif', serif" font-size="${fontSize}" font-weight="bold" fill="white" text-anchor="middle">
            ${tspans}
          </text>
        </svg>`;

        try {
            const resvg = new Resvg(svg);
            const image = resvg.render();
            songTargetBuffer.set(image.pixels);
            startSongTransition(songTargetBuffer);
        } catch (err) {
            console.error("[NDI] Error rendering fallback song background frame:", err);
        }
    }
}

/**
 * Handle incoming scripture WebSocket message.
 */
export function onScriptureUpdate(data: Record<string, unknown>): void {
    if (!isNdiAvailable) return;

    if (data.type === "clear") {
        startScriptureTransition(emptyBuffer, 300);
        return;
    }

    const book = typeof data.book === "string" ? data.book : "";
    const chapter = typeof data.chapter === "number" ? data.chapter : 0;
    const verse = typeof data.verse === "number" ? data.verse : 0;
    const text = typeof data.text === "string" ? data.text : "";

    if (!text) return;

    if (isBrowserRendererActive) {
        setTimeout(async () => {
            const ok = await captureScriptureScreenshot();
            if (!ok) {
                renderScriptureFallback(book, chapter, verse, text);
            }
        }, 100);
        return;
    }

    // Vector fallback path
    renderScriptureFallback(book, chapter, verse, text);
}

/**
 * Handle incoming song WebSocket message.
 */
export function onSongUpdate(data: Record<string, unknown>): void {
    if (!isNdiAvailable) return;

    if (data.type === "clear") {
        startSongTransition(emptyBuffer, 300);
        return;
    }

    const mode = typeof data.mode === "string" ? data.mode : "lower";
    const text = typeof data.text === "string" ? data.text : "";

    if (!text) return;

    if (isBrowserRendererActive) {
        setTimeout(async () => {
            const ok = await captureSongScreenshot();
            if (!ok) {
                renderSongFallback(mode, text);
            }
        }, 100);
        return;
    }

    renderSongFallback(mode, text);
}

/**
 * Query current NDI engine status.
 */
export function getNdiStatus(): NdiStatus {
    return {
        available: isNdiAvailable,
        version: ndiVersion,
        sources: isNdiAvailable ? ["Presenter - Scripture", "Presenter - Songs"] : [],
        browserRenderer: isBrowserRendererActive,
        error: ndiError,
        bufferStats: getBufferStats(),
    };
}

/**
 * Return non-zero alpha pixel counts in active NDI frame buffers (for diagnostics and testing).
 */
export function getBufferStats(): { scriptureNonZero: number; songNonZero: number } {
    let sCount = 0;
    let songCount = 0;
    for (let i = 3; i < scriptureBuffer.length; i += 4) {
        if (scriptureBuffer[i]! > 0) sCount++;
    }
    for (let i = 3; i < songBuffer.length; i += 4) {
        if (songBuffer[i]! > 0) songCount++;
    }
    return { scriptureNonZero: sCount, songNonZero: songCount };
}

/**
 * Initialize NDI runtime library, create video senders, start browser renderer and streaming loop.
 */
export async function initNdi(port = 1000): Promise<boolean> {
    const libPath = findNdiLibrary();
    if (!libPath) {
        ndiError = "NDI runtime library not found on system";
        isNdiAvailable = false;
        return false;
    }

    try {
        ndiLib = dlopen(libPath, {
            NDIlib_initialize: { args: [], returns: FFIType.bool },
            NDIlib_destroy: { args: [], returns: FFIType.void },
            NDIlib_version: { args: [], returns: FFIType.cstring },
            NDIlib_send_create: { args: [FFIType.ptr], returns: FFIType.ptr },
            NDIlib_send_destroy: { args: [FFIType.ptr], returns: FFIType.void },
            NDIlib_send_send_video_v2: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },
        });

        const initialized = ndiLib.symbols.NDIlib_initialize();
        if (!initialized) {
            ndiError = "NDIlib_initialize() returned false";
            isNdiAvailable = false;
            return false;
        }

        try {
            ndiVersion = String(ndiLib.symbols.NDIlib_version() ?? "NDI v6");
        } catch {
            ndiVersion = "NDI SDK";
        }

        scriptureSender = createNdiSender("Presenter - Scripture");
        songSender = createNdiSender("Presenter - Songs");

        if (!scriptureSender || !songSender) {
            ndiError = "Failed to create NDI senders";
            isNdiAvailable = false;
            return false;
        }

        scriptureFrameStruct = createFrameStruct(scriptureBuffer);
        songFrameStruct = createFrameStruct(songBuffer);

        // Continuous 30fps video stream loop with smooth cubic easeInOut transition interpolation
        streamInterval = setInterval(() => {
            if (!ndiLib || !scriptureSender || !songSender || !scriptureFrameStruct || !songFrameStruct) return;

            const now = performance.now();

            if (scriptureTransitioning) {
                const elapsed = now - scriptureTransitionStart;
                const progress = Math.min(1.0, elapsed / scriptureTransitionDuration);
                blendBuffers(scriptureFromBuffer, scriptureTargetBuffer, scriptureBuffer, progress);
                if (progress >= 1.0) {
                    scriptureTransitioning = false;
                    scriptureBuffer.set(scriptureTargetBuffer);
                }
            }

            if (songTransitioning) {
                const elapsed = now - songTransitionStart;
                const progress = Math.min(1.0, elapsed / songTransitionDuration);
                blendBuffers(songFromBuffer, songTargetBuffer, songBuffer, progress);
                if (progress >= 1.0) {
                    songTransitioning = false;
                    songBuffer.set(songTargetBuffer);
                }
            }

            ndiLib.symbols.NDIlib_send_send_video_v2(scriptureSender, ptr(scriptureFrameStruct));
            ndiLib.symbols.NDIlib_send_send_video_v2(songSender, ptr(songFrameStruct));
        }, 33);

        isNdiAvailable = true;
        ndiError = null;

        // Initialize headless browser for 1:1 OBS Browser Source fidelity
        await initHeadlessBrowser(port);

        return true;
    } catch (err: any) {
        ndiError = err?.message || String(err);
        isNdiAvailable = false;
        return false;
    }
}

/**
 * Gracefully terminate NDI senders, headless browser, and destroy NDI library on shutdown.
 */
export function shutdownNdi(): void {
    if (streamInterval) {
        clearInterval(streamInterval);
        streamInterval = null;
    }

    if (scriptureCdp) {
        scriptureCdp.close();
        scriptureCdp = null;
    }

    if (songCdp) {
        songCdp.close();
        songCdp = null;
    }

    if (chromeProc) {
        try {
            chromeProc.kill();
        } catch {}
        chromeProc = null;
    }

    if (chromeUserDataDir) {
        try {
            rmSync(chromeUserDataDir, { recursive: true, force: true });
        } catch {}
        chromeUserDataDir = null;
    }

    if (ndiLib) {
        try {
            if (scriptureSender) ndiLib.symbols.NDIlib_send_destroy(scriptureSender);
            if (songSender) ndiLib.symbols.NDIlib_send_destroy(songSender);
            ndiLib.symbols.NDIlib_destroy();
        } catch {}
    }
    isNdiAvailable = false;
}
