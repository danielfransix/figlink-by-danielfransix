# Technical Architecture: Figlink

Figlink enables external scripts and AI agents to interact programmatically with live Figma documents in real time. It bypasses Figma's REST API limitations by creating a direct WebSocket connection between a local Node.js environment and running Figma plugin instances.

Figlink supports **two modes of operation** that share the same plugin and link server:

| Mode | AI Connection | Transport |
|------|--------------|-----------|
| **Native IDE** | AI runs `node tools/figma.js` CLI commands via terminal | WebSocket `ws://localhost:9001` |
| **MCP (Local / Web)** | AI calls typed tools through an MCP server | Streamable HTTP `http://localhost:39399` |

Both modes use the **same plugin** (`figma-plugin/`) and **same link server** (`link-server/`). The AI chooses the mode; the plugin doesn't know the difference.

---

## 1. System Overview

```
┌───────────────────────────────────────────────────────────────────────────┐
│  MODE 1 — Native IDE                                                      │
│                                                                           │
│  AI in IDE                                                                │
│    │  terminal: node tools/figma.js get_selection                         │
│    ▼                                                                      │
│  tools/figma.js  ──ws──►  link-server/server.js  ◄──ws──  figma-plugin/  │
│  (one-shot client)        (ws://localhost:9001)           (code.js + ui)  │
└───────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────┐
│  MODE 2 — MCP (Local IDE or Web AI via ngrok)                             │
│                                                                           │
│  AI in IDE / Web AI                                                       │
│    │  Streamable HTTP to localhost:39399 or ngrok URL                     │
│    ▼                                                                      │
│  figma-mcp/server.js                                                      │
│    │  bridge.sendCommand(command, params, fileKey)                        │
│    ▼                                                                      │
│  figma-mcp/bridge.js  ──ws──►  link-server/server.js  ◄──ws──  plugin/   │
│  (persistent WebSocket)       (ws://localhost:9001)           (code.js)   │
└───────────────────────────────────────────────────────────────────────────┘
```

**The bridge is the key difference.** In Native IDE mode, the AI spawns a new `ws` connection per command (one-shot). In MCP mode, the bridge maintains a persistent WebSocket to the link server, and `server.js` calls `bridge.sendCommand()` for every MCP tool invocation.

**Shared backend:**
```
start.js  (launcher / watcher / IPC parent)
    │
    │  IPC channel (stdio: ipc)
    ▼
link-server/server.js   ◄──── ws://localhost:9001 ────►  figma-plugin/ui.html ↔ code.js  (File A)
                                                    ────►  figma-plugin/ui.html ↔ code.js  (File B)
                              ▲                       
                              │  WebSocket            
                    ┌─────────┴─────────┐
                    │                   │
              tools/figma.js      figma-mcp/bridge.js
              (Native IDE)        (MCP mode)
```

---

## 2. Components

### `start.js` — Launcher, watcher, IPC parent

The single entry point for the core Figlink system. Coordinates everything at startup and keeps watching for changes.

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

A lightweight `ws`-based WebSocket server on port 9001. Routes commands between clients (CLI or MCP bridge) and Figma plugin instances. Multiple files can be connected simultaneously.

**Key data structures:**
```javascript
plugins: Map<fileKey, { ws, name }>         // One entry per connected Figma file
pending: Map<id, { sender, fileKey, createdAt }> // In-flight commands awaiting plugin response
```

**Connection lifecycle:**

1. **Plugin registration** — plugin sends `{ type: 'register', role: 'plugin', fileKey, fileName }`. If `fileKey` is absent, the server generates `unnamed-{timestamp}-{5-char random}` to avoid collisions. The entry is stored in `plugins`.

2. **First client message (auto-inject)** — on a client's very first message, the server attempts to read `prompts/system.md` from disk and sends it back as `{ type: 'active_prompt', id: 'system', content }`. If the file does not exist, the injection is silently skipped. The MCP bridge ignores this message (it only resolves by `msg.id` match).

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

**Plugin command categories:**

| Category | Commands |
|----------|---------|
| **Query** | `ping`, `get_selection`, `get_nodes`, `get_nodes_flat`, `get_page_frames`, `get_pages`, `set_current_page`, `get_local_styles`, `get_local_variables`, `get_all_available_variables`, `get_all_document_variables`, `resolve_variables` |
| **Rename** | `rename_node`, `bulk_rename` |
| **Text** | `set_characters`, `bulk_set_characters`, `apply_text_style`, `bulk_apply_text_style` |
| **Color** | `apply_fill_style`, `apply_fill_variable`, `bulk_apply_fill_variable` |
| **Variables** | `set_variable_binding`, `bulk_set_variable_binding`, `remove_variable_binding`, `create_variable_collection`, `create_variable`, `update_variable`, `rename_variable`, `delete_variable`, `delete_variable_collection`, `add_mode`, `rename_mode` |
| **Properties** | `set_property`, `bulk_set_property` (supports layout, typography, prototyping, and advanced auto-layout properties) |
| **Styles** | `duplicate_text_style`, `bulk_duplicate_text_style`, `set_style_property`, `bulk_set_style_property`, `set_style_variable_binding`, `bulk_set_style_variable_binding`, `delete_style`, `bulk_delete_style` |
| **Components** | `reset_instance_spacing`, `reset_instance_text_styles`, `unclip_text_parent_frames`, `clone_component_set`, `swap_instances`, `search_components`, `get_component_details`, `get_library_components`, `instantiate_component`, `add_component_property`, `edit_component_property`, `delete_component_property`, `analyze_component_set` |
| **Structure** | `create_node`, `create_node_tree`, `set_node_raw`, `delete_node`, `group_as_component_set`, `flatten_node`, `clone_node`, `move_node`, `resize_node` |
| **Screenshot** | `screenshot_selection`, `screenshot_node`, `screenshot_page_overview`, `find_and_screenshot`, `screenshot_frame_thumbnails`, `screenshot_node_with_context`, `screenshot_viewport_region` |
| **Viewport** | `get_viewport_info`, `find_visible_nodes`, `scroll_to_node` |
| **Export** | `export_node`, `find_image_nodes` |
| **Other** | `set_description`, `get_annotations`, `set_annotations`, `set_image_fill` |

**Key implementation details:**

- **Spatial coordinates** — `serializeNode()` includes `x`, `y`, `width`, `height` on every node that has them. This benefits both text-based and screenshot tools.
- `SETTABLE_PROPERTIES` — The exhaustive list of modifiable fields, expanded to include:
  - **Prototyping:** `reactions`, `scrollBehavior`, `overflowDirection`, `flowStartingPoints`
  - **Advanced Layout:** `layoutWrap`, `layoutPositioning`, `itemReverseZIndex`, `strokesIncludedInLayout`, `primaryAxisAlignItems`, `counterAxisAlignItems`
  - **Typography:** `lineHeight`, `letterSpacing`, `paragraphSpacing`, `textCase`, `textDecoration`, `textAlignHorizontal`, `textAlignVertical`, `textAutoResize`
  - **Styling:** `cornerSmoothing`, `rotation`
- `getNodes({ nodeId, depth })` — depth is clamped to `Math.max(0, depth)` before recursion.
- `getNodesFlat({ nodeId, skipVectors, skipInstanceChildren })` — walks the tree with a `depth > 100` recursion guard, with yield points every 1000 nodes (`await setTimeout(5)`) to prevent event loop starvation. Vector-type nodes are skipped when `skipVectors: true`. Instance children (IDs containing `;`) are skipped when `skipInstanceChildren: true`.
- `serializeNode(node, depth)` — recursively serializes nodes to plain objects. Handles `figma.mixed` (serialized as `null`), fills, bound variables, corner radius, padding/spacing, text properties, prototyping logic, and style names. Stops recursion at depth 0, includes `childCount` instead.
- `serializeBoundVariables(node)` — flattens bound variable objects to their `id` strings; normalizes both single bindings and array bindings.
- `getAllAvailableVariables()` — imports `COLOR` and `FLOAT` variables from all connected team library collections, deduplicates against local variables, logs failures via `console.warn`.
- `getAllDocumentVariables()` — walks the entire current page collecting all variable IDs from `boundVariables` and fill bindings, then resolves each. Logs individual resolution failures via `console.warn`.
- All font loads use `ensureFontLoaded(fontName)`.
- `swapInstances(containerId, newComponentSetId, searchPattern)` — finds instances in the container matching `searchPattern` (case-insensitive, defaults to `"button"`, empty string matches all). Matches variant properties by name parsing, swaps component, restores text, adjusts layout constraints.
- `cloneComponentSet` — marks unwanted variant components as `name: "DELETE_ME", visible: false` rather than deleting immediately.
- `resetInstanceSpacing(nodeId)` — walks the subtree, collects all `INSTANCE` nodes with auto-layout, compares 6 spacing fields against `mainComponent`, resets any that differ. Returns `{ instancesModified, fieldsReset, rootId, rootName }`.
- `resetInstanceTextStyles(nodeId)` — walks instances, finds descendant `TEXT` nodes, locates corresponding master text node via child-index path replay (`findCorrespondingMasterNode`), resets `textStyleId` if it differs.
- `unclipTextParentFrames(nodeId)` — finds container nodes with `clipsContent: true` and direct `TEXT` children, sets `clipsContent = false`.

#### Screenshot & Visual Agent

Screenshots are an additional data modality alongside text-based tools. The AI receives real rendered images directly through the MCP protocol.

**Core pattern:**
```javascript
const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
const base64 = uint8ToBase64(bytes);
return {
  __figlink_result_type: 'image',
  data: base64,
  mimeType: 'image/png',
  metadata: { nodeId, name, type, format, scale, width, height }
};
```

**Key screenshot utilities:**

- `uint8ToBase64(bytes)` — chunked base64 encoding using 32KB chunks via `String.fromCharCode.apply()`. Avoids O(n²) garbage collection on large exports.
- `exportNodeAsImage(node, options)` — unified export entry point. Auto-scale-down: if a node's longest dimension exceeds 4000px at the requested scale, the scale is automatically reduced. Returns the `__figlink_result_type: 'image'` envelope.
- `deduplicateNodes(nodes)` — walks the parent chain of each node. If any ancestor is already in the result set, the child is excluded. Prevents redundant screenshots (e.g. selecting a Frame and a Button inside it yields one image of the Frame).
- All gallery-style screenshot tools follow this pattern: **dedup → paginate (`page`/`pageSize`/`hasMore`) → concurrent export (batch of 5) → partial-failure handling** (failed items become text error items instead of crashing the entire response).

**Screenshot tools:**

| Tool | Description |
|------|-------------|
| `screenshot_selection` | Multi-selection export with deduplication and pagination. Spatial summary included. |
| `screenshot_node` | Export a single node by ID. |
| `screenshot_page_overview` | Birds-eye view of the entire current page. Falls back to frame gallery if full-page export fails. |
| `find_and_screenshot` | Search for nodes by name/type/text content and screenshot all matches. Paginated with yield points. |
| `screenshot_frame_thumbnails` | Thumbnail gallery of every top-level frame. Paginated. |
| `screenshot_node_with_context` | Export a node plus its containing frame (detail + surroundings). |
| `screenshot_viewport_region` | Capture what the user sees on screen. Deduplicated. Dominant-frame optimization: if one frame fills >80% of the viewport, returns just that one. |

**Viewport tools:**

| Tool | Description |
|------|-------------|
| `get_viewport_info` | Current viewport center, zoom level, and visible bounds (`figma.viewport`). |
| `find_visible_nodes` | List top-level frames intersecting the viewport, with IDs, names, and bounding boxes. |
| `scroll_to_node` | Center the Figma canvas on a specific node (`figma.viewport.scrollAndZoomIntoView`). |

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
- On `ws.onclose`: computes retry delay with **exponential backoff + jitter**: `Math.min(30000, 2500 × 2^retryAttempt) + rand(0, 500)ms`. Increments `retryAttempt`. Gives delays of ~2.5s, ~5s, ~10s, ~20s, capped at ~30s.
- `pendingMessages` — up to 10 messages buffered when disconnected, flushed on reconnect. When cap is hit, oldest dropped.

**UI details:**
- Font: Cal Sans (Google Fonts CDN). Dark theme (`#141414`).
- Status dot: green (connected), orange pulsing (connecting), red (error).

---

### `figma-mcp/bridge.js` — Persistent WebSocket bridge

Maintains a long-lived WebSocket connection to `ws://localhost:9001`. Exposes a single `sendCommand(command, params, fileKey, timeoutMs)` API.

**Key design:**
```javascript
class FiglinkBridge {
  async sendCommand(command, params, fileKey, timeoutMs) {
    const id = randomUUID();
    const msg = { id, command, params: { ...params }, fileKey };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Command timed out')), timeoutMs || 30 * 60 * 1000);
      this.pending.set(id, { resolve, reject, timeout: timer });
      this.ws.send(JSON.stringify(msg));
    });
  }
}
```

- **Persistent connection** — one WebSocket for all MCP tool calls. No connect-per-call overhead.
- **30-minute default timeout** — much longer than the CLI's 15 s, accommodating large-page operations.
- **Auto-reconnect** — on disconnect, retries every 5 seconds until reconnected. During reconnect, pending commands reject with a disconnect error.
- **Ignores `active_prompt`** — the bridge resolves only by `msg.id` match, so the auto-injected system prompt is silently discarded.

---

### `figma-mcp/server.js` — MCP HTTP server

An HTTP server on port 39399 that exposes Figlink as typed MCP tools using `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`.

**Dependencies:**
- `@modelcontextprotocol/sdk` v1.29.0 — MCP server and Streamable HTTP transport
- `zod` — runtime parameter validation for all tools

**Port:** `39399` (changed from `3000` in v1.0.1 to avoid conflicts with other local tools).

**Transport:** Streamable HTTP at `http://localhost:39399`. Uses `sessionIdGenerator: () => randomUUID()` with automatic session tracking (`transports` map). Sessions expire when the client disconnects; the map entry is deleted in `onsessionclosed`.

**Response formatting:**

The server distinguishes three result types from the plugin using the `__figlink_result_type` envelope:

| Envelope | Contains | MCP Output |
|----------|---------|------------|
| `{ __figlink_result_type: 'image', data, mimeType, metadata }` | Base64 image + metadata | `[{ type: 'image', data, mimeType }, { type: 'text', text: JSON(metadata) }]` |
| `{ __figlink_result_type: 'mixed', items: [...] }` | Mixed image + text items | Each item mapped to `type: 'image'` or `type: 'text'` |
| (any other result) | Plain JSON | `[{ type: 'text', text: JSON(result) }]` |

```javascript
function formatResult(result) {
  if (result?.__figlink_result_type === 'image') return imageContent(result);
  if (result?.__figlink_result_type === 'mixed') return mixedContent(result);
  return jsonContent(result);
}
```

**MCP tool categories:**

| Category | Example tools | Output format |
|----------|--------------|---------------|
| **Query** | `figma_ping`, `figma_get_selection`, `figma_get_nodes`, `figma_get_page_frames`, `figma_parse_link` | `jsonContent` |
| **Styles** | `figma_get_local_styles`, `figma_apply_text_style`, `figma_set_style_property`, `figma_delete_style` | `jsonContent` |
| **Variables** | `figma_get_local_variables`, `figma_set_variable_binding`, `figma_create_variable`, `figma_import_variables_by_key` | `jsonContent` |
| **Properties** | `figma_set_property` (accepts `items[]`) | `jsonContent` |
| **Text** | `figma_set_characters`, `figma_rename_node` | `jsonContent` |
| **Structure** | `figma_create_node`, `figma_delete_node`, `figma_flatten_node`, `figma_group_as_component_set` | `jsonContent` |
| **Components** | `figma_swap_instances`, `figma_clone_component_set`, `figma_instantiate_component`, `figma_search_components` | `jsonContent` |
| **Screenshot** | `figma_screenshot_selection`, `figma_screenshot_node`, `figma_screenshot_by_link`, `figma_find_and_screenshot`, `figma_screenshot_page_overview`, `figma_screenshot_frame_thumbnails`, `figma_screenshot_node_with_context`, `figma_screenshot_viewport_region` | `formatResult` (image or mixed) |
| **Viewport** | `figma_get_viewport_info`, `figma_find_visible_nodes`, `figma_scroll_to_node` | `jsonContent` |
| **Export** | `figma_export_node`, `figma_find_image_nodes` | `formatResult` / `jsonContent` |
| **Instance Reset** | `figma_reset_instance_spacing`, `figma_reset_instance_text_styles`, `figma_unclip_text_parent_frames` | `jsonContent` |
| **Other** | `figma_set_image_fill`, `figma_get_annotations`, `figma_set_annotations` | `jsonContent` |

**Total: 76 MCP tools**

---

### `figma-mcp/start-mcp.bat` / `.command` — MCP startup scripts

**Windows (`start-mcp.bat`):**
1. Checks Node.js is installed.
2. Starts **Figlink link-server** on `ws://localhost:9001` (via `node start.js` in a new terminal).
3. Installs MCP dependencies (`npm install` in `figma-mcp/`) if `node_modules` is absent.
4. **Auto-starts ngrok** on port 39399 if `ngrok` is in PATH (for Web AI mode). Opens a separate terminal.
5. Starts **MCP server** on `http://localhost:39399` in a new terminal.

**Mac (`start-mcp.command`):** Same logic, adapted for macOS shell (`&&` chaining, `open -a Terminal`).

---

### `tools/figma.js` — One-shot CLI client (Native IDE mode)

Sends a single command, prints the JSON result, exits. Used by AI agents for individual Figma API calls in Native IDE mode.

```bash
node tools/figma.js [--file <fileKey|figmaUrl>] <command> [params-json]
```

**`--file` flag:** Accepts a raw file key or a full Figma URL. Handles both URL formats (old `node-id=123%3A456` and new `node-id=123-456`).

**Local commands (no server connection):**
- `parse_link <url>` — returns `{ fileKey, nodeId }` for any Figma URL.
- `list_connected_files` — returns all files with an active plugin connection.

**Connection behavior:**
- Opens a new WebSocket per invocation. 15 s timeout (`COMMAND_TIMEOUT_MS = 15000`).
- Exports `sendCommand` so `tools/process.js` can reuse the WebSocket helper.

---

### `tools/process.js` — Standardization processor

Implements the design system standardization workflow. Uses `sendCommand` from the same file.

**CLI:**
```bash
node tools/process.js [--file <fileKey|figmaUrl>] standardize <nodeId>
node tools/process.js [--file <fileKey|figmaUrl>] standardize-page
node tools/process.js [--file <fileKey|figmaUrl>] standardize-file
node tools/process.js clean
```

**Configuration constants:**
```javascript
const BULK_BINDING_CHUNK     = 500;    // Items per bulk_set_variable_binding call
const STANDARDIZE_TIMEOUT_MS = 300000; // 5 min timeout for get_all_available_variables
const PAGE_CONCURRENCY       = 3;      // Frames processed in parallel per page
const COLOR_MAX_DIST         = 30;     // Max RGB Manhattan distance to bind a color variable
const FLOAT_MAX_DIFF         = 2;      // Max pixel difference to bind a spacing/radius variable
```

**`standardize <nodeId>`:**
1. Fetches all `COLOR` and `FLOAT` variables and local text styles.
2. Fetches all descendants of the target frame as a flat array.
3. Builds mutation lists (rename, text styles, color variables, spacing/radius, clip content).
4. Chunks `bulk_set_variable_binding` and `bulk_set_property` at 500 items per call.

**`standardize-page`:** Processes up to 3 frames in parallel via `Promise.all`. Frame failures are caught and logged.

**`standardize-file`:** Iterates all pages, switches to each, calls `standardizePage()`.

---

## 3. Two Modes of Operation

### Native IDE Mode

**Start:** `Windows Start Figlink.bat` / `Mac Start Figlink.command` (or `node start.js`).

The AI runs commands by executing `node tools/figma.js` in the terminal. Each command opens a new WebSocket, sends the command, prints JSON to stdout, and exits.

**Best for:** AI IDEs with terminal access (Cursor, Windsurf, Trae, VS Code). No extra dependencies.

### MCP Mode

**Start:** `start-mcp.bat` / `start-mcp.command`.

The AI connects to `http://localhost:39399` (or an ngrok URL for web AIs) and discovers 76 typed tools. Each tool invocation calls `bridge.sendCommand()` internally, reusing the same persistent WebSocket connection.

**Best for:** Any IDE with MCP support (Cursor, Claude Desktop, Copilot), or web-based AIs (Notion AI, Claude web, ChatGPT) via ngrok.

**Local IDE MCP configuration:**
```json
{
  "mcpServers": {
    "figlink": {
      "url": "http://localhost:39399/",
      "transport": "streamable-http"
    }
  }
}
```

**Web AI via ngrok:**
```
ngrok http 39399
```
Paste the ngrok Forwarding URL into the web AI's MCP endpoint field.

---

## 4. Prompt system

**File:** `prompts/system.md`

Contains the system instructions for the AI assistant. When a CLI client makes its first request, the server reads this file and auto-injects its content as an `active_prompt` message. The MCP bridge silently ignores this message.

Changes to `system.md` take effect immediately without requiring a server restart.

**Content rule:** The system prompt must be a generic, reusable workflow guide. Task-specific data (URLs, file keys, hex values) belongs in `temp/`.

---

## 5. File structure

```
figlink/
├── README.md                       # User guide with setup for all modes
├── TECHNICAL_ARCHITECTURE.md       # This file
├── .gitignore
│
├── figlink-codebase/               # Core Figlink system
│   ├── start.js                    # Launcher, watcher, IPC parent
│   ├── Windows Start Figlink.bat   # Windows double-click launcher
│   ├── Mac Start Figlink.command   # Mac double-click launcher
│   ├── figma-plugin/
│   │   ├── code.js                 # Plugin logic (Figma Plugin API)
│   │   ├── ui.html                 # Plugin UI + WebSocket bridge
│   │   └── manifest.json           # Figma plugin manifest
│   ├── link-server/
│   │   ├── server.js               # WebSocket relay (multi-file routing)
│   │   └── package.json            # ws dependency
│   ├── tools/
│   │   ├── figma.js                # One-shot CLI client (Native IDE mode)
│   │   ├── process.js              # Standardization processor
│   │   ├── bulk-operations.js      # Bulk instance swap / relinking
│   │   └── export.js               # Export utilities
│   ├── prompts/
│   │   ├── system.md               # System instructions auto-injected to AI
│   │   └── library/                # Prompt templates
│   └── temp/                       # Task-specific data (gitignored)
│
├── figma-mcp/                      # MCP server subsystem
│   ├── server.js                   # MCP HTTP server (76 tools, port 39399)
│   ├── bridge.js                   # Persistent WebSocket to link server
│   ├── start-mcp.bat               # Windows startup (auto-starts ngrok)
│   ├── start-mcp.command           # Mac startup
│   └── package.json                # @modelcontextprotocol/sdk + zod
│
├── release-notes/                  # Version release notes
│   ├── v1.0.0-may-16.md
│   └── v1.0.1-may-16.md
│
└── .vscode/                        # IDE settings
    └── settings.json
```

---

## 6. Full data flow examples

### Native IDE Mode

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
    → server receives first message → reads system.md → sends active_prompt (ignored)
    → server matches fileKey 'abc' → stores pending.set('uuid-1', { sender, fileKey, createdAt })
    → server forwards { id: 'uuid-1', command: 'get_local_variables', params: {} } to plugin
    → plugin runs getLocalVariables() → posts { id: 'uuid-1', result: [...] } to ui.html
    → ui.html sends over WebSocket to server
    → server finds pending entry 'uuid-1', deletes it, sends result to figma.js
    → figma.js prints JSON to stdout, closes WebSocket, exits 0

4.  AI edits figma-plugin/code.js
    → fs.watch fires after 300ms debounce
    → start.js sends { type: 'code_changed' } over IPC
    → server.js broadcasts { type: 'code_changed' } to all connected plugins
    → plugin ui.html shows "Plugin code updated" banner
    → user closes and re-runs the plugin
```

### MCP Mode

```
1.  start-mcp.bat
    → starts Figlink server (node start.js)
    → installs MCP deps if needed (npm install)
    → auto-starts ngrok http 39399 (if ngrok in PATH)
    → starts MCP server (node server.js)

2.  bridge.js connects to ws://localhost:9001 (persistent connection)
    → logs "[figlink-bridge] Connected to Figlink server"

3.  MCP server starts on http://localhost:39399
    → AI client (IDE or web) sends initialize request
    → StreamableHTTPServerTransport creates session (randomUUID)
    → transports[id] = transport
    → AI discovers 76 figma_* tools

4.  User opens Figma and runs plugin (same as Native IDE)

5.  AI calls figma_screenshot_selection (example)
    → MCP server receives HTTP POST at / with JSON-RPC tool call
    → transport.handleRequest() routes to tool handler
    → handler calls bridge.sendCommand('screenshot_selection', params, fileKey)
    → bridge sends { id: 'uuid-5', command: 'screenshot_selection', params } over persistent ws
    → server routes to plugin → plugin exports images → returns base64 results
    → bridge resolves promise with { __figlink_result_type: 'mixed', items: [...] }
    → formatResult() maps to MCP ImageContent + TextContent
    → AI receives rendered screenshots directly in its context

6.  AI calls figma_scroll_to_node (viewport sync)
    → plugin runs figma.viewport.scrollAndZoomIntoView([node])
    → returns { ok: true, nodeId, scrolled: true }
    → user sees Figma canvas center on the target node
```

---

## 7. Error handling

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
| `figma.loadFontAsync` called repeatedly | `ensureFontLoaded` cache prevents redundant async calls |
| Empty `valuesByMode` on FLOAT variable | Variable silently skipped during `floatVars` construction |
| Color match too far from any variable | Skipped when RGB Manhattan distance > `COLOR_MAX_DIST` (30) |
| Spacing/radius match too far | Skipped when diff > `FLOAT_MAX_DIFF` (2) |
| Library variable import failure | `console.warn`; other variables still imported |
| Variable ID resolution failure | `console.warn`; skipped in result |
| Text style ID lookup failure | `console.warn`; node serialized without style name fields |
| WebSocket retry on disconnect | Exponential backoff: 2.5s → 5s → 10s → 20s → 30s + ≤500ms jitter |
| Pending message buffer full (10 cap) | Oldest dropped; UI shows "Buffer full" |
| Plugin can't self-reload | `code_changed` banner shown; user must manually close and re-run |
| Gallery screenshot partial failure | Failed items become text error entries; successful images still delivered |
| Auto-scale-down (export > 4000px) | Scale reduced automatically; actual scale reported in metadata |
| MCP session not found | Returns 404 with `{ code: -32001, message: 'Session not found' }` |
| MCP transport OAuth probe (`/.well-known/openid-configuration`) | Returns 404; safely ignored by AI platforms |
| MCP bridge disconnected from Figlink | Auto-reconnects every 5s; pending commands reject with disconnect error |
| ngrok not found in PATH | Script prints notice instead of crashing; user can run ngrok manually |
| `node.find()` iteration on large pages | Yield points every 1000 nodes (`await setTimeout(5)`) prevent event loop starvation |

---

## 8. Limitations

- **Plugin must stay open.** All commands time out if the plugin is closed. There is no persistent background execution inside Figma.
- **Plugin can't self-reload.** The Figma Plugin API does not expose a reload method. Code changes require the user to manually re-run the plugin.
- **IPC requires `start.js`.** Running `server.js` directly serves WebSocket clients normally, but `code_changed` notifications won't work.
- **`figma.fileKey` may be null.** On draft files or during plugin development, `figma.fileKey` is unavailable. The plugin falls back to `figma.root.name` as the fileKey. This can cause routing issues if two files have the same name.
- **Mixed properties.** `figma.mixed` is serialized as `null`. Fields with mixed values are skipped during standardization matching.
- **Vector payloads.** `skipVectors: true` is the default in `get_nodes_flat`. Large vector networks produce payloads that can approach WebSocket message size limits.
- **Standardization is non-transactional.** If a batch command fails partway through, earlier chunks are already applied. There is no rollback.
- **15 s CLI timeout insufficient for large-page operations.** `tools/figma.js` hard-codes a 15 s timeout. Commands that call `findAll` across a large page will exceed this. Use the MCP bridge (30-min timeout) or the inline WebSocket script pattern with a 120 s timeout.
- **Team library access requires Figma Organization plan.** `figma.teamLibrary` APIs are only available in paid plans. On free plans, `getAllAvailableVariables` will only return local variables.
- **MCP sessions are ephemeral.** The MCP server uses in-memory session storage. If the server restarts, all active sessions are lost and the AI must re-initialize.
- **Screenshots are synchronous within Figma.** `node.exportAsync()` runs on the Figma main thread. Large or numerous exports can cause brief UI freezes. Gallery tools mitigate this with concurrency caps (batch of 5).
- **No persistent MCP auth.** The MCP server has no authentication by design (runs on localhost). For ngrok exposure, use `ngrok http 39399 --basic-auth "user:pass"` if your platform requires credentials.
- **ngrok free plan has rotating URLs.** Each `ngrok http` invocation assigns a new subdomain. Web AI users must update their MCP endpoint URL after each restart. Upgrade to ngrok paid plan for a reserved domain.
