"""Port de app/api/publish/[sessionId]/route.ts.

Publication = capture réelle du coupon misé sur 1xBet envoyée par
l'utilisateur, pas un ticket généré automatiquement — voir orchestrator.py
(s'arrête à 'approved') et la discussion produit : l'IA ne fabrique jamais
de faux "Mise / Gains potentiels / Statut : Accepté", seul un vrai pari
réellement placé peut afficher ces informations.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from local_auth import require_local_secret
from supabase_client import admin_supabase
from tools.duplicate_checker import check_duplicates, save_published_matches
from tools.telegram import send_photo

router = APIRouter(dependencies=[Depends(require_local_secret)])

# Marge large pour une capture d'écran de téléphone (souvent 3-6 Mo en HD).
MAX_FILE_BYTES = 10 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
_EXT_BY_TYPE = {"image/png": "png", "image/webp": "webp", "image/jpeg": "jpg"}


@router.post("/api/publish/{session_id}")
async def publish(session_id: str, file: UploadFile = File(...)):
    res = admin_supabase.table("pronostic_sessions").select("*, picks(*)").eq("id", session_id).single().execute()
    session = res.data
    if not session:
        raise HTTPException(status_code=404, detail="Session introuvable")
    if session["status"] != "approved":
        raise HTTPException(status_code=400, detail="La session doit être approuvée avant publication")
    if not session.get("writer_output"):
        raise HTTPException(status_code=400, detail="Aucun texte de post rédigé pour cette session")

    writer_output = session["writer_output"]
    picks = session.get("picks") or []
    if not picks:
        raise HTTPException(status_code=400, detail="Aucun pick dans cette session")

    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Format non supporté — envoie une image JPEG, PNG ou WebP.")

    bytes_data = await file.read()
    if len(bytes_data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=400, detail="Image trop grande (max 10 Mo).")

    try:
        picks_as_candidate = [
            {
                "competition": p["competition"],
                "home_team": p["home_team"],
                "away_team": p["away_team"],
                "match_datetime": p.get("match_datetime") or datetime.now(timezone.utc).isoformat(),
                "bet_type": p["bet_type"],
                "odds": p["odds"],
                "trend_label": p["trend_label"],
                "trend_pct": p["trend_pct"],
                "sample_size": p["sample_size"],
            }
            for p in picks
        ]

        # Les picks sont volontairement partagés entre paliers (même jour) —
        # ce contrôle bloque seulement un match déjà réellement publié pour
        # CE palier, pas la présence normale d'un match dans plusieurs
        # paliers.
        dup = check_duplicates(picks_as_candidate, session["tier"])
        if not dup["ok"]:
            raise HTTPException(status_code=409, detail=f"Picks déjà publiés : {', '.join(dup['duplicates'])}")

        ext = _EXT_BY_TYPE[file.content_type]
        path = f"{session_id}-{int(datetime.now(timezone.utc).timestamp() * 1000)}.{ext}"

        # Bucket privé — ces captures peuvent révéler un solde de compte
        # réel, jamais rendues publiques (admin_supabase bypasse RLS pour
        # cet upload serveur, mais aucune politique publique n'existe sur ce
        # bucket).
        admin_supabase.storage.from_("manual-tickets").upload(
            path, bytes_data, {"content-type": file.content_type, "upsert": "false"}
        )

        telegram_msg_id = await send_photo(bytes_data, writer_output)

        admin_supabase.table("pronostic_sessions").update(
            {
                "status": "published",
                "published_at": datetime.now(timezone.utc).isoformat(),
                "telegram_msg_id": telegram_msg_id,
                "manual_ticket_path": path,
            }
        ).eq("id", session_id).execute()

        save_published_matches(picks_as_candidate, session_id, session["tier"])

        return {"success": True, "telegram_message_id": telegram_msg_id}
    except HTTPException:
        raise
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))
