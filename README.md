# IA de Pronostics & Coupons

Chaîne Telegram de pronostics football, pilotée par un pipeline multi-agents
(Planificateur → Analyste → Sélecteur de cotes → Rédacteur), avec
validation manuelle depuis un dashboard avant toute publication. Hébergement
100% local : frontend Next.js + backend Python, tous deux sur ta machine.
Seul Supabase reste dans le cloud (base de données, Auth, Storage).

## Deux choses distinctes en Python

- **`backend/`** — le vrai serveur de production. Un service FastAPI
  permanent qui remplace les anciennes routes `app/api/**` (déployées sur
  Vercel auparavant) : pipeline IA, intégrations API externes (API-Football,
  The Odds API, Serper, Telegram, OpenRouter/Groq), génération d'image.
  Voir `backend/README.md` pour l'installation et le lancement.
- **`python/`** — un outil manuel ponctuel, sans rapport avec le serveur
  ci-dessus. Deux scripts (`collect_data.py`, `send_telegram.py`) pour
  collecter des données à la demande et les analyser au cas par cas
  (assisté par Claude Code), sans passer par Supabase ni par le pipeline
  automatisé.

## Démarrage local

1. **Backend** — voir `backend/README.md` (installation des dépendances
   Python, `.env`, lancement d'uvicorn). Le scheduler intégré reproduit les
   deux horaires de l'ancien `vercel.json` (génération 09:00 UTC,
   vérification des résultats 21:00 UTC).
2. **Frontend** — copie `.env.local.example` en `.env.local` à la racine,
   renseigne Supabase (`NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`) et `LOCAL_BACKEND_SECRET` (identique à
   celui de `backend/.env`), puis :

   ```bash
   npm install
   npm run dev
   ```

Les routes `app/api/**` ne font plus que vérifier la session utilisateur
Supabase puis relayer vers le backend Python local (voir
`lib/tools/backend-proxy.ts`) — aucune clé API externe (OpenRouter,
API-Football, Telegram...) n'est nécessaire côté frontend, elles vivent
uniquement dans `backend/.env`.
