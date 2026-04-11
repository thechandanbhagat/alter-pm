// @group BusinessLogic : GitHub star prompt — shown once after first use, dismissible
import { useEffect, useState } from 'react'
import { Star, X } from 'lucide-react'

// @group Constants : Storage key + repo URL
const STORAGE_KEY = 'alter-pm2:github-star-dismissed'
const REPO_URL    = 'https://github.com/thechandanbhagat/alter-pm'

// @group Utilities : Has the user already dismissed / acted on the banner?
function isDismissed(): boolean {
  return !!localStorage.getItem(STORAGE_KEY)
}

function dismiss(reason: 'later' | 'now' | 'done') {
  localStorage.setItem(STORAGE_KEY, reason)
}

// @group BusinessLogic > GitHubStarBanner : Floating bottom-right popup asking to star the repo
export function GitHubStarBanner() {
  const [visible, setVisible] = useState(false)

  // Show after a short delay on first visit (never show again once acted on)
  useEffect(() => {
    if (isDismissed()) return
    const t = setTimeout(() => setVisible(true), 8000)
    return () => clearTimeout(t)
  }, [])

  if (!visible) return null

  function handleNow() {
    dismiss('now')
    window.open(REPO_URL, '_blank', 'noreferrer')
    setVisible(false)
  }

  function handleLater() {
    dismiss('later')
    setVisible(false)
  }

  function handleDone() {
    dismiss('done')
    setVisible(false)
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: 36,   // sit above the 22px status bar
      right: 16,
      zIndex: 9000,
      width: 280,
      background: 'var(--color-card)',
      border: '1px solid var(--color-border)',
      borderRadius: 10,
      boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
      overflow: 'hidden',
      animation: 'alter-slide-up 0.28s cubic-bezier(0.4,0,0.2,1)',
    }}>

      {/* Accent top bar */}
      <div style={{ height: 3, background: 'linear-gradient(90deg, #f59e0b, #fbbf24)' }} />

      {/* Body */}
      <div style={{ padding: '14px 16px 12px' }}>

        {/* Close (×) */}
        <button
          onClick={handleLater}
          title="Remind me later"
          style={{
            position: 'absolute', top: 10, right: 10,
            width: 20, height: 20, padding: 0,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--color-muted-foreground)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 4,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--color-foreground)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--color-muted-foreground)' }}
        >
          <X size={13} />
        </button>

        {/* Icon + heading */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: 'color-mix(in srgb, #f59e0b 15%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Star size={16} color="#f59e0b" fill="#f59e0b" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-foreground)', lineHeight: 1.3 }}>
              Enjoying alter?
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-muted-foreground)', lineHeight: 1.4, marginTop: 1 }}>
              A star on GitHub helps a lot ⭐
            </div>
          </div>
        </div>

        {/* CTA buttons */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          <button
            onClick={handleNow}
            style={{
              flex: 1, height: 30, fontSize: 12, fontWeight: 600,
              background: '#f59e0b', color: '#000', border: 'none',
              borderRadius: 6, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              transition: 'filter 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.filter = 'brightness(1.1)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.filter = 'none' }}
          >
            <Star size={12} fill="#000" />
            Star now
          </button>

          <button
            onClick={handleLater}
            style={{
              flex: 1, height: 30, fontSize: 12, fontWeight: 500,
              background: 'var(--color-secondary)', color: 'var(--color-foreground)',
              border: '1px solid var(--color-border)',
              borderRadius: 6, cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-accent)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-secondary)' }}
          >
            Later
          </button>
        </div>

        {/* "Already done" micro-link */}
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <button
            onClick={handleDone}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              fontSize: 10, color: 'var(--color-muted-foreground)',
              textDecoration: 'underline', textUnderlineOffset: 2, opacity: 0.6,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.6' }}
          >
            I've already starred it
          </button>
        </div>
      </div>

      {/* Slide-up keyframe injected once */}
      <style>{`
        @keyframes alter-slide-up {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

// @group BusinessLogic > GitHubStarWidget : Compact star-count chip for the status bar
export function GitHubStarWidget() {
  const [stars, setStars] = useState<number | null>(null)

  useEffect(() => {
    // Fetch star count from GitHub API, cache for 1 h
    const CACHE_KEY = 'alter-pm2:gh-stars-cache'
    const cached = localStorage.getItem(CACHE_KEY)
    if (cached) {
      try {
        const { count, ts } = JSON.parse(cached) as { count: number; ts: number }
        if (Date.now() - ts < 3_600_000) { setStars(count); return }
      } catch { /* ignore */ }
    }
    fetch('https://api.github.com/repos/outernet-io/alter')
      .then(r => r.json())
      .then((data: { stargazers_count?: number }) => {
        if (typeof data.stargazers_count === 'number') {
          setStars(data.stargazers_count)
          localStorage.setItem(CACHE_KEY, JSON.stringify({ count: data.stargazers_count, ts: Date.now() }))
        }
      })
      .catch(() => { /* silently ignore — not critical */ })
  }, [])

  return (
    <a
      href="https://github.com/thechandanbhagat/alter-pm"
      target="_blank"
      rel="noreferrer"
      title="Star alter on GitHub"
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '0 8px', height: '100%',
        borderLeft: '1px solid var(--color-border)',
        textDecoration: 'none', color: 'var(--color-muted-foreground)',
        fontSize: 11, fontWeight: 500, opacity: 0.8, cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.color = '#f59e0b' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.8'; (e.currentTarget as HTMLElement).style.color = 'var(--color-muted-foreground)' }}
    >
      <Star size={11} />
      {stars !== null && (
        <span>{stars >= 1000 ? `${(stars / 1000).toFixed(1)}k` : stars}</span>
      )}
    </a>
  )
}
