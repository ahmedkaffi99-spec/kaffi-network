import { readFileSync } from 'fs'
import { join } from 'path'
import satori from 'satori'
import sharp from 'sharp'
import type { PickCandidate } from '@/lib/types'
import { shortenBetType, teamInitials } from '@/lib/tools/display-format'
import { resolveMatchFlags } from '@/lib/tools/flags'
import { loadTeamLogoDataUri } from '@/lib/tools/team-logos'

function loadFont(weight: 400 | 700): ArrayBuffer {
  const file = weight === 700 ? 'inter-700.woff' : 'inter-400.woff'
  const buf = readFileSync(join(process.cwd(), 'lib', 'assets', 'fonts', file))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

// Satori (le moteur de rendu) n'affiche pas les glyphes emoji correctement
// (rendus en carré/rectangle vide) — tout le visuel du ticket est composé
// de formes CSS/texte uniquement, jamais d'emoji.
function numberBadge(n: number) {
  return {
    type: 'div',
    props: {
      style: {
        width: '26px',
        height: '26px',
        borderRadius: '7px',
        background: 'linear-gradient(135deg, #d9b56f 0%, #b8863f 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '13px',
        fontWeight: 700,
        color: '#0a1428',
        flexShrink: 0,
      },
      children: String(n),
    },
  }
}

// Badge d'initiales — dernier repli, quand ni logo ni drapeau n'ont pu être
// résolus (mode cotes seules, où API-Football n'a pas tourné).
function initialsBadge(name: string) {
  return {
    type: 'div',
    props: {
      style: {
        width: '22px',
        height: '22px',
        borderRadius: '50%',
        background: 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.14)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '9px',
        fontWeight: 700,
        color: '#c3cbdc',
        flexShrink: 0,
      },
      children: teamInitials(name),
    },
  }
}

// Vrai drapeau (image PNG rasterisée depuis flag-icons, voir lib/tools/flags.ts)
function flagBadge(dataUri: string) {
  return {
    type: 'img',
    props: {
      src: dataUri,
      width: 22,
      height: 16,
      style: { borderRadius: '3px', flexShrink: 0, objectFit: 'cover' as const },
    },
  }
}

// Vrai blason d'équipe (récupéré depuis API-Football, voir lib/tools/team-logos.ts)
function logoBadge(dataUri: string) {
  return {
    type: 'img',
    props: {
      src: dataUri,
      width: 20,
      height: 20,
      style: { flexShrink: 0, objectFit: 'contain' as const },
    },
  }
}

// Priorité : vrai blason d'équipe > drapeau > initiales — chaque niveau
// n'est disponible que si la donnée en amont l'était (jamais inventé).
function teamMarker(logoDataUri: string | null, flagDataUri: string | null, name: string) {
  if (logoDataUri) return logoBadge(logoDataUri)
  if (flagDataUri) return flagBadge(flagDataUri)
  return initialsBadge(name)
}

export async function generateTicketImage(
  picks: PickCandidate[],
  combinedOdds: number,
  date: string
): Promise<Buffer> {
  // Résout les drapeaux AVANT de construire l'arbre Satori (rendu synchrone) —
  // un par équipe pour un match international (les noms d'équipe sont des
  // pays), un seul représentant la compétition pour un match de club (les
  // deux équipes sont du même pays, un drapeau par équipe serait redondant).
  const flagsByPick = await Promise.all(
    picks.map(pick => resolveMatchFlags(pick.competition, pick.home_team, pick.away_team))
  )
  const homeMarkers = picks.map((pick, i) => {
    const f = flagsByPick[i]
    return f.mode === 'teams' ? f.home : f.mode === 'competition' ? f.flag : null
  })
  const awayMarkers = picks.map((pick, i) => {
    const f = flagsByPick[i]
    return f.mode === 'teams' ? f.away : f.mode === 'competition' ? f.flag : null
  })

  // Vrais blasons — uniquement présents si l'Analyste a tourné avec
  // l'API-Football (jamais en mode cotes seules). null pour un pick sans
  // logo fait retomber teamMarker() sur le drapeau puis les initiales.
  const homeLogos = await Promise.all(picks.map(pick => loadTeamLogoDataUri(pick.home_team_logo)))
  const awayLogos = await Promise.all(picks.map(pick => loadTeamLogoDataUri(pick.away_team_logo)))

  const fontData = loadFont(400)
  const fontDataBold = loadFont(700)
  const formattedDate = new Date(date).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  const cardHeight = 76
  const totalHeight = 156 + picks.length * cardHeight + 70

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svg = await (satori as any)(
    {
      type: 'div',
      props: {
        style: {
          width: '620px',
          height: `${totalHeight}px`,
          background: 'linear-gradient(155deg, #060d1f 0%, #0a1631 55%, #0d1c3c 100%)',
          fontFamily: 'Inter',
          display: 'flex',
          flexDirection: 'column',
          padding: '0',
          boxSizing: 'border-box',
          position: 'relative',
        },
        children: [
          // Liseré doré en haut
          {
            type: 'div',
            props: {
              style: {
                height: '4px',
                width: '100%',
                background: 'linear-gradient(90deg, transparent 0%, #c9a35c 50%, transparent 100%)',
              },
            },
          },
          {
            type: 'div',
            props: {
              style: { display: 'flex', flexDirection: 'column', padding: '30px 34px', flex: 1 },
              children: [
                // Header
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: { display: 'flex', alignItems: 'center', gap: '12px' },
                          children: [
                            {
                              type: 'div',
                              props: {
                                style: {
                                  width: '38px',
                                  height: '38px',
                                  borderRadius: '11px',
                                  background: 'linear-gradient(135deg, #d9b56f 0%, #9c7739 100%)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '15px',
                                  fontWeight: 700,
                                  color: '#0a1428',
                                },
                                children: 'IA',
                              },
                            },
                            {
                              type: 'div',
                              props: {
                                style: { display: 'flex', flexDirection: 'column' },
                                children: [
                                  { type: 'span', props: { style: { color: '#e8cf9e', fontSize: '15px', fontWeight: 700, letterSpacing: '1.5px' }, children: 'PRONOSTICS IA' } },
                                  { type: 'span', props: { style: { color: '#5b6b8c', fontSize: '11px', marginTop: '2px' }, children: formattedDate } },
                                ],
                              },
                            },
                          ],
                        },
                      },
                      {
                        type: 'div',
                        props: {
                          style: {
                            background: 'linear-gradient(135deg, rgba(201,163,92,0.16), rgba(201,163,92,0.05))',
                            border: '1px solid rgba(201,163,92,0.45)',
                            borderRadius: '10px',
                            padding: '8px 16px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                          },
                          children: [
                            { type: 'span', props: { style: { color: '#8a97b5', fontSize: '9px', letterSpacing: '1.5px', fontWeight: 600 }, children: 'COTE COMBINÉE' } },
                            { type: 'span', props: { style: { color: '#e8cf9e', fontSize: '24px', fontWeight: 700 }, children: combinedOdds.toFixed(2) } },
                          ],
                        },
                      },
                    ],
                  },
                },
                // Picks
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', flexDirection: 'column', gap: '10px' },
                    children: picks.map((pick, i) => ({
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          gap: '14px',
                          background: 'rgba(255,255,255,0.035)',
                          border: '1px solid rgba(255,255,255,0.06)',
                          borderRadius: '10px',
                          padding: '11px 14px',
                        },
                        children: [
                          numberBadge(i + 1),
                          {
                            type: 'div',
                            props: {
                              style: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 },
                              children: [
                                {
                                  type: 'div',
                                  props: {
                                    style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' },
                                    children: [
                                      {
                                        type: 'div',
                                        props: {
                                          style: { display: 'flex', alignItems: 'center', gap: '7px', flex: 1, minWidth: 0 },
                                          children: [
                                            teamMarker(homeLogos[i], homeMarkers[i], pick.home_team),
                                            { type: 'span', props: { style: { color: '#f4f6fb', fontSize: '13px', fontWeight: 700, maxWidth: '128px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: pick.home_team } },
                                            { type: 'span', props: { style: { color: '#5b6b8c', fontSize: '10px', fontWeight: 700 }, children: 'VS' } },
                                            { type: 'span', props: { style: { color: '#f4f6fb', fontSize: '13px', fontWeight: 700, maxWidth: '128px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: pick.away_team } },
                                            teamMarker(awayLogos[i], awayMarkers[i], pick.away_team),
                                          ],
                                        },
                                      },
                                      { type: 'span', props: { style: { color: '#e8cf9e', fontSize: '13px', fontWeight: 700, flexShrink: 0 }, children: `@${pick.odds.toFixed(2)}` } },
                                    ],
                                  },
                                },
                                { type: 'span', props: { style: { color: '#c9a35c', fontSize: '11px', fontWeight: 600, marginTop: '4px' }, children: shortenBetType(pick.bet_type) } },
                                { type: 'span', props: { style: { color: '#7c8aab', fontSize: '10px', marginTop: '2px' }, children: pick.trend_label } },
                              ],
                            },
                          },
                        ],
                      },
                    })),
                  },
                },
                // Footer
                {
                  type: 'div',
                  props: {
                    style: {
                      borderTop: '1px solid rgba(201,163,92,0.15)',
                      marginTop: '20px',
                      paddingTop: '14px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    },
                    children: [
                      { type: 'span', props: { style: { color: '#526082', fontSize: '10px' }, children: 'Pari responsable — aucun gain garanti' } },
                      { type: 'span', props: { style: { color: '#8a97b5', fontSize: '10px', fontWeight: 600, letterSpacing: '0.5px' }, children: 't.me/IAdePronosticsCoupons' } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      width: 620,
      height: totalHeight,
      fonts: [
        { name: 'Inter', data: fontData, weight: 400 as const, style: 'normal' as const },
        { name: 'Inter', data: fontDataBold, weight: 700 as const, style: 'normal' as const },
      ],
    }
  )

  return sharp(Buffer.from(svg)).png().toBuffer()
}
