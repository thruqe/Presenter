import type { ServerWebSocket } from "bun";
import { networkInterfaces } from "os";
import { logServerStart, logRequest } from "./logger";
import {
    parseRef,
    getFullChapterVerses,
    findBooks,
    searchFuzzyVerses,
    getSingleVerse,
} from "./scripture";
import {
    listSongs,
    insertSong,
    insertSection,
    insertLine,
    getFullSong,
    updateSong,
    removeSong,
} from "./songs";
import {
    handleWsOpen,
    handleWsClose,
    handleWsMessage,
    getLastVerse,
    getLastSong,
} from "./ws";
import { initNdi, getNdiStatus, shutdownNdi } from "./ndi";
import type { CreateSongInput, BookSearchResult } from "./types";
import QRCode from "qrcode";

const PREFERRED_PORT = Number(process.env.PORT) || 1000;
let activePort = PREFERRED_PORT;
let lanIp: string | null = null;

/**
 * Determine the machine's LAN-facing IPv4 address so other devices on the
 * same network can reach this server, ignoring VPNs and virtual interfaces.
 *
 * @returns The physical LAN IPv4 address found, or null if none exists.
 */
function getLocalIp(): string | null {
    const nets = networkInterfaces();
    const fallbackCandidates: string[] = [];

    // Common virtual interface naming patterns on Windows, Linux, and macOS
    const virtualPattern = /cloudflare|warp|wsl|vEthernet|docker|hyper-v|tailscale|loopback|tap|tun/i;

    for (const name of Object.keys(nets)) {
        if (virtualPattern.test(name)) continue;

        for (const net of nets[name] ?? []) {
            // IPv4 only, non-internal
            if (net.family === "IPv4" && !net.internal) {
                // Ignore Cloudflare's virtual/tunnel subnet
                if (net.address.startsWith("172.16.")) continue;

                // Priority: Standard local subnets (Wi-Fi / Ethernet LAN)
                if (net.address.startsWith("192.168.") || net.address.startsWith("10.")) {
                    return net.address;
                }

                fallbackCandidates.push(net.address);
            }
        }
    }

    return fallbackCandidates[0] ?? null;
}

/**
 * Main application HTTP web server request router.
 *
 * @param req Incoming HTTP request object
 * @param server Active Bun server instance
 * @returns HTTP response object or undefined if upgraded to WebSocket
 */
async function handleFetch(req: Request, server: Bun.Server<unknown>): Promise<Response | undefined> {
    const url = new URL(req.url);
    const path = url.pathname;

    // WebSocket upgrade route
    if (path === "/ws") {
        if (server.upgrade(req, { data: undefined })) {
            return undefined;
        }
        logRequest(req.method, path, 500);
        return new Response("Upgrade failed", { status: 500 });
    }

    let response: Response;

    // Static HTML page routes
    if (path === "/") {
        response = new Response(Bun.file("public/control.html"));
    } else if (path === "/output") {
        response = new Response(Bun.file("public/output.html"));
    } else if (path === "/image.png") {
        response = new Response(Bun.file("public/image.png"));
    } else if (path === "/favicon.ico") {
        response = new Response(Bun.file("public/favicon.ico"));
    } else if (path === "/icon.png") {
        response = new Response(Bun.file("public/icon.png"));
    } else if (path === "/song") {
        response = new Response(Bun.file("public/song-output.html"));
    } else if (path === "/song-control") {
        response = new Response(Bun.file("public/song-control.html"));
    } else if (path === "/qr") {
        response = Response.redirect("/#qr", 302);
    } else if (path.startsWith("/fonts/")) {
        response = new Response(Bun.file("public" + path));
    }
    // Scripture search endpoint
    else if (path === "/api/search") {
        const queryParam = url.searchParams.get("q");
        const query = queryParam ? queryParam.trim() : "";

        if (query.length < 1) {
            response = Response.json([]);
        } else {
            const ref = parseRef(query);
            let chapterVerses = ref !== null ? getFullChapterVerses(ref.book, ref.chapter) : [];

            if (chapterVerses.length > 0) {
                response = Response.json(chapterVerses);
            } else {
                const books = findBooks(query);
                if (books.length > 0) {
                    const result: BookSearchResult[] = books.map((b) => ({
                        type: "book",
                        name: b.name,
                    }));
                    response = Response.json(result);
                } else {
                    const searchResults = searchFuzzyVerses(query);
                    response = Response.json(searchResults);
                }
            }
        }
    }
    // Single verse retrieval endpoint
    else if (path === "/api/verse") {
        const bookParam = url.searchParams.get("book");
        const chapterParam = url.searchParams.get("chapter");
        const verseParam = url.searchParams.get("verse");

        if (bookParam === null || chapterParam === null || verseParam === null) {
            response = Response.json({});
        } else {
            const chapterNum = parseInt(chapterParam, 10);
            const verseNum = parseInt(verseParam, 10);

            if (isNaN(chapterNum) || isNaN(verseNum)) {
                response = Response.json({});
            } else {
                const verseRecord = getSingleVerse(bookParam, chapterNum, verseNum);
                response = Response.json(verseRecord ?? {});
            }
        }
    }
    // Songs listing & creation endpoint
    else if (path === "/api/songs") {
        if (req.method === "GET") {
            response = Response.json(listSongs.all());
        } else if (req.method === "POST") {
            try {
                const body = (await req.json()) as Partial<CreateSongInput>;
                const title = typeof body.title === "string" ? body.title : "";
                const displayMode = typeof body.display_mode === "string" ? body.display_mode : "lower";
                const sections = Array.isArray(body.sections) ? body.sections : [];

                const songRow = insertSong.get(title, displayMode);
                const songId = songRow ? songRow.id : 0;

                sections.forEach((sec, i) => {
                    const label = typeof sec.label === "string" ? sec.label : "";
                    const lines = Array.isArray(sec.lines) ? sec.lines : [];

                    const secRow = insertSection.get(songId, label, i);
                    const secId = secRow ? secRow.id : 0;

                    lines.forEach((line, j) => {
                        const lineText = typeof line === "string" ? line : "";
                        insertLine.run(secId, lineText, j);
                    });
                });

                response = Response.json({ id: songId });
            } catch {
                response = new Response("Invalid JSON payload", { status: 400 });
            }
        } else {
            response = new Response("Method not allowed", { status: 405 });
        }
    }
    // NDI streaming status endpoint
    else if (path === "/api/ndi/status") {
        response = Response.json(getNdiStatus());
    }
    // Live output status endpoint for both channels
    else if (path === "/api/output/status") {
        const lastV = getLastVerse();
        const lastS = getLastSong();
        let scriptureData = null;
        let songData = null;
        try { if (lastV) scriptureData = JSON.parse(lastV); } catch {}
        try { if (lastS) songData = JSON.parse(lastS); } catch {}
        response = Response.json({
            scripture: scriptureData,
            song: songData,
        });
    }
    // Network information & QR code generation endpoint
    else if (path === "/api/network") {
        const targetPath = url.searchParams.get("path") || "/";
        const cleanPath = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
        const host = lanIp || "localhost";
        const networkUrl = `http://${host}:${activePort}${cleanPath}`;
        const localUrl = `http://localhost:${activePort}${cleanPath}`;

        let qrSvg = "";
        try {
            qrSvg = await QRCode.toString(networkUrl, {
                type: "svg",
                margin: 2,
                color: {
                    dark: "#000000",
                    light: "#ffffff",
                },
            });
        } catch (e) {
            console.error("Failed to generate QR code SVG:", e);
        }

        response = Response.json({
            lanIp,
            port: activePort,
            hasLan: lanIp !== null,
            targetPath: cleanPath,
            targetUrl: networkUrl,
            localUrl,
            qrSvg,
            urls: {
                control: `http://${host}:${activePort}/`,
                songControl: `http://${host}:${activePort}/song-control`,
                scriptureOutput: `http://${host}:${activePort}/output`,
                songOutput: `http://${host}:${activePort}/song`,
            },
        });
    }
    // Direct QR SVG output route for image tags
    else if (path === "/api/qr") {
        const targetPath = url.searchParams.get("path") || "/";
        const cleanPath = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
        const host = lanIp || "localhost";
        const networkUrl = `http://${host}:${activePort}${cleanPath}`;

        try {
            const qrSvg = await QRCode.toString(networkUrl, {
                type: "svg",
                margin: 2,
                color: {
                    dark: "#000000",
                    light: "#ffffff",
                },
            });
            response = new Response(qrSvg, {
                headers: {
                    "Content-Type": "image/svg+xml",
                    "Cache-Control": "no-cache",
                },
            });
        } catch {
            response = new Response("Failed to generate QR code", { status: 500 });
        }
    }
    // Individual song endpoint matching /api/songs/:id
    else {
        const songMatch = path.match(/^\/api\/songs\/(\d+)$/);
        if (songMatch !== null && songMatch[1] !== undefined) {
            const songId = parseInt(songMatch[1], 10);
            if (isNaN(songId)) {
                response = new Response("Invalid song ID", { status: 400 });
            } else if (req.method === "GET") {
                const song = getFullSong(songId);
                response = Response.json(song ?? {});
            } else if (req.method === "PUT") {
                try {
                    const body = (await req.json()) as Partial<CreateSongInput>;
                    const title = typeof body.title === "string" ? body.title : "";
                    const displayMode = typeof body.display_mode === "string" ? body.display_mode : "lower";
                    const sections = Array.isArray(body.sections) ? body.sections : [];

                    const success = updateSong(songId, {
                        title,
                        display_mode: displayMode,
                        sections,
                    });

                    if (success) {
                        response = Response.json({ ok: true, id: songId });
                    } else {
                        response = new Response("Song not found", { status: 404 });
                    }
                } catch {
                    response = new Response("Invalid JSON payload", { status: 400 });
                }
            } else if (req.method === "DELETE") {
                removeSong(songId);
                response = Response.json({ ok: true });
            } else {
                response = new Response("Method not allowed", { status: 405 });
            }
        } else {
            response = new Response("Not found", { status: 404 });
        }
    }

    logRequest(req.method, path, response.status);
    return response;
}

/**
 * Initialize Bun server instance and configure routes + web sockets.
 */
let server: Bun.Server<unknown>;
try {
    server = Bun.serve({
        port: PREFERRED_PORT,
        hostname: "0.0.0.0",
        fetch(req, srv) {
            return handleFetch(req, srv);
        },
        websocket: {
            open(ws: ServerWebSocket<unknown>) {
                handleWsOpen(ws);
            },
            close(ws: ServerWebSocket<unknown>) {
                handleWsClose(ws);
            },
            message(ws: ServerWebSocket<unknown>, message: string | Buffer) {
                handleWsMessage(ws, message);
            },
        },
    });
} catch (err: any) {
    if (err?.code === "EACCES" && PREFERRED_PORT < 1024) {
        console.warn(
            `\x1b[33m[Warning] Binding to port ${PREFERRED_PORT} requires root privileges on Linux.\x1b[0m\n` +
            `\x1b[33mFalling back to port 8642. (To run on port ${PREFERRED_PORT}, run with sudo or set unprivileged_port_start).\x1b[0m`
        );
        server = Bun.serve({
            port: 8642,
            hostname: "0.0.0.0",
            fetch(req, srv) {
                return handleFetch(req, srv);
            },
            websocket: {
                open(ws: ServerWebSocket<unknown>) {
                    handleWsOpen(ws);
                },
                close(ws: ServerWebSocket<unknown>) {
                    handleWsClose(ws);
                },
                message(ws: ServerWebSocket<unknown>, message: string | Buffer) {
                    handleWsMessage(ws, message);
                },
            },
        });
    } else {
        throw err;
    }
}

activePort = server.port ?? PREFERRED_PORT;
lanIp = getLocalIp();

// Initialize NDI video streaming engine for Scripture and Song outputs
await initNdi(activePort);
const ndiStatus = getNdiStatus();
await logServerStart(activePort, lanIp, ndiStatus);

process.on("SIGINT", () => {
    shutdownNdi();
    process.exit(0);
});

process.on("SIGTERM", () => {
    shutdownNdi();
    process.exit(0);
});

declare const self: Worker;
if (typeof postMessage === "function") {
    postMessage({ type: "ready", port: activePort });
}