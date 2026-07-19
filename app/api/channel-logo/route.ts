import { readFileSync } from 'fs'
import { join } from 'path'
import { NextResponse } from 'next/server'
import satori from 'satori'
import sharp from 'sharp'

function loadFont(): ArrayBuffer {
  const buf = readFileSync(join(process.cwd(), 'lib', 'assets', 'fonts', 'inter-700.woff'))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

export async function GET() {
  const fontData = loadFont()

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
                // Marque "K" — Satori ne rend pas les glyphes emoji correctement
                {
                  type: 'div',
                  props: {
                    style: {
                      width: '140px',
                      height: '140px',
                      borderRadius: '32px',
                      background: 'linear-gradient(135deg, #d9b56f 0%, #9c7739 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '72px',
                      fontWeight: 700,
                      color: '#060d1f',
                      marginBottom: '16px',
                    },
                    children: 'K',
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
