# Presenter

This is one of the tools I built for the media team in Church. It is a real-time church presentation server that lets the media team display Bible scriptures and song lyrics on a screen during service — all controlled from any device on the same network, without needing any special software installed.

## What It Does

The server runs on a local machine and serves two kinds of content: **Bible scripture** and **worship song lyrics**. There are separate control interfaces (for the operator) and output interfaces (for the projector or display screen), and everything stays in sync in real time using WebSockets.

When a new device connects — say, a projector screen — it immediately receives the last displayed verse or song so it never starts blank.

## Scripture

The app ships with a full **King James Version (KJV)** Bible database (`db/KJV.sqlite`). The operator can search for scripture in several ways:

- By reference, e.g. `John 3:16` or `Genesis 1 1`
- By chapter only, e.g. `Romans 8`
- By book name prefix, e.g. typing `Gen` to find Genesis
- By fuzzy full-text search across all verse content — it matches every word you type across the entire Bible

Once a verse is selected on the control page, it is pushed via WebSocket to the output screen instantly.

## Worship Songs

The app has a built-in song library stored in `db/songs.sqlite`. Songs are structured with a title, a display mode, and multiple named sections (e.g. Verse 1, Chorus, Bridge), where each section contains individual lines of lyrics.

The media team can:

- Browse all songs in the library sorted by title
- Add new songs with sections and lines
- Edit existing songs
- Delete songs
- Select a song and navigate through its sections during worship, pushing each section's lyrics to the display screen in real time

Songs support a `display_mode` setting (e.g. `lower` or `background`) that controls how the lyrics appear on the output screen.

## Pages and Routes

| Route | Description |
|---|---|
| `/` | Scripture control panel — search and push Bible verses |
| `/output` | Scripture output screen — displays the current verse |
| `/song-control` | Song control panel — browse the song library and present lyrics |
| `/song` | Song output screen — displays the current song section |

## Real-Time Sync via WebSockets

All control and output pages connect to a shared WebSocket at `/ws`. When the operator selects a verse or a song section, the message is broadcast to every connected client. Late-joining screens (like a projector that was just plugged in) automatically receive the last known state for both the scripture and song channels so they are always up to date.

## NDI Output Streaming

Presenter broadcasts both live presentation channels over the local area network as **NDI® (Network Device Interface)** video feeds. Broadcast software such as **OBS Studio**, **vMix**, **TriCaster**, or **Wirecast** can auto-discover and mix them directly without browser capture or screen scraping:

- **`Presenter - Scripture`**: Broadcasts the active scripture slide in 1080p with clean typography and transparency.
- **`Presenter - Songs`**: Broadcasts worship lyrics in 1080p, preserving transparency for lower-thirds (`lower`) or rendered card backgrounds (`background`).

### Using NDI in OBS / vMix
1. Ensure the NDI runtime is installed on your system (e.g. NDI SDK or OBS NDI plugin).
2. In OBS Studio, add a new **NDI™ Source**.
3. Under **Source name**, select `Presenter - Scripture` or `Presenter - Songs`.
4. The feed delivers 30fps RGBA frames with full alpha transparency, ideal for overlaying verses and lyrics directly on your live camera mix.

> *Note: If NDI libraries are not present on the host, the server gracefully logs a notice and continues serving standard web outputs without interruption.*

## Control Page Switcher & Dual Monitors

Both control interfaces (`/` and `/song-control`) provide an integrated presentation workflow:

- **Quick Navigation Switcher**: Easily toggle between Scripture and Song Control in the top header (or use `Alt+S` for Songs and `Alt+B` for Scripture).
- **Stage Preview Monitor**: A 16:9 preview dock showing staged verses or lyrics before sending them live, complete with a **"Push Live ↵"** button.
- **Live Output Monitor**: A real-time 16:9 monitor displaying what is currently active on the public screens and NDI streams, complete with a pulsing **LIVE** indicator, a **"✕ Clear"** button (`Esc`), and a popup button to open the public display window.
- **Live Channel Sync**: Each control page displays the real-time status of both NDI feeds and the companion channel.

## API

The server exposes a REST API for managing scripture, songs, and live output status:

- `GET /api/search?q=...` — Search for scriptures by reference, book name, or text
- `GET /api/verse?book=...&chapter=...&verse=...` — Fetch a specific verse
- `GET /api/songs` — List all songs
- `POST /api/songs` — Create a new song
- `GET /api/songs/:id` — Fetch a full song with all sections and lines
- `PUT /api/songs/:id` — Update an existing song
- `DELETE /api/songs/:id` — Delete a song
- `GET /api/ndi/status` — Check NDI runtime availability and active sources
- `GET /api/output/status` — Get current live state of scripture and song outputs

## Tech Stack

- **Runtime:** [Bun](https://bun.sh) — a fast all-in-one JavaScript runtime
- **Language:** TypeScript
- **Database:** SQLite (via Bun's built-in SQLite driver)
- **Transport:** Native Bun HTTP server + WebSockets
- **Containerization:** Docker and Docker Compose

## Running the App

Install dependencies:

```bash
bun install
```

Start the server:

```bash
bun run src/index.ts
```

Or with hot-reload during development:

```bash
bun --watch src/index.ts
```

The server starts on port `1000` by default and is accessible from any device on the same local network. It detects the machine's LAN IP automatically and prints the address on startup so you can open it from a phone, tablet, or projector on the same Wi-Fi.

## Running with Docker

```bash
docker compose up -d
```

The `db/` folder is mounted as a volume so your songs database persists across container restarts.
