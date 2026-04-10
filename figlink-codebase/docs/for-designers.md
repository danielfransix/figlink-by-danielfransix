# Figlink for Designers

Figlink lets your AI assistant control Figma directly. You describe what you want in plain language and watch it happen live in your file.

---

## The problem it solves

Most Figma work isn't designing — it's maintenance. Rebinding variables after a token rename. Renaming 200 layers to match the new naming convention. Applying a text style to every heading across 15 screens. Checking contrast on 40 components. This is the work that takes half your day and requires zero creative thought.

Figlink hands that work to an AI. You keep your hands on the decisions that actually matter.

---

## Use cases

### Connecting a file to your design system

You've inherited a file full of hardcoded hex values and detached text layers. Normally you'd spend hours hunting them down and re-binding one by one.

With Figlink:
> *"Look at the styles and variables in this file, then bind every fill to the closest color variable and every text layer to the closest text style."*

The AI reads your file, compares every fill's RGB value against your color variables, and binds them — flagging anything it couldn't confidently match.

---

### Keeping Figma in sync with your codebase

Your design system lives in a `tokens.json` or `tailwind.config.js` in the repo. Every time a developer updates a spacing value or renames a color token, your Figma file is out of date.

With Figlink, your AI can read both:
> *"Read `tailwind.config.js` and compare its spacing scale to the auto-layout gaps in this file. Update the Figma values to match exactly."*

> *"The team renamed `color-brand-primary` to `color-interactive-primary` in the token file. Find every variable binding in this file that uses the old name and update it."*

---

### Localizing an entire product

Translating text in Figma means opening every layer, typing the new content, and adjusting frames that now overflow. Multiplied by 40 screens and 6 languages.

With Figlink:
> *"Translate all text layers in these screens to German. Where the translated text overflows its frame, convert the parent to auto-layout so it expands to fit."*

One prompt. Every screen. The AI handles the overflow logic too.

---

### Accessibility auditing

Manually checking WCAG contrast ratios across a full product is tedious enough that it often doesn't happen. With Figlink you can make it a routine step:

> *"Scan this entire page for WCAG AA contrast violations. Adjust the lightness of failing text until each one passes, and give me a list of every change you made."*

---

### Bulk component cleanup after a system update

Your design system team renamed the button component variants — `Type=Primary` is now `Variant=Primary`. Half your file's instances are pointing to the wrong variant.

With Figlink:
> *"Swap all button instances in this file to use the new component set. Match variants intelligently — if the old instance was 'Primary / Large', find the equivalent in the new set."*

---

### Prototyping navigation flows

Wiring up a full prototype by hand — selecting each button, dragging to the right frame, setting the interaction — is mechanical work that scales badly across large files.

With Figlink:
> *"Find every button labeled 'Next' and connect it to the next frame on the page. Find every 'Back' button and connect it to the frame that logically precedes the current screen in the user flow, not just the previous frame on the canvas."*

---

### Rebuilding a live design from a website

Starting a redesign from a live product? Rather than building components from scratch, you can have the AI extract the existing design language and build it directly in Figma:

> *"Go to this URL, extract all the color tokens, font sizes, and spacing values, then apply them to the selected frames and create text styles for each type size you find."*

---

### Enforcing naming conventions across a file

Before handing a file off to a developer, layer names need to be clean. Figlink can rename everything at once based on your rules:

> *"Rename every frame to match the first text layer inside it. Rename every text layer to the first 30 characters of its content. Rename any unnamed group to 'Group'."*

---

## What it feels like to use

You work in Figma as normal. The AI runs in your IDE (Cursor, Windsurf, Claude, etc.) alongside the open repository folder. You describe what you want, the AI sends instructions to your file, and you see the changes appear in real time.

If you don't like a change, you undo it in Figma. The AI can also read what's in the file at any moment and explain what it's looking at.

There's no special syntax to learn. You just tell it what you want done.

---

## What makes this different from other Figma AI tools

Most AI Figma tools give you a fixed set of actions: resize this, suggest a color, generate a layout. Figlink doesn't have a menu of presets. The AI has full read/write access to your file and can do anything a human with Figma skills could do — including things the tool's creator never anticipated.

If the AI needs a capability that doesn't exist yet, it can extend itself by modifying the underlying code. This is expected behavior, not a workaround.
