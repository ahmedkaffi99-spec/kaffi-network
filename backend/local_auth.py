"""Vérification du secret partagé entre le frontend Next.js local et ce
serveur — même principe que lib/tools/cron-auth.ts (comparaison à temps
constant), adapté en dépendance FastAPI plutôt qu'un check manuel par route.

Ce n'est PAS de l'authentification utilisateur (ça reste Supabase Auth côté
Next.js) — juste un filtre pour qu'un autre appareil sur le même réseau local
ne puisse pas déclencher ces actions (génération, publication...) sans
connaître le secret.
"""
import hmac
import os

from dotenv import load_dotenv
from fastapi import Header, HTTPException

load_dotenv()

_EXPECTED = os.environ["LOCAL_BACKEND_SECRET"]


def require_local_secret(x_local_secret: str | None = Header(default=None)) -> None:
    if not x_local_secret or not hmac.compare_digest(x_local_secret, _EXPECTED):
        raise HTTPException(status_code=401, detail="Non autorisé")
