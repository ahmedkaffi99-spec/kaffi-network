// Formatage d'affichage — notation courte de bookmaker (1/X/2, Over/Under,
// BTTS) reconnue par les parieurs habitués à 1xBet et équivalents, plutôt
// que les phrases longues utilisées en interne pour le calcul des résultats
// (lib/tools/result-checker.ts continue d'utiliser bet_type tel quel).

export function shortenBetType(betType: string): string {
  const bt = betType.toLowerCase()

  const overMatch = bt.match(/(?:plus de|over)\s*(\d+(?:\.\d+)?)/)
  if (overMatch) return `Over ${overMatch[1]}`

  const underMatch = bt.match(/(?:moins de|under)\s*(\d+(?:\.\d+)?)/)
  if (underMatch) return `Under ${underMatch[1]}`

  if (bt.includes('btts') || bt.includes('deux équipes marquent')) {
    return bt.includes('non') ? 'BTTS Non' : 'BTTS Oui'
  }

  if (bt.includes('victoire') && (bt.includes('domicile') || bt.includes('home'))) return '1'
  if (bt.includes('victoire') && (bt.includes('extérieur') || bt.includes('exterieur') || bt.includes('away'))) return '2'
  if (bt.includes('match nul') || bt === 'nul' || bt.includes('draw')) return 'X'

  const handicapMatch = betType.match(/handicap\s+(.+?)\s+([+-]?\d+(?:\.\d+)?)/i)
  if (handicapMatch) {
    const [, team, point] = handicapMatch
    return `${team.trim()} ${point.startsWith('-') || point.startsWith('+') ? point : `+${point}`}`
  }

  return betType
}

/** Initiales pour le badge d'équipe (pas de vrai logo — voir note dans image-generator.ts). */
export function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}
