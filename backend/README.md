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

### Installation sur Termux (Android)

`numpy`/`lxml`/`Pillow` ont du code natif (C) — les laisser se compiler
depuis zéro via `pip` sur un téléphone est lent et échoue parfois. Termux
fournit ces paquets déjà compilés via `pkg` — les installer comme ça, PUIS
le reste via `pip` :

```bash
pkg update && pkg upgrade
pkg install python git python-numpy python-lxml python-pillow libjpeg-turbo

git clone <url-du-repo>
cd kaffi-network && git checkout claude/code-session-hzweq0
cd backend

# --system-site-packages : hérite des paquets natifs installés par pkg
# ci-dessus au lieu de tenter de les recompiler dans le venv.
python -m venv .venv --system-site-packages
source .venv/bin/activate
pip install fastapi "uvicorn[standard]" httpx python-dotenv python-multipart supabase apscheduler pydantic beautifulsoup4 numpy

cp .env.example .env
pkg install nano   # ou l'éditeur de ton choix
nano .env          # remplis tes vraies clés
```

**Ne PAS installer `scipy`** sur Termux (`pkg install python-scipy` échoue
souvent — pas de wheel précompilé fiable pour toutes les combinaisons
Python/Android, et compiler depuis zéro sans toolchain Fortran ne marche
pas). Ce n'est pas grave : `scipy` n'est utile QUE pour l'ajustement
Dixon-Coles avancé (`quant/poisson_model.py::fit_dixon_coles_mle`, pas
encore branché dans le pipeline réel) — tout le reste (Elo, force
attaque/défense simple, simulation Monte Carlo, détection de value bets,
donc `scripts/analyze_specific_matches.py`) fonctionne sans scipy.

Ensuite, mêmes commandes que d'habitude (`python scripts/analyze_specific_matches.py`,
`uvicorn app:app ...`). Si `pip install` réessaie quand même de compiler
`numpy`/`scipy`/`lxml`/`Pillow` depuis zéro, vérifie que le venv a bien été
créé avec `--system-site-packages`.

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

## Moteur quantitatif (`quant/` + `agents/quant_analyst.py`)

Un second moteur de pronostic, entièrement déterministe (aucun appel LLM),
construit à côté du pipeline "IA conversationnelle" (planner/analyst/writer)
décrit plus haut :

- **`quant/elo.py`** — ratings Elo (système "World Football Elo Ratings" :
  avantage terrain, K-factor, multiplicateur d'écart de buts). Sert de
  signal informatif (écart de rating affiché sur chaque value bet), pas
  d'entrée dans le calcul de probabilité de marché.
- **`quant/poisson_model.py`** — modèle de buts Poisson + correction
  Dixon-Coles (1997) pour les scores faibles. Deux méthodes d'estimation de
  la force attaque/défense d'une équipe :
  - `estimate_team_strength_simple` — ratio à la moyenne de ligue, à partir
    du seul historique récent d'UNE équipe (~15 derniers matchs, mélangés
    aux xG Understat via `blended_goals` quand disponibles). C'est la
    méthode **réellement utilisée** par `agents/quant_analyst.py`
    aujourd'hui, parce que la collecte actuelle (`tools/football_api.py`)
    ne rassemble pas un historique croisé sur tout un championnat.
  - `fit_dixon_coles_mle` — l'ajustement Dixon-Coles complet par maximum de
    vraisemblance, statistiquement plus rigoureux mais qui a besoin d'un
    gros jeu de données joint entre équipes (≥ 100 matchs, voir
    `MIN_MATCHES_FOR_MLE`). Disponible et testé, mais pas encore branché
    faute d'une collecte de données à cette échelle.
- **`quant/monte_carlo.py`** — 100 000 tirages de score à partir de la
  distribution Dixon-Coles, pour produire les probabilités 1X2, BTTS,
  Over/Under et les scores exacts les plus probables.
- **`quant/value_bet.py`** — Edge, Expected Value, Kelly Criterion
  (fractionnaire, plafonné), score de confiance sur 100 et classement par
  étoiles (★ à ★★★★★).
- **`tools/understat.py`** / **`tools/fbref.py`** — scraping gratuit (pas
  de clé API) pour xG/xGA/xPoints/PPDA/Deep Completions (Understat) et
  Progressive Passes/Carries + un proxy des "big chances" via les Actions
  Créatrices de Tir/But (FBref, qui ne publie pas la métrique Opta exacte).
- **`tools/oddspapi.py`** — cotes bookmaker via [OddsPapi](https://oddspapi.io)
  (`ODDSPAPI_KEY`), fournisseur alternatif à The Odds API (`tools/odds_api.py`)
  couvrant beaucoup plus de marchés et de compétitions (basé sur un script de
  collecte déjà validé en production par l'utilisateur). Utilisé en priorité
  par `agents/quant_analyst.py::_resolve_bookmaker_odds` pour 1X2/BTTS/
  Over-Under, avec repli automatique sur The Odds API si OddsPapi n'a pas la
  sélection recherchée (ou si `ODDSPAPI_KEY` n'est pas configurée).

**Portée actuelle** : marchés 1X2, BTTS, Over/Under uniquement (le "cœur
statistique") — pas encore les ~18 marchés ni les 7 modèles ML évoqués dans
le prompt maître d'origine, ni un tableau de bord dédié. Ce sont des
extensions possibles, pas encore construites.

**Point d'entrée** : `agents/quant_analyst.py::run_quant_analysis(date) ->
list[ValueBet]`. **Pas câblé dans `orchestrator.py` par défaut** —
c'est un module autonome, testable et utilisable indépendamment. Le brancher
à la place (ou en complément) de `agents/analyst.py` dans le pipeline de
production réelle (qui alimente un vrai canal Telegram) est une décision à
prendre après avoir comparé ses sorties à des value bets connus, pas un
changement à faire à l'aveugle.

**Non testé en conditions réelles** : les scrapers Understat/FBref n'ont
pas pu être validés contre les vrais sites depuis l'environnement de
développement (accès réseau restreint dans ce sandbox) — leur logique de
parsing est testée contre des pages HTML factices reproduisant fidèlement
la structure documentée des deux sites (voir `tests/test_understat.py`,
`tests/test_fbref.py`), mais une vraie requête HTTP n'a jamais été
exécutée. À valider en premier une fois en local :

```bash
python3 -c "
import asyncio
from tools.understat import get_league_team_stats
print(asyncio.run(get_league_team_stats('EPL')))
"
```

`tools/oddspapi.py` a la même limite (aucune vraie requête HTTP exécutée
depuis ce sandbox), mais avec plus de confiance : son schéma vient
directement d'un script de collecte déjà utilisé en production par
l'utilisateur (`bet_agent/collecte_donnees.py`), pas d'une lecture de
documentation seule. À valider :

```bash
python3 -c "
import asyncio
from tools.oddspapi import get_fixtures
print(asyncio.run(get_fixtures()))
"
```

## Structure

```
app.py                  Point d'entrée FastAPI (routers + scheduler)
orchestrator.py         Pipeline complet (port de lib/orchestrator.ts)
scheduler.py            Cron local (APScheduler) — remplace vercel.json
model_router.py         Routage OpenRouter/Groq (port de lib/model-router.ts)
local_auth.py           Vérification du secret partagé (X-Local-Secret)
supabase_client.py      Client Supabase service-role
agent_kernel/           Framework générique multi-agents (blackboard, budget, mémoire)
agents/                 planner, analyst, odds_selector, writer, supervisor, quant_analyst
quant/                  elo, poisson_model, monte_carlo, value_bet (moteur quantitatif, voir plus haut)
tools/                  football_api, odds_api, oddspapi, serper, telegram,
                        image_generator, memory, quota_tracker, result_checker,
                        duplicate_checker, display_format, understat, fbref
routers/                generate, sessions, publish, channel_logo
tests/                  pytest — unitaires + intégration (mocks)
```
