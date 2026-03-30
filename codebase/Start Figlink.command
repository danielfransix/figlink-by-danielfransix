#!/bin/bash
# Figlink — Mac Launcher
# Double-click this file in Finder to start Figlink.
# (If macOS asks, click Open to allow it to run.)

# Move to the directory containing this script
cd "$(dirname "$0")"

# Source common Node.js paths (nvm, Homebrew, system installs)
export PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && \. "$HOME/.nvm/nvm.sh"
[ -s "$HOME/.nvm/bash_completion" ] && \. "$HOME/.nvm/bash_completion"

# Check Node.js is available
if ! command -v node &> /dev/null; then
  echo ""
  echo "  +----------------------------------------------------------+"
  echo "  |                                                          |"
  echo "  |   Node.js is not installed on this machine.              |"
  echo "  |                                                          |"
  echo "  |   Figlink requires Node.js to run.                       |"
  echo "  |                                                          |"
  echo "  |   Download it free from:                                 |"
  echo "  |     https://nodejs.org/en/download                       |"
  echo "  |                                                          |"
  echo "  |   Install Node.js, then double-click this file again.    |"
  echo "  |                                                          |"
  echo "  +----------------------------------------------------------+"
  echo ""
  read -p "  Press Enter to close..."
  exit 1
fi

# Run the launcher
node start.js

# Keep window open if it exits unexpectedly
echo ""
read -p "  Figlink stopped. Press Enter to close..."
