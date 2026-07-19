import { readFileSync } from 'fs'
import { join } from 'path'
import satori from 'satori'
import sharp from 'sharp'
import type { PickCandidate } from '@/lib/types'
import { shortenBetType, teamInitials } from '@/lib/tools/display-format'

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

// Pas de vrai blason d'équipe : ni API-Football (indisponible en mode
// cotes-uniquement, notre mode réel actuel) ni The Odds API ne fournissent
// d'URL de logo exploitable de façon fiable. Badge d'initiales à la place —
// toujours disponible, cohérent visuellement, aucune dépendance externe.
function teamBadge(name: string) {
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

export async function generateTicketImage(
  picks: PickCandidate[],
  combinedOdds: number,
  date: string
): Promise<Buffer> {
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
                                  fontSize: '18px',
                                  fontWeight: 700,
                                  color: '#0a1428',
                                },
                                children: 'K',
                              },
                            },
                            {
                              type: 'div',
                              props: {
                                style: { display: 'flex', flexDirection: 'column' },
                                children: [
                                  { type: 'span', props: { style: { color: '#e8cf9e', fontSize: '17px', fontWeight: 700, letterSpacing: '2.5px' }, children: 'KAFFI NETWORK' } },
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
                                            teamBadge(pick.home_team),
                                            { type: 'span', props: { style: { color: '#f4f6fb', fontSize: '13px', fontWeight: 700, maxWidth: '128px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: pick.home_team } },
                                            { type: 'span', props: { style: { color: '#5b6b8c', fontSize: '10px', fontWeight: 700 }, children: 'VS' } },
                                            { type: 'span', props: { style: { color: '#f4f6fb', fontSize: '13px', fontWeight: 700, maxWidth: '128px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: pick.away_team } },
                                            teamBadge(pick.away_team),
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
                      { type: 'span', props: { style: { color: '#8a97b5', fontSize: '10px', fontWeight: 600, letterSpacing: '0.5px' }, children: 't.me/kaffinetwork' } },
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
