#!/usr/bin/env bash
# Lance le backend local. Suppose que .venv existe déjà (voir README.md pour
# l'installation initiale) et que .env est rempli.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "Environnement virtuel introuvable — installe d'abord (voir README.md) :"
  echo "  python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

if [ ! -f .env ]; then
  echo "backend/.env introuvable — copie .env.example en .env et remplis-le."
  exit 1
fi

source .venv/bin/activate
exec uvicorn app:app --host 0.0.0.0 --port 8000
