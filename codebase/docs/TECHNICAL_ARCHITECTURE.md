# Technical Architecture: Figlink

**Figlink** is a system that enables external scripts (AI agents, CLI tools) to interact programmatically with a live Figma document in real time. It bypasses Figma's REST API limitations by creating a direct WebSocket connection between a local Node.js environment and a running Figma plugin.

---

## 1. System Components

The system has four components:

```
start.js (launcher/watcher)
    │  IPC channel
    ▼
link-server/server.js  ←──── ws://localhost:9001 ────►  figma-plugin/code.js
                                                              (Figma Plugin API)
    ▲
    │  WebSocket
figma.js / process.js (CLI clients)
```

### `start.js` — Launcher and watcher

The entry point for running Figlink. It handles:

- **Dependency check:** Checks whether `link-server/node_modules` exists; if not, runs `npm install` automatically.
- **Startup banner:** Prints a styled terminal banner with the Figlink name and author info.
- **Spawning the server:** Launches `link-server/server.js` as a child process using Node.js `child_process.spawn` with `stdio: ['ignore', 'inherit', 'inherit', 'ipc']`. The `'ipc'` entry opens a Node.js IPC channel between the parent and child.
- **File watching:** Uses `fs.watch` on the `link-server/` directory and the `figma-plugin/` directory (watching directories is more reliable than individual files for editors that write atomically).
  - Changes to `link-server/server.js` → triggers `restartServer()` after a 300ms debounce.
  - Changes to `figma-plugin/code.js` → triggers `notifyCodeChanged()` after a 300ms debounce.
- **Code-changed notification:** When the plugin's code changes, `start.js` sends `{ type: 'code_changed' }` over the IPC channel to the server process. The server forwards this to the connected plugin, which shows a banner prompting the user to close and re-open the plugin.
- **Mac launcher check:** On startup, checks if `Start Figlink.command` is missing its execute permission and prints the exact `chmod +x "..."` command the user can copy.
- **Graceful shutdown:** Handles `SIGINT` / `SIGTERM` to cleanly stop the child server process.

### `link-server/server.js` — WebSocket relay

A lightweight WebSocket server (`ws` library) on `ws://localhost:9001`. It relays messages between CLI clients and the Figma plugin.

**Registration:**
- The plugin connects and sends `{ type: 'register', role: 'plugin' }` → server tracks this as `pluginWs`.
- CLI clients send commands without registering (identified by the presence of a `command` field).

**Routing:**
- Message from CLI client with a `command` field → forwarded to `pluginWs`.
- Message from the plugin with a `result` or `error` field → looked up by `msg.id` in a `pending` map and forwarded to the waiting CLI client.

**Reliability features:**
- `msg.id` is validated before being stored in the `pending` map; messages missing an `id` get an immediate error response.
- On plugin disconnect, all entries in `pending` are immediately resolved with `{ error: 'Figma plugin disconnected' }` and the map is cleared — CLI clients don't hang waiting for a 15s timeout.
- WebSocket errors are logged: `ws.on('error', (err) => console.error('[Figlink] WebSocket error:', err.message))`.
- IPC messages from `start.js` are forwarded to the plugin: `process.on('message', ...)` handles `{ type: 'code_changed' }`.

### `figma-plugin/code.js` — Plugin execution engine

Runs inside Figma desktop. Has full access to the Figma Plugin API.

**UI:** Fixed at 500×300px, titled "Figlink". No dynamic resizing.

**Message routing:**
- Receives messages from the plugin's `ui.html` (via `figma.ui.onmessage`) and dispatches them to command handlers.
- Special messages handled before command routing:
  - `{ type: 'close_plugin' }` → calls `figma.closePlugin()`

**Key capabilities:**
- **Serialization:** `serializeNode` and `serializeFills` convert Figma's complex node objects into flat, JSON-safe structures. Handles `figma.mixed`, bound variables, and style IDs.
- **Bulk operations:** `bulk_rename`, `bulk_apply_text_style`, `bulk_set_variable_binding`, `bulk_apply_fill_variable` — reduces round-trips for large operations.
- **Variable and style resolution:** `getAllDocumentVariables` traverses the full document to find variables bound to any node, including those from linked libraries.
- **Recursion guard:** The internal `walk(node, insideInstance, depth = 0)` function used by `getNodesFlat` has a `depth > 100` guard to prevent stack overflow on deeply nested documents.
- **Deep clone:** Uses `structuredClone(node.fills)` (V8 native, available in the Figma plugin runtime) instead of `JSON.parse(JSON.stringify(...))`.

### `figma-plugin/ui.html` — Plugin UI

The visible panel shown in Figma when the plugin runs. Communicates with `code.js` via `parent.postMessage` / `figma.ui.onmessage`.

**Connection management:**
- Connects to the link server at `ws://localhost:9001`.
- On open: sends `{ type: 'register', role: 'plugin' }`, then flushes any queued messages.
- On `registered` response: updates status to connected.
- On `code_changed` message: shows the "Plugin code updated" banner with a Close Plugin button.
- On close/error: schedules a reconnect attempt after 2.5s. `clearTimeout(retryTimer)` is called at the start of every `connect()` to prevent duplicate connections.

**Pending message buffer:**
- Commands arriving from `code.js` while the WebSocket is not `OPEN` are stored in `pendingMessages[]` (capped at 10).
- On reconnect and successful registration, buffered messages are flushed in `ws.onopen`.

**OS detection:**
- Uses `navigator.platform` and `navigator.userAgent` to detect Mac or Windows.
- The start instruction row for the detected OS is highlighted. If OS is unknown, both rows are highlighted.

**Visual design:**
- Font: Cal Sans (Google Fonts), used throughout.
- Fixed dimensions: 500×300px.
- Dark theme: `#141414` background.
- Status dot: green (connected), orange pulsing (connecting), red (error).

---

## 2. Data flow — full example

1. User runs `node start.js` → server starts, watchers begin.
2. User opens Figma, runs the Figlink plugin → plugin connects to server, registers as plugin.
3. AI assistant runs `node figma.js get_nodes_flat '{"nodeId":"488:373"}'` from the figlink folder.
4. `figma.js` connects to `ws://localhost:9001`, sends `{ id: "uuid-1", command: "get_nodes_flat", params: { nodeId: "488:373" } }`.
5. Server receives it, stores `pending.set("uuid-1", senderWs)`, forwards to plugin.
6. Plugin's `code.js` runs `getNodesFlat`, serializes results, sends back `{ id: "uuid-1", result: [...] }`.
7. Server looks up `pending.get("uuid-1")`, sends result to the waiting `figma.js` process.
8. `figma.js` prints JSON to stdout and exits.

---

## 3. Code-changed notification flow

1. AI edits `figma-plugin/code.js`.
2. `fs.watch` in `start.js` fires after a 300ms debounce.
3. `start.js` logs an ASCII-box message in the terminal and calls `serverProcess.send({ type: 'code_changed' })` over the IPC channel (wrapped in try-catch for safety).
4. `server.js` receives it and calls `pluginWs.send(JSON.stringify({ type: 'code_changed' }))`.
5. Plugin's `ui.html` receives the WebSocket message and shows the "Plugin code updated" banner.
6. User clicks "Close Plugin" (or uses the shortcut ⌘⌥P on Mac / Ctrl+Alt+P on Windows) to re-open the plugin with the new code loaded.

---

## 4. File structure

```
figlink/
├── start.js                      # Launcher, watcher, IPC parent
├── figma.js                      # CLI client (one-shot commands)
├── process.js                    # High-level standardization processor
├── Start Figlink.bat             # Windows double-click launcher
├── Start Figlink.command         # Mac double-click launcher
├── link-server/
│   ├── server.js                 # WebSocket relay server
│   └── package.json              # ws dependency
└── figma-plugin/
    ├── code.js                   # Plugin logic (Figma Plugin API)
    ├── ui.html                   # Plugin UI (WebSocket client)
    └── manifest.json             # Figma plugin manifest
```

---

## 5. The standardization processor (`process.js`)

`process.js` is a higher-level client built on top of Figlink. It implements the design system standardization workflow described in `FIGMA_PROCESSOR_INSTRUCTIONS.md`.

**What it does:**

1. **Data ingestion:**
   - `get_all_document_variables` → caches all `COLOR` and `FLOAT` variables.
   - `get_local_styles` → caches text styles.
   - `get_nodes_flat` → gets all nodes in the target frame as a flat array.
   - `get_nodes` (depth 10) → gets the hierarchy for layout context.

2. **Heuristic matching:**
   - **Colors:** Computes RGB absolute difference to find the nearest `COLOR` variable.
   - **Spacing / radius:** Maps numeric layout properties to `spacing/*` or `radius/*` `FLOAT` variables by minimum numerical difference.
   - **Typography:** Normalizes font weight names to numbers, scores candidates by combined `fontSize` + `fontWeight` difference, picks closest text style.

3. **Context-aware rules:** Skips auto-layout variable binding for nodes named with "illustration", "vector", or similar — leaves them free-form.

4. **Batch execution:** Mutation commands are chunked into batches of 500 to avoid overloading the plugin with massive payloads.

**Running:**
```bash
node process.js standardize <NODE_ID>
```

---

## 6. Error handling and limitations

- **Timeouts:** CLI commands time out after 15s (30s for heavy operations). The plugin must be open in Figma and connected to the server for commands to work.
- **Plugin can't self-reload:** Figma plugins cannot programmatically reload themselves. When the plugin's source code changes, the user must close and re-open the plugin manually. The `code_changed` notification and banner are the mechanism for surfacing this.
- **Mixed properties:** `figma.mixed` (e.g., a text node with multiple different font sizes) is serialized as `null` and skipped during standardization.
- **Vectors:** `skipVectors: true` is the default in `get_nodes_flat`. Vector networks produce large JSON payloads that can exceed WebSocket memory limits.
- **IPC channel:** The IPC channel between `start.js` and `server.js` is only available when the server was started via `start.js`. Running `server.js` directly will still work for serving WebSocket clients, but the code-changed notification path will not function.
