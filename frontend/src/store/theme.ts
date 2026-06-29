export type Theme = 'lapis' | 'daylight'

const STORAGE_KEY = 'es-theme'
const DEFAULT: Theme = 'lapis'

function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t)
}

function getStored(): Theme {
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'daylight' ? 'daylight' : DEFAULT
}

export function toggleTheme(): Theme {
  const current = getStored()
  const next: Theme = current === 'lapis' ? 'daylight' : 'lapis'
  localStorage.setItem(STORAGE_KEY, next)
  applyTheme(next)
  window.dispatchEvent(new CustomEvent('es-theme-change', { detail: next }))
  return next
}

export function getCurrentTheme(): Theme {
  return getStored()
}
