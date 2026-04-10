# Figlink — System Context

Figlink is a WebSocket bridge that lets an AI agent read and write a live Figma file in real time. A Node.js server (`link-server/server.js`) listens on `ws://localhost:9001`. A Figma plugin connects to it and executes commands on the canvas. CLI tools (`tools/figma.js`, `tools/process.js`) send those commands.

---

## Connection & Navigation

```bash
# Verify the server is reachable and the plugin is open
node tools/figma.js ping
node tools/figma.js list_connected_files

# If multiple files are open, target one explicitly
node tools/figma.js --file <fileKey> ping

# Parse a Figma URL → fileKey + nodeId
node tools/figma.js parse_link <figmaUrl>

# List pages; switch to the correct one before building
node tools/figma.js get_pages
node tools/figma.js set_current_page '{"pageId":"<id>"}'
```

**Rule:** If `list_connected_files` returns no matching file, stop and ask the user to open the Figlink plugin in the target Figma file before continuing.

---

## Core Command Reference

| Command | Tool | Notes |
|---------|------|-------|
| `ping` | figma.js | Health check |
| `list_connected_files` | figma.js | Lists open Figma files |
| `parse_link <url>` | figma.js | Extracts fileKey + nodeId |
| `get_pages` | figma.js | Lists all pages |
| `set_current_page` | figma.js | Switches active page |
| `get_page_frames` | figma.js | Top-level frames on current page |
| `get_nodes` | figma.js | Read node tree by id |
| `create_node_tree` | figma.js | Create node(s) from a JSON tree |
| `set_node_raw` | figma.js | Update a node's properties |
| `delete_node` | figma.js | Remove a node |
| `reset_instance_spacing` | figma.js | Restore spacing overrides on instances to match their master component |
| `standardize <nodeId>` | process.js | Run full standardization on a frame |
| `standardize-page` | process.js | Standardize all frames on current page |
| `clean` | process.js | Wipe the temp/ folder |

---

## Large-Page Operations

Some commands (e.g. `reset_instance_spacing`) use `findAll` across an entire page and can take longer than the 15 s default timeout in `tools/figma.js`. For these, use an inline script with a longer timeout:

```javascript
const WebSocket = require('./link-server/node_modules/ws');
const { randomUUID } = require('crypto');
const ws = new WebSocket('ws://localhost:9001');
const id = randomUUID();
const msg = { id, command: '<command>', params: { nodeId: '<id>' }, fileKey: '<fileKey>' };
let done = false;
const timeout = setTimeout(() => { if (!done) { console.error('TIMEOUT'); process.exit(1); } }, 120000);
ws.on('open', () => ws.send(JSON.stringify(msg)));
ws.on('message', (raw) => {
  const res = JSON.parse(raw.toString());
  if (res.type === 'active_prompt') return;
  if (res.id !== id) return;
  done = true; clearTimeout(timeout); ws.close();
  if (res.error) { console.error(JSON.stringify({ error: res.error })); process.exit(1); }
  console.log(JSON.stringify(res.result, null, 2));
  process.exit(0);
});
ws.on('error', (e) => { if (!done) { console.error(e.message); process.exit(1); } });
```

---

## Temp File Conventions

- All intermediate work (design specs, build plans, scripts) goes in `temp/`
- Name files after the target: `temp/<site>-design-spec.md`, `temp/<site>-build.js`
- Never rely on memory or approximation — extract real values from the source (CSS, API, live file)
- Run `node tools/process.js clean` when finished with a task

---

## Design Principles

- **Plan before executing** — write a layout plan to `temp/` before creating nodes
- **Build order** — atomic components → organism components → page frames
- **Auto layout everywhere** — use `layoutMode: 'HORIZONTAL'` or `'VERTICAL'` on every container; never absolute-position elements that should be responsive
- **Naming** — lowercase with dashes (`primary-button`, `icon-card`); never spaces
- **Exact values** — copy colors, spacing, and typography from the source; never approximate
