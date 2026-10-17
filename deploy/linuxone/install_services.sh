#!/usr/bin/env bash
# Install and start the two systemd services: the Granite model server (llama.cpp) and the
# PrioriHealth web app. Both restart automatically and survive reboots.
#
#   bash deploy/linuxone/install_services.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OPT="${PRIORIHEALTH_OPT:-$HOME/priorihealth-opt}"
USER_NAME="$(id -un)"
PORT="${PRIORIHEALTH_PORT:-8000}"
THREADS="$(nproc)"

render() {  # fill the unit template placeholders
  sed -e "s#@ROOT@#$ROOT#g" -e "s#@OPT@#$OPT#g" -e "s#@USER@#$USER_NAME#g" \
      -e "s#@PORT@#$PORT#g" -e "s#@THREADS@#$THREADS#g" "$1"
}

render "$ROOT/deploy/linuxone/priorihealth-llama.service" | sudo tee /etc/systemd/system/priorihealth-llama.service >/dev/null
render "$ROOT/deploy/linuxone/priorihealth-web.service" | sudo tee /etc/systemd/system/priorihealth-web.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now priorihealth-llama.service priorihealth-web.service

# Open the web port in the host firewall, if one is active.
if command -v ufw >/dev/null && sudo ufw status | grep -q active; then
  sudo ufw allow "$PORT"/tcp
elif command -v firewall-cmd >/dev/null && sudo firewall-cmd --state >/dev/null 2>&1; then
  sudo firewall-cmd --permanent --add-port="$PORT"/tcp && sudo firewall-cmd --reload
fi

echo "Waiting for the model to load..."
for _ in $(seq 1 120); do
  curl -fs http://127.0.0.1:8080/health >/dev/null && break
  sleep 2
done
curl -fs http://127.0.0.1:8080/health && echo " <- llama-server healthy"
curl -fs "http://127.0.0.1:$PORT/api/system" && echo
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "PrioriHealth: http://${IP:-<server-ip>}:$PORT   (also open port $PORT in the cloud security group if needed)"
