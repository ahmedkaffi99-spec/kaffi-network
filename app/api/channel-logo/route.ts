import { NextResponse } from 'next/server'
import satori from 'satori'
import sharp from 'sharp'

async function loadFont(): Promise<ArrayBuffer> {
  const res = await fetch(
    'https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2'
  )
  return res.arrayBuffer()
}

export async function GET() {
  const fontData = await loadFont()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svg = await (satori as any)(
    {
      type: 'div',
      props: {
        style: {
          width: '640px',
          height: '640px',
          background: 'linear-gradient(135deg, #060d1f 0%, #0a1428 50%, #0d1f3c 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Inter',
          position: 'relative',
        },
        children: [
          // Cercle décoratif extérieur
          {
            type: 'div',
            props: {
              style: {
                position: 'absolute',
                width: '520px',
                height: '520px',
                borderRadius: '50%',
                border: '2px solid rgba(201,163,92,0.2)',
                top: '60px',
                left: '60px',
              },
            },
          },
          // Cercle intérieur
          {
            type: 'div',
            props: {
              style: {
                position: 'absolute',
                width: '420px',
                height: '420px',
                borderRadius: '50%',
                border: '1px solid rgba(201,163,92,0.1)',
                top: '110px',
                left: '110px',
              },
            },
          },
          // Contenu central
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0px',
                zIndex: 1,
              },
              children: [
                // Icône éclair
                {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: '96px',
                      lineHeight: '1',
                      marginBottom: '16px',
                    },
                    children: '⚡',
                  },
                },
                // KAFFI
                {
                  type: 'div',
                  props: {
                    style: {
                      color: '#c9a35c',
                      fontSize: '72px',
                      fontWeight: 700,
                      letterSpacing: '10px',
                      lineHeight: '1',
                    },
                    children: 'KAFFI',
                  },
                },
                // Séparateur doré
                {
                  type: 'div',
                  props: {
                    style: {
                      width: '200px',
                      height: '2px',
                      background: 'linear-gradient(90deg, transparent, #c9a35c, transparent)',
                      margin: '12px 0',
                    },
                  },
                },
                // NETWORK
                {
                  type: 'div',
                  props: {
                    style: {
                      color: '#ffffff',
                      fontSize: '28px',
                      fontWeight: 300,
                      letterSpacing: '14px',
                      lineHeight: '1',
                    },
                    children: 'NETWORK',
                  },
                },
                // Tagline
                {
                  type: 'div',
                  props: {
                    style: {
                      color: 'rgba(201,163,92,0.6)',
                      fontSize: '13px',
                      letterSpacing: '4px',
                      marginTop: '16px',
                      fontWeight: 400,
                    },
                    children: 'PRONOSTICS IA',
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      width: 640,
      height: 640,
      fonts: [{ name: 'Inter', data: fontData, weight: 400 as const, style: 'normal' as const }],
    }
  )

  const png = await sharp(Buffer.from(svg)).png().toBuffer()

  return new NextResponse(png, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': 'attachment; filename="kaffi-network-logo.png"',
    },
  })
}
