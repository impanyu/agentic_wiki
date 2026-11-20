#!/bin/sh
# One-time setup of the rankwiki instance next to the wiki on the same VM:
# its own checkout (~/rankwiki), data directory, .env.local, systemd service on
# port 3002 and Caddy site. Idempotent: existing files are kept. Afterwards deploy
# with: cd ~/rankwiki && SERVICE=rankwiki APP_PORT=3002 DATA_DIR=$HOME/rankwiki/data \
#   sh scripts/deploy/install-release.sh <sha>
set -eu
SRC=$HOME/agenticwiki
DIR=$HOME/rankwiki
PORT=3002
DOMAIN=rankwiki.aisoup.net
if [ ! -d "$DIR/.git" ]; then
 git clone -q "$SRC" "$DIR"
 git -C "$DIR" remote set-url origin "$(git -C "$SRC" remote get-url origin)"
fi
mkdir -p "$DIR/data" && chmod 700 "$DIR/data"
# Only what a public-data wiki needs: no Drive, Dropbox, OneDrive, Picker or ArcGIS OAuth keys.
if [ ! -f "$DIR/.env.local" ]; then
 umask 077
 grep -E '^(OPENAI_API_KEY|OPENAI_[A-Z_]*MODEL|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|STORAGE_TOKEN_ENCRYPTION_KEY|GOOGLE_MAPS_API_KEY|YOUTUBE_API_KEY|GITHUB_TOKEN|EARTH_ENGINE_[A-Z_]*)=' "$SRC/.env.local" > "$DIR/.env.local" || true
 echo "APP_URL=https://$DOMAIN" >> "$DIR/.env.local"
 ee="$SRC/data/secrets/earthengine-service-account.json"
 if [ -f "$ee" ] && ! grep -q '^EARTH_ENGINE_SERVICE_ACCOUNT_KEY_FILE=' "$DIR/.env.local"; then echo "EARTH_ENGINE_SERVICE_ACCOUNT_KEY_FILE=$ee" >> "$DIR/.env.local"; fi
fi
echo "rankwiki .env.local keys: $(cut -d= -f1 "$DIR/.env.local" | xargs)"
# The service mirrors the wiki's unit with its own directory, port and URL.
unit=$(systemctl show -p FragmentPath --value agenticwiki)
if [ ! -f /etc/systemd/system/rankwiki.service ]; then
 sed -e "s#$SRC#$DIR#g" -e "s#^Environment=PORT=.*#Environment=PORT=$PORT#" -e "s#^Environment=APP_URL=.*#Environment=APP_URL=https://$DOMAIN#" -e "s#^Description=.*#Description=rankwiki#" "$unit" | sudo tee /etc/systemd/system/rankwiki.service >/dev/null
 sudo systemctl daemon-reload
 sudo systemctl enable -q rankwiki
fi
if ! sudo grep -q "^$DOMAIN" /etc/caddy/Caddyfile; then
 sudo cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.before-rankwiki-$(date +%s)"
 printf '\n%s {\n\treverse_proxy 127.0.0.1:%s {\n\t\tflush_interval -1\n\t}\n}\n' "$DOMAIN" "$PORT" | sudo tee -a /etc/caddy/Caddyfile >/dev/null
 sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
 sudo systemctl reload caddy
fi
echo "rankwiki is set up: $DIR, port $PORT, https://$DOMAIN"
