# Technical Architecture: Figlink

**Figlink** is a system that enables external scripts (AI agents, CLI tools) to interact programmatically with one or more live Figma documents in real time. It bypasses Figma's REST API limitations by creating a direct WebSocket connection between a local Node.js environment and running Figma plugin instances.

---

## 1. System Components

```
start.js (launcher / watcher)
    │  IPC channel
    ▼
link-server/server.js  ←──── ws://localhost:9001 ────►  figma-plugin/code.js  (File A)
                                                    ────►  figma-plugin/code.js  (File B)
                                                    ────►  figma-plugin/code.js  (File N)
    ▲
    │  WebSocket
tools/figma.js / tools/process.js (CLI clients)
```

### `start.js` — Launcher and watcher

The entry point. Stays in the codebase root so it can be invoked directly or via the double-click launchers.

- **Dependency check:** Checks whether `link-server/node_modules` exists; runs `npm install` automatically if not.
- **Startup banner:** Prints a styled terminal banner with author and coffee link.
- **Spawning the server:** Launches `link-server/server.js` as a child process with `stdio: ['ignore', 'inherit', 'inherit', 'ipc']` — the `'ipc'` entry opens a Node.js IPC channel between parent and child.
- **File watching:** Uses `fs.watch` on `link-server/` and `figma-plugin/`:
  - Changes to `server.js` → `restartServer()` after 300ms debounce.
  - Changes to `code.js` → `notifyCodeChanged()` after 300ms debounce.
- **Code-changed notification:** Sends `{ type: 'code_changed' }` over IPC to the server, which broadcasts it to all connected plugins. Each plugin shows a banner prompting the user to reload.
- **Graceful shutdown:** Handles `SIGINT` / `SIGTERM`.

### `link-server/server.js` — WebSocket relay

A lightweight WebSocket server (`ws` library) on `ws://localhost:9001`. Supports multiple simultaneous plugin connections — one per open Figma file.

**Registration:**
- Each plugin connects and sends `{ type: 'register', role: 'plugin', fileKey, fileName }`.
- Server stores connections in `plugins: Map<fileKey, { ws, name }>`.
- On registration, server responds with `{ type: 'registered', fileKey, fileName }`.

**Routing:**
- `list_connected_files` command → answered directly by the server (no plugin needed).
- Other commands from a CLI client → routed to the plugin for the specified `fileKey`.
  - If `fileKey` is omitted and only one file is connected, defaults to that file.
  - If `fileKey` is omitted and multiple files are connected, returns an error listing connected file names.
- Plugin result → looked up by `msg.id` in `pending: Map<id, { sender, fileKey }>` and returned to the waiting client.

**Reliability:**
- On plugin disconnect: only pending requests for that specific file are resolved with an error; other files' pending requests are unaffected.
- IPC messages from `start.js` are broadcast to **all** connected plugins.

### `figma-plugin/code.js` — Plugin execution engine

Runs inside Figma desktop. Has full access to the Figma Plugin API.

**On load:**
- Posts `{ type: 'file_info', fileKey: figma.fileKey, fileName: figma.root.name }` to the UI immediately so it can include the file identity in its WebSocket registration.

**Message routing:**
- Receives messages from `ui.html` via `figma.ui.onmessage` and dispatches to command handlers.
- Special messages handled before command routing: `close_plugin`, `open_url`.

**Key capabilities:**
- **Serialization:** `serializeNode` and `serializeFills` convert Figma objects to flat JSON-safe structures. Handles `figma.mixed`, bound variables, style IDs.
- **Bulk operations:** `bulk_rename`, `bulk_apply_text_style`, `bulk_set_variable_binding`, `bulk_apply_fill_variable`, `bulk_set_property` — reduce round-trips for large operations.
- **Variable resolution:** `getAllDocumentVariables` traverses the full document to find all bound variables, including library variables.
- **Recursion guard:** `walk()` in `getNodesFlat` guards against `depth > 100`.
- **Deep clone:** Uses `structuredClone(node.fills)`.

### `figma-plugin/ui.html` — Plugin UI

The visible panel in Figma. Communicates with `code.js` via `parent.postMessage` / `figma.ui.onmessage`.

**File identity flow:**
1. `code.js` posts `file_info` on load → UI stores `{ fileKey, fileName }`.
2. When WebSocket opens, UI sends `{ type: 'register', role: 'plugin', fileKey, fileName }`.
3. On `registered` response, status shows `"<fileName> · ready"`.
4. If `file_info` arrives after WebSocket is already open, UI re-sends registration immediately.

**Connection management:**
- Reconnects every 2.5s on close/error.
- Pending messages (capped at 10) are buffered and flushed on reconnect.

**UI:**
- Font: Cal Sans (Google Fonts).
- Dimensions: 500×300px. Dark theme (`#141414`).
- Status dot: green (connected), orange pulsing (connecting), red (error).
- Footer links: `x.com/danielfransix` and `☕ Buy me a coffee` — both open via `figma.openExternal`.

### `tools/figma.js` — One-shot CLI client

Used by the AI to send individual commands to a specific connected Figma file.

```bash
node tools/figma.js [--file <fileKey|figmaUrl>] <command> [params-json]
```

**Special local commands (no server needed):**
- `parse_link <url>` — Parses any Figma URL into `{ fileKey, nodeId }`. Handles both old (`node-id=123%3A456`) and new (`node-id=123-456`) URL formats.
- `list_connected_files` — Asks the server for all currently connected plugins.

**`--file` flag:** Accepts either a raw file key or a full Figma URL (file key is extracted automatically).

### `tools/process.js` — Standardization processor

A higher-level client that implements the design system standardization workflow.

**Commands:**
```bash
node tools/process.js [--file <fileKey|figmaUrl>] standardize <nodeId>
node tools/process.js [--file <fileKey|figmaUrl>] standardize-page
node tools/process.js [--file <fileKey|figmaUrl>] standardize-file
node tools/process.js clean
```

**What standardization does:**
1. Fetches all `COLOR` and `FLOAT` variables + text styles from the document.
2. Fetches all nodes in the target frame as a flat array.
3. Renames text/frame layers to match content.
4. Binds unlinked text nodes to the closest text style (by fontSize + fontWeight).
5. Binds unlinked fills to the closest COLOR variable (by RGB proximity).
6. Binds unlinked layout fields to `spacing/*` or `radius/*` FLOAT variables (by numeric proximity). Skips nodes named "illustration" or "vector".
7. Sets `clipsContent: true` on all container nodes.
8. Applies all mutations in batches of 500.

**Exports `sendCommand`** so `tools/eval.js` can reuse the WebSocket helper.

---

## 2. File structure

```
figlink/
├── start.js                       # Launcher, watcher, IPC parent
├── Start Figlink.bat              # Windows double-click launcher
├── Start Figlink.command          # Mac double-click launcher
│
├── figma-plugin/
│   ├── code.js                    # Plugin logic (Figma Plugin API)
│   ├── ui.html                    # Plugin UI (WebSocket client)
│   └── manifest.json              # Figma plugin manifest
│
├── link-server/
│   ├── server.js                  # WebSocket relay (multi-file)
│   └── package.json               # ws dependency
│
├── tools/
│   ├── figma.js                   # One-shot CLI client for the AI
│   ├── process.js                 # Standardization processor
│   ├── eval.js                    # Dev utility / REPL helper
│   └── test.bat                   # Dev test runner (Windows)
│
├── docs/
│   ├── README.md                  # Setup guide and commands reference
│   └── TECHNICAL_ARCHITECTURE.md # This file
│
├── examples/
│   └── FIGMA_PROCESSOR_INSTRUCTIONS.md  # Example AI instructions for standardization
│
└── temp/
    └── .gitignore                 # Keeps folder tracked, ignores contents
```

---

## 3. Data flow — full example

1. User runs `node start.js` → server starts, watchers begin.
2. User opens two Figma files, runs Figlink plugin in each.
   - Plugin in File A registers: `{ type: 'register', fileKey: 'abc', fileName: 'Design System' }`
   - Plugin in File B registers: `{ type: 'register', fileKey: 'xyz', fileName: 'Onboarding Flow' }`
   - Server stores both in `plugins` map.
3. AI runs `node tools/figma.js list_connected_files` → server returns both files immediately.
4. AI runs `node tools/figma.js --file abc get_local_variables`.
5. `figma.js` connects to WS, sends `{ id: "uuid-1", command: "get_local_variables", params: {}, fileKey: "abc" }`.
6. Server routes to the plugin registered under `"abc"`, stores `pending.set("uuid-1", { sender, fileKey: "abc" })`.
7. Plugin runs `getLocalVariables()`, sends back `{ id: "uuid-1", result: [...] }`.
8. Server routes result to the waiting `figma.js` process, which prints it and exits.

---

## 4. Code-changed notification flow

1. AI edits `figma-plugin/code.js`.
2. `fs.watch` in `start.js` fires after 300ms debounce.
3. `start.js` logs a warning box and calls `serverProcess.send({ type: 'code_changed' })` over IPC.
4. `server.js` receives it and sends `{ type: 'code_changed' }` to **all** connected plugins.
5. Each plugin's `ui.html` shows the "Plugin code updated" banner.
6. User closes and re-opens each plugin to load the new code.

---

## 5. Error handling and limitations

- **Timeouts:** CLI commands time out after 15s (180s for heavy operations in `process.js`). The plugin must be open and connected.
- **Plugin can't self-reload:** Figma plugins cannot reload themselves. The `code_changed` notification and banner are the mechanism for surfacing this.
- **Mixed properties:** `figma.mixed` is serialized as `null` and skipped during standardization.
- **Vectors:** `skipVectors: true` is the default in `get_nodes_flat`. Vector networks produce large payloads that can exceed WebSocket memory limits.
- **IPC channel:** Only available when the server was started via `start.js`. Running `server.js` directly still serves WebSocket clients but the code-changed notification won't work.
- **File key on local dev:** `figma.fileKey` is available in production Figma files. In draft or local plugin testing it may be null — the plugin falls back to using the file name as key.
