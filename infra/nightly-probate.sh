#!/bin/bash
#
# Nightly free probate refresh: fetch Texas "Notice to Creditors" for Travis
# County (texaspublicnotices.com, headless), then ingest → match → rescore.
# Designed to be run by launchd (see com.fulcrum.probate-nightly.plist).
#
# Self-healing: starts the Postgres/Redis containers and the ML service if
# they're down. Degrades gracefully — if ingest can't run, the notices are
# still saved for the next attempt. Fetched HTML contains real PII and is kept
# OUTSIDE the repo (~/.fulcrum/probate).

set -uo pipefail

REPO="/Users/willfoti/Documents/GitHub/fulcrum"
NODE_BIN="/Users/willfoti/.nvm/versions/node/v24.15.0/bin"
export PATH="$NODE_BIN:/usr/local/bin:/usr/bin:/bin"

export DATABASE_URL="postgresql://fulcrum:fulcrum@localhost:5437/fulcrum"
export REDIS_URL="redis://localhost:6380"
export ML_SERVICE_URL="http://127.0.0.1:8010"

DATA="$HOME/.fulcrum/probate"
LOGS="$HOME/.fulcrum/logs"
mkdir -p "$DATA" "$LOGS"
LOG="$LOGS/probate-nightly.log"
NOTICES="$DATA/notices-$(date +%Y%m%d).html"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

log "=== nightly probate refresh start ==="

# 1. containers (idempotent; they carry restart=unless-stopped)
docker start fulcrum-postgres fulcrum-redis >/dev/null 2>&1
for i in $(seq 1 30); do
  docker exec fulcrum-postgres pg_isready -U fulcrum >/dev/null 2>&1 && break
  sleep 1
done

# 2. ML service (start from the durable venv if not reachable)
if ! curl -sf --max-time 4 "$ML_SERVICE_URL/health" >/dev/null 2>&1; then
  log "ML service down — starting from services/ml/.venv"
  ( cd "$REPO/services/ml" && DATABASE_URL="$DATABASE_URL" \
      .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8010 \
      >>"$LOGS/ml-service.log" 2>&1 & )
  for i in $(seq 1 30); do
    curl -sf --max-time 3 "$ML_SERVICE_URL/health" >/dev/null 2>&1 && break
    sleep 1
  done
fi

# 3. fetch real Travis probate notices (free, headless)
log "fetching notices → $NOTICES"
if pnpm --filter @fulcrum/ingest fetch:notices "$NOTICES" --months 3 --max-pages 10 >>"$LOG" 2>&1; then
  log "fetch ok"
else
  log "fetch FAILED — see log; aborting ingest"
  exit 1
fi

# 4. ingest → match → rescore (only if ML is up)
if curl -sf --max-time 4 "$ML_SERVICE_URL/health" >/dev/null 2>&1; then
  log "ingesting notices"
  pnpm --filter @fulcrum/ingest ingest:probate --notices-file "$NOTICES" \
    --since "$(date -v-6m +%Y-%m-%d 2>/dev/null || date +%Y-%m-%d)" >>"$LOG" 2>&1 \
    && log "ingest ok" || log "ingest FAILED — notices saved for retry"
else
  log "ML still down — skipped ingest; notices saved at $NOTICES"
fi

# 5. retain only the last 14 notice files (PII hygiene)
ls -1t "$DATA"/notices-*.html 2>/dev/null | tail -n +15 | xargs rm -f 2>/dev/null

log "=== done ==="
