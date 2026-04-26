# ExampleApp — Quick Task Library

> **Note: Example Prompts**
> This file contains custom example prompts from internal projects (ExampleApp / Example DS). They are included here as references to show how you can structure your own tasks and standardizations. The specific IDs, variables, and links mentioned are private and will not work for you, but you can adapt these prompt patterns for your own design systems.

Tasks executed against the ExampleApp Figma file via Figlink.

---

**Task 1 — Radius + clip content on wide frames**
> Find all the frames in this file in the pages in the screenshot, that their width is greater than 380, then set their rounding to the 12px variable and turn on clip content. Skip component instances, but if it's a master component, check to apply the same rule. Use high timeouts, it's a large file, and do it in bits.

---

**Task 2 — Bind under-weight strokes to 1.4px variable**
> Find anything that has a border, or stroke width, and isn't a component instance or component, and ensure anyone with a value for this border/stroke less than 1.4 is set to the 1.4 width variable. All pages.

---

**Task 4 — Create mobile-app/ text styles in Example DS**
> Create new text styles in Example DS — same setup as the existing `web/` bucket, but name the bucket `mobile-app/`. For font family, bind to the `sans` variable from the `mobile-app` variable bucket instead of the web one.

---

**Task 5 — Remap exampleapp text from web/ → mobile-app/ styles**
> Remap all body text and titles in exampleapp across all pages to use the `mobile-app/` text styles instead of the `web/` ones. Do it page by page so as not to overwhelm the system.

---

**Task 6 — Fix Example DS master components to use mobile-app/ styles**
> Fix the text styles in the components page in Example DS — link all text to the mobile-app/ styles. Then publish so exampleapp instances auto-update.

---

**Task 7 — Upgrade all 14px text to 16px equivalent weight**
> Find any text that is 14px of any weight in the exampleapp file, and change it to the 16px equivalent weight text style (`mobile-app/text-base/*`). Skip text that is inside a component instance (fix it on the master instead). Skip text styled as `text-title/*`. If any text-title nodes were already changed, reset them back to their correct style.

---

**Task 8 — Audit components pages for wrongly-changed text-title nodes**
> Check both components pages (exampleapp and Example DS) to confirm no text that should be text-title was accidentally changed to a 16px normal style.

---

**Task 9 — Fix CaretDown icon stroke to slate/900 in all field-component instances**
> Find all instances of the `field-component` (variant: type=big-field, status=filled, text-entry-disabled=false) across all exampleapp pages. Inside each, find the phosphor library icon and reset its stroke color variable binding back to `slate/900`.

---

**Task 10 — Reset text style overrides on component instances (all pages)**
> Text styles on several component instances had been manually modified. Go page by page through the exampleapp file, check the masters in Example DS, and reset the overrides so instances automatically inherit the correct text style from their master — without blowing away other intentional overrides (component props, fills, visibility). Do it surgically and space out the edits with timeouts.
>
> Result: 1,666 text nodes reset across 15 pages via `reset_instance_text_styles` (path-traversal, textStyleId sync).

---

**Task 3 — UX copy + frame renames across all flows**
> Act as a senior UX writer. Write copy for every text element in the designs. Read the Notion source of truth first (ExampleApp flow doc + all subpages), then work through the Figma files starting with the component pages. Write copy screen by screen, mapping every text layer to its purpose. Rename frames appropriately as you go. Flag any UX gaps vs the flow doc.

---

**Task 11 — Align Figma modal copy with Notion specifications**
> Read the provided Notion document containing the notification copy templates (titles and bodies). Then, go through all the modals in the specified Figma file/node and ensure the text in the Figma modals perfectly matches the copy defined in the Notion document. Use Figlink to programmatically update any text nodes in Figma that are out of sync.
