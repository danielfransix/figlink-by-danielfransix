# Figma Design System Processor — Example Instructions

> **Note for AI assistants:** This is an optional follow-on workflow. Before following any of the instructions in this document, explicitly ask the user whether they want to run the design system standardization process. This guide describes a specific way of working that may not match what the user wants to achieve — confirm with them first.

This document provides instructions for an AI agent using Figlink to automatically process and standardize Figma frames based on an established design system.

---

## Core Objective

When provided with a Figma link (file, page, or frame), standardize the frame's layers, text styles, colors, layout spacing, border radii, and clip content using the Figlink tools.

---

## Step 0 — Resolve the link

Always start by parsing any Figma link the user provides:

```bash
node tools/figma.js parse_link <figmaUrl>
# Returns: { "fileKey": "abc123", "nodeId": "488:513" }
# nodeId is null for file-level links
```

Then confirm the file is connected:

```bash
node tools/figma.js list_connected_files
# Returns: [{ "fileKey": "abc123", "name": "Design System" }, ...]
```

If the target file is not in the list, ask the user to open the Figlink plugin in that Figma file first.

---

## Step 1 — Run standardization

Use the consolidated processor script — it handles fetching, evaluating, and applying all rules in one step:

```bash
# Single frame (use nodeId from parse_link)
node tools/process.js --file <fileKey> standardize <nodeId>

# All frames on the current page
node tools/process.js --file <fileKey> standardize-page

# Every page and frame in the file
node tools/process.js --file <fileKey> standardize-file
```

If only one file is connected, `--file` can be omitted.

---

## Standardization Rules

### Layer Renaming
- **Naming convention**: always lowercase with dashes, never spaces (e.g. `primary-button`, `user-profile-card`)
- **Text layers**: rename to match their text content (truncate at ~30 characters)
- **Frame layers**: rename generic frames (e.g. "Frame 123") based on their first text child's content
- Skip vector layers

### Text Style Binding
- Find text nodes not linked to a text style (`textStyleId` is null)
- Match by `fontSize` + `fontWeight` against available local text styles
- Bind to the closest match

### Color Variable Binding
- Find fills not bound to a variable (`colorVariableId` is null)
- Match by RGB proximity against available `COLOR` variables
- Bind to the closest match

### Spacing & Radius Binding
- Find layout fields not bound to a variable: `paddingTop/Right/Bottom/Left`, `itemSpacing`, `counterAxisSpacing`, `cornerRadius`, `topLeftRadius`, `topRightRadius`, `bottomRightRadius`, `bottomLeftRadius`
- Match numeric values against `spacing/*` or `radius/*` `FLOAT` variables
- **Exception**: skip binding on nodes named with "illustration" or "vector" — leave them free-form

### Clip Content
- Set `clipsContent: true` on all container nodes (`FRAME`, `COMPONENT`, `COMPONENT_SET`, `INSTANCE`, `GROUP`, `SECTION`)

---

## Multi-file workflows

When the user gives you links to multiple files:

```bash
# Parse all links first
node tools/figma.js parse_link <linkA>   # → fileKey: abc
node tools/figma.js parse_link <linkB>   # → fileKey: xyz, nodeId: 204:16

# Confirm all files are connected
node tools/figma.js list_connected_files

# Read from file A, act on file B
node tools/figma.js --file abc get_local_variables
node tools/figma.js --file xyz set_characters '{"nodeId":"204:16","text":"..."}'
```

---

## Temp files

If you need to write intermediate files during your work, place them in `temp/`:

```bash
node tools/figma.js get_local_variables > temp/variables.json
```

In Node.js scripts use `path.join(__dirname, '..', 'temp', 'filename.json')`.

Run `node tools/process.js clean` to wipe the temp folder when done.

---

## Example trigger prompt

> "Please process this Figma frame according to the Design System Processor Instructions: [INSERT_FIGMA_LINK]"
