export type Theme = 'lapis' | 'daylight'

const STORAGE_KEY = 'es-theme'
// Light "control room" is the confirmed design; dark (lapis) is opt-in only.
const DEFAULT: Theme = 'daylight'

function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t)
}

function getStored(): Theme {
  // Only an explicit opt-in to dark sticks; everything else uses the light default.
  return localStorage.getItem(STORAGE_KEY) === 'lapis' ? 'lapis' : DEFAULT
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
