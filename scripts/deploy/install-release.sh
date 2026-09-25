#!/bin/sh
# Install a prebuilt release on the VM: check out the commit, download the
# artifact published by build-release.sh, swap .next/standalone atomically and
# restart the service. Downtime is the restart only; no build runs here.
set -eu
sha=${1:?usage: install-release.sh <short-sha>}
cd "$(dirname "$0")/../.."
export PATH="$HOME/.local/agenticwiki-node/bin:$PATH"
git fetch -q origin && git checkout -q "$sha"
# Reinstall dependencies whenever the lockfile differs from the one last installed
# (comparing commits misses changes already pulled before this script runs).
lock=$(sha256sum package-lock.json | cut -d" " -f1)
if [ "$(cat node_modules/.installed-lock 2>/dev/null)" != "$lock" ]; then npm ci --omit=dev --no-audit --no-fund && echo "$lock" > node_modules/.installed-lock; fi
# UNL VPN sessions: root-owned helper plus openconnect and smbclient (see scripts/vpn).
if [ -f scripts/vpn/aw-vpn ]; then
  command -v openconnect >/dev/null && command -v smbclient >/dev/null || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q openconnect smbclient >/dev/null
  sudo install -d -m 755 /usr/local/lib/agenticwiki
  sudo install -m 755 -o root -g root scripts/vpn/aw-vpn scripts/vpn/aw-vpn-script /usr/local/lib/agenticwiki/
  # Restart the broker only when it changed; with KillMode=process a restart keeps tunnels up anyway.
  changed=0
  cmp -s scripts/vpn/aw-vpn-daemon.cjs /usr/local/lib/agenticwiki/aw-vpn-daemon.cjs || changed=1
  cmp -s scripts/vpn/agenticwiki-vpn.service /etc/systemd/system/agenticwiki-vpn.service || changed=1
  sudo install -m 644 -o root -g root scripts/vpn/aw-vpn-daemon.cjs /usr/local/lib/agenticwiki/
  sudo install -m 644 -o root -g root scripts/vpn/agenticwiki-vpn.service /etc/systemd/system/agenticwiki-vpn.service
  sudo systemctl daemon-reload && sudo systemctl enable -q agenticwiki-vpn
  if [ "$changed" = 1 ] || ! systemctl is-active -q agenticwiki-vpn; then sudo systemctl restart agenticwiki-vpn; fi
fi
asset="/tmp/agenticwiki-$sha.tgz"
curl -fsSL -o "$asset" "https://github.com/impanyu/agentic_wiki/releases/download/deploy-$sha/agenticwiki-$sha.tgz"
rm -rf .next/standalone.new && mkdir -p .next/standalone.new
tar -xzf "$asset" -C .next/standalone.new
ln -sfn ../../node_modules .next/standalone.new/node_modules
[ -d .next/standalone ] && { rm -rf .next/standalone.prev; mv .next/standalone .next/standalone.prev; }
mv .next/standalone.new .next/standalone
# Let running page-agent replies and page generations finish (up to 3 minutes) so a
# deploy does not cut them off mid-answer.
NODE_BIN=${NODE_BIN:-$HOME/.local/agenticwiki-node/bin/node}
for _ in $(seq 1 36); do
  busy=$("$NODE_BIN" -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1],{readOnly:true});console.log(db.prepare(\"SELECT count(*) n FROM generation_locks WHERE expires>? AND (name LIKE 'agent:%' OR name LIKE 'question:%' OR name LIKE 'fork:%')\").get(Date.now()).n)" "${DATA_DIR:-$PWD/data}/agenticwiki.sqlite" 2>/dev/null || echo 0)
  [ "$busy" = "0" ] && break
  echo "Waiting for $busy running agent task(s) to finish before restarting…"; sleep 5
done
sudo systemctl restart agenticwiki
sleep 5
systemctl is-active agenticwiki
curl -fsS localhost:3000/api/health && echo
git tag -f "deploy-$sha" >/dev/null
echo "Installed deploy-$sha (previous build kept in .next/standalone.prev)."
