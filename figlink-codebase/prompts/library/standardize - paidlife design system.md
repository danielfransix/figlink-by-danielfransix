# Figma Design System Processor — ExampleApp Design System

> **Sample prompt — not a generic template.**
> This file contains standardization rules written specifically for the **ExampleApp design system** (e.g. naming conventions, token structures, title-text logic). If you are using FigLink with a different design system, treat this as a reference example and write your own version tailored to your system's tokens, style names, and conventions. Only the workflow structure (the commands and step order) is reusable as-is; the rules themselves are opinionated to ExampleApp.

> **Workflow note:** This is an optional follow-on workflow. Before following any of the instructions in this document, explicitly ask the user whether they want to run the design system standardization process. Confirm with them first — this guide describes a specific opinionated process that may not match what they want.

---

## Core Objective

Standardize the layers, text styles, colors, spacing, border radii etc against an established design system — with the eye of an expert designer, not a mechanical find-and-replace. Every decision should ask: *does this look and feel intentional?*

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
# Flatten unnecessary wrappers first (frames inside frames with no styles)
node tools/process.js --file <fileKey> flatten <nodeId>

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

### Design Sensibilities

Approach every standardization pass as an expert designer reviewing a handoff. Beyond mechanical binding, ask:

- **Visual hierarchy** — Does the type scale read clearly from heading → body → caption? If not, flag it.
- **Intentionality** — Would a skilled designer have made this choice? If a binding would produce a visually wrong result (e.g., applying a caption style to a large headline), skip it and note why.
- **Consistency** — Are like elements treated the same way across the frame? Inconsistencies are bugs.
- **Polish** — After binding, does the frame still look designed? If something looks off, investigate before moving on.

### Layer Renaming
- Naming convention: always lowercase with dashes, never spaces (`primary-button`, `user-profile-card`)
- Text layers: rename to match their text content (truncate at ~30 characters)
- Frame layers: rename generic frames (e.g. "Frame 123") based on their first text child's content
- Skip vector layers

### Text Style Binding
- Match by `fontSize` + `fontWeight` against available text styles (local **and** library styles in use on the page)
- Text nodes with no style bound are always processed
- Text nodes that ARE already bound are re-evaluated if they qualify as title text (see below)

**Title text rule:** A text node is title text if *either* condition is true:
1. `fontWeight` is `Medium`, `SemiBold`, `Bold`, `ExtraBold`, or `Black`
2. `fontSize` ≥ 18px (large enough to read as a heading regardless of weight)

Title text must **always** be resolved to a `text-title` style matched by closest `fontSize` — even if the node is already bound to another style, and even if the original font family differs. This enforces the design system's heading convention unconditionally. Only fall back to general matching if no `text-title` styles exist in the file.

**Intelligent title recognition:** Beyond font weight and size, use design judgment to identify implicit titles — the primary label in a card, the screen heading, a section name. If a Regular-weight text node is clearly functioning as a title in its context, treat it as title text and apply the closest `text-title` style.

### Color Variable Binding
- Find fills not bound to a variable (`colorVariableId` is null)
- Match by RGB proximity against available `COLOR` variables
- Bind to the closest match

### Spacing & Radius Binding
- Find layout fields not bound to a variable: `paddingTop/Right/Bottom/Left`, `itemSpacing`, `counterAxisSpacing`, `cornerRadius`, `topLeftRadius`, `topRightRadius`, `bottomRightRadius`, `bottomLeftRadius`
- Match numeric values against `spacing/*` or `radius/*` `FLOAT` variables — values within 4px of a token snap to it
- **Exception**: skip binding on nodes named with "illustration" or "vector" — leave them free-form

**Spacing cadence:** After binding, step back and review the spacing rhythm like a designer. Spacing values should follow a coherent scale (e.g. 4 → 8 → 12 → 16 → 24 → 32). If you see erratic values like 7, 13, 19 px that didn't snap, flag them — they are almost always design mistakes, not intentional choices. Prefer snapping to the nearest step rather than leaving values unbound, and note any that needed judgment calls.

### Clip Content
- **Rule:** For every FRAME and COMPONENT node on the page, set `clipsContent` based on width:
  - `width >= 440px` → `clipsContent = true` (full-screen / sheet frames need clipping)
  - `width < 440px` → `clipsContent = false` (cards, rows, inner containers should not clip)
- Apply unconditionally — do not skip based on current state.
- **Exception**: skip nodes named with "illustration" or "vector".

### Icon Stroke Weight Reset
- After standardisation, find all INSTANCE nodes whose main component name matches `Weight=(Thin|Light|Regular|Bold|Duotone)` — these are Phosphor icon instances.
- For each icon instance, find every descendant node with a non-empty `strokes` array and bind `strokeWeight` to the correct Example DS `border-width/*` variable based on the Weight variant:
  - **Thin** → `border-width/1` (1px)
  - **Light** → `border-width/1-24` (1.24px)
  - **Regular** → `border-width/1-4` (1.4px)
  - **Bold** → `border-width/1-8` (1.8px)
  - **Duotone** → `border-width/1-4` (1.4px, same as Regular)
  - **Fill** → skip (no stroke)
- This resets any manual strokeWeight overrides so instances inherit the correct variable from the master component.

### Nesting Optimization
- Standardize layouts to avoid unnecessary nesting. Use the `flatten` command (`node tools/process.js flatten <nodeId>`) to automatically remove wrapper frames/groups that only contain one child and have no visual properties of their own (no fills, strokes, padding, corner radius, effects, or opacity).

### Component Instances
- **Never** modify component instances during standardization — except for the icon stroke weight reset above, which specifically targets instance overrides.
- Only modify a component's structure if it is the master component you are dealing with directly.

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
