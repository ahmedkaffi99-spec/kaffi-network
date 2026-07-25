"""Port de app/api/sessions/[id]/{approve,reject,chat,apply-change}/route.ts.

Contrairement aux routes Next.js d'origine, ces routes ne vérifient plus une
session utilisateur Supabase (pas de cookies SSR côté backend Python) —
seul `require_local_secret` protège l'accès, le dashboard restant lui-même
protégé par Supabase Auth côté Next.js (middleware.ts, inchangé). Voir
local_auth.py.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from agent_kernel import parse_agent_json
from agents.odds_selector import TIER_PICK_RANGE
from agents.supervisor import check_forbidden_words
from local_auth import require_local_secret
from model_router import route_completion
from supabase_client import admin_supabase

router = APIRouter(dependencies=[Depends(require_local_secret)])

MAX_HISTORY = 12
MAX_MESSAGE_LEN = 2000
MAX_TEXT_LEN = 4000

AGENT_LABEL = {"analyst": "l'Analyste", "writer": "le Rédacteur"}


@router.post("/api/sessions/{session_id}/approve")
async def approve(session_id: str):
    res = (
        admin_supabase.table("pronostic_sessions")
        .update({"status": "approved"})
        .eq("id", session_id)
        .eq("status", "draft")
        .execute()
    )
    return {"success": True}


@router.post("/api/sessions/{session_id}/reject")
async def reject(session_id: str):
    # Rejet manuel d'un palier 'draft' — remplace l'ancien verdict
    # "revision_needed" du Superviseur IA : c'est maintenant l'utilisateur
    # qui juge le post et décide s'il publie ou non.
    admin_supabase.table("pronostic_sessions").update(
        {"status": "rejected", "notes": "Rejeté manuellement depuis le dashboard."}
    ).eq("id", session_id).eq("status", "draft").execute()
    return {"success": True}


class ChatHistoryItem(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    agent: Literal["analyst", "writer"] = "analyst"
    message: str
    history: list[ChatHistoryItem] = []


def _build_system_prompt(agent: str, session: dict, picks: list[dict]) -> str:
    active_picks = [p for p in picks if not p.get("was_rejected")]
    picks_text = (
        "\n".join(
            f"- {p['home_team']} vs {p['away_team']} ({p['competition']}) → {p['bet_type']} @ {p['odds']:.2f} — "
            f"tendance {p['trend_pct']}% sur {p['sample_size']} matchs ({p['trend_label']})"
            for p in active_picks
        )
        or "Aucun pick retenu dans ce combiné."
    )

    analyst_output = session.get("analyst_output") or {}
    rejected = analyst_output.get("picks_rejetés") or []
    rejected_text = (
        "\n".join(f"- {rp['match']} ({rp['competition']}){f' — ' + rp['bet_type'] if rp.get('bet_type') else ''} : {rp['raison']}" for rp in rejected)
        if rejected
        else "Aucun."
    )

    odds_selector_output = session.get("odds_selector_output") or {}
    excluded = odds_selector_output.get("excluded_picks") or []
    excluded_text = "\n".join(f"- {ep['match']} ({ep['bet_type']}) : {ep['reason']}" for ep in excluded) if excluded else "Aucun."

    common_context = f"""PALIER : {session['tier']} — cote combinée {session.get('combined_odds') or '—'}
STATUT : {session['status']}
{session.get('notes') or ''}

PICKS RETENUS DANS CE COMBINÉ :
{picks_text}

PICKS ÉCARTÉS PAR L'ANALYSTE (tendance/cote insuffisante) :
{rejected_text}

PICKS ÉCARTÉS PAR LE SÉLECTEUR DE COTES (marché bookmaker jugé peu fiable) :
{excluded_text}

RÉSUMÉ DE L'ANALYSTE : {analyst_output.get('summary') or 'Non disponible.'}
{f"PLAN SUIVI PAR L'ANALYSTE : {analyst_output['plan']}" if analyst_output.get('plan') else ''}

POST TELEGRAM RÉDIGÉ : {session.get('writer_output') or 'Non disponible.'}"""

    role_instructions = (
        "Tu ES l'Analyste qui a produit cette sélection — explique tes choix (pourquoi ces picks, pourquoi tel pick a été écarté) en te basant STRICTEMENT sur les données ci-dessous."
        if agent == "analyst"
        else "Tu ES le Rédacteur qui a écrit ce post Telegram — explique tes choix de ton, de formulation, de mise en avant des picks, en te basant STRICTEMENT sur les données ci-dessous."
    )

    change_instructions = (
        'Si l\'utilisateur demande EXPLICITEMENT de réécrire/modifier le post (pas juste une question), inclus "proposed_change": { "type": "rewrite_post", "new_text": "le texte COMPLET réécrit du post" }. "new_text" doit être le post entier prêt à publier, pas un extrait.'
        if agent == "writer"
        else 'Si l\'utilisateur demande EXPLICITEMENT de retirer un pick précis de ce combiné (pas juste une question), inclus "proposed_change": { "type": "remove_pick", "home_team": "...", "away_team": "...", "bet_type": "..." } — copie EXACTEMENT ces trois valeurs depuis "PICKS RETENUS" ci-dessus, sans les reformuler. Tu ne peux PAS ajouter ou remplacer un pick par un autre — seulement en retirer un existant.'
    )

    return f"""{role_instructions}

RÈGLES ABSOLUES :
- N'invente JAMAIS une statistique, une cote ou un match qui n'est pas dans les données ci-dessous.
- Si une question porte sur une donnée absente, dis clairement que tu ne l'as pas plutôt que de deviner.
- Réponds en français, de façon concise (quelques phrases), sans jargon inutile.
- {change_instructions}
- Ne mets "proposed_change" à autre chose que null QUE si l'utilisateur demande clairement un changement — jamais pour une simple question ou une explication.

Réponds UNIQUEMENT avec du JSON valide, structure exacte :
{{
  "reply": "ta réponse conversationnelle",
  "proposed_change": null
}}

DONNÉES DE CETTE SESSION :
{common_context}"""


@router.post("/api/sessions/{session_id}/chat")
async def chat(session_id: str, body: ChatRequest):
    message = body.message.strip()[:MAX_MESSAGE_LEN]
    history = body.history[-MAX_HISTORY:]

    if not message:
        raise HTTPException(status_code=400, detail="Message vide.")

    res = admin_supabase.table("pronostic_sessions").select("*, picks(*)").eq("id", session_id).single().execute()
    session = res.data
    if not session:
        raise HTTPException(status_code=404, detail="Session introuvable")

    picks = session.get("picks") or []

    system_prompt = _build_system_prompt(body.agent, session, picks)
    conversation = "\n\n".join(
        [
            *(f"{'Utilisateur' if h.role == 'user' else AGENT_LABEL[body.agent]} : {h.content[:MAX_MESSAGE_LEN]}" for h in history),
            f"Utilisateur : {message}",
        ]
    )

    result = await route_completion(body.agent, system_prompt, conversation, 768)
    text, model_used = result["text"], result["model_used"]

    if not text:
        raise HTTPException(status_code=502, detail="Aucun modèle disponible pour répondre — réessaie dans un instant.")

    # Fail-closed : si le JSON est illisible, on affiche le texte brut comme
    # réponse mais on ne propose JAMAIS de changement à partir d'une sortie
    # qu'on n'a pas pu parser correctement.
    fallback = {"reply": text, "proposed_change": None}
    parsed = parse_agent_json(text, fallback)

    return {"reply": parsed.get("reply") or text, "proposed_change": parsed.get("proposed_change"), "model_used": model_used}


class ApplyChangeRequest(BaseModel):
    type: str
    new_text: str | None = None
    home_team: str | None = None
    away_team: str | None = None
    bet_type: str | None = None


@router.post("/api/sessions/{session_id}/apply-change")
async def apply_change(session_id: str, body: ApplyChangeRequest):
    """Applique un changement PROPOSÉ par le chat (/api/sessions/{id}/chat) —
    jamais appliqué automatiquement, seulement quand l'utilisateur clique
    "Appliquer ce changement" dans le dashboard. C'est ce bouton qui fait
    autorité : le chat ne fait que proposer, cette route exécute."""
    res = admin_supabase.table("pronostic_sessions").select("*, picks(*)").eq("id", session_id).single().execute()
    session = res.data
    if not session:
        raise HTTPException(status_code=404, detail="Session introuvable")

    # Une session déjà approuvée/publiée/rejetée est figée — un pick a pu
    # être réellement misé sur 1xBet entre-temps, la modifier après coup
    # romprait le lien avec ce qui a été réellement engagé.
    if session["status"] != "draft":
        raise HTTPException(status_code=409, detail="Cette session n'est plus modifiable (déjà approuvée, publiée ou rejetée).")

    if body.type == "rewrite_post":
        new_text = (body.new_text or "").strip()
        if not new_text:
            raise HTTPException(status_code=400, detail="Texte vide.")
        if len(new_text) > MAX_TEXT_LEN:
            raise HTTPException(status_code=400, detail="Texte trop long.")

        forbidden = check_forbidden_words(new_text)
        if forbidden:
            raise HTTPException(status_code=400, detail=f"Ce texte contient des mots interdits ({', '.join(forbidden)}) — non appliqué.")

        admin_supabase.table("pronostic_sessions").update({"writer_output": new_text}).eq("id", session_id).execute()
        return {"success": True, "note": "Post mis à jour."}

    if body.type == "remove_pick":
        home_team = (body.home_team or "").strip().lower()
        away_team = (body.away_team or "").strip().lower()
        bet_type = (body.bet_type or "").strip().lower()

        picks = session.get("picks") or []
        active_picks = [p for p in picks if not p.get("was_rejected")]

        target = next(
            (
                p
                for p in active_picks
                if p["home_team"].strip().lower() == home_team
                and p["away_team"].strip().lower() == away_team
                and p["bet_type"].strip().lower() == bet_type
            ),
            None,
        )

        if not target:
            raise HTTPException(status_code=404, detail="Pick introuvable dans ce combiné.")

        remaining = [p for p in active_picks if p["id"] != target["id"]]
        rng = TIER_PICK_RANGE[session["tier"]]

        if len(remaining) < rng["min"]:
            raise HTTPException(
                status_code=400,
                detail=f"Impossible de retirer ce pick : il faut au moins {rng['min']} picks pour un palier {session['tier']}, il n'en resterait que {len(remaining)}.",
            )

        admin_supabase.table("picks").update(
            {"was_rejected": True, "rejection_reason": "Retiré manuellement via le chat."}
        ).eq("id", target["id"]).execute()

        combined_odds = 1.0
        for p in remaining:
            combined_odds *= p["odds"]
        combined_odds = round(combined_odds * 100) / 100

        admin_supabase.table("pronostic_sessions").update({"combined_odds": combined_odds}).eq("id", session_id).execute()

        return {
            "success": True,
            "note": "Pick retiré, cote recalculée. Pense à demander au Rédacteur de réécrire le post si besoin — il n'est pas mis à jour automatiquement.",
        }

    raise HTTPException(status_code=400, detail="Type de changement inconnu.")
