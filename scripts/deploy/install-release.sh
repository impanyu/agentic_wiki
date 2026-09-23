#!/bin/sh
# Install a prebuilt release on the VM: check out the commit, download the
# artifact published by build-release.sh, swap .next/standalone atomically and
# restart the service. Downtime is the restart only; no build runs here.
set -eu
sha=${1:?usage: install-release.sh <short-sha>}
cd "$(dirname "$0")/../.."
export PATH="$HOME/.local/agenticwiki-node/bin:$PATH"
previous=$(git rev-parse --short HEAD)
git fetch -q origin && git checkout -q "$sha"
if git diff --quiet "$previous" "$sha" -- package-lock.json; then :; else npm ci --omit=dev; fi
asset="/tmp/agenticwiki-$sha.tgz"
curl -fsSL -o "$asset" "https://github.com/impanyu/agentic_wiki/releases/download/deploy-$sha/agenticwiki-$sha.tgz"
rm -rf .next/standalone.new && mkdir -p .next/standalone.new
tar -xzf "$asset" -C .next/standalone.new
ln -sfn ../../node_modules .next/standalone.new/node_modules
[ -d .next/standalone ] && { rm -rf .next/standalone.prev; mv .next/standalone .next/standalone.prev; }
mv .next/standalone.new .next/standalone
sudo systemctl restart agenticwiki
sleep 5
systemctl is-active agenticwiki
curl -fsS localhost:3000/api/health && echo
git tag -f "deploy-$sha" >/dev/null
echo "Installed deploy-$sha (previous build kept in .next/standalone.prev)."
