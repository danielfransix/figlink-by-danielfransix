# Figlink

Figlink lets an AI assistant (in any IDE) control your Figma file in real time — reading layers, renaming things, applying styles, binding variables, and more — just by you describing what you want.

---

## What is Figlink?

Figlink is a live connection between your AI coding assistant and Figma. Once set up, you tell your AI what you want done in Figma ("standardize this frame", "rename all the text layers", "apply the spacing variables") and it figures out the right commands and executes them directly inside your open Figma file.

The AI doesn't just follow a fixed script. It reads the state of your file, thinks about what needs to change, and writes or updates its own tools as needed to get the job done. You describe the goal — Figlink handles the execution.

---

## How to set it up (one-time)

### Step 1 — Install the Figma plugin

In Figma desktop:
- Menu → Plugins → Development → Import plugin from manifest
- Navigate to the `figma-plugin` folder inside `figlink` and select `manifest.json`

This installs the Figlink plugin into Figma. You only do this once.

### Step 2 — Add the figlink folder to your AI's IDE

Open the `figlink` folder in your IDE (VS Code, Cursor, Windsurf, etc.) as a workspace or project folder.

This is important — it gives the AI direct access to the Figlink system files so it can read, understand, and extend them as needed.

---

## Starting Figlink (every session)

### On Windows

Double-click `Start Figlink.bat` inside the figlink folder.

### On Mac

Double-click `Start Figlink.command` inside the figlink folder.
(If macOS asks, click Open to allow it.)

### Or from the terminal

Open a terminal, navigate into the figlink folder, and run:
```bash
node start.js
```

This starts the link server and watches for any file changes — so if the AI edits the system, changes take effect automatically without needing a restart.

### Run the plugin in Figma

Open Figma → Plugins → Development → Figlink → Run

When the plugin shows a green dot and says "Connected", Figlink is live and ready.

---

## How to use it

1. Start the link server (above)
2. Open your Figma file and run the Figlink plugin
3. In your IDE, open a chat with your AI assistant
4. Tell the AI what you want done in Figma

The AI has access to the figlink folder, so it can read the available tools, run commands, and even write new capabilities directly into the system if what you're asking isn't supported yet.

**Example prompts to get started:**
- "Use Figlink to read the selected frame and tell me what layers are in it"
- "Rename all the generic frame names in this selection to match their content"
- "Apply spacing variables to the padding and gaps in this frame"
- "Process this Figma frame and standardize the text styles and colors to match our design system"

You don't need to know any code. Just describe what you want. The AI reads the docs, runs the right commands, and reports back what it did.

---

## What the AI can do in Figma

Once connected, the AI can:

- **Read** — Get node trees, text content, fills, styles, variables, and layout properties
- **Rename** — Rename individual layers or bulk rename across a selection
- **Text** — Set text content and link text nodes to text styles
- **Colors** — Apply color styles or bind fills to color variables
- **Spacing & radius** — Bind padding, gaps, and corner radius to spacing/radius variables
- **Raw properties** — Set any writable property directly (opacity, clip content, etc.)

---

## Commands reference (for the AI)

The AI uses `figma.js` to send commands. From inside the figlink folder:

```bash
node figma.js <command> '<json-params>'
```

All output is JSON. Errors go to stderr and exit with code 1.

### Read

**`ping`** — Check the connection.
```bash
node figma.js ping
```

**`get_selection`** — Get the currently selected nodes (depth 3).
```bash
node figma.js get_selection
```

**`get_nodes`** — Get a node tree by ID.
```bash
node figma.js get_nodes '{"nodeId":"488:373","depth":3}'
```

**`get_nodes_flat`** — Get all descendants as a flat array.
```bash
node figma.js get_nodes_flat '{"nodeId":"488:373"}'
```

**`get_local_styles`** — Get all text and color styles in the file.
```bash
node figma.js get_local_styles
```

**`get_local_variables`** — Get variable collections defined locally.
```bash
node figma.js get_local_variables
```

**`get_all_document_variables`** — Get all variables bound anywhere in the document (including library variables).
```bash
node figma.js get_all_document_variables
```

**`resolve_variables`** — Look up specific variables by ID.
```bash
node figma.js resolve_variables '{"ids":["VariableID:abc/123"]}'
```

### Rename

**`rename_node`** — Rename a single node.
```bash
node figma.js rename_node '{"nodeId":"488:616","name":"container"}'
```

**`bulk_rename`** — Rename multiple nodes.
```bash
node figma.js bulk_rename '{"renames":[{"nodeId":"488:616","name":"container"},{"nodeId":"488:617","name":"label"}]}'
```

### Text

**`set_characters`** — Set text content on a text node.
```bash
node figma.js set_characters '{"nodeId":"488:513","text":"Log in to your account"}'
```

**`bulk_set_characters`** — Set text on multiple nodes.
```bash
node figma.js bulk_set_characters '{"items":[{"nodeId":"488:513","text":"Log in"},{"nodeId":"488:514","text":"Continue"}]}'
```

**`apply_text_style`** — Link a text node to a text style.
```bash
node figma.js apply_text_style '{"nodeId":"488:513","styleId":"S:abc123"}'
```

**`bulk_apply_text_style`** — Link multiple text nodes to text styles.
```bash
node figma.js bulk_apply_text_style '{"items":[{"nodeId":"488:513","styleId":"S:abc"},{"nodeId":"488:514","styleId":"S:def"}]}'
```

### Colors

**`apply_fill_style`** — Apply a color style to a node's fill.
```bash
node figma.js apply_fill_style '{"nodeId":"488:616","styleId":"S:abc123"}'
```

**`apply_fill_variable`** — Bind a fill to a color variable.
```bash
node figma.js apply_fill_variable '{"nodeId":"488:616","variableId":"VariableID:abc/123","fillIndex":0}'
```

**`bulk_apply_fill_variable`** — Bind fills on multiple nodes.
```bash
node figma.js bulk_apply_fill_variable '{"items":[{"nodeId":"488:616","variableId":"VariableID:abc/123","fillIndex":0}]}'
```

### Variable bindings (spacing, radius, etc.)

**`set_variable_binding`** — Bind a layout field to a variable.
```bash
node figma.js set_variable_binding '{"nodeId":"488:616","field":"paddingTop","variableId":"VariableID:abc/123"}'
```

Common fields: `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`, `itemSpacing`, `counterAxisSpacing`, `cornerRadius`, `topLeftRadius`, `topRightRadius`, `bottomRightRadius`, `bottomLeftRadius`

**`bulk_set_variable_binding`** — Bind multiple fields across multiple nodes.
```bash
node figma.js bulk_set_variable_binding '{"items":[{"nodeId":"488:616","field":"paddingTop","variableId":"VariableID:abc/123"}]}'
```

**`remove_variable_binding`** — Unbind a variable from a field.
```bash
node figma.js remove_variable_binding '{"nodeId":"488:616","field":"paddingTop"}'
```

### Raw property

**`set_property`** — Set any writable property directly.
```bash
node figma.js set_property '{"nodeId":"488:616","field":"opacity","value":0.5}'
```

---

## For large bulk operations

When passing large arrays of data, use inline Node.js to avoid shell escaping issues:

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

## Node data shape

`get_nodes` and `get_nodes_flat` return nodes like this:

```json
{
  "id": "488:616",
  "name": "container",
  "type": "FRAME",
  "fills": [{ "type": "SOLID", "color": { "r": 255, "g": 255, "b": 255 }, "colorVariableId": "VariableID:..." }],
  "boundVariables": { "paddingTop": "VariableID:...", "fills": ["VariableID:..."] },
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

`colorVariableId` on a fill means it's already bound to a variable. `textStyleId` on a text node means it's already linked to a text style.

---

## Troubleshooting

**Plugin shows orange dot / "Connecting"** — The link server isn't running. Start it with `Start Figlink.bat` (Windows), `Start Figlink.command` (Mac), or `node start.js` from the figlink folder.

**"Figma plugin not connected"** error — The plugin isn't running in Figma. Open Figma → Plugins → Development → Figlink → Run.

**"Timeout"** error — The link server is running but the plugin isn't open in Figma, or the plugin is open on a different file.

**Plugin says "Plugin code updated" banner** — The AI updated the plugin's source code. Close and re-open the plugin to load the new version. Shortcut: `⌘⌥P` on Mac, `Ctrl+Alt+P` on Windows.
