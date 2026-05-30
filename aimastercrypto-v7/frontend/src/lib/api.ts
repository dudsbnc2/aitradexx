import axios from 'axios'
import { setupApiInterceptors } from '@/lib/api-interceptor'
import { setAccessToken, clearAuth as clearAuthManager } from '@/lib/auth-manager'

// In browser: use same origin (nginx proxies /api/ to backend)
// In SSR/dev: use env var
const API_BASE = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_API_URL || window.location.origin)
  : (process.env.NEXT_PUBLIC_API_URL || 'http://backend:8000')

export const api = axios.create({
  baseURL: `${API_BASE}/api`,
  timeout: 30000,
  withCredentials: true, // V7: necessário para enviar httpOnly cookie no refresh
})

// V7: interceptors geridos pelo auth-manager (token em memória, não localStorage)
setupApiInterceptors(api)

// ── Auth helpers ──────────────────────────────────────────────────────────

export function setAuthCookie(token: string) {
  // Non-httpOnly cookie apenas para middleware de route protection (Next.js)
  document.cookie = `aic_auth=${token}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`
}

export function clearAuth() {
  clearAuthManager()
  document.cookie = 'aic_auth=; path=/; max-age=0'
}

// ── Market ────────────────────────────────────────────────────────────────

export const fetchMarketOverview = () => api.get('/market/overview').then((r) => r.data)
export const fetchTrending = () => api.get('/market/trending').then((r) => r.data)
export const fetchCoins = (symbols?: string) =>
  api.get('/market/coins', { params: symbols ? { symbols } : {} }).then((r) => r.data)
export const fetchFearGreed = () => api.get('/market/fear-greed').then((r) => r.data)
export const fetchNews = (currencies?: string) =>
  api.get('/market/news', { params: currencies ? { currencies } : {} }).then((r) => r.data)

// ── Signals ───────────────────────────────────────────────────────────────

export const analyzeSignal = (pair: string, timeframe: string, useMtf = true, useAi = true) =>
  api.post('/signals/analyze', { pair, timeframe, use_mtf: useMtf, use_ai: useAi }).then((r) => r.data)

export const runScan = (timeframe: string, pairs?: string[], useMtf = true) =>
  api.post('/signals/scan', { timeframe, pairs, use_mtf: useMtf }).then((r) => r.data)

export const runBacktest = (pair: string, timeframe: string, candles = 500) =>
  api.post('/signals/backtest', { pair, timeframe, candles }).then((r) => r.data)

export const fetchSignalHistory = (params?: { pair?: string; source?: string; limit?: number }) =>
  api.get('/signals/history', { params }).then((r) => r.data)

export const fetchPerformanceStats = (pair?: string) =>
  api.get('/signals/performance', { params: pair ? { pair } : {} }).then((r) => r.data)

// ── Auth ──────────────────────────────────────────────────────────────────

export const login = async (email: string, password: string) => {
  const r = await api.post('/auth/login', { email, password })
  const data = r.data
  if (data.access_token) {
    setAccessToken(data.access_token)
    setAuthCookie(data.access_token)
  }
  return data
}

export const register = async (email: string, username: string, password: string) => {
  const r = await api.post('/auth/register', { email, username, password })
  const data = r.data
  if (data.access_token) {
    setAccessToken(data.access_token)
    setAuthCookie(data.access_token)
  }
  return data
}

export const verifyEmail = (email: string, code: string) =>
  api.post('/auth/verify-email', { email, code }).then((r) => {
    const data = r.data
    if (data.access_token) {
      setAccessToken(data.access_token)
      setAuthCookie(data.access_token)
    }
    return data
  })

export const resendCode = (email: string) =>
  api.post('/auth/resend-code', { email }).then((r) => r.data)

export const getMe = () => api.get('/auth/me').then((r) => r.data)

export const logout = async () => {
  try {
    await api.post('/auth/logout', { refresh_token: null })
  } catch { /* ignorar erros de rede no logout */ }
  clearAuth()
  window.location.href = '/login'
}

// ── Billing V7 ────────────────────────────────────────────────────────────

export const createCheckout = (plan: 'pro_monthly' | 'elite_monthly') =>
  api.post('/v1/billing/create-checkout', { plan }).then((r) => r.data)

export const createBillingPortal = () =>
  api.post('/v1/billing/create-portal').then((r) => r.data)

export const fetchBillingStatus = () =>
  api.get('/v1/billing/status').then((r) => r.data)

// ── Admin ─────────────────────────────────────────────────────────────────

export const adminStats = () => api.get('/admin/stats').then((r) => r.data)

export const adminListUsers = (params?: {
  page?: number; limit?: number; search?: string; role?: string; banned?: boolean
}) => api.get('/admin/users', { params }).then((r) => r.data)

export const adminGetUser = (id: number) => api.get(`/admin/users/${id}`).then((r) => r.data)

export const adminBanUser = (user_id: number, reason: string, permanent = false) =>
  api.post('/admin/ban-user', { user_id, reason, permanent }).then((r) => r.data)

export const adminUnbanUser = (user_id: number) =>
  api.post('/admin/unban-user', { user_id }).then((r) => r.data)

export const adminUpdateUser = (user_id: number, data: { role?: string; is_active?: boolean }) =>
  api.patch(`/admin/users/${user_id}`, { user_id, ...data }).then((r) => r.data)

export const adminSignals = (params?: { page?: number; limit?: number; pair?: string; bias?: string }) =>
  api.get('/admin/signals', { params }).then((r) => r.data)

export const adminActivity = (limit = 50) =>
  api.get('/admin/activity', { params: { limit } }).then((r) => r.data)

// Admin Ops V7
export const adminOperations = () => api.get('/v1/admin/operations').then((r) => r.data)
export const adminSignalAnalytics = (days = 30) =>
  api.get('/v1/admin/signals/analytics', { params: { days } }).then((r) => r.data)

// ── WebSocket ─────────────────────────────────────────────────────────────

export function createPriceWebSocket(pairs: string[], onMessage: (data: any) => void): WebSocket | null {
  if (typeof window === 'undefined') return null
  const origin = process.env.NEXT_PUBLIC_API_URL || window.location.origin
  const WS_BASE = origin
    .replace('https://', 'wss://')
    .replace('http://', 'ws://')

  let ws: WebSocket | null = null
  let pingInterval: ReturnType<typeof setInterval> | null = null
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  let destroyed = false

  function cleanup() {
    if (pingInterval) { clearInterval(pingInterval); pingInterval = null }
    if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null }
    if (ws) {
      // Remove all listeners before closing to prevent MaxListenersExceededWarning
      ws.onopen = null
      ws.onmessage = null
      ws.onclose = null
      ws.onerror = null
      ws = null
    }
  }

  function connect() {
    if (destroyed) return
    cleanup()  // always clean previous instance before creating new one

    const socket = new WebSocket(`${WS_BASE}/ws/prices?pairs=${pairs.join(',')}`)

    socket.onmessage = (event) => {
      try { onMessage(JSON.parse(event.data)) } catch { }
    }

    socket.onopen = () => {
      pingInterval = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send('ping')
      }, 30000)
    }

    socket.onclose = () => {
      if (pingInterval) { clearInterval(pingInterval); pingInterval = null }
      if (!destroyed) {
        reconnectTimeout = setTimeout(connect, 3000)
      }
    }

    socket.onerror = () => {
      socket.close()  // triggers onclose → reconnect
    }

    ws = socket
  }

  connect()

  return {
    close: () => {
      destroyed = true
      cleanup()
    },
  } as unknown as WebSocket
}

// ── Formatters ────────────────────────────────────────────────────────────

export function fmtPrice(n: number | undefined | null): string {
  if (n === undefined || n === null || isNaN(n as number) || n === 0) return '—'
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(4)
  return n.toFixed(8)
}

export function fmtPct(n: number | undefined | null): string {
  if (n === undefined || n === null || isNaN(n as number)) return '—'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

export function fmtLargeNum(n: number | undefined | null): string {
  if (!n || isNaN(n as number)) return '—'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  return `$${n.toLocaleString()}`
}
