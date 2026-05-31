/**
 * AIMasterCrypto — Auth Manager V7 (localStorage fallback)
 *
 * Access token: memória + localStorage (para sobreviver a page reload)
 * Refresh token: httpOnly cookie
 */

const LS_KEY = 'access_token'

let _accessToken: string | null = null
let _refreshTimer: ReturnType<typeof setTimeout> | null = null
let _isRefreshing = false
let _refreshCallbacks: Array<(token: string | null) => void> = []

const ACCESS_TOKEN_LIFETIME_MS = 15 * 60 * 1000
const REFRESH_BEFORE_MS = 2 * 60 * 1000

export function setAccessToken(token: string): void {
  _accessToken = token
  if (typeof window !== 'undefined') localStorage.setItem(LS_KEY, token)
  _scheduleRefresh()
}

export function getAccessToken(): string | null {
  if (_accessToken) return _accessToken
  // Recuperar do localStorage após page reload
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(LS_KEY)
    if (stored) { _accessToken = stored; _scheduleRefresh() }
    return stored
  }
  return null
}

export function clearAuth(): void {
  _accessToken = null
  if (typeof window !== 'undefined') localStorage.removeItem(LS_KEY)
  if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null }
}

export async function initAuth(): Promise<string | null> {
  // Se já tem token em localStorage, usa-o directamente
  const stored = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null
  if (stored) {
    _accessToken = stored
    _scheduleRefresh()
    return stored
  }
  try {
    const token = await _doRefresh()
    return token
  } catch {
    clearAuth()
    return null
  }
}

export async function forceRefresh(): Promise<string | null> {
  return _doRefresh()
}

export function isAuthenticated(): boolean {
  return getAccessToken() !== null
}

function _scheduleRefresh(): void {
  if (_refreshTimer) clearTimeout(_refreshTimer)
  const delay = ACCESS_TOKEN_LIFETIME_MS - REFRESH_BEFORE_MS
  _refreshTimer = setTimeout(async () => {
    try {
      await _doRefresh()
    } catch {
      clearAuth()
      window.dispatchEvent(new CustomEvent('auth:expired'))
    }
  }, delay)
}

async function _doRefresh(): Promise<string | null> {
  if (_isRefreshing) {
    return new Promise((resolve) => { _refreshCallbacks.push(resolve) })
  }
  _isRefreshing = true
  try {
    const apiBase = typeof window !== 'undefined'
      ? (process.env.NEXT_PUBLIC_API_URL || window.location.origin)
      : (process.env.NEXT_PUBLIC_API_URL || 'http://backend:8000')

    const res = await fetch(`${apiBase}/api/v1/auth/refresh-cookie`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!res.ok) { clearAuth(); _resolveRefreshCallbacks(null); return null }

    const data = await res.json()
    const token = data.access_token
    if (token) {
      _accessToken = token
      if (typeof window !== 'undefined') localStorage.setItem(LS_KEY, token)
      _scheduleRefresh()
      _resolveRefreshCallbacks(token)
      return token
    }
    clearAuth(); _resolveRefreshCallbacks(null); return null
  } catch {
    clearAuth(); _resolveRefreshCallbacks(null); return null
  } finally {
    _isRefreshing = false
  }
}

function _resolveRefreshCallbacks(token: string | null): void {
  const callbacks = [..._refreshCallbacks]
  _refreshCallbacks = []
  callbacks.forEach((cb) => cb(token))
}

export async function getValidToken(): Promise<string | null> {
  const t = getAccessToken()
  if (t) return t
  return initAuth()
}
