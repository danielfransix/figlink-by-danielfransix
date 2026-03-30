# Figma Design System Processor Instructions

> **Note for AI assistants:** This is an optional follow-on workflow. Before following any of the instructions in this document, explicitly ask the user whether they want to run the design system standardization process. This guide describes a specific way of working that may not match what the user wants to achieve — confirm with them first.

This document provides instructions for an AI agent using the `figlink` tool to automatically process and standardize Figma frames based on our established design system rules.

## Core Objective
When provided with a Figma frame link (or node ID), the goal is to standardize the frame's layers, text styles, colors, layout spacing, border radii, and specific node properties (like clip content) using the `figlink` tool.

## General Rules & Process Flow

When given a Figma frame link to process, execute the following steps sequentially:

### 1. Fetch Frame Context
- Use `figma.js` to fetch the flat node tree of the target frame:
  ```bash
  node figma.js get_nodes_flat '{"nodeId":"YOUR_NODE_ID", "skipVectors": true, "skipInstanceChildren": true}' > frame_nodes.json
  ```
- Fetch all document variables and local styles to use as reference for standardizing the frame:
  ```bash
  node figma.js get_all_document_variables > variables.json
  node figma.js get_local_styles > styles.json
  ```

### 2. Layer Renaming & Cleanup
- Ignore vector layers (as skipped in the fetch command).
- **Naming Convention**: When naming things, layers, or component properties, ALWAYS use lowercase, and use a dash `-` to separate words. NEVER use an actual space. (e.g. `primary-button`, `user-profile-card`)
- **Text Layers**: Rename unlinked text layers to match their actual text content (truncate at ~30 characters for readability), applying the naming convention above.
- **Frame Layers**: Rename generic frames (e.g., "Frame 123") descriptively, ideally based on the text content of their first text child, applying the naming convention above.

### 3. Text Style Binding
- Find any text nodes that are not linked to a text style (`textStyleId` is null).
- Analyze their raw `fontSize`, `fontWeight`, and `fontFamily`.
- Compare these properties against the fetched local text styles.
- Bind the text node to the most similar/closest matching text style available in the document.

### 4. Color Variables Binding
- Extract all `COLOR` variables from `variables.json`.
- Scan all nodes for raw `#Hex` fills that are not bound to a variable (`colorVariableId` is null).
- Calculate the closest matching color variable based on RGB values.
- Bind the fill to that specific color variable.

### 5. Layout, Spacing, and Radius Standardization
- Extract all `FLOAT` variables from `variables.json`.
- Separate them into spacing variables (`spacing/*`) and radius variables (`radius/*`).
- Scan layout properties: `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`, `itemSpacing`, `counterAxisSpacing`, `cornerRadius`, `topLeftRadius`, `topRightRadius`, `bottomRightRadius`, and `bottomLeftRadius`.
- For any hardcoded numeric value, find the nearest multiple-of-2 variable value (or exact match from the `spacing/` or `radius/` collections).
- **Exception**: DO NOT apply auto-layout spacing or variable bindings to frames containing illustrations (e.g., layers named "illustration", "vector", or similar context). Let these remain free-form.
- Intelligently discern what needs auto-layout and assign the right variable values.

### 6. Frame Properties (Clip Content)
- Ensure that the `clipsContent` property is set to `true` for all container-like nodes (e.g., `FRAME`, `COMPONENT`, `COMPONENT_SET`, `INSTANCE`, `GROUP`, `SECTION`).

## Execution Strategy
- Use the consolidated script `node process.js standardize <NODE_ID>` which handles fetching, evaluating, and applying all the rules described above in a single step using the Figlink API.
- Do not create separate `.js` or `.json` files manually; the unified tool keeps the workspace clean.

## Example Trigger Prompt
To trigger this workflow, simply provide this instruction doc and the target frame link:

> "Please process this Figma frame according to the Design System Processor Instructions: [INSERT_FIGMA_LINK]"
