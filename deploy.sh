#!/usr/bin/env bash
# Déploiement sur le VPS : récupère la dernière version et recharge l'API sans coupure.
# Prérequis : .env et data/series.json déjà en place sur le serveur (copiés à la main).
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "Fichier .env manquant : copier .env.example en .env et le compléter." >&2
  exit 1
fi

git pull --ff-only
npm ci --omit=dev
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

echo "Déploiement terminé."
