import { readFileSync } from 'fs'
import { join } from 'path'
import satori from 'satori'
import sharp from 'sharp'
import type { PickCandidate } from '@/lib/types'

function loadFont(weight: 400 | 700): ArrayBuffer {
  const file = weight === 700 ? 'inter-700.ttf' : 'inter-400.ttf'
  const buf = readFileSync(join(process.cwd(), 'lib', 'assets', 'fonts', file))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
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

  const cardHeight = 52
  const totalHeight = 120 + picks.length * cardHeight + 80

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svg = await (satori as any)(
    {
      type: 'div',
      props: {
        style: {
          width: '600px',
          height: `${totalHeight}px`,
          background: '#0a1428',
          fontFamily: 'Inter',
          display: 'flex',
          flexDirection: 'column',
          padding: '28px 32px',
          boxSizing: 'border-box',
        },
        children: [
          // Header
          {
            type: 'div',
            props: {
              style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
              children: [
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', alignItems: 'center', gap: '10px' },
                    children: [
                      { type: 'div', props: { style: { fontSize: '22px' }, children: '⚡' } },
                      {
                        type: 'div',
                        props: {
                          style: { display: 'flex', flexDirection: 'column' },
                          children: [
                            { type: 'span', props: { style: { color: '#c9a35c', fontSize: '16px', fontWeight: 700, letterSpacing: '2px' }, children: 'KAFFI NETWORK' } },
                            { type: 'span', props: { style: { color: '#64748b', fontSize: '11px' }, children: formattedDate } },
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
                      background: 'rgba(201,163,92,0.15)',
                      border: '1px solid rgba(201,163,92,0.4)',
                      borderRadius: '8px',
                      padding: '6px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                    },
                    children: [
                      { type: 'span', props: { style: { color: '#64748b', fontSize: '9px', letterSpacing: '1px' }, children: 'COTE COMBINÉE' } },
                      { type: 'span', props: { style: { color: '#c9a35c', fontSize: '22px', fontWeight: 700 }, children: combinedOdds.toFixed(2) } },
                    ],
                  },
                },
              ],
            },
          },
          // Séparateur perforé
          {
            type: 'div',
            props: {
              style: { borderTop: '2px dashed rgba(201,163,92,0.25)', margin: '0 0 16px 0' },
            },
          },
          // Picks
          ...picks.map((pick, i) => ({
            type: 'div',
            props: {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '8px',
                background: 'rgba(20,37,71,0.8)',
                borderRadius: '8px',
                padding: '8px 12px',
              },
              children: [
                { type: 'span', props: { style: { color: '#c9a35c', fontSize: '14px', fontWeight: 700, minWidth: '20px' }, children: `${i + 1}.` } },
                {
                  type: 'div',
                  props: {
                    style: { display: 'flex', flexDirection: 'column', flex: 1 },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
                          children: [
                            { type: 'span', props: { style: { color: '#ffffff', fontSize: '12px', fontWeight: 600 }, children: `${pick.home_team} - ${pick.away_team}` } },
                            { type: 'span', props: { style: { color: '#c9a35c', fontSize: '12px', fontWeight: 700 }, children: `@${pick.odds.toFixed(2)}` } },
                          ],
                        },
                      },
                      { type: 'span', props: { style: { color: '#94a3b8', fontSize: '10px' }, children: `${pick.bet_type} · ${pick.trend_pct}% sur ${pick.sample_size} matchs` } },
                    ],
                  },
                },
              ],
            },
          })),
          // Footer
          {
            type: 'div',
            props: {
              style: { borderTop: '1px solid rgba(201,163,92,0.15)', marginTop: '12px', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
              children: [
                { type: 'span', props: { style: { color: '#475569', fontSize: '9px' }, children: '⚠️ Pari responsable — aucun gain garanti' } },
                { type: 'span', props: { style: { color: '#475569', fontSize: '9px' }, children: 't.me/kaffinetwork' } },
              ],
            },
          },
        ],
      },
    },
    {
      width: 600,
      height: totalHeight,
      fonts: [
        { name: 'Inter', data: fontData, weight: 400 as const, style: 'normal' as const },
        { name: 'Inter', data: fontDataBold, weight: 700 as const, style: 'normal' as const },
      ],
    }
  )

  return sharp(Buffer.from(svg)).png().toBuffer()
}
