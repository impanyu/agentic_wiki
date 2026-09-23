#!/bin/sh
# Build the production bundle on a fast machine and publish it as a GitHub
# release asset, so the VM only downloads and swaps it (see install-release.sh).
# The artifact excludes node_modules: the VM links its own Linux dependencies.
set -eu
cd "$(dirname "$0")/../.."
NODE=${NODE:-$(command -v node || echo /Users/yp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node)}
sha=$(git rev-parse --short HEAD)
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then echo "Commit and push your changes first: the VM checks out $sha." >&2; exit 1; fi
"$NODE" node_modules/next/dist/bin/next build --webpack
"$NODE" scripts/prepare-standalone.mjs
asset="${TMPDIR:-/tmp}/agenticwiki-$sha.tgz"
tar -C .next/standalone --exclude=node_modules --exclude=data -czf "$asset" .
gh release create "deploy-$sha" "$asset" --title "deploy $sha" --notes "Built artifact for $sha" --latest=false
echo "Published deploy-$sha. On the VM run: scripts/deploy/install-release.sh $sha"
