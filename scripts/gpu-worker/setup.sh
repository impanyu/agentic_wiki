#!/usr/bin/env bash
# RankWiki GPU worker — one-time setup on a Linux machine with an NVIDIA GPU (a lab or home machine).
# Installs vLLM in a virtualenv, picks a model that fits the GPU's memory, and runs two systemd services:
#   rankwiki-model  — the local OpenAI-compatible model server (127.0.0.1:8000, never exposed)
#   rankwiki-worker — scripts/llm-pool-worker.mjs: pulls agents' model calls from RankWiki over outbound HTTPS
# No inbound ports, no tunnels. Re-running is safe. Usage:  bash setup.sh   (asks for the pool token, hidden)
set -euo pipefail
command -v nvidia-smi >/dev/null || { echo "No NVIDIA driver found (nvidia-smi). Install the driver first."; exit 1; }
GPU=$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1); MEM=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -1)
NGPU=$(nvidia-smi -L | wc -l); echo "GPU: $GPU ×$NGPU, ${MEM} MiB each"
# Model by memory (per GPU): ≥90 GB gpt-oss-120b; ≥44 GB Qwen3.6-35B-A3B FP8; ≥22 GB Qwen3 14B AWQ; else stop.
if   [ "$MEM" -ge 90000 ]; then MODEL=${MODEL:-openai/gpt-oss-120b}; EXTRA="--tool-call-parser openai --enable-auto-tool-choice"
elif [ "$MEM" -ge 44000 ]; then MODEL=${MODEL:-Qwen/Qwen3.6-35B-A3B-FP8}; EXTRA="--tool-call-parser hermes --enable-auto-tool-choice --reasoning-parser qwen3"
elif [ "$MEM" -ge 22000 ]; then MODEL=${MODEL:-Qwen/Qwen3-14B-AWQ}; EXTRA="--tool-call-parser hermes --enable-auto-tool-choice --reasoning-parser qwen3"
else echo "This GPU has too little memory for an agent model."; exit 1; fi
echo "Model: $MODEL"
DIR=$HOME/rankwiki-gpu; mkdir -p "$DIR"; cd "$DIR"
# Python env with vLLM (uv: fast installer), Node 18+ for the worker.
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH=$HOME/.local/bin:$PATH
[ -d .venv ] || uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -U vllm
command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ] || { echo "Installing Node 22 (user-local)…"; curl -fsSL https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-x64.tar.xz | tar -xJ -C "$DIR"; ln -sf "$DIR/node-v22.11.0-linux-x64/bin/node" "$HOME/.local/bin/node"; }
curl -fsSL https://raw.githubusercontent.com/impanyu/agentic_wiki/rankwiki/scripts/llm-pool-worker.mjs -o worker.mjs
# The pool token (from the RankWiki VM: sudo grep ^LLM_POOL_TOKEN= ~/rankwiki/.env.local) — typed hidden, stored 0600.
if [ ! -s token ]; then read -rsp "Paste the RankWiki pool token (hidden): " T; echo; printf %s "$T" > token; chmod 600 token; fi
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/rankwiki-model.service" <<UNIT
[Unit]
Description=RankWiki local model server (vLLM, $MODEL)
[Service]
WorkingDirectory=$DIR
ExecStart=$DIR/.venv/bin/vllm serve $MODEL --host 127.0.0.1 --port 8000 --served-model-name local --tensor-parallel-size $NGPU --max-model-len 131072 --enable-prefix-caching --gpu-memory-utilization 0.92 $EXTRA
Restart=always
RestartSec=20
[Install]
WantedBy=default.target
UNIT
cat > "$HOME/.config/systemd/user/rankwiki-worker.service" <<UNIT
[Unit]
Description=RankWiki model-pool worker (pulls agents' requests)
After=rankwiki-model.service
[Service]
WorkingDirectory=$DIR
ExecStart=/bin/sh -c 'LLM_POOL_TOKEN=\$(cat $DIR/token) RANKWIKI_URL=https://rankwiki.aisoup.net LOCAL_BASE=http://127.0.0.1:8000/v1 LOCAL_MODEL=local POOL_MODEL=local CONCURRENCY=${CONCURRENCY:-16} WORKER_ID=$(hostname)-gpu exec $(command -v node || echo $HOME/.local/bin/node) $DIR/worker.mjs'
Restart=always
RestartSec=15
[Install]
WantedBy=default.target
UNIT
loginctl enable-linger "$USER" 2>/dev/null || sudo loginctl enable-linger "$USER" || true
systemctl --user daemon-reload
systemctl --user enable --now rankwiki-model.service
echo "Downloading and loading $MODEL (first start takes a while)…"
for i in $(seq 1 180); do curl -sf http://127.0.0.1:8000/v1/models >/dev/null && break; sleep 10; done
curl -sf http://127.0.0.1:8000/v1/models >/dev/null || { echo "The model server did not come up; see: journalctl --user -u rankwiki-model -n 50"; exit 1; }
systemctl --user enable --now rankwiki-worker.service
sleep 5; journalctl --user -u rankwiki-worker -n 5 --no-pager
echo "Done. Status: systemctl --user status rankwiki-model rankwiki-worker   Logs: journalctl --user -u rankwiki-worker -f"
