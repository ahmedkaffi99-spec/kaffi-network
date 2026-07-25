"""Port de lib/tools/display-format.ts — notation courte de bookmaker."""
import re


def shorten_bet_type(bet_type: str) -> str:
    bt = bet_type.lower()

    over_match = re.search(r"(?:plus de|over)\s*(\d+(?:\.\d+)?)", bt)
    if over_match:
        return f"Over {over_match.group(1)}"

    under_match = re.search(r"(?:moins de|under)\s*(\d+(?:\.\d+)?)", bt)
    if under_match:
        return f"Under {under_match.group(1)}"

    if "btts" in bt or "deux équipes marquent" in bt:
        return "BTTS Non" if "non" in bt else "BTTS Oui"

    if "victoire" in bt and ("domicile" in bt or "home" in bt):
        return "1"
    if "victoire" in bt and ("extérieur" in bt or "exterieur" in bt or "away" in bt):
        return "2"
    if "match nul" in bt or bt == "nul" or "draw" in bt:
        return "X"

    handicap_match = re.search(r"handicap\s+(.+?)\s+([+-]?\d+(?:\.\d+)?)", bet_type, re.IGNORECASE)
    if handicap_match:
        team, point = handicap_match.group(1), handicap_match.group(2)
        sign = point if point.startswith(("-", "+")) else f"+{point}"
        return f"{team.strip()} {sign}"

    return bet_type


def team_initials(name: str) -> str:
    """Initiales pour le badge d'équipe (pas de vrai logo)."""
    words = [w for w in name.strip().split() if w]
    if len(words) >= 2:
        return (words[0][0] + words[1][0]).upper()
    return name[:2].upper()
