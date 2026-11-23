#!/usr/bin/env bash
# Production deployment on the VPS (Docker Compose). Run from the clone, as a user of the docker group:
#   bash deploy/production.sh
# Optional variables:
#   DEPLOY_BRANCH (default: main)
#   SKIP_GIT=1        do not git pull (already done by the caller)
#   KEEP_BACKUPS=10   number of database backups kept

set -euo pipefail

DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
KEEP_BACKUPS="${KEEP_BACKUPS:-10}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log() { echo "[deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }
die() { echo "[deploy ERREUR] $*" >&2; exit 1; }

command -v git >/dev/null || die "git introuvable"
docker compose version >/dev/null 2>&1 || die "docker compose introuvable"
[[ -f .env ]] || die ".env introuvable (présent uniquement sur le VPS, jamais commité)"

FIXI_PORT="$(sed -n 's/^FIXI_PORT=//p' .env | tr -d "\"' \r")"
FIXI_PORT="${FIXI_PORT:-3000}"

# 1. Code
if [[ "${SKIP_GIT:-0}" != "1" ]]; then
  [[ -z "$(git status --porcelain)" ]] || die "Copie de travail modifiée sur le VPS : commit ou stash avant de déployer"
  git fetch origin "$DEPLOY_BRANCH"
  git checkout "$DEPLOY_BRANCH"
  git pull --ff-only origin "$DEPLOY_BRANCH"
fi
log "Commit déployé : $(git rev-parse --short HEAD) - $(git log -1 --pretty=%s)"

# 2. Database backup, taken by the running container before the new image applies its migrations.
#    The SQLite online backup API gives a consistent copy even while Fixi is writing (WAL mode).
#    Backups stay in the fixi-data volume: /app/data/backups.
if [[ -n "$(docker compose ps -q --status running fixi)" ]]; then
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  log "Sauvegarde de la base : backups/fixi-$STAMP.db"
  docker compose exec -T fixi node -e '
    const fs = require("node:fs");
    const Database = require("better-sqlite3");
    const src = process.env.DATABASE_PATH || "./data/fixi.db";
    fs.mkdirSync("./data/backups", { recursive: true });
    new Database(src, { readonly: true }).backup(process.argv[1])
      .then(() => console.log("sauvegarde OK"))
      .catch((e) => { console.error(e); process.exit(1); });
  ' "./data/backups/fixi-$STAMP.db"
  # Keep only the most recent backups.
  docker compose exec -T fixi sh -c "ls -1t ./data/backups/fixi-*.db | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f"
else
  log "Conteneur arrêté : pas de sauvegarde (premier déploiement ?)"
fi

# 3. Build and restart (migrations run at startup).
log "Construction de l'image et redémarrage"
docker compose up -d --build

# 4. Health check.
log "Attente de /healthz sur 127.0.0.1:$FIXI_PORT"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$FIXI_PORT/healthz" >/dev/null 2>&1; then
    log "Fixi répond"
    docker image prune -f >/dev/null
    log "Déploiement terminé"
    exit 0
  fi
  sleep 2
done
docker compose logs --tail 50 fixi
die "Fixi ne répond pas après 60 s (voir les logs ci-dessus ; sauvegarde dans /app/data/backups)"
