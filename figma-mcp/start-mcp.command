#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "  ============================================================"
echo "    Figlink MCP — Expose Figma to Web AI Models"
echo "  ============================================================"
echo ""

# ── 1. Start Figlink link-server (ws://localhost:9001) ──────────
FIGLINK_DIR="$(dirname "$0")/../figlink-codebase"
cd "$FIGLINK_DIR"

if [ ! -d "link-server/node_modules" ]; then
    echo "  Installing Figlink dependencies..."
    (cd link-server && npm install)
fi

echo "  Starting Figlink server on ws://localhost:9001..."
osascript -e 'tell app "Terminal" to do script "cd \"'"$FIGLINK_DIR"'\" && node start.js"' > /dev/null 2>&1 || true

cd "$(dirname "$0")"

# ── 2. Install MCP deps if needed ───────────────────────────────
if [ ! -d "node_modules" ]; then
    echo "  Installing MCP dependencies..."
    npm install
    echo ""
fi

# ── 3. Start MCP server ─────────────────────────────────────────
echo ""
echo "  Starting MCP server on http://localhost:3000"
echo ""
echo "  ------------------------------------------------------------"
echo ""
echo "  NEXT: Expose to the web with ngrok."
echo ""
echo "  If you don't have ngrok installed:"
echo "    1. Create a free account at https://ngrok.com"
echo "    2. Install: brew install ngrok"
echo "    3. Run: ngrok config add-authtoken <your-token>"
echo ""
echo "  Then in a new terminal, run:"
echo "    ngrok http 3000"
echo ""
echo "  Copy the Forwarding URL (e.g. https://xxxx.ngrok-free.app)"
echo "  and paste it into your web AI's MCP endpoint field."
echo ""
echo "  No bearer token is needed — the MCP protocol doesn't"
echo "  require one. If Notion AI requires a field, leave it empty."
echo "  To add protection, use ngrok's built-in auth:"
echo "    ngrok http 3000 --basic-auth \"user:pass\""
echo "  then provide those credentials to the AI platform."
echo ""
echo "  ------------------------------------------------------------"
echo ""

node server.js
