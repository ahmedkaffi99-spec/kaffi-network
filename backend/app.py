"""Point d'entrée FastAPI du backend local — remplace les routes app/api/**.

Lancement : uvicorn app:app --host 0.0.0.0 --port 8000
(exécuté depuis le dossier backend/, voir README.md). Ne pas utiliser
--reload en usage réel : le scheduler (cron local) tournerait dans le
process rechargé et redémarrerait à chaque modification de fichier.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI

from routers.channel_logo import router as channel_logo_router
from routers.generate import router as generate_router
from routers.publish import router as publish_router
from routers.sessions import router as sessions_router
from scheduler import start_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_scheduler()
    yield


app = FastAPI(title="IA de Pronostics & Coupons — backend local", lifespan=lifespan)

app.include_router(generate_router)
app.include_router(sessions_router)
app.include_router(publish_router)
app.include_router(channel_logo_router)


@app.get("/health")
async def health() -> dict:
    return {"ok": True}
