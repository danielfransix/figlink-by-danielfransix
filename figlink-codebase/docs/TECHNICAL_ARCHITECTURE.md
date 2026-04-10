# Technical Architecture: Figlink

Figlink enables external scripts and AI agents to interact programmatically with live Figma documents in real time. It bypasses Figma's REST API limitations by creating a direct WebSocket connection between a local Node.js environment and running Figma plugin instances.

---

## 1. System Overview

```
start.js  (launcher / watcher / IPC parent)
    │
    │  IPC channel (stdio: ipc)
    ▼
link-server/server.js   ◄──── ws://localhost:9001 ────►  figma-plugin/ui.html ↔ code.js  (File A)
                                                    ────►  figma-plugin/ui.html ↔ code.js  (File B)
                              ▲
                              │  WebSocket
                    tools/figma.js
                    tools/process.js
```

---

## 2. Components

### `start.js` — Launcher, watcher, IPC parent

The single entry point. Coordinates everything at startup and keeps watching for changes.

**Startup sequence:**
1. Prints the styled terminal banner.
2. Checks if running on macOS with an unexecutable `.command` launcher and surfaces a `chmod +x` hint.
3. Runs `npm install` in `link-server/` if `node_modules` is absent.
4. Calls `checkSystemPrompt()` to warn if `prompts/system.md` is missing.
5. Calls `startServer()` — spawns the server process, sets up IPC.
6. Calls `watchFiles()` — watches `link-server/` and `figma-plugin/`.

**`startServer()`:**
- Kills any process already occupying port 9001 (platform-specific: `netstat` + `taskkill` on Windows; `lsof | xargs kill -9` on Unix).
- Spawns `link-server/server.js` as a child process with `stdio: ['ignore', 'inherit', 'inherit', 'ipc']`.
- Auto-restarts the server on unexpected exits (not on its own `SIGTERM`).

**`watchFiles()`:**
- Watches `link-server/server.js` — 300ms debounce → `restartServer()`.
- Watches `figma-plugin/code.js` — 300ms debounce → `notifyCodeChanged()` + IPC `{ type: 'code_changed' }` to the server.

**Shutdown:** `SIGINT`/`SIGTERM` → kills server child process → `process.exit(0)`.

---

### `link-server/server.js` — WebSocket relay

A lightweight `ws`-based WebSocket server on port 9001. Routes commands between CLI clients and Figma plugin instances. Multiple files can be connected simultaneously.

**Key data structures:**
```javascript
plugins: Map<fileKey, { ws, name }>         // One entry per connected Figma file
pending: Map<id, { sender, fileKey, createdAt }> // In-flight commands awaiting plugin response
```

**Connection lifecycle:**

1. **Plugin registration** — plugin sends `{ type: 'register', role: 'plugin', fileKey, fileName }`. If `fileKey` is absent, the server generates `unnamed-{timestamp}-{5-char random}` to avoid collisions. The entry is stored in `plugins`.

2. **First CLI client message (auto-inject)** — on a client's very first message, the server attempts to read `prompts/system.md` from disk and sends it back as `{ type: 'active_prompt', id: 'system', content }`. If the file does not exist, the injection is silently skipped.

3. **Command routing:**
   - `list_connected_files` is answered directly by the server; never forwarded to a plugin.
   - All other commands are forwarded to the plugin matching `msg.fileKey`. If `fileKey` is omitted and only one plugin is connected, that one is used. `{ sender, fileKey, createdAt: Date.now() }` is stored in `pending`.
   - Plugin result arrives → `pending.delete(msg.id)` (always, regardless of whether sender is still open) → result forwarded to sender if still `OPEN`.

4. **TTL sweep** — `setInterval` runs every 10 seconds. Any pending entry older than 30 seconds is deleted and the original caller receives `{ id, error: 'Request timed out — plugin did not respond in time.' }`.

5. **Plugin disconnect** — removes from `plugins`, resolves all pending requests for that `fileKey` with a disconnect error.

**IPC messages received from `start.js`:**
- `{ type: 'code_changed' }` → broadcasts `{ type: 'code_changed' }` to all connected plugins.

---

### `figma-plugin/code.js` — Plugin execution engine

Runs inside Figma desktop. Has full access to the Figma Plugin API. Receives serialized command objects from `ui.html` and dispatches to handlers.

**On load:**
```javascript
figma.ui.postMessage({ type: 'file_info', fileKey: figma.fileKey || figma.root.name, fileName: figma.root.name });
```
`figma.fileKey` may be `null` on draft files; the file name is used as fallback key.

**Constants defined at module level:**
- `SETTABLE_PROPERTIES` — a `Set` of the only field names `setProperty` / `bulkSetProperty` may write. Protects against arbitrary property mutation.
- `_loadedFonts` — a `Set<"family:style">` font loading cache. `ensureFontLoaded(fontName)` checks it before calling `figma.loadFontAsync`, eliminating redundant async loads across a session.

**Message dispatch:**
```javascript
figma.ui.onmessage = async (msg) => {
  // Special messages: resize, close_plugin, open_url — handled directly
  const { id, command, params } = msg;
  try {
    const result = await handleCommand(command, params || {});
    figma.ui.postMessage({ id, result });
  } catch (err) {
    figma.ui.postMessage({ id, error: err.message, errorType: err.name });
  }
};
```
Both `error` and `errorType` (`err.name`) are included in error responses.

**Command categories:**

| Category | Commands |
|----------|---------|
| Query | `ping`, `get_selection`, `get_nodes`, `get_nodes_flat`, `get_page_frames`, `get_pages`, `set_current_page`, `get_local_styles`, `get_local_variables`, `get_all_available_variables`, `get_all_document_variables`, `resolve_variables` |
| Rename | `rename_node`, `bulk_rename` |
| Text | `set_characters`, `bulk_set_characters`, `apply_text_style`, `bulk_apply_text_style` |
| Color | `apply_fill_style`, `apply_fill_variable`, `bulk_apply_fill_variable` |
| Variables | `set_variable_binding`, `bulk_set_variable_binding`, `remove_variable_binding` |
| Properties | `set_property`, `bulk_set_property` (supports layout, typography, prototyping, and advanced auto-layout properties) |
| Styles | `duplicate_text_style`, `bulk_duplicate_text_style`, `set_style_property`, `bulk_set_style_property`, `set_style_variable_binding`, `bulk_set_style_variable_binding`, `delete_style`, `bulk_delete_style` |
| Components | `reset_instance_spacing`, `clone_component_set`, `swap_button_instances` |
| Structure | `create_node`, `create_node_tree`, `set_node_raw`, `delete_node`, `group_as_component_set`, `flatten_node` |

**Key implementation details:**

- `SETTABLE_PROPERTIES` — The exhaustive list of modifiable fields, recently expanded to include:
  - **Prototyping:** `reactions`, `scrollBehavior`, `overflowDirection`, `flowStartingPoints`
  - **Advanced Layout:** `layoutWrap`, `layoutPositioning`, `itemReverseZIndex`, `strokesIncludedInLayout`, `primaryAxisAlignItems`, `counterAxisAlignItems`
  - **Typography:** `lineHeight`, `letterSpacing`, `paragraphSpacing`, `textCase`, `textDecoration`, `textAlignHorizontal`, `textAlignVertical`, `textAutoResize`
  - **Styling:** `cornerSmoothing`, `rotation`
- `getNodes({ nodeId, depth })` — depth is clamped to `Math.max(0, depth)` before recursion.
- `getNodesFlat({ nodeId, skipVectors, skipInstanceChildren })` — walks the tree with a `depth > 100` recursion guard. Vector-type nodes (`VECTOR`, `IMAGE`, `BOOLEAN_OPERATION`, `STAR`, `POLYGON`, `ELLIPSE`, `LINE`) are skipped when `skipVectors: true`. Instance children (IDs containing `;`) are skipped when `skipInstanceChildren: true`.
- `applyFillVariable(nodeId, variableId, fillIndex)` — validates `fillIndex` is within bounds before indexing `fills[]`.
- `setProperty(nodeId, field, value)` — throws if `field` is not in `SETTABLE_PROPERTIES`. For prototyping `reactions`, it calls the asynchronous `node.setReactionsAsync()` method under the hood. "Auto" spacing is intelligently handled by translating it to/from `SPACE_BETWEEN` align properties.
- `serializeNode(node, depth)` — recursively serializes nodes to plain objects. Handles `figma.mixed` (serialized as `null`), fills, bound variables, corner radius, padding/spacing, text properties, prototyping logic, and style names. Stops recursion at depth 0, includes `childCount` instead.
- `serializeBoundVariables(node)` — flattens bound variable objects to their `id` strings; normalizes both single bindings and array bindings.
- `getAllAvailableVariables()` — imports `COLOR` and `FLOAT` variables from all connected team library collections, deduplicates against local variables, logs failures via `console.warn`.
- `getAllDocumentVariables()` — walks the entire current page collecting all variable IDs from `boundVariables` and fill bindings, then resolves each. Logs individual resolution failures via `console.warn`.
- All font loads use `ensureFontLoaded(fontName)` — `applyTextStyle`, `setCharacters`, `bulkSetCharacters`, `duplicateTextStyle`, `swapButtonInstances`.
- `cloneComponentSet` — marks unwanted variant components as `name: "DELETE_ME", visible: false` rather than deleting immediately, because immediate deletion in a COMPONENT_SET can corrupt the set in some Figma versions.
- `swapButtonInstances` — finds instances in the container with "button" in their name, matches variant properties by name parsing, swaps component, restores text, adjusts layout constraints.
- `resetInstanceSpacing(nodeId)` — walks the subtree rooted at `nodeId` (or current page if omitted) with `findAll`, collecting all `INSTANCE` nodes that have auto-layout (`layoutMode !== 'NONE'`). For each instance, reads `mainComponent` and compares `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`, `itemSpacing`, and `counterAxisSpacing` against the master. Any field that differs is reset to the master's value. Fields that already match are left untouched. Returns `{ instancesModified, fieldsReset, rootId, rootName }`. **Note:** `findAll` on a large page can exceed the 15 s CLI timeout in `tools/figma.js` — use the inline WebSocket script pattern with a 120 s timeout for page-scale operations.

---

### `figma-plugin/ui.html` — Plugin UI

The visible Figma panel. Bridges `code.js` and the WebSocket server via `postMessage`.

**File identity flow:**
1. `code.js` posts `{ type: 'file_info', fileKey, fileName }` on load.
2. UI stores `fileInfo = { fileKey, fileName }`.
3. On WebSocket open, UI sends `{ type: 'register', role: 'plugin', fileKey, fileName }`.
4. If `file_info` arrives after WebSocket is already open, UI immediately re-sends registration.

**Connection management:**
- On `ws.onopen`: resets `retryAttempt = 0`, sends registration, flushes `pendingMessages`.
- On `ws.onclose`: computes retry delay with **exponential backoff + jitter**: `Math.min(30000, 2500 × 2^retryAttempt) + rand(0, 500)ms`. Increments `retryAttempt`. This gives delays of ~2.5s, ~5s, ~10s, ~20s, capped at ~30s, preventing hammering a downed server.
- On `ws.onerror`: sets error state, shows hint panel.
- `pendingMessages` — up to 10 messages buffered when disconnected, flushed on reconnect. When the cap is hit, the oldest message is dropped and the UI shows `"Buffer full — some messages may be lost"`.

**Message routing:**
- Messages from the server with `type: 'registered'` → update status dot to green.
- Messages with `type: 'code_changed'` → show the "Plugin code updated" banner.
- All other messages → `parent.postMessage({ pluginMessage: msg }, '*')` → received by `code.js`.

**UI details:**
- Font: Cal Sans (Google Fonts CDN).
- Initial size: 500×300px. Dark theme (`#141414`). Resizes to auto-height via `resize` message from `code.js`.
- Status dot states: green (connected), orange pulsing (connecting), red (error).

---

### `tools/figma.js` — One-shot CLI client

Sends a single command, prints the JSON result, exits. Used by AI agents for individual Figma API calls.

```bash
node tools/figma.js [--file <fileKey|figmaUrl>] <command> [params-json]
```

**`--file` flag:** Accepts a raw file key or a full Figma URL (file key extracted via `parseFigmaUrl`). Handles both URL formats:
- Old: `node-id=123%3A456` → decoded to `123:456`
- New: `node-id=123-456` → first `-` replaced with `:` → `123:456`

**Local commands (no server connection):**
- `parse_link <url>` — returns `{ fileKey, nodeId }` for any Figma URL. Runs without a server.
- `list_connected_files` — returns all files with an active plugin connection.

**Connection behavior:**
- Opens a new WebSocket on every invocation.
- First incoming message is the auto-injected `active_prompt` (ignored because its `id` doesn't match the pending command id).
- Times out after 15 seconds with `COMMAND_TIMEOUT_MS = 15000`.
- On successful result: closes WebSocket, prints JSON to stdout, exits 0.
- On error response: closes WebSocket, prints error to stderr, exits 1.
- On malformed JSON from server: rejects with `'Malformed JSON from Figlink server'`.
- Exports `sendCommand` so `tools/process.js` can reuse the WebSocket helper.

---

### `tools/process.js` — Standardization processor

Implements the design system standardization workflow as a higher-level CLI. Uses `sendCommand` from the same file (also used by `tools/figma.js`).

**Configuration constants (top of file):**
```javascript
const BULK_BINDING_CHUNK     = 500;    // Items per bulk_set_variable_binding call
const STANDARDIZE_TIMEOUT_MS = 300000; // 5 min timeout for get_all_available_variables
const PAGE_CONCURRENCY       = 3;      // Frames processed in parallel per page
const COLOR_MAX_DIST         = 30;     // Max RGB Manhattan distance to bind a color variable
const FLOAT_MAX_DIFF         = 2;      // Max pixel difference to bind a spacing/radius variable
```

**CLI:**
```bash
node tools/process.js [--file <fileKey|figmaUrl>] standardize <nodeId>
node tools/process.js [--file <fileKey|figmaUrl>] standardize-page
node tools/process.js [--file <fileKey|figmaUrl>] standardize-file
node tools/process.js clean
```

**Module vs CLI:** The file wraps its CLI dispatch block in `if (require.main === module)`, so external scripts can safely `require('./tools/process.js')` to import `sendCommand` without triggering the CLI logic. This is the correct pattern for any new tool scripts added under `tools/`.

**`standardize <nodeId>`:**
1. Fetches all `COLOR` and `FLOAT` variables (including team library imports) and local text styles.
   - `floatVars` construction guards against empty `valuesByMode` — variables without any mode values are silently skipped.
2. Fetches all descendants of the target frame as a flat array (`skipVectors: true`, `skipInstanceChildren: true`).
3. Builds mutation lists:
   - **Rename:** TEXT nodes → first 30 chars of their text content. FRAME nodes with a default name (`startsWith('Frame')`) → first 30 chars of their first descendant TEXT.
   - **Text styles:** TEXT nodes without `textStyleId` → closest style by `fontSize × 10 + fontWeightDiff / 100`. Only bound if a match exists.
   - **Color variables:** SOLID fills without `colorVariableId` → closest COLOR variable by RGB Manhattan distance. **Only bound if distance ≤ `COLOR_MAX_DIST` (30).**
   - **Spacing/radius:** layout fields (`paddingTop/Right/Bottom/Left`, `itemSpacing`, `counterAxisSpacing`, `cornerRadius`, `topLeft/Right/BottomRight/LeftRadius`) without existing bindings → closest `spacing/*` or `radius/*` FLOAT variable by absolute value difference. **Only bound if diff ≤ `FLOAT_MAX_DIFF` (2).** Skipped on nodes whose name contains "illustration" or "vector".
   - **Clip content:** all container node types (`FRAME`, `COMPONENT`, `COMPONENT_SET`, `INSTANCE`, `GROUP`, `SECTION`) → `clipsContent: true`.
4. Sends mutations in batches:
   - `bulk_rename`, `bulk_apply_text_style`, `bulk_apply_fill_variable` — single calls.
   - `bulk_set_variable_binding`, `bulk_set_property` — chunked at `BULK_BINDING_CHUNK` (500) items per call.

**`standardize-page`:**
- Fetches top-level frames on current page.
- Processes up to `PAGE_CONCURRENCY` (3) frames in parallel using `Promise.all`. Individual frame failures are caught and logged without stopping remaining frames.

**`standardize-file`:**
- Iterates all pages, switches to each via `set_current_page`, calls `standardizePage()`.
- Page-level errors are caught and logged; processing continues to the next page.

**`clean`:**
- Deletes all files in `temp/` (except `.gitignore`) using `fs.rmSync({ force: true })`.

---

## 3. Prompt system

**File:** `prompts/system.md`

This file contains the system instructions for the AI assistant. 

When a CLI client makes its first request, the server reads this file and auto-injects its content as an `active_prompt` message. If the file is renamed or deleted, the AI will not receive any system instructions.

Because the server reads the file from disk on every new connection, changes to `system.md` take effect immediately without requiring a server restart.

**Prompt file content rule:** The system prompt must be a **generic, reusable workflow guide** — it describes *how* to approach a class of tasks, not *what* to do for a specific task. It must never contain task-specific data such as URLs, file keys, hex values scraped from a particular site, or target node IDs.

**Task-specific data belongs in `temp/`:** Extracted design tokens, build plans, site-specific specs, and intermediate scripts for a particular job should be written to `temp/<task-name>-*.md` (or `.js`, `.json`). The `temp/` folder is gitignored and is cleaned with `node tools/process.js clean`.

---

## 4. File structure

```
figlink/
├── start.js                        # Launcher, watcher, IPC parent
├── Windows Start Figlink.bat       # Windows double-click launcher
├── Mac Start Figlink.command       # Mac double-click launcher
│
├── figma-plugin/
│   ├── code.js                     # Plugin logic (Figma Plugin API)
│   ├── ui.html                     # Plugin UI + WebSocket bridge
│   └── manifest.json               # Figma plugin manifest
│
├── link-server/
│   ├── server.js                   # WebSocket relay (multi-file routing)
│   └── package.json                # ws dependency
│
├── tools/
│   ├── figma.js                    # One-shot CLI client (also exports sendCommand)
│   ├── process.js                  # Standardization processor
│   └── eval.js                     # Dev utility / REPL helper
│
├── prompts/
│   ├── system.md                   # System instructions auto-injected to AI
│   └── library/
│       ├── standardize.md          # Example instructions for standardization
│       └── website-recreation.md   # Example instructions for website recreation
│
├── docs/
│   └── TECHNICAL_ARCHITECTURE.md  # This file
│
└── temp/
    └── .gitignore                  # Keeps folder tracked, ignores temp contents
```

---

## 5. Full data flow example

```
1.  node start.js
    → checks if prompts/system.md exists
    → kills anything on port 9001 → spawns server.js
    → watches files for changes

2.  User opens Figma File A (key: "abc") and runs the plugin
    → ui.html connects to ws://localhost:9001
    → sends { type: 'register', role: 'plugin', fileKey: 'abc', fileName: 'Design System' }
    → server stores plugins.set('abc', { ws, name: 'Design System' })
    → server sends { type: 'registered', ... } back
    → plugin dot turns green

3.  AI runs: node tools/figma.js --file abc get_local_variables
    → figma.js opens a new WebSocket to ws://localhost:9001
    → sends { id: 'uuid-1', command: 'get_local_variables', params: {}, fileKey: 'abc' }
    → server receives first message from this client → reads system.md and sends active_prompt
    → server matches fileKey 'abc' → stores pending.set('uuid-1', { sender, fileKey: 'abc', createdAt })
    → server forwards { id: 'uuid-1', command: 'get_local_variables', params: {} } to plugin
    → plugin runs getLocalVariables() → posts { id: 'uuid-1', result: [...] } to ui.html
    → ui.html sends it over WebSocket to server
    → server finds pending entry 'uuid-1', deletes it, sends result to figma.js
    → figma.js prints JSON to stdout, closes WebSocket, exits 0

4.  AI edits figma-plugin/code.js
    → fs.watch fires after 300ms debounce
    → start.js logs the warning box
    → start.js sends { type: 'code_changed' } over IPC
    → server.js broadcasts { type: 'code_changed' } to all connected plugins
    → plugin ui.html shows the "Plugin code updated" banner
    → user closes and re-runs the plugin
```

---

## 6. Error handling

| Scenario | Behaviour |
|----------|-----------|
| JSON parse failure on server | `console.warn` with first 120 chars of raw message; message dropped |
| `system.md` unreadable at runtime | Injection silently skipped; AI receives no prompt |
| Plugin disconnects mid-command | All pending requests for that fileKey resolved with disconnect error |
| Pending entry not answered in 30s | TTL sweep sends timeout error to caller; entry deleted |
| Sender closed before plugin responds | `pending.delete` still runs; send skipped if `readyState !== OPEN` |
| Unnamed plugin fileKey collision | Prevented by appending `${Date.now()}-${5-char random}` |
| `setProperty` with unlisted field | Throws `Property "x" is not in the allowed list` |
| `applyFillVariable` with out-of-bounds `fillIndex` | Throws with fill count in message |
| `getNodes` with negative depth | Depth clamped to 0 |
| `figma.loadFontAsync` called repeatedly for same font | `ensureFontLoaded` cache prevents redundant async calls |
| Empty `valuesByMode` on FLOAT variable | Variable silently skipped during `floatVars` construction in process.js |
| Color match too far from any variable | Skipped when RGB Manhattan distance > `COLOR_MAX_DIST` (30) |
| Spacing/radius match too far from any variable | Skipped when diff > `FLOAT_MAX_DIFF` (2) |
| Library variable import failure | `console.warn` with variable name and key; other variables still imported |
| Variable ID resolution failure | `console.warn`; skipped in result |
| Text style ID lookup failure | `console.warn`; node serialized without style name fields |
| WebSocket retry on disconnect | Exponential backoff: 2.5s → 5s → 10s → 20s → 30s + ≤500ms jitter |
| Pending message buffer full (10 cap) | Oldest dropped; UI shows "Buffer full — some messages may be lost" |
| Plugin can't self-reload | `code_changed` banner shown; user must manually close and re-run |

---

## 7. Limitations

- **Plugin must stay open.** All commands time out if the plugin is closed. There is no persistent background execution inside Figma.
- **Plugin can't self-reload.** The Figma Plugin API does not expose a reload method. Code changes require the user to manually re-run the plugin.
- **IPC requires `start.js`.** Running `server.js` directly serves WebSocket clients normally, but `code_changed` notifications won't work.
- **`figma.fileKey` may be null.** On draft files or during plugin development, `figma.fileKey` is unavailable. The plugin falls back to `figma.root.name` as the fileKey. This can cause routing issues if two files have the same name.
- **Mixed properties.** `figma.mixed` is serialized as `null`. Fields with mixed values are skipped during standardization matching.
- **Vector payloads.** `skipVectors: true` is the default in `get_nodes_flat`. Large vector networks produce payloads that can approach WebSocket message size limits.
- **Standardization is non-transactional.** If a batch command fails partway through, earlier chunks are already applied. There is no rollback.
- **15 s CLI timeout insufficient for large-page operations.** `tools/figma.js` hard-codes a 15 s timeout. Commands that call `findAll` across a large page (e.g. `reset_instance_spacing` on a page with hundreds of instances) will exceed this. Use the inline WebSocket script pattern documented in `prompts/system.md` with a longer timeout (120 s recommended).
- **Team library access requires Figma Organization plan.** `figma.teamLibrary` APIs are only available in paid plans. On free plans, `getAllAvailableVariables` will only return local variables; the library collection call fails with a warning.
