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

## How it fits into a developer workflow

Figlink runs locally. There's no cloud dependency, no API key for the Figma file, no separate service to manage. You start a local server, the designer runs a lightweight plugin in Figma Desktop, and any AI with terminal access can now issue commands to that file.

For one-off tasks, you prompt the AI in natural language. For repeatable workflows, the AI can write a script in the `temp/` folder and run it — the same command structure, but automated.

The plugin code itself is also editable. If you need a capability that doesn't exist, adding it is a matter of writing a new command handler in JavaScript. The server picks up the change without a restart.

---

## What it doesn't replace

Figlink is not a replacement for the Figma REST API for read-only data extraction at scale (analytics, reporting across many files). It's designed for interactive, AI-driven automation on files that are actively open in Figma Desktop — the kind of work that a developer and designer would previously have had to coordinate manually.
