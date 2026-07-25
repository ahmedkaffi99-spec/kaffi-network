"""Port de app/api/channel-logo/route.ts."""
from fastapi import APIRouter, Depends, Response

from local_auth import require_local_secret
from tools.image_generator import generate_channel_logo

router = APIRouter(dependencies=[Depends(require_local_secret)])


@router.get("/api/channel-logo")
async def channel_logo():
    png = generate_channel_logo()
    return Response(
        content=png,
        media_type="image/png",
        headers={"Content-Disposition": 'attachment; filename="ia-pronostics-coupons-logo.png"'},
    )
