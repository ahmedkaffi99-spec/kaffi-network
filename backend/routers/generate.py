"""Port de app/api/generate/route.ts."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from local_auth import require_local_secret
from orchestrator import run_pipeline

router = APIRouter()


class GenerateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    date: str | None = None
    # runId : généré côté navigateur (voir components/CommandCenterClient.tsx)
    # pour pouvoir démarrer le polling de la vue "live" avant même que ce
    # run ne commence à poster des messages — le frontend envoie du JSON
    # camelCase, jamais retouché pour rester un proxy strictement passthrough.
    run_id: str | None = Field(default=None, alias="runId")


@router.post("/api/generate", dependencies=[Depends(require_local_secret)])
async def generate(body: GenerateRequest):
    result = await run_pipeline(body.date, body.run_id)
    return result
