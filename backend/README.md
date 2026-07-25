# Backend local (Python / FastAPI)

Remplace les routes `app/api/**` et toute la logique métier de `lib/` —
pipeline multi-agents, intégrations API externes, envoi Telegram,
génération d'image. Tourne en permanence sur ta machine, à côté du
frontend Next.js (voir racine du repo). Supabase reste dans le cloud,
inchangé.

Ne pas confondre avec `python/` à la racine du repo : `python/` est un
outil manuel ponctuel (scripts `collect_data.py` / `send_telegram.py`,
sans Supabase) pour une analyse assistée par Claude Code au cas par cas.
Ce dossier `backend/` est le vrai serveur de production, qui remplace
l'ancien déploiement Vercel.

## Installation

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# remplis .env : Supabase, LOCAL_BACKEND_SECRET, OpenRouter/Groq, API-Football,
# Odds API, Serper, Telegram, lien affilié.
```

`LOCAL_BACKEND_SECRET` doit être identique à celui du `.env.local` du
frontend Next.js (racine du repo) — c'est un filtre réseau local, pas de
l'authentification utilisateur (qui reste Supabase Auth côté Next.js).
Génère une valeur longue et aléatoire, par exemple :

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

## Lancement

```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

Ne pas ajouter `--reload` en usage réel : le scheduler (cron local,
`scheduler.py`) tourne dans le même process et un rechargement automatique
le redémarrerait à chaque modification de fichier. Le scheduler démarre
automatiquement avec l'API (voir la fonction `lifespan` dans `app.py`) et
reproduit les deux horaires qu'utilisait `vercel.json` : génération
quotidienne à 09:00 UTC, vérification des résultats à 21:00 UTC.

Ensuite, lance le frontend normalement (`npm run dev` ou `npm run build &&
npm run start` à la racine du repo) — les routes `app/api/**` relaient déjà
vers `http://127.0.0.1:8000` (voir `lib/tools/backend-proxy.ts`), aucun
changement de code frontend nécessaire.

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```

- Tests unitaires sur les fonctions pures : similarité d'équipes
  (`team_similarity`), évaluation d'un résultat de pari
  (`_evaluate_result`), composition des paliers (`_compose_tiers`),
  mots interdits (`check_forbidden_words`), notation courte des paris.
- Un test d'intégration (`tests/test_orchestrator_integration.py`) exécute
  le pipeline complet (Planificateur → Analyste → Sélecteur de cotes →
  Rédacteur → Superviseur → sauvegarde) avec toutes les frontières
  externes (LLM, API-Football, Odds API, Serper, Supabase) remplacées par
  de faux appels déterministes — voir `tests/fake_supabase.py`.

Ces tests ne remplacent pas une vraie génération : une fois tes clés
réelles en place dans `.env`, lance un vrai `POST /api/generate` (depuis le
dashboard, bouton "Générer") et compare le résultat à une session connue
du site actuel avant de considérer la bascule terminée.

## Structure

```
app.py                  Point d'entrée FastAPI (routers + scheduler)
orchestrator.py         Pipeline complet (port de lib/orchestrator.ts)
scheduler.py            Cron local (APScheduler) — remplace vercel.json
model_router.py         Routage OpenRouter/Groq (port de lib/model-router.ts)
local_auth.py           Vérification du secret partagé (X-Local-Secret)
supabase_client.py      Client Supabase service-role
agent_kernel/           Framework générique multi-agents (blackboard, budget, mémoire)
agents/                 planner, analyst, odds_selector, writer, supervisor
tools/                  football_api, odds_api, serper, telegram, image_generator,
                        memory, quota_tracker, result_checker, duplicate_checker,
                        display_format
routers/                generate, sessions, publish, channel_logo
tests/                  pytest — unitaires + intégration (mocks)
```
