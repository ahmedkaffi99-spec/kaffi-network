#!/usr/bin/env python3
"""
Envoie sur le canal Telegram le texte du combiné rédigé par Claude Code
(dernière étape du flux collect_data.py -> analyse -> send_telegram.py).

Usage :
    python send_telegram.py message.txt
    python send_telegram.py message.txt --photo capture_1xbet.jpg

Le fichier message doit être au format Telegram "HTML" (parse_mode=HTML) —
seuls & < > sont réservés, contrairement à MarkdownV2. Mêmes balises que le
site : <b>gras</b>, <i>italique</i>.

Variables d'environnement requises (voir .env.example) :
    TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID
"""
import os
import sys

import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        print(f"Erreur : variable d'environnement {name} manquante (voir .env.example).", file=sys.stderr)
        sys.exit(1)
    return value


def send_message(text: str) -> dict:
    token = require_env("TELEGRAM_BOT_TOKEN")
    channel_id = require_env("TELEGRAM_CHANNEL_ID")
    res = requests.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={"chat_id": channel_id, "text": text, "parse_mode": "HTML"},
        timeout=20,
    )
    if not res.ok:
        raise RuntimeError(f"Telegram sendMessage {res.status_code}: {res.text}")
    return res.json()


def send_photo(photo_path: str, caption: str) -> dict:
    token = require_env("TELEGRAM_BOT_TOKEN")
    channel_id = require_env("TELEGRAM_CHANNEL_ID")
    with open(photo_path, "rb") as f:
        res = requests.post(
            f"https://api.telegram.org/bot{token}/sendPhoto",
            data={"chat_id": channel_id, "caption": caption, "parse_mode": "HTML"},
            files={"photo": f},
            timeout=30,
        )
    if not res.ok:
        raise RuntimeError(f"Telegram sendPhoto {res.status_code}: {res.text}")
    return res.json()


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python send_telegram.py <fichier_message.txt> [--photo <image>]")
        sys.exit(1)

    message_path = sys.argv[1]
    with open(message_path, "r", encoding="utf-8") as f:
        text = f.read().strip()

    if not text:
        print("Erreur : le fichier message est vide.", file=sys.stderr)
        sys.exit(1)

    photo_path = None
    if "--photo" in sys.argv:
        idx = sys.argv.index("--photo")
        if idx + 1 >= len(sys.argv):
            print("Erreur : --photo nécessite un chemin de fichier.", file=sys.stderr)
            sys.exit(1)
        photo_path = sys.argv[idx + 1]

    result = send_photo(photo_path, text) if photo_path else send_message(text)

    msg_id = result.get("result", {}).get("message_id")
    print(f"✅ Envoyé sur Telegram — message #{msg_id}")


if __name__ == "__main__":
    main()
