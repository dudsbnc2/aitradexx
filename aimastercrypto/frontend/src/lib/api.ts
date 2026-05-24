import axios from 'axios'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export const api = axios.create({
  baseURL: `${API_BASE}/api`,
  timeout: 30000,
})

// Attach auth token if present
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token')
    if (token) config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ── Market ────────────────────────────────────────────────────────────────

export const fetchMarketOverview = () => api.get('/market/overview').then((r) => r.data)
export const fetchTrending = () => api.get('/market/trending').then((r) => r.data)
export const fetchCoins = (symbols?: string) =>
  api.get('/market/coins', { params: symbols ? { symbols } : {} }).then((r) => r.data)
export const fetchFearGreed = () => api.get('/market/fear-greed').then((r) => r.data)
export const fetchDexTrending = () => api.get('/market/dex/trending').then((r) => r.data)
export const fetchNews = (currencies?: string) =>
  api.get('/market/news', { params: currencies ? { currencies } : {} }).then((r) => r.data)

// ── Signals ───────────────────────────────────────────────────────────────

export const analyzeSignal = (pair: string, timeframe: string, useMtf = true, useAi = true) =>
  api.post('/signals/analyze', { pair, timeframe, use_mtf: useMtf, use_ai: useAi }).then((r) => r.data)

export const runScan = (timeframe: string, pairs?: string[], useMtf = true) =>
  api.post('/signals/scan', { timeframe, pairs, use_mtf: useMtf }).then((r) => r.data)

export const runBacktest = (pair: string, timeframe: string, candles = 500) =>
  api.post('/signals/backtest', { pair, timeframe, candles }).then((r) => r.data)

export const getIndicators = (pair: string, tf: string) =>
  api.get(`/signals/indicators/${pair.replace('/', '-')}/${tf}`).then((r) => r.data)

// ── Auth ──────────────────────────────────────────────────────────────────

export const login = (email: string, password: string) =>
  api.post('/auth/login', { email, password }).then((r) => r.data)

export const register = (email: string, username: string, password: string) =>
  api.post('/auth/register', { email, username, password }).then((r) => r.data)

export const getMe = () => api.get('/auth/me').then((r) => r.data)


// ── WebSocket ─────────────────────────────────────────────────────────────

export function createPriceWebSocket(
  pairs: string[],
  onMessage: (data: any) => void,
): WebSocket | null {
  if (typeof window === 'undefined') return null
  const WS_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000')
    .replace('https://', 'wss://')
    .replace('http://', 'ws://')
  const ws = new WebSocket(`${WS_BASE}/ws/prices?pairs=${pairs.join(',')}`)

  ws.onmessage = (event) => {
    try {
      onMessage(JSON.parse(event.data))
    } catch {
      // ignore parse errors
    }
  }

  // Heartbeat
  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send('ping')
  }, 30000)

  ws.onclose = () => clearInterval(interval)
  return ws
}

// ── Formatters ────────────────────────────────────────────────────────────

export function fmtPrice(n: number): string {
  if (!n) return '—'
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(4)
  return n.toFixed(8)
}

export function fmtPct(n: number): string {
  if (n === undefined || n === null) return '—'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

export function fmtLargeNum(n: number): string {
  if (!n) return '—'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  return `$${n.toLocaleString()}`
}
