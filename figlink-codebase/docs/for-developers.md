# Figlink for Developers

Figlink gives an AI assistant full read/write access to a live Figma file through a local WebSocket bridge. For developers, this means you can automate the design side of your workflow the same way you already automate everything else.

---

## The problem it solves

Design files drift from code. Tokens get renamed in the codebase and nobody updates Figma. Spacing values diverge over time. Handoff docs go stale. And any bulk change to a design system — a rename, a restructure, a token migration — requires a designer to spend hours clicking through Figma manually.

Figlink makes Figma scriptable. Your AI can read your codebase, read the Figma file, compare them, and make the changes.

---

## Use cases

### Syncing design tokens from code to Figma

Your source of truth for tokens lives in code — a `tokens.json`, a `tailwind.config.js`, a CSS custom properties file. When a developer updates a value, Figma falls behind.

With Figlink, you can ask an AI to reconcile them:
> *"Read `tailwind.config.js`. Compare its color palette to the COLOR variables in this Figma file. For every mismatch, update the Figma variable to match the code value."*

> *"Read `design-tokens.json`. Every spacing value in the file has a corresponding FLOAT variable in Figma. Find them by name and update any that are out of sync."*

This can be made part of a regular workflow — run it after any token PR merges.

---

### Migrating a design system

When you rename a token, deprecate a component, or restructure a variable collection, the Figma file needs to follow. That used to mean asking a designer to manually hunt down every usage.

With Figlink, the AI handles the migration:
> *"The token `color-brand-500` has been renamed to `color-interactive-default`. Find every node in this file bound to the old variable and rebind it to the new one."*

> *"We split the `Button` component into `ButtonPrimary` and `ButtonSecondary`. Swap every instance in this file to the correct new component based on its current variant."*

---

### Automating design handoff prep

Before a file is handed off to engineering, it needs to be in a specific state: layers named semantically, variables bound (not hardcoded values), auto-layout applied correctly. This prep work is usually a designer's problem, but it's mechanical enough to automate.

With Figlink, a developer can run the prep themselves:
> *"Rename every layer in the selection to match our naming spec: frames named after their first text child, text nodes named after their content."*

> *"Find every fill in this frame that uses a hardcoded hex value and bind it to the closest matching color variable from the library."*

> *"Check all spacing values in this file against our 4px spacing scale. Anything that doesn't land on a grid value, flag it."*

---

### Validating Figma against your component library

Your React component library has a specific set of props, variants, and states. You want to verify the Figma file actually reflects them — before a sprint starts, not after.

With Figlink, the AI can cross-reference the two:
> *"Read the TypeScript props for `Button` in `src/components/Button.tsx`. Check the Figma component set for Button and verify every variant in the code has a corresponding variant in Figma. List any gaps."*

---

### Extracting a design token snapshot for CI

You want a JSON snapshot of current design tokens in Figma that your build pipeline can compare against the codebase. Instead of using the Figma REST API and writing a custom script:

> *"Get all COLOR and FLOAT variables from this file and output them as a JSON file at `temp/figma-tokens.json` in the format our token transformer expects."*

The AI reads the file and writes the output — no API key management, no custom integration code.

---

### Generating code from a Figma file

You want to translate what's in Figma directly into code — not as a one-time export, but driven by the actual live values in the file. With Figlink, the AI can read the Figma variables and styles and write the output in whatever format your project expects:

> *"Extract all COLOR variables from this file and generate a `src/styles/tokens.css` file using CSS custom properties."*

> *"Read all text styles and output a `typography` section for `tailwind.config.ts` that maps each style name to its font size, weight, and line height."*

> *"Get the spacing FLOAT variables and generate a `spacing` scale for Tailwind."*

Because the AI is reading the live file rather than a static export, the output reflects the current state of the design system at the moment you run it.

---

### Generating Figma content from data

You have a spreadsheet or database of content — product names, prices, descriptions — and you need it reflected in Figma screens for a presentation or review.

With Figlink:
> *"Here's a JSON array of 12 products. For each one, find the corresponding card component on this page and update the name, price, and description text layers."*

---

### Propagating a style change across a large file

A designer changes a base text style and now 30 derived styles are out of sync. Or a brand color shifted and every component that uses a semantic alias needs to be checked.

With Figlink, you can script the propagation:
> *"The base font size for `body-md` changed from 14px to 15px. Find every text style that inherits from it — same weight and line height, just the size — and update them proportionally."*

---

### Running a design audit on demand

Before a release, you want to know the state of the file: are there hardcoded values, missing variable bindings, layers with no name, contrast failures?

With Figlink the AI can audit the whole file and return a report:
> *"Audit this file. List every node with a hardcoded fill color (not bound to a variable), every text node not attached to a text style, and every frame with a hardcoded border radius."*

This becomes a checkable artifact the same way a linting report is.

---

### Localization and content updates at scale

When you need to push translated copy into a Figma file across multiple screens — or keep a staging file in sync with content changes — updating text nodes one at a time is not viable.

With Figlink, the AI can apply bulk text changes programmatically:
> *"Here is a JSON map of node IDs to French translations. Update every text layer in the file to its translated value."*

> *"Every text node in this file that contains the old product name should be updated to the new one."*

---

## How it fits into a developer workflow

Figlink runs locally. There's no cloud dependency, no API key for the Figma file, no separate service to manage. You start a local server, the plugin runs in Figma Desktop, and any AI with terminal access can issue commands to that file. Multiple files can be connected at the same time — the server routes commands to the right one by file key.

**For one-off tasks**, prompt the AI in natural language. It will call `tools/figma.js` directly.

**For repeatable workflows**, the AI can write a script to `temp/` and execute it. The `temp/` folder is gitignored — it's the working area for task-specific files, intermediate data, and automation scripts. Clean it with `node tools/process.js clean` when done.

**For plugin code changes**, edit `figma-plugin/code.js` directly. `start.js` watches the file and broadcasts a `code_changed` notification to all connected plugins instantly. You only need to close and re-run the plugin inside Figma — no server restart.

---

## Working with multiple files

When more than one Figma file has the plugin running, commands need to know which file to target. Use the `--file` flag with either a file key or a full Figma URL:

```bash
node tools/figma.js --file <fileKey> get_page_frames
node tools/figma.js --file "https://www.figma.com/design/abc123/..." get_local_variables
```

If only one file is connected and `--file` is omitted, that file is used automatically. To see all currently connected files:

```bash
node tools/figma.js list_connected_files
```

---

## Writing automation scripts

For tasks that go beyond a single command, write a script in `temp/` that calls `sendCommand` directly. The helper is exported from `tools/process.js`:

```javascript
// temp/my-script.js
const { sendCommand } = require('../tools/process.js');

async function run() {
  const variables = await sendCommand('get_local_variables', {});
  // ... transform, compare, decide what to update
  await sendCommand('bulk_set_variable_binding', { bindings: [...] });
}

run().catch(console.error);
```

Run it with:
```bash
node temp/my-script.js
```

The default timeout in `sendCommand` is 180 seconds. For commands that scan large pages (such as `reset_instance_spacing` across hundreds of instances), pass a higher value explicitly:

```javascript
await sendCommand('reset_instance_spacing', { nodeId: '...' }, 300000);
```

---

## Extending the plugin

The plugin's command surface lives entirely in `figma-plugin/code.js`. To add a new capability, add a handler to the `handleCommand` switch block:

```javascript
case 'my_new_command': {
  const { nodeId } = params;
  const node = await figma.getNodeByIdAsync(nodeId);
  // ... do something with the Figma Plugin API
  return { success: true };
}
```

Save the file. `start.js` detects the change and broadcasts a `code_changed` notification — close and re-run the plugin in Figma, and the new command is available immediately. No server restart needed.

The handler receives `params` as a plain object and must return a JSON-serializable value. Throwing an error causes the caller to receive `{ error: message, errorType: name }`.

---

## Available commands

A summary of what the plugin exposes. All commands are sent via `tools/figma.js` or `sendCommand`.

| Category | Commands |
|---|---|
| **Query** | `ping`, `get_selection`, `get_nodes`, `get_nodes_flat`, `get_page_frames`, `get_pages`, `set_current_page`, `list_connected_files` |
| **Styles** | `get_local_styles`, `get_all_available_styles`, `apply_text_style`, `bulk_apply_text_style`, `apply_fill_style`, `duplicate_text_style`, `bulk_duplicate_text_style`, `set_style_property`, `bulk_set_style_property`, `set_style_variable_binding`, `bulk_set_style_variable_binding`, `delete_style`, `bulk_delete_style` |
| **Variables** | `get_local_variables`, `get_all_available_variables`, `get_all_document_variables`, `resolve_variables`, `set_variable_binding`, `bulk_set_variable_binding`, `remove_variable_binding`, `apply_fill_variable`, `bulk_apply_fill_variable` |
| **Properties** | `set_property`, `bulk_set_property` — covers layout, typography, corner radius, opacity, blend mode, constraints, prototyping, and auto-layout fields |
| **Text** | `set_characters`, `bulk_set_characters` |
| **Rename** | `rename_node`, `bulk_rename` |
| **Structure** | `create_node`, `create_node_tree`, `set_node_raw`, `delete_node`, `flatten_node`, `group_as_component_set` |
| **Components** | `reset_instance_spacing`, `reset_instance_text_styles`, `swap_button_instances`, `clone_component_set`, `unclip_text_parent_frames` |
| **Utilities** | `parse_link` — extracts `fileKey` and `nodeId` from any Figma URL, runs without a server |

For full parameter details, see the handler implementations in `figma-plugin/code.js` and the architecture notes in `docs/TECHNICAL_ARCHITECTURE.md`.

---

## What it doesn't replace

Figlink is not a replacement for the Figma REST API for read-only data extraction at scale (analytics, reporting across many files). It's designed for interactive, AI-driven automation on files that are actively open in Figma Desktop — the kind of work that a developer and designer would previously have had to coordinate manually.
