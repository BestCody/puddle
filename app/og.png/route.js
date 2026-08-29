import { ImageResponse } from 'next/og'

// Social platforms will not render an SVG share card, so this route produces the real
// 1200x630 PNG that og:image and twitter:image point at. Everything is drawn inline:
// fetching the logo or a webfont here would make link previews depend on a second request
// that can fail silently and leave the card blank again.
export const runtime = 'nodejs'
export const revalidate = 86400

const BLUE = '#4ca5f7'
const INK = '#111111'

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px',
          background: `linear-gradient(135deg, #ffffff 0%, #f2f8ff 55%, #e4f1ff 100%)`
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div
            style={{
              display: 'flex',
              width: '64px',
              height: '64px',
              borderRadius: '999px',
              background: BLUE
            }}
          />
          <div style={{ display: 'flex', fontSize: '44px', fontWeight: 700, color: INK, letterSpacing: '-0.03em' }}>
            puddle
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div
            style={{
              display: 'flex',
              fontSize: '82px',
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: '-0.04em',
              color: INK
            }}
          >
            Discover places.
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: '82px',
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: '-0.04em',
              color: BLUE
            }}
          >
            See who&rsquo;s there.
          </div>
        </div>

        <div style={{ display: 'flex', fontSize: '30px', color: '#5b6b7a' }}>
          Parks, cafes, restaurants and more, near you — puddle.you
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
