#!/usr/bin/env bash
set -e

# ═══════════════════════════════════════════════════════════
#  J.A.R.V.I.S. — One-command launcher
#  Usage: bash start.sh
# ═══════════════════════════════════════════════════════════

CYAN='\033[0;36m'
GREEN='\033[0;32m'
AMBER='\033[0;33m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

echo ""
echo -e "${CYAN}${BOLD}  ╔══════════════════════════════════════════╗${RESET}"
echo -e "${CYAN}${BOLD}  ║   J.A.R.V.I.S.  —  STARTING UP          ║${RESET}"
echo -e "${CYAN}${BOLD}  ╚══════════════════════════════════════════╝${RESET}"
echo ""

# ── 1. Check Node.js ─────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo -e "${RED}  ✗ Node.js not found.${RESET}"
  echo -e "    Install it from: https://nodejs.org (LTS version)"
  exit 1
fi

NODE_VER=$(node --version)
echo -e "${GREEN}  ✓ Node.js ${NODE_VER} detected${RESET}"

# ── 2. Install dependencies if needed ────────────────────────
if [ ! -d "node_modules" ]; then
  echo -e "${AMBER}  ↓ Installing dependencies…${RESET}"
  npm install --silent
  echo -e "${GREEN}  ✓ Dependencies installed${RESET}"
else
  echo -e "${GREEN}  ✓ Dependencies already installed${RESET}"
fi

# ── 3. API Key setup ─────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo ""
  echo -e "${AMBER}  ⚠  No .env file found.${RESET}"
  echo -e "     Get your key at: ${BOLD}https://console.anthropic.com${RESET} → API Keys"
  echo ""
  echo -en "  Enter your Anthropic API key: "
  read -r API_KEY

  if [ -z "$API_KEY" ]; then
    echo -e "${RED}  ✗ No key entered. Aborting.${RESET}"
    exit 1
  fi

  echo "ANTHROPIC_API_KEY=${API_KEY}" > .env
  echo "PORT=3000"                   >> .env
  echo -e "${GREEN}  ✓ .env created${RESET}"
else
  echo -e "${GREEN}  ✓ .env already configured${RESET}"
fi

# ── 4. Open browser (best-effort) ────────────────────────────
PORT=$(grep '^PORT=' .env 2>/dev/null | cut -d= -f2 || echo 3000)
URL="http://localhost:${PORT}"

open_browser() {
  if command -v xdg-open &>/dev/null; then
    xdg-open "$URL" &>/dev/null &
  elif command -v open &>/dev/null; then
    open "$URL" &
  elif command -v start &>/dev/null; then
    start "$URL" &
  fi
}

# Delay browser open until server is likely ready
(sleep 2 && open_browser) &

# ── 5. Start server ──────────────────────────────────────────
echo ""
echo -e "${CYAN}  → Opening ${BOLD}${URL}${RESET}${CYAN} in your browser…${RESET}"
echo -e "${CYAN}  → Press ${BOLD}Ctrl+C${RESET}${CYAN} to stop J.A.R.V.I.S.${RESET}"
echo ""

node server.js
