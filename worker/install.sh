#!/bin/bash
set -euo pipefail

APP_DIR="/opt/mining-worker"
SERVICE_FILE="/etc/systemd/system/mining.service"
XMRIG_URL="https://github.com/xmrig/xmrig/releases/download/v6.22.0/xmrig-6.22.0-linux-static-x64.tar.gz"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "========================================"
echo "  MINING WORKER - PRODUCTION INSTALL"
echo "========================================"

if [ "$EUID" -ne 0 ]; then
  echo "Run as root: sudo ./install.sh"
  exit 1
fi

if [ -z "${API_URL:-}" ] || [ -z "${MONERO_ADDRESS:-}" ] || [ -z "${WORKER_API_SECRET:-}" ]; then
  echo "Missing required environment variables."
  echo "Example:"
  echo "  sudo API_URL=https://PROJECT.supabase.co/functions/v1/mining-api \\"
  echo "       MONERO_ADDRESS=YOUR_MONERO_ADDRESS \\"
  echo "       WORKER_API_SECRET=YOUR_LONG_RANDOM_SECRET \\"
  echo "       ./install.sh"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[1/6] Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "[1/6] Node.js already installed: $(node --version)"
fi

echo "[2/6] Creating ${APP_DIR}..."
mkdir -p "$APP_DIR"
cd "$APP_DIR"

echo "[3/6] Installing worker script..."
cp "$SCRIPT_DIR/worker.js" "$APP_DIR/worker.js"

if [ ! -f "$APP_DIR/xmrig" ]; then
  echo "[4/6] Downloading XMRig..."
  curl -L -o xmrig.tar.gz "$XMRIG_URL"
  tar -xzf xmrig.tar.gz
  cp xmrig-6.22.0/xmrig "$APP_DIR/xmrig"
  chmod +x "$APP_DIR/xmrig"
  rm -rf xmrig-6.22.0 xmrig.tar.gz
else
  echo "[4/6] XMRig already installed"
fi

echo "[5/6] Writing environment file..."
cat > "$APP_DIR/mining.env" << EOF
API_URL=${API_URL}
MONERO_ADDRESS=${MONERO_ADDRESS}
WORKER_API_SECRET=${WORKER_API_SECRET}
WORKER_ID=${WORKER_ID:-worker-$(hostname)}
XMRIG_PATH=${APP_DIR}/xmrig
API_PORT=${API_PORT:-8081}
POOL_URL=${POOL_URL:-gulf.moneroocean.stream:10128}
EOF
chmod 600 "$APP_DIR/mining.env"

echo "[6/6] Installing systemd service..."
cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Mining Worker - XMRig Reporter
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/mining.env
ExecStart=/usr/bin/node ${APP_DIR}/worker.js
Restart=always
RestartSec=5
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable mining
systemctl restart mining

echo ""
echo "Installed successfully."
echo "Commands:"
echo "  systemctl status mining"
echo "  journalctl -u mining -f"
echo "  systemctl restart mining"
