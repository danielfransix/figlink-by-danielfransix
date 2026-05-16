# Figlink

*If you find this project useful, please consider giving it a star ⭐ on GitHub!*

**Let your AI assistant control Figma.** Open a chat, describe what you want done in your design file, and watch it happen — renaming layers, applying styles, binding variables, all of it.

Figlink supports **three ways** to connect your AI to Figma:

| Mode | How the AI talks to Figma | Best for |
|------|--------------------------|----------|
| **1. Native IDE** | AI runs commands directly from your IDE's terminal | Cursor, Windsurf, Trae, VS Code with Copilot |
| **2. MCP — Local IDE** | AI connects to a local MCP server on `localhost:3000` | Any IDE with MCP support (Claude, Cursor, Copilot) |
| **3. MCP — Web AI** | Same MCP server, exposed to the internet via ngrok | Notion AI, Claude web, ChatGPT, any web-based AI |

All three modes work with the same plugin and link server. You only install the plugin once. Choose the mode that fits your workflow.

---

## Before you start — what you need

- **Figma Desktop** (the downloadable app, not the browser version)
- **Node.js** installed on your computer — download it at [nodejs.org](https://nodejs.org) and install it like any app. Choose the LTS version.
- **An AI assistant** — any of the modes above will work. For modes 2 and 3, your AI needs MCP support.

**For Web AI (Mode 3):** You'll also need ngrok (free tier is fine). See the [Mode 3 section](#3-mcp--web-ai) below.

That's it. You don't need to know how to code.

---

## Set up (one time only)

### Step 1 — Clone the repository

1. Copy the URL of this repository from your browser
2. Open your AI IDE (Cursor, Windsurf, Trae, etc.) — or a terminal if you're on web AI
3. Ask your AI to clone the repository to your local computer, or clone it yourself:
   ```
   git clone https://github.com/danielfransix/figlink.git
   ```
4. The folder will be at a path like `C:\Users\...\figlink` (Windows) or `/Users/.../figlink` (Mac). Remember this path.

### Step 2 — Install dependencies

The link server and MCP server each need their dependencies installed once.

Open a terminal in the repository folder and run:

```
cd figlink-codebase\link-server
npm install
```

```
cd ..\..\figma-mcp
npm install
```

### Step 3 — Install the plugin into Figma

1. Open Figma Desktop
2. Click the Figma logo (top left) → **Plugins** → **Development** → **Import plugin from manifest**
3. A file browser opens — navigate into the `figlink-codebase` folder in this repository, then into the `figma-plugin` subfolder, and select the `manifest.json` file.
4. Click **Open**
5. Run the plugin (Figma logo → Plugins → Development → Figlink → Run)

The plugin is now installed. You'll only ever do this once.

---

## 1. Native IDE

*Use this if your AI runs inside Cursor, Windsurf, Trae, VS Code, or any IDE with terminal access.*

### Start the system

**Windows:** Double-click `Windows Start Figlink.bat` (in the `figlink-codebase` folder)

**Mac:** Double-click `Mac Start Figlink.command`
- If a security warning appears, go to **System Settings → Privacy & Security** and click **Open Anyway**, then double-click it again.
- If it still won't open, run this once in Terminal: `chmod +x "Mac Start Figlink.command"` then double-click it.

**Or from a terminal:** Open a terminal inside the `figlink-codebase` folder and run:
```
node start.js
```

A terminal window opens and stays open. Leave it running.

### Run the plugin in Figma

1. Open your Figma file
2. Click the Figma logo → **Plugins** → **Development** → **Figlink** → **Run**
3. A small panel appears in the bottom-right corner of Figma

**The dot changes from orange to green and says "Connected".** Just below it, it will show your file's name like `Design System · ready`.

> If it shows an orange dot: Figlink isn't running. Go back to Start the system.

### Talk to your AI

Open a chat with your AI in the IDE while the repository folder is open. Ask your AI to check if you are properly connected via Figlink.

Once it confirms you are connected, you can start prompting! You don't need special commands or technical language.

**Some wild things you can ask:**

- *"Read the `tailwind.config.js` in my local codebase, compare its spacing tokens to the auto-layout gaps in this Figma file, and adjust the Figma file to match the code exactly."*
- *"Analyze the spatial coordinates of these absolute-positioned elements and automatically restructure them into proper auto-layout rows and columns."*
- *"Connect to this master design system [link] and my current file [link], then replace all hardcoded hex codes in my file with the closest matching semantic variables from the master."*
- *"Translate all text layers in these screens to German, and if the new text overflows, convert the parent frames to auto-layout so they expand correctly."*
- *"Turn these 15 screens into a clickable prototype. Find all buttons that say 'Next' and make them navigate to the next frame on click. Intelligently prototype back buttons to go back to the screen the user is coming from [not just the screen before it on the Figma page]"*
- *"Scan this entire page for WCAG AA contrast violations, automatically adjust the lightness of failing text to pass, and generate a markdown report of the changes."*
- *"Update all text layers in this selection to use Title Case and add a 150% line height."*
- *"Here's a Figma link — standardize it based on our design system standardization guide doc: [paste link to Figma] and attach markdown guide doc."*
- *"Extract all the semantic color tokens from this webpage and apply them to the currently selected frames."*
- *"Look at the styles in this file and bind all the color fills to the nearest color variable."*

The AI reads your Figma file, thinks about what needs to change, and makes the changes directly. You'll see them appear in Figma in real time.

**Note:** Your AI will sometimes need to make changes to the code in this repository to achieve your unique asks. This is perfectly fine and expected! That is the power of this system: it doesn't try to cater to every use case; it simply provides a bridge that the AI can then use to reliably do anything.

---

## 2. MCP — Local IDE

*Use this if your IDE supports the Model Context Protocol — Claude Desktop, Cursor, VS Code with Copilot, or any MCP-compatible client.*

Instead of the AI running terminal commands, it connects to a local MCP server that exposes Figlink as structured tools. The AI sees Figma operations as callable functions with typed parameters.

### Start both servers

**Windows:** Double-click `start-mcp.bat` (in the `figma-mcp` folder)

**Mac:** Double-click `start-mcp.command` (in the `figma-mcp` folder)

This launches two servers in separate windows:
- **Figlink Server** — WebSocket on `ws://localhost:9001`
- **MCP Server** — HTTP on `http://localhost:3000`

Leave both windows running.

### Run the plugin in Figma

Same as Mode 1 — open your Figma file and run the Figlink plugin (Figma logo → Plugins → Development → Figlink → Run). The dot turns green when connected.

### Configure your IDE's MCP client

Add this to your IDE's MCP configuration. The exact location varies:

- **Cursor:** `.cursor/mcp.json` in your project
- **Claude Desktop:** `claude_desktop_config.json`
- **VS Code:** `.vscode/mcp.json` or Copilot settings
- **Trae:** MCP settings panel

```json
{
  "mcpServers": {
    "figlink": {
      "url": "http://localhost:3000/"
    }
  }
}
```

No authentication or API keys are needed — the server runs on your machine.

### Use it

Once connected, your AI will see all 74 Figlink tools. You can prompt naturally — the AI discovers what tools are available and calls them as needed:

- *"List all the components in my design system file"*
- *"Search for button components and show me their properties"*
- *"Create a new color variable called 'primary/500' with value #3B82F6"*
- *"Rename all frames on this page to follow BEM naming"*
- *"Clone the selected component and move it 200px to the right"*

---

## 3. MCP — Web AI

*Use this for web-based AIs like Notion AI, Claude web, or ChatGPT — any AI that lives in the browser and can't access your local terminal.*

The same MCP server from Mode 2, but exposed to the internet through ngrok so web AIs can reach it.

### Prerequisites

1. **Create a free ngrok account** at [ngrok.com](https://ngrok.com)
2. **Download and install ngrok**
3. **Add your auth token** (only once):
   ```
   ngrok config add-authtoken <your-token>
   ```

### Start everything

**Windows:** Double-click `start-mcp.bat` (in the `figma-mcp` folder)

**Mac:** Double-click `start-mcp.command` (in the `figma-mcp` folder)

This launches the Figlink server and MCP server. Leave both windows open.

### Run the plugin in Figma

Open your Figma file and run the Figlink plugin. The dot turns green when connected.

### Expose the MCP server with ngrok

In a **new terminal**, run:

```
ngrok http 3000
```

You'll see output like:

```
Forwarding  https://violet-recapture-brewing.ngrok-free.dev → http://localhost:3000
```

Copy the `https://xxxx.ngrok-free.dev` URL. This is your public MCP endpoint.

### Connect your web AI

Paste the ngrok URL into your web AI's MCP endpoint field:

- **Notion AI:** Settings → MCP → Add endpoint → paste URL
- **Claude web:** MCP settings → Add server → paste URL
- **ChatGPT:** MCP configuration → Add server → paste URL

**No bearer token or authentication is needed.** If your AI platform requires a field, leave it empty or use ngrok's optional basic auth:

```
ngrok http 3000 --basic-auth "user:pass"
```

Then provide those credentials in your AI's MCP configuration.

### Use it

Your web AI now has the same 74 tools as the local IDE. Prompt naturally — the AI discovers the tools and calls them:

- *"Read my Figma file and tell me how many components it has"*
- *"Find all text layers using the wrong font and fix them"*
- *"Apply the color variables from my design system to this selection"*
- *"Export the selected frame as a PNG"*

### ngrok URL changes

Free ngrok URLs change every time you restart ngrok. Each session you'll get a new URL — just paste the new one into your AI's MCP settings. If you need a fixed URL, upgrade to ngrok's paid plan for a reserved domain.

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

**MCP: "Failed to connect MCP server"**
→ The MCP server isn't running. Make sure you started `start-mcp.bat` / `start-mcp.command` and both terminal windows are open.

**MCP: "SSE error: Non-200 status code (500)"**
→ Restart the MCP server. Close both terminal windows, then double-click `start-mcp.bat` / `start-mcp.command` again.

**MCP: 400 Bad Request in ngrok logs**
→ Your AI is re-initializing a session. This is normal — the MCP server handles it by creating new sessions. If it persists, restart the MCP server.

**MCP: "Session not found"**
→ Your AI lost its session. No action needed — it will re-initialize automatically.

**MCP: OAuth/OIDC errors in logs (/.well-known/openid-configuration)**
→ Your AI platform is probing for OAuth endpoints. The MCP server returns 404 for these intentionally — they can be safely ignored.

**ngrok won't start or shows errors**
→ Make sure you've signed up at ngrok.com and added your auth token: `ngrok config add-authtoken <your-token>`

---

## Keeping things tidy

If the AI generates any temporary files, they go into the `temp/` folder. To clear them out, tell the AI: *"Clean up the temp folder."* Or, open a terminal inside the repository folder and run `node tools/process.js clean`.

---

## Project structure

| Folder | Purpose |
|--------|---------|
| `figlink-codebase/` | Core Figlink system — link server, plugin, batch tools |
| `figlink-codebase/figma-plugin/` | The Figma plugin (`code.js`, `manifest.json`) |
| `figlink-codebase/link-server/` | WebSocket relay server (`ws://localhost:9001`) |
| `figlink-codebase/prompts/` | System prompt and prompt library |
| `figma-mcp/` | MCP server — exposes Figlink as 74 typed tools |
| `figma-mcp/bridge.js` | WebSocket bridge between MCP and the link server |
| `figma-mcp/server.js` | MCP HTTP server (`http://localhost:3000`) |

---

## Questions or issues?

- Open an issue on GitHub
- Reach out on X: [x.com/danielfransix](https://x.com/danielfransix)
