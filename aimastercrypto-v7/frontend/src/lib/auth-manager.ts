/**
 * AIMasterCrypto — Secure Auth Manager V7
 *
 * Substitui localStorage para tokens JWT.
 * Access token: em memória (inacessível a XSS)
 * Refresh token: httpOnly cookie (inacessível a JS)
 *
 * Uso:
 *   import { initAuth, getAccessToken, setAccessToken, clearAuth } from '@/lib/auth-manager'
 *
 *   // No layout.tsx — iniciar na montagem
 *   await initAuth()
 *
 *   // Nas API calls — obter token
 *   const token = getAccessToken()
 */

// Access token em memória — nunca em localStorage ou sessionStorage
let _accessToken: string | null = null
let _refreshTimer: ReturnType<typeof setTimeout> | null = null
let _isRefreshing = false
let _refreshCallbacks: Array<(token: string | null) => void> = []

// Duração do access token em ms (deve coincidir com backend: 15 min)
const ACCESS_TOKEN_LIFETIME_MS = 15 * 60 * 1000
// Renovar 2 minutos antes de expirar
const REFRESH_BEFORE_MS = 2 * 60 * 1000

/**
 * Define o access token em memória e agenda renovação automática.
 */
export function setAccessToken(token: string): void {
  _accessToken = token
  _scheduleRefresh()
}

/**
 * Obtém o access token actual.
 * Retorna null se não autenticado.
 */
export function getAccessToken(): string | null {
  return _accessToken
}

/**
 * Limpa o estado de autenticação.
 */
export function clearAuth(): void {
  _accessToken = null
  if (_refreshTimer) {
    clearTimeout(_refreshTimer)
    _refreshTimer = null
  }
}

/**
 * Inicializa a autenticação tentando renovar o token via cookie httpOnly.
 * Chamar no arranque da aplicação (layout.tsx ou _app.tsx).
 *
 * Retorna o access token se autenticado, null caso contrário.
 */
export async function initAuth(): Promise<string | null> {
  try {
    const token = await _doRefresh()
    return token
  } catch {
    clearAuth()
    return null
  }
}

/**
 * Força renovação do token.
 * Útil antes de operações críticas.
 */
export async function forceRefresh(): Promise<string | null> {
  return _doRefresh()
}

/**
 * Verifica se o utilizador está autenticado.
 */
export function isAuthenticated(): boolean {
  return _accessToken !== null
}

// ── Implementação interna ────────────────────────────────────────────────────

function _scheduleRefresh(): void {
  if (_refreshTimer) clearTimeout(_refreshTimer)

  const delay = ACCESS_TOKEN_LIFETIME_MS - REFRESH_BEFORE_MS
  _refreshTimer = setTimeout(async () => {
    try {
      await _doRefresh()
    } catch {
      // Se falhar, limpar token — utilizador precisará re-login
      clearAuth()
      // Notificar a app via evento customizado
      window.dispatchEvent(new CustomEvent('auth:expired'))
    }
  }, delay)
}

async function _doRefresh(): Promise<string | null> {
  // Se já está a renovar, esperar pelo resultado
  if (_isRefreshing) {
    return new Promise((resolve) => {
      _refreshCallbacks.push(resolve)
    })
  }

  _isRefreshing = true

  try {
    const res = await fetch('/api/v1/auth/refresh-cookie', {
      method: 'POST',
      credentials: 'include', // envia o httpOnly cookie automaticamente
      headers: { 'Content-Type': 'application/json' },
    })

    if (!res.ok) {
      // 401 = refresh token expirado ou revogado
      clearAuth()
      _resolveRefreshCallbacks(null)
      return null
    }

    const data = await res.json()
    const token = data.access_token

    if (token) {
      _accessToken = token
      _scheduleRefresh()
      _resolveRefreshCallbacks(token)
      return token
    }

    clearAuth()
    _resolveRefreshCallbacks(null)
    return null
  } catch (err) {
    clearAuth()
    _resolveRefreshCallbacks(null)
    return null
  } finally {
    _isRefreshing = false
  }
}

function _resolveRefreshCallbacks(token: string | null): void {
  const callbacks = [..._refreshCallbacks]
  _refreshCallbacks = []
  callbacks.forEach((cb) => cb(token))
}

// ── Helper para interceptor axios ───────────────────────────────────────────

/**
 * Usar no interceptor do axios para obter token válido.
 * Se o token expirou, tenta renovar antes de continuar.
 */
export async function getValidToken(): Promise<string | null> {
  if (_accessToken) return _accessToken

  // Tentar renovar via cookie
  return initAuth()
}
