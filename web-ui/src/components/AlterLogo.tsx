// @group BusinessLogic : Alter brand mark and wordmark used across the dashboard

import { useId, type CSSProperties } from 'react'

type AlterLogoVariant = 'mark' | 'wordmark'
type AlterLogoSize = 'sidebar' | 'login'

interface AlterLogoProps {
  variant?: AlterLogoVariant
  size?: AlterLogoSize
  style?: CSSProperties
}

interface AlterMarkProps {
  size: number
}

const LOGO_SIZES = {
  sidebar: { mark: 30, word: 18, suffix: 11, gap: 8 },
  login: { mark: 56, word: 30, suffix: 15, gap: 10 },
} as const

// @group BusinessLogic > AlterMark : Scalable hex-kernel mark
function AlterMark({ size }: AlterMarkProps) {
  const hexGradientId = useId()

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={hexGradientId} x1="30" y1="24" x2="98" y2="104" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--color-primary, #4f9cf9)" />
          <stop offset="0.56" stopColor="#5fa8ff" />
          <stop offset="1" stopColor="var(--color-status-running, #3ddc84)" />
        </linearGradient>
      </defs>
      <rect x="10" y="10" width="108" height="108" rx="28" fill="#0b1117" />
      <rect x="11" y="11" width="106" height="106" rx="27" stroke="#263244" strokeWidth="2" />
      <path
        d="M64 24 99 44.5v39L64 104 29 83.5v-39L64 24Z"
        stroke={`url(#${hexGradientId})`}
        strokeWidth="7"
        strokeLinejoin="round"
      />
      <rect x="43" y="42" width="42" height="44" rx="12" fill="#132033" stroke="#304158" strokeWidth="2" />
      <rect x="50" y="49" width="28" height="28" rx="7" fill="#17263a" stroke="#243750" strokeWidth="1.5" />
      <path d="M54 57 64 63 54 69" stroke="#ffd166" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M66 72h11" stroke="#80deea" strokeWidth="5" strokeLinecap="round" />
      <circle cx="64" cy="24" r="7.5" fill="#0b1117" stroke="#ffd166" strokeWidth="4" />
      <circle cx="29" cy="83.5" r="7.5" fill="#0b1117" stroke="#80deea" strokeWidth="4" />
      <circle cx="99" cy="83.5" r="7.5" fill="#0b1117" stroke="var(--color-status-running, #3ddc84)" strokeWidth="4" />
    </svg>
  )
}

// @group BusinessLogic > AlterLogo : Wordmark composition for app chrome and auth screens
export function AlterLogo({ variant = 'wordmark', size = 'sidebar', style }: AlterLogoProps) {
  const logoSize = LOGO_SIZES[size]

  if (variant === 'mark') {
    return <AlterMark size={logoSize.mark} />
  }

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: logoSize.gap,
      lineHeight: 1,
      ...style,
    }}>
      <AlterMark size={logoSize.mark} />
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 2 }}>
        <span style={{
          fontWeight: 750,
          fontSize: logoSize.word,
          letterSpacing: 0,
          color: 'var(--color-foreground)',
        }}>
          alter
        </span>
        <span style={{
          fontSize: logoSize.suffix,
          color: 'var(--color-muted-foreground)',
          fontWeight: 650,
          letterSpacing: 0,
        }}>
          pm
        </span>
      </span>
    </span>
  )
}
