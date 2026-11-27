#!/bin/sh
# rankwiki operations on the VM, kept short to type: sh rankwiki.sh <command> [sha]
#   db        start the entity database (PostgreSQL 16 + pgvector, localhost:5434) once;
#             its password is generated here and written only to ~/rankwiki/.env.local
#   deploy    install release <sha> into ~/rankwiki and restart the rankwiki service
#   status    service, health, database and recent logs
set -eu
DIR=$HOME/rankwiki
ENV=$DIR/.env.local
case "${1:-status}" in
 db)
  if ! grep -q '^ENTITY_DB_URL=' "$ENV"; then
   p=$(openssl rand -hex 24)
   sudo docker run -d --name rankwiki-pg --restart unless-stopped \
    -e POSTGRES_USER=rankwiki -e POSTGRES_PASSWORD="$p" -e POSTGRES_DB=rankwiki \
    -p 127.0.0.1:5434:5432 -v rankwiki_pg:/var/lib/postgresql/data pgvector/pgvector:pg16 >/dev/null
   echo "ENTITY_DB_URL=postgres://rankwiki:$p@127.0.0.1:5434/rankwiki" >> "$ENV"
  fi
  for _ in $(seq 1 30); do sudo docker exec rankwiki-pg pg_isready -U rankwiki >/dev/null 2>&1 && break; sleep 2; done
  sudo docker exec rankwiki-pg psql -U rankwiki -tAc 'select version()'
  echo "ENTITY_DB_URL set: $(grep -c '^ENTITY_DB_URL=' "$ENV")";;
 deploy)
  sha=${2:?usage: rankwiki.sh deploy <sha>}
  cd "$DIR" && git fetch -q origin rankwiki && git checkout -q "$sha"
  SERVICE=rankwiki APP_PORT=3002 DATA_DIR=$DIR/data sh scripts/deploy/install-release.sh "$sha"
  # The background processes: the worker (model scheduler, maintenance) and the team workers.
  sudo systemctl restart rankwiki-worker || true
  # Team workers run from their own copy of a release and keep it until told: "teams" drains them (no new tasks,
  # finish the running ones, then restart on this release); "restart-teams" restarts them now; by default they
  # keep running (a change to pages or data tools does not need them).
  case "${3:-}" in
   restart-teams) for u in $(systemctl list-units --plain --no-legend 'rankwiki-teams@*' | awk '{print $1}'); do sudo systemctl restart "$u" || true; done;;
   teams) touch "$DIR/data/drain-teams";;
  esac
  # Enabled team workers that are not running (stopped by hand, or failed) are started.
  for u in $(ls /etc/systemd/system/multi-user.target.wants/ 2>/dev/null | grep '^rankwiki-teams@'); do systemctl is-active -q "$u" || sudo systemctl start "$u" || true; done;;
 status)
  echo "service: $(systemctl is-active rankwiki)"; curl -s localhost:3002/api/health; echo
  sudo docker ps --filter name=rankwiki-pg --format '{{.Names}} {{.Status}}' || true
  git -C "$DIR" log -1 --format='commit %h %s'
  sudo journalctl -u rankwiki -n 8 --no-pager | cut -c1-200;;
 *) echo "usage: rankwiki.sh db|deploy <sha>|status"; exit 1;;
esac
