"""Port de lib/tools/telegram.ts — Telegram Bot API."""
import os

import httpx

from .display_format import shorten_bet_type

TIER_LABELS = {"prudent": "Prudent", "equilibre": "Équilibré", "audacieux": "Audacieux"}
NUMBER_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]


def _telegram_api() -> str:
    return f"https://api.telegram.org/bot{os.environ['TELEGRAM_BOT_TOKEN']}"


def _escape_html(text: str) -> str:
    """Telegram parse_mode=HTML ne réserve que & < > — bien plus fiable que
    MarkdownV2 (~20 caractères réservés dont le point) pour du texte généré
    par un LLM qui n'échappe pas toujours parfaitement."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def format_combine_post(picks: list[dict], combined_odds: float) -> str:
    n = len(picks)
    lines = [f"🎫 <b>Combiné du jour — {n} match{'s' if n > 1 else ''} à tendance</b>", ""]

    for i, pick in enumerate(picks):
        num = NUMBER_EMOJIS[i] if i < len(NUMBER_EMOJIS) else f"{i + 1}."
        match = _escape_html(f"{pick['home_team']} VS {pick['away_team']}")
        bet = _escape_html(shorten_bet_type(pick["bet_type"]))
        odds = f"{pick['odds']:.2f}"
        trend = _escape_html(pick["trend_label"])
        lines.append(f"{num} <b>{match}</b> → {bet} (cote {odds})")
        lines.append(f"   💡 <i>{trend}</i>")

    lines += [
        "",
        f"<b>Cote combinée : {combined_odds:.2f}</b>",
        "",
        f"👉 Place ce combiné ici : {_escape_html(os.environ.get('AFFILIATE_LINK', ''))}",
        "",
        "⚠️ <i>Plus un combiné a de matchs, plus le risque augmente. Aucune prédiction sportive n'est garantie.</i>",
    ]

    return "\n".join(lines)


async def send_message(text: str, reply_to_message_id: str | None = None) -> str:
    channel_id = os.environ.get("TELEGRAM_CHANNEL_ID")
    if not os.environ.get("TELEGRAM_BOT_TOKEN") or not channel_id:
        raise RuntimeError("TELEGRAM_BOT_TOKEN ou TELEGRAM_CHANNEL_ID manquant")

    body = {"chat_id": channel_id, "text": text, "parse_mode": "HTML"}
    if reply_to_message_id:
        body["reply_to_message_id"] = int(reply_to_message_id)

    async with httpx.AsyncClient() as client:
        res = await client.post(f"{_telegram_api()}/sendMessage", json=body, timeout=20.0)
        if not res.is_success:
            raise RuntimeError(f"Telegram sendMessage {res.status_code}: {res.text}")
        data = res.json()

    return str(data["result"]["message_id"])


def format_result_announcement(
    tier: str, date: str, combo_result: str, wins: int, total: int, combined_odds: float | None
) -> str:
    """Message factuel — pas de LLM ici, l'annonce d'un résultat ne doit rien 'interpréter'."""
    import datetime as _dt

    tier_label = TIER_LABELS.get(tier, tier)
    date_label = _dt.datetime.fromisoformat(date).strftime("%A %d %B")
    icon = {"win": "✅", "loss": "❌", "void": "➖"}[combo_result]
    verdict = {"win": "GAGNÉ", "loss": "PERDU", "void": "ANNULÉ"}[combo_result]

    lines = [
        f"{icon} <b>Résultat — Combiné {tier_label} du {date_label}</b>",
        "",
        f"{wins}/{total} picks corrects",
    ]
    if combined_odds is not None:
        lines.append(f"Cote visée : {combined_odds:.2f}")
    lines += ["", f"<b>{verdict}</b>"]

    return "\n".join(lines)


async def send_photo(image_bytes: bytes, caption: str) -> str:
    channel_id = os.environ.get("TELEGRAM_CHANNEL_ID")
    if not os.environ.get("TELEGRAM_BOT_TOKEN") or not channel_id:
        raise RuntimeError("TELEGRAM_BOT_TOKEN ou TELEGRAM_CHANNEL_ID manquant")

    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"{_telegram_api()}/sendPhoto",
            data={"chat_id": channel_id, "caption": caption, "parse_mode": "HTML"},
            files={"photo": ("kombine.png", image_bytes, "image/png")},
            timeout=30.0,
        )
        if not res.is_success:
            raise RuntimeError(f"Telegram sendPhoto {res.status_code}: {res.text}")
        data = res.json()

    return str(data["result"]["message_id"])
