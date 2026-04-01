# Figlink

Figlink lets an AI assistant (in any IDE) control your Figma files in real time — reading layers, renaming things, applying styles, binding variables, and more — just by you describing what you want.

---

## What is Figlink?

Figlink is a live connection between your AI coding assistant and Figma. Once set up, you tell your AI what you want done in Figma and it figures out the right commands and executes them directly inside your open Figma file.

The AI doesn't follow a fixed script. It reads the state of your file, thinks about what needs to change, and executes directly. You describe the goal — Figlink handles the execution.

Multiple Figma files can be connected simultaneously, so the AI can reference one file and act on another in the same workflow.

---

## How to set it up (one-time)

### Step 1 — Install the Figma plugin

In Figma desktop:
- Menu → Plugins → Development → Import plugin from manifest
- Navigate to the `figma-plugin/` folder and select `manifest.json`

### Step 2 — Add the figlink folder to your AI's IDE

Open the `figlink` folder in your IDE (VS Code, Cursor, Windsurf, etc.) as a workspace or project folder. This gives the AI direct access to the Figlink tools so it can run commands and extend the system as needed.

---

## Starting Figlink (every session)

### Windows
Double-click `Start Figlink.bat`

### Mac
Double-click `Start Figlink.command`
(If macOS asks, click Open to allow it.)

### Terminal
```bash
node start.js
```

This starts the link server and watches for file changes — if the AI edits the system, changes take effect automatically.

### Run the plugin in Figma

Open Figma → Plugins → Development → Figlink → Run

When the plugin shows a green dot and says **"Connected"**, Figlink is live. The sub-text shows the connected file name (e.g. `Design System · ready`).

---

## How to use it

1. Start the link server
2. Open your Figma file(s) and run the Figlink plugin in each
3. Open a chat with your AI assistant
4. Tell the AI what you want done

**Example prompts:**
- "Use Figlink to read the selected frame and tell me what layers are in it"
- "Rename all the generic frame names in this selection to match their content"
- "Apply spacing variables to the padding and gaps in this frame"
- "Look at the design system in file A and apply its color variables to the frame at this link: [link]"

---

## What the AI can do

- **Read** — Node trees, text content, fills, styles, variables, layout properties
- **Rename** — Single nodes or bulk rename across a selection
- **Text** — Set text content, link text nodes to text styles
- **Colors** — Apply color styles or bind fills to color variables
- **Spacing & radius** — Bind padding, gaps, and corner radius to variables
- **Properties** — Set any writable property (opacity, clip content, etc.)
- **Multi-file** — Read from one file and act on another in the same session

---

## Commands reference (for the AI)

All tools live in `tools/`. Run from the codebase root:

```bash
node tools/figma.js [--file <fileKey|figmaUrl>] <command> [params-json]
```

Output is always JSON. Errors go to stderr with exit code 1.

### Working with Figma links

**`parse_link`** — Parse a Figma URL into fileKey + nodeId. Run this first on any link the user provides.
```bash
node tools/figma.js parse_link https://figma.com/design/abc123/Name?node-id=488-513
# { "fileKey": "abc123", "nodeId": "488:513" }
```

**`list_connected_files`** — See all files with an active plugin connection.
```bash
node tools/figma.js list_connected_files
# [{ "fileKey": "abc123", "name": "Design System" }, ...]
```

**`--file`** — Target a specific connected file. Accepts a file key or a full Figma URL.
```bash
node tools/figma.js --file abc123 get_local_styles
node tools/figma.js --file https://figma.com/design/abc123/Name ping
```
Omit `--file` when only one file is connected.

---

### Read

**`ping`** — Check connection.
```bash
node tools/figma.js ping
```

**`get_selection`** — Get currently selected nodes (depth 3).
```bash
node tools/figma.js get_selection
```

**`get_nodes`** — Get a node tree by ID.
```bash
node tools/figma.js get_nodes '{"nodeId":"488:373","depth":3}'
```

**`get_nodes_flat`** — Get all descendants as a flat array.
```bash
node tools/figma.js get_nodes_flat '{"nodeId":"488:373"}'
```

**`get_local_styles`** — Get all text and color styles in the file.
```bash
node tools/figma.js get_local_styles
```

**`get_local_variables`** — Get variable collections defined locally.
```bash
node tools/figma.js get_local_variables
```

**`get_all_document_variables`** — Get all variables bound anywhere in the document, including library variables.
```bash
node tools/figma.js get_all_document_variables
```

**`resolve_variables`** — Look up specific variables by ID.
```bash
node tools/figma.js resolve_variables '{"ids":["VariableID:abc/123"]}'
```

**`get_page_frames`** — Get top-level frames on the current page.
```bash
node tools/figma.js get_page_frames
```

**`get_pages`** — Get all pages in the file.
```bash
node tools/figma.js get_pages
```

**`set_current_page`** — Switch the active page.
```bash
node tools/figma.js set_current_page '{"pageId":"0:2"}'
```

---

### Rename

**`rename_node`** — Rename a single node.
```bash
node tools/figma.js rename_node '{"nodeId":"488:616","name":"container"}'
```

**`bulk_rename`** — Rename multiple nodes.
```bash
node tools/figma.js bulk_rename '{"renames":[{"nodeId":"488:616","name":"container"},{"nodeId":"488:617","name":"label"}]}'
```

---

### Text

**`set_characters`** — Set text content on a text node.
```bash
node tools/figma.js set_characters '{"nodeId":"488:513","text":"Log in to your account"}'
```

**`bulk_set_characters`** — Set text on multiple nodes.
```bash
node tools/figma.js bulk_set_characters '{"items":[{"nodeId":"488:513","text":"Log in"},{"nodeId":"488:514","text":"Continue"}]}'
```

**`apply_text_style`** — Link a text node to a text style.
```bash
node tools/figma.js apply_text_style '{"nodeId":"488:513","styleId":"S:abc123"}'
```

**`bulk_apply_text_style`** — Link multiple text nodes to text styles.
```bash
node tools/figma.js bulk_apply_text_style '{"items":[{"nodeId":"488:513","styleId":"S:abc"},{"nodeId":"488:514","styleId":"S:def"}]}'
```

---

### Colors

**`apply_fill_style`** — Apply a color style to a node's fill.
```bash
node tools/figma.js apply_fill_style '{"nodeId":"488:616","styleId":"S:abc123"}'
```

**`apply_fill_variable`** — Bind a fill to a color variable.
```bash
node tools/figma.js apply_fill_variable '{"nodeId":"488:616","variableId":"VariableID:abc/123","fillIndex":0}'
```

**`bulk_apply_fill_variable`** — Bind fills on multiple nodes.
```bash
node tools/figma.js bulk_apply_fill_variable '{"items":[{"nodeId":"488:616","variableId":"VariableID:abc/123","fillIndex":0}]}'
```

---

### Variable bindings

**`set_variable_binding`** — Bind a layout field to a variable.
```bash
node tools/figma.js set_variable_binding '{"nodeId":"488:616","field":"paddingTop","variableId":"VariableID:abc/123"}'
```

Fields: `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`, `itemSpacing`, `counterAxisSpacing`, `cornerRadius`, `topLeftRadius`, `topRightRadius`, `bottomRightRadius`, `bottomLeftRadius`

**`bulk_set_variable_binding`** — Bind multiple fields across multiple nodes.
```bash
node tools/figma.js bulk_set_variable_binding '{"items":[{"nodeId":"488:616","field":"paddingTop","variableId":"VariableID:abc/123"}]}'
```

**`remove_variable_binding`** — Unbind a variable from a field.
```bash
node tools/figma.js remove_variable_binding '{"nodeId":"488:616","field":"paddingTop"}'
```

---

### Raw property

**`set_property`** — Set any writable property directly.
```bash
node tools/figma.js set_property '{"nodeId":"488:616","field":"opacity","value":0.5}'
```

---

## For large bulk operations

Use inline Node.js to avoid shell escaping issues:

```bash
node -e "
const WebSocket = require('./link-server/node_modules/ws');
const { randomUUID } = require('crypto');
const items = [/* your array here */];
const ws = new WebSocket('ws://localhost:9001');
ws.on('open', () => {
  const id = randomUUID();
  ws.send(JSON.stringify({ id, command: 'bulk_set_variable_binding', params: { items } }));
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id !== id) return;
    ws.close();
    console.log(JSON.stringify(msg.result, null, 2));
    process.exit(0);
  });
});
"
```

---

## Temp files

Any intermediate files (JSON output, debug data, etc.) must go in `temp/`:

```bash
node tools/figma.js get_local_variables > temp/variables.json
```

Run `node tools/process.js clean` to wipe the folder when done.

---

## Node data shape

```json
{
  "id": "488:616",
  "name": "container",
  "type": "FRAME",
  "fills": [{ "type": "SOLID", "color": { "r": 255, "g": 255, "b": 255 }, "colorVariableId": "VariableID:..." }],
  "boundVariables": { "paddingTop": "VariableID:..." },
  "paddingTop": 16, "paddingRight": 16, "paddingBottom": 16, "paddingLeft": 16,
  "itemSpacing": 8,
  "cornerRadius": 8,
  "children": [...]
}
```

TEXT nodes additionally include:
```json
{
  "text": "Log in to your account",
  "textStyleId": "S:abc123",
  "textStyleName": "body/md"
}
```

`colorVariableId` on a fill means it's already bound. `textStyleId` on a text node means it's already linked.

---

## Troubleshooting

**Orange dot / "Connecting"** — Link server isn't running. Start it with `Start Figlink.bat`, `Start Figlink.command`, or `node start.js`.

**"Figma plugin not connected"** — Plugin isn't running. Open Figma → Plugins → Development → Figlink → Run.

**"Multiple files connected — specify --file"** — More than one Figma file has the plugin open. Add `--file <fileKey>` to your command.

**"File X not connected"** — The file key from the link doesn't match any connected plugin. Open that file in Figma and run the plugin.

**"Timeout"** — Server is running but plugin isn't open, or you're on the wrong file.

**"Plugin code updated" banner** — AI updated `code.js`. Close and re-open the plugin. Shortcut: `⌘⌥P` (Mac) / `Ctrl+Alt+P` (Windows).
