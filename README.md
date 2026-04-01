# Figlink

**Let your AI assistant control Figma.** Open a chat, describe what you want done in your design file, and watch it happen — renaming layers, applying styles, binding variables, all of it.

---

## Before you start — what you need

- **Figma Desktop** (the downloadable app, not the browser version)
- **Node.js** installed on your computer — download it at [nodejs.org](https://nodejs.org) and install it like any app. Choose the LTS version.
- **An AI assistant** — Claude, ChatGPT, Cursor, Windsurf, or any AI with access to a terminal

That's it. You don't need to know how to code.

---

## Set up (one time only)

### Step 1 — Install the plugin into Figma

1. Open Figma Desktop
2. Click the Figma logo (top left) → **Plugins** → **Development** → **Import plugin from manifest**
3. A file browser opens — navigate to your Figlink folder, then into the `figma-plugin` subfolder, and select the file called `manifest.json`
4. Click **Open**

The plugin is now installed. You'll only ever do this once.

---

### Step 2 — Open the Figlink folder in your AI's workspace

Your AI needs to be able to "see" the Figlink folder so it can run commands.

- **Cursor / Windsurf / VS Code:** File → Open Folder → select the Figlink folder
- **Claude Desktop:** Add the Figlink folder as a project or workspace
- **ChatGPT / other:** Make sure your AI has access to a terminal that can run files from this folder

> The AI doesn't need to read or understand the files — it just needs to be able to run them.

---

## Every time you use it — 3 steps

### Step 1 — Start Figlink

**Windows:** Double-click `Start Figlink.bat`

**Mac:** Double-click `Start Figlink.command`
- If a security warning appears, go to **System Settings → Privacy & Security** and click **Open Anyway**, then double-click it again.
- If it still won't open, run this once in Terminal: `chmod +x "Start Figlink.command"` then double-click it.

**Or from any terminal:** `node start.js`

A terminal window opens and stays open. Leave it running.

---

### Step 2 — Run the plugin in Figma

1. Open your Figma file
2. Click the Figma logo → **Plugins** → **Development** → **Figlink** → **Run**
3. A small panel appears in the bottom-right corner of Figma

**The green dot means it's working.** It will say something like `Design System · ready` with your file's name.

> If it shows an orange dot: Figlink isn't running. Go back to Step 1.

---

### Step 3 — Tell your AI what you want

Open a chat with your AI and just describe what you want done. You don't need special commands or technical language.

**Some things you can ask:**

- *"Rename all the frame layers in this selection to match their text content"*
- *"Apply the spacing variables to all the padding and gaps in this component"*
- *"Look at the styles in this file and bind all the color fills to the nearest color variable"*
- *"Read the layers in this frame and tell me which ones don't have styles applied"*
- *"Here's a Figma link — standardize it: [paste link]"*

The AI reads your Figma file, thinks about what needs to change, and makes the changes directly. You'll see them appear in Figma in real time.

---

## Working with multiple Figma files

You can have the plugin running in more than one Figma file at the same time. When you do, just tell the AI which file you're talking about:

*"Here's the link to the design system file: [link]. And here's the file I want you to update: [link]. Copy the color variables from the first file and apply them to the frames in the second."*

---

## The system prompt (optional)

Figlink has a system prompt — a set of instructions that tell the AI exactly how to work with your design system. You can see it at `prompts/prompt-files/standardize.md`.

You can edit this file to customize the AI's behavior for your specific design system. Changes take effect immediately — no restart needed.

**To turn the system prompt off** (if you want the AI to work freely without instructions):

Open `prompts/prompt-setter.txt` and change:
```
send_prompt=true
```
to:
```
send_prompt=false
```

Then restart Figlink. Set it back to `true` whenever you want the instructions back.

---

## If something goes wrong

**Orange dot in the plugin / "Connecting"**
→ Figlink isn't running. Double-click `Start Figlink.bat` or `Start Figlink.command` and wait a moment.

**Red dot / "Link not running"**
→ Same as above — Figlink stopped. Start it again.

**The plugin closes or disappears**
→ Just run it again: Figma logo → Plugins → Development → Figlink → Run.

**A banner appears saying "Plugin code updated"**
→ The AI made changes to the plugin. Click **Close Plugin** in the banner, then run the plugin again (Plugins → Development → Figlink → Run). This is normal.

**"Multiple files connected — specify which file"**
→ You have the plugin open in more than one Figma file. Just tell the AI which file to use, or paste the Figma link for the one you want.

**"No Figma plugin connected"**
→ The plugin isn't running. Open Figma and run it (Plugins → Development → Figlink → Run).

**Commands seem to hang or nothing happens**
→ Check that the terminal window where you started Figlink is still open and hasn't closed. If it has, start it again.

---

## Keeping things tidy

If the AI generates any temporary files, they go into the `temp/` folder. To clear them out, tell the AI: *"Clean up the temp folder."* Or run `node tools/process.js clean` in the terminal.

---

## Questions or issues?

- Open an issue on GitHub
- Reach out on X: [x.com/danielfransix](https://x.com/danielfransix)
