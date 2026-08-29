// @group BusinessLogic > Favorites : Persist favorite namespaces to localStorage
import { useCallback, useState } from 'react'

const LS_KEY = 'alter:favorite-namespaces'

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

export function useFavoriteNamespaces() {
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites)

  const toggle = useCallback((ns: string) => {
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(ns)) next.delete(ns); else next.add(ns)
      try { localStorage.setItem(LS_KEY, JSON.stringify([...next])) } catch {}
      return next
    })
  }, [])

  return { favorites, toggle }
}
