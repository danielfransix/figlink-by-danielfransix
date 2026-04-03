# Website Recreation — Guide

This document governs tasks where an AI agent is asked to recreate a website's design in Figma using the Figlink system.

---

## Step 0 — Extract the live site's design data (do not guess)

Before touching Figma, fetch the real CSS and markup from the target URL:

```bash
# Get the HTML to find font and CSS file references
curl -s -L "<url>" -A "Mozilla/5.0"

# Download the main CSS bundle (find the href from the <link rel="stylesheet"> tag)
curl -s "<css-url>"

# Look for theme variables set in JS (dark/light mode semantic tokens)
curl -s "<js-bundle-url>" | tr ',' '\n' | grep -E '"--background|--foreground|--border'
```

Save extracted design tokens (colors, typography, spacing) to `temp/<site-name>-design-spec.md`. Never rely on memory — use the real values.

---

## Step 1 — Navigate to the correct page

```bash
node tools/figma.js get_pages
node tools/figma.js set_current_page '{"pageId":"<id>"}'
```

---

## Step 2 — Plan the frame layout before creating anything

Write a layout plan to `temp/<site>-build-plan.md` covering:
- **Canvas positions** — where each frame sits (e.g. Desktop at x=0, Tablet at x=1600, Mobile at x=2600)
- **Frame sizes** — Desktop 1440px, Tablet 768px, Mobile 375px
- **Section order** — header → toolbar → grid → footer, etc.
- **Component extraction** — identify repeated elements that should be components

---

## Step 3 — Build components first, then compose

Build in this order using `create_node_tree`:

1. **Atomic components** — buttons, inputs, tags, icon cards, nav links
2. **Organism components** — toolbar, header, footer
3. **Page frames** — Desktop, Tablet, Mobile — composed from the above

---

## Step 4 — Apply exact values from the design spec

- Fill colors: use exact RGB values from the extracted CSS — never approximate
- Typography: load the exact font family and style from the live site
- Spacing: match padding, gap, and margin values exactly
- Border radius: copy the exact `border-radius` values

---

## Step 5 — Build each breakpoint

For each frame (Desktop → Tablet → Mobile):
1. Create the outer frame with the correct width (`primaryAxisSizingMode: 'AUTO'` for height)
2. Nest sections using auto layout
3. Adapt layout rules per the site's responsive CSS (media queries)

---

## Step 6 — Organize the canvas

- Label every frame clearly: `<site>-desktop`, `<site>-tablet`, `<site>-mobile`
- Add at least 160px gap between frames
- Group component sets in a dedicated area away from the page frames

---

## Temp File Naming

| File | Contents |
|------|----------|
| `temp/<site>-design-spec.md` | Extracted colors, fonts, spacing, component structure |
| `temp/<site>-build-plan.md` | Frame layout plan, component list, canvas positions |
| `temp/<site>-build.js` | Optional Node.js script for bulk `create_node_tree` calls |

---

## Example Trigger Prompt

> "Recreate [URL] in Figma at [figma link] — desktop, tablet, and mobile views, exact match to the live site."
