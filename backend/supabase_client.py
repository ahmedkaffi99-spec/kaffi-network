"""Client Supabase service-role — équivalent de lib/supabase/admin.ts.

Bypass RLS entièrement, usage serveur uniquement. Le frontend garde son
propre client (anon key) pour l'authentification et la lecture des pages —
ce backend ne fait jamais d'authentification utilisateur, seule
local_auth.py protège ses routes (secret partagé, réseau local).
"""
import os

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

_SUPABASE_URL = os.environ["SUPABASE_URL"]
_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

admin_supabase: Client = create_client(_SUPABASE_URL, _SERVICE_ROLE_KEY)
