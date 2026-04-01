# Figma Design System Processor

> **Note:** This is an optional follow-on workflow. Before following any of the instructions in this document, explicitly ask the user whether they want to run the design system standardization process. Confirm with them first — this guide describes a specific opinionated process that may not match what they want.

---

## Core Objective

Standardize the layers, text styles, colors, spacing, border radii, and clip content of Figma frames against an established design system.

---

## Step 0 — Resolve the link and verify connection

```bash
node tools/figma.js parse_link <figmaUrl>
# → { fileKey, nodeId }

node tools/figma.js list_connected_files
# Confirm target file is in the list
```

---

## Step 1 — Run standardization

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
- Naming convention: always lowercase with dashes, never spaces (`primary-button`, `user-profile-card`)
- Text layers: rename to match their text content (truncate at ~30 characters)
- Frame layers: rename generic frames (e.g. "Frame 123") based on their first text child's content
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

## Multi-file Workflows

```bash
# Parse all links first
node tools/figma.js parse_link <linkA>   # → fileKey: abc
node tools/figma.js parse_link <linkB>   # → fileKey: xyz, nodeId: 204:16

# Read from file A, act on file B
node tools/figma.js --file abc get_local_variables
node tools/figma.js --file xyz set_characters '{"nodeId":"204:16","text":"..."}'
```

---

## Example Trigger Prompt

> "Please process this Figma frame according to the Design System Processor instructions: [INSERT_FIGMA_LINK]"
