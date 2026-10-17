#!/usr/bin/env bash
# Serve PrioriHealth at https://<domain> from the LinuxONE server: opens ports 80/443,
# installs Caddy (automatic Let's Encrypt certificates) as a reverse proxy to the app,
# and binds the app to localhost so it is only reachable through HTTPS.
#
#   bash deploy/linuxone/setup_https.sh priorihealth.miles-ehrlich.com
#
# DNS: add an A record for the domain pointing at this server's public IP. With
# Cloudflare, set it to "DNS only" (grey cloud): the proxy closes streams that are quiet for
# 100 s, and live panel discussions can pause longer than that on a small VM.
set -euo pipefail

DOMAIN="${1:?usage: setup_https.sh <domain>}"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a

echo "== Firewall: allow HTTP (80) and HTTPS (443)"
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 3 -p tcp -m conntrack --ctstate NEW --dport "$port" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save; fi
if command -v ufw >/dev/null && sudo ufw status | grep -q active; then sudo ufw allow 80,443/tcp; fi

echo "== Installing Caddy"
sudo -E apt-get install -y caddy

echo "== Caddy site config for $DOMAIN"
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:${PRIORIHEALTH_PORT:-8000} {
		flush_interval -1   # stream live panel discussions immediately (server-sent events)
	}
}
EOF
sudo systemctl enable --now caddy
sudo systemctl reload caddy

echo "== Binding the app to localhost (public traffic now goes through Caddy/HTTPS)"
sudo sed -i 's#--host 0.0.0.0#--host 127.0.0.1#' /etc/systemd/system/priorihealth-web.service
sudo systemctl daemon-reload
sudo systemctl restart priorihealth-web

echo
echo "Done. Once DNS for $DOMAIN points here, Caddy fetches a certificate automatically:"
echo "  https://$DOMAIN"
echo "Check: sudo journalctl -u caddy -f"
