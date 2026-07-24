# Pipeline Python — collecte, analyse par Claude Code, envoi Telegram

Alternative 100% Python au pipeline automatique du site (qui tourne sur
Vercel en TypeScript). Ici, tu lances les scripts toi-même, et c'est Claude
Code (dans une session comme celle-ci) qui fait l'analyse — pas d'appel API
LLM payant à chaque génération.

## Le flux en 3 étapes

```
1. python collect_data.py [date]
   → collecte matchs, historiques, cotes, actualités
   → écrit python/data/collected_YYYY-MM-DD.json

2. Tu montres ce fichier à Claude Code et lui demandes d'analyser
   → Claude Code applique les mêmes règles que l'Analyste du site :
     tendance >= 80% sur >= 8 matchs, cote entre 1.35 et 6.0,
     cote fiable si l'écart entre bookmakers <= 20%
   → Claude Code écrit un fichier message.txt (format Telegram HTML)

3. python send_telegram.py message.txt [--photo capture.jpg]
   → publie sur le canal Telegram
```

## Installation

```bash
cd python
python -m venv venv
source venv/bin/activate   # Windows : venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# remplis .env avec tes clés (mêmes clés API que le site)
```

## Étape 1 — collecter

```bash
python collect_data.py                # aujourd'hui
python collect_data.py 2026-07-25      # une date précise
```

Prend quelques minutes — l'API-Football gratuite est limitée à 10
requêtes/minute (7 secondes entre chaque appel équipe), c'est volontaire et
incompressible sans passer à un plan payant.

Le fichier produit contient, par match : compétition, équipes, historique des
15 derniers matchs de chaque équipe (résultats, buts), les cotes détaillées
par bookmaker (h2h, plus/moins de X buts, handicap), et les actualités
récentes (blessures/suspensions) si `SERPER_API_KEY` est configurée.

## Étape 2 — analyser (avec Claude Code)

Ouvre une session Claude Code dans ce dossier et demande par exemple :

> Lis python/data/collected_2026-07-25.json et compose un combiné prudent
> (2 à 4 picks) en respectant les règles indiquées dans le champ "rules" du
> fichier. Écris le résultat dans python/data/message.txt au format Telegram
> HTML (balises `<b>` et `<i>`, pas de Markdown).

Claude Code peut composer plusieurs paliers (prudent/équilibré/audacieux) si
tu le demandes — mêmes plages de picks que le site (voir `rules` dans le
JSON).

## Étape 3 — envoyer sur Telegram

```bash
python send_telegram.py data/message.txt
# avec une capture 1xBet réellement misée :
python send_telegram.py data/message.txt --photo data/capture.jpg
```

## Ce que ce dossier NE fait PAS

- Pas de sauvegarde dans Supabase (pas d'historique, pas de suivi de
  résultats, pas de mémoire long terme) — c'est un flux ponctuel, indépendant
  du dashboard du site.
- Pas de vérification automatique des résultats après coup.
- Pas de retry/superviseur automatique — la vérification, c'est toi (en
  relisant ce que Claude Code propose) avant l'étape 3.
