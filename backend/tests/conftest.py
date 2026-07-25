"""Variables d'environnement factices — permet d'importer les modules du
backend (qui lisent os.environ au chargement) sans vraies clés API. Aucun
test de ce dossier ne fait de vrai appel réseau : les frontières externes
(LLM, API-Football, Odds API, Serper, Supabase) sont monkeypatchées dans
chaque test qui en a besoin."""
import os

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("LOCAL_BACKEND_SECRET", "test-secret")
os.environ.setdefault("OPENROUTER_API_KEY", "test-openrouter-key")
os.environ.setdefault("API_FOOTBALL_KEY", "test-api-football-key")
os.environ.setdefault("ODDS_API_KEY", "test-odds-key")
os.environ.setdefault("SERPER_API_KEY", "test-serper-key")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-telegram-token")
os.environ.setdefault("TELEGRAM_CHANNEL_ID", "test-channel")
os.environ.setdefault("AFFILIATE_LINK", "https://example.com/aff")
