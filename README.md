# Figlink

*If you find this project useful, please consider giving it a star ⭐ on GitHub!*

**Let your AI assistant control Figma.** Open a chat, describe what you want done in your design file, and watch it happen — renaming layers, applying styles, binding variables, all of it.

---

## Before you start — what you need

- **Figma Desktop** (the downloadable app, not the browser version)
- **Node.js** installed on your computer — download it at [nodejs.org](https://nodejs.org) and install it like any app. Choose the LTS version.
- **An AI assistant** — Claude, ChatGPT, Cursor, Windsurf, or any AI with access to a terminal

That's it. You don't need to know how to code.

---

## Set up (one time only)

### Step 1 — Clone the repository

1. Copy the URL of this repository from your browser
2. Open your AI IDE (Cursor, Windsurf, Trae, etc.)
3. Ask your AI to clone the repository to your local computer
4. Once cloned, ask your AI to give you the path to the folder where the system is installed

### Step 2 — Start the system

1. Open the folder your AI just gave you the path for
2. Start Figlink based on your operating system:
   - **Windows:** Double-click `Windows Start Figlink.bat`
   - **Mac:** Double-click `Mac Start Figlink.command` (if a security warning appears, go to System Settings → Privacy & Security and click Open Anyway)
3. A terminal window opens and stays open. Leave it running.

### Step 3 — Install the plugin into Figma

1. Open Figma Desktop
2. Click the Figma logo (top left) → **Plugins** → **Development** → **Import plugin from manifest**
3. A file browser opens — navigate to the folder your AI gave you the path for, then into the `figma-plugin` subfolder, and select the file called `manifest.json`
4. Click **Open**
5. Run the plugin (Figma logo → Plugins → Development → Figlink → Run)

The plugin is now installed. You'll only ever do this once.

---

## Every time you use it — 3 steps

### Step 1 — Start Figlink

**Windows:** Double-click `Windows Start Figlink.bat`

**Mac:** Double-click `Mac Start Figlink.command`
- If a security warning appears, go to **System Settings → Privacy & Security** and click **Open Anyway**, then double-click it again.
- If it still won't open, run this once in Terminal: `chmod +x "Mac Start Figlink.command"` then double-click it.

**Or from any terminal:** Open a terminal, ensure you are inside the folder your AI gave you the path for, and run `node start.js`

A terminal window opens and stays open. Leave it running.

---

### Step 2 — Run the plugin in Figma

1. Open your Figma file
2. Click the Figma logo → **Plugins** → **Development** → **Figlink** → **Run**
3. A small panel appears in the bottom-right corner of Figma

**The dot changes from orange to green and says "Connected".** Just below it, it will show your file's name like `Design System · ready`.

> If it shows an orange dot: Figlink isn't running. Go back to Step 1.

---

### Step 3 — Tell your AI what you want

Open a chat with your AI in the IDE while the repository folder is open. Ask your AI to check if you are properly connected via Figlink.

Once it confirms you are connected, you can start prompting! You don't need special commands or technical language.

**Some wild things you can ask:**

- *"Rename all the frame layers in this selection to match their text content"*
- *"Look at the styles in this file and bind all the color fills to the nearest color variable"*
- *"Here's a Figma link — standardize it based on our design system: [paste link]"*
- *"Extract all the semantic color tokens from this webpage and apply them to the currently selected frames"*
- *"Analyze the layout structure of these cards and make them all use auto-layout with consistent padding"*
- *"Read the text in these layers, translate it to Spanish using your own knowledge, and update the layers"*

The AI reads your Figma file, thinks about what needs to change, and makes the changes directly. You'll see them appear in Figma in real time.

**Note:** Your AI will sometimes need to make changes to the code in this repository to achieve your unique asks. This is perfectly fine and expected! That is the power of this system: it doesn't try to cater to every usecase, it simply provides a bridge that the AI can then use to reliably do anything.

---

## Working with multiple Figma files

You can have the plugin running in more than one Figma file at the same time (up to 8 concurrent connected files). When you do, just tell the AI which file you're talking about by cross-referencing them:

*"Here's the link to the design system file: [link]. And here's the file I want you to update: [link]. Copy the color variables from the first file and apply them to the frames in the second."*

---

## The system prompt (optional)

Figlink has a system prompt — a set of instructions that tell the AI exactly how to work with your design system. You can see it at `prompts/system.md`.

You can edit this file to customize the AI's behavior for your specific design system. Changes take effect immediately — no restart needed.

**To turn the system prompt off** (if you want the AI to work freely without instructions):

Simply rename, move, or delete `prompts/system.md`.

Restarting Figlink is not needed. Put it back at `prompts/system.md` whenever you want the instructions back.

---

## If something goes wrong

**Orange dot in the plugin / "Connecting"**
→ Figlink isn't running. Double-click `Windows Start Figlink.bat` or `Mac Start Figlink.command` and wait a moment.

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

If the AI generates any temporary files, they go into the `temp/` folder. To clear them out, tell the AI: *"Clean up the temp folder."* Or, open a terminal inside the repository folder and run `node tools/process.js clean`.

---

## Questions or issues?

- Open an issue on GitHub
- Reach out on X: [x.com/danielfransix](https://x.com/danielfransix)
