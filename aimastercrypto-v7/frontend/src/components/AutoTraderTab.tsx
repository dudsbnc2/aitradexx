'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bot, Key, Wallet, Play, Trash2, RefreshCw, ChevronDown,
  CheckCircle, Shield, Zap, TrendingUp, TrendingDown,
  ToggleLeft, ToggleRight, ExternalLink, Info, BarChart2,
  Sparkles, Clock, Search, Radio, Square, AlertTriangle,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import ActivityFeed from './ActivityFeed'
import AccountStatusBar from './AccountStatusBar'
import { logSuccess, logError, logWarning, logInfo, logAction } from '@/lib/activity-log'

const API = process.env.NEXT_PUBLIC_API_URL || ''

type TradeMode   = 'spot' | 'futures'
type RiskProfile = 'conservative' | 'balanced' | 'aggressive'
type BotStatus   = 'idle' | 'scanning' | 'executing' | 'done' | 'error'

interface ExchangeKey { id: number; exchange: string; label: string; testnet: boolean; api_key_preview: string }
interface BalanceCoin { coin: string; balance: string; available: string; usd_value: string }
interface TradeLog {
  id: number; pair: string; side: string; trade_mode: TradeMode; exchange: string
  qty: number; price: number; take_profit: number; stop_loss: number; leverage: number
  status: string; order_id: string; error_msg: string; created_at: string; triggered_by: string
}
interface AIRunResult {
  executed: boolean; reason?: string; pair?: string; bias?: string; side?: string
  confidence?: number; timeframe?: string; trade_mode?: string; price?: number
  qty?: number; take_profit?: number; stop_loss?: number; leverage?: number
  order_id?: string; signal?: { analysis?: string }; scanned?: number
}

const SPOT_PAIRS = [
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT',
  'DOGE/USDT', 'ADA/USDT', 'AVAX/USDT', 'LINK/USDT', 'DOT/USDT',
  'TON/USDT', 'SUI/USDT', 'APT/USDT', 'NEAR/USDT', 'UNI/USDT',
  'ARB/USDT', 'OP/USDT', 'INJ/USDT', 'SEI/USDT', 'TIA/USDT',
  'ENA/USDT', 'WIF/USDT', 'PEPE/USDT', 'BONK/USDT', 'SHIB/USDT',
  'FET/USDT', 'RENDER/USDT', 'TAO/USDT', 'LDO/USDT', 'AAVE/USDT',
]

const FUTURES_TIMEFRAMES = ['1m','3m','5m','15m','30m','1H','2H','4H','6H','12H','1D']
const LEVERAGE_PRESETS   = [1,2,3,5,10,20,25,50,75,100,125]

async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
  const headers: Record<string,string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string,string> || {}),
  }
  let res = await fetch(url, { ...options, headers })
  if (res.status === 401) {
    try {
      const refresh = await fetch(`${API}/api/v1/auth/refresh-cookie`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      })
      if (refresh.ok) {
        const d = await refresh.json()
        if (d.access_token) {
          localStorage.setItem('access_token', d.access_token)
          res = await fetch(url, { ...options, headers: { ...headers, Authorization: `Bearer ${d.access_token}` } })
        }
      }
    } catch {}
  }
  return res
}

function StatusBadge({ status, t }: { status: string; t: ReturnType<typeof useTranslations> }) {
  const map: Record<string,string> = {
    filled:    'text-[#00ff88] bg-[#00ff88]/10 border-[#00ff88]/30',
    pending:   'text-[#ffcc00] bg-[#ffcc00]/10 border-[#ffcc00]/30',
    failed:    'text-[#ff4466] bg-[#ff4466]/10 border-[#ff4466]/30',
    cancelled: 'text-[#8ba3be] bg-[#1a3a5c]/50 border-[#1a3a5c]',
  }
  const labels: Record<string,string> = {
    filled:    t('autotrader.status_filled'),
    pending:   t('autotrader.status_pending'),
    failed:    t('autotrader.status_failed'),
    cancelled: t('autotrader.status_cancelled'),
  }
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono border ${map[status] || map.pending}`}>{labels[status] || status.toUpperCase()}</span>
}

function ExchangeBadge({ exchange }: { exchange: string }) {
  const EXCHANGES_MAP: Record<string, { logo: string; name: string }> = {
    bybit:       { logo: '🟡', name: 'Bybit' },
    okx:         { logo: '🔷', name: 'OKX' },
    hyperliquid: { logo: '🟣', name: 'Hyperliquid' },
  }
  const ex = EXCHANGES_MAP[exchange]
  return <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono border border-[#1a3a5c] text-[#8ba3be]">{ex?.logo} {ex?.name || exchange.toUpperCase()}</span>
}

function BotResultCard({ status, result, t }: { status: BotStatus; result: AIRunResult|null; t: ReturnType<typeof useTranslations> }) {
  if (status === 'idle') return (
    <div className="flex flex-col items-center justify-center py-10 text-center space-y-3">
      <div className="w-14 h-14 rounded-full bg-[#00d4ff]/5 border border-[#00d4ff]/10 flex items-center justify-center">
        <Bot size={24} className="text-[#1a3a5c]" />
      </div>
      <div className="text-sm font-bold text-[#3d5a73]">{t('autotrader.bot_idle_title')}</div>
      <div className="text-xs font-mono text-[#1a3a5c] max-w-xs">
        {t('autotrader.bot_idle_subtitle')} <span className="text-[#00d4ff]">{t('autotrader.bot_idle_btn')}</span>
      </div>
    </div>
  )

  if (status === 'scanning') return (
    <div className="flex flex-col items-center justify-center py-10 text-center space-y-4">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-2 border-[#00d4ff]/20 animate-ping" />
        <div className="absolute inset-2 rounded-full border-2 border-[#00d4ff]/40 animate-ping" style={{ animationDelay:'0.3s' }} />
        <div className="absolute inset-4 rounded-full bg-[#00d4ff]/10 flex items-center justify-center">
          <Search size={16} className="text-[#00d4ff]" />
        </div>
      </div>
      <div>
        <div className="text-sm font-bold text-[#00d4ff]">{t('autotrader.bot_scanning')}</div>
        <div className="text-xs font-mono text-[#3d5a73] mt-1">{t('autotrader.bot_scanning_sub')}</div>
      </div>
      <div className="flex gap-1.5">
        {[0,1,2,3,4].map(i => (
          <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-[#00d4ff]"
            animate={{ opacity:[0.2,1,0.2], y:[0,-4,0] }}
            transition={{ duration:1.2, repeat:Infinity, delay:i*0.15 }} />
        ))}
      </div>
    </div>
  )

  if (status === 'executing') return (
    <div className="flex flex-col items-center justify-center py-10 text-center space-y-4">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-2 border-[#ff9900]/30 animate-pulse" />
        <div className="absolute inset-3 rounded-full bg-[#ff9900]/10 flex items-center justify-center">
          <Radio size={18} className="text-[#ff9900]" />
        </div>
      </div>
      <div>
        <div className="text-sm font-bold text-[#ff9900]">{t('autotrader.bot_executing')}</div>
        <div className="text-xs font-mono text-[#3d5a73] mt-1">{t('autotrader.bot_executing_sub')}</div>
      </div>
    </div>
  )

  if (!result) return null

  if (result.executed) return (
    <motion.div initial={{ opacity:0, scale:0.97 }} animate={{ opacity:1, scale:1 }} className="space-y-4">
      <div className="flex items-center gap-3 p-4 rounded-xl bg-[#00ff88]/8 border border-[#00ff88]/20">
        <div className="w-10 h-10 rounded-full bg-[#00ff88]/15 flex items-center justify-center flex-shrink-0">
          <CheckCircle size={20} className="text-[#00ff88]" />
        </div>
        <div>
          <div className="text-sm font-bold text-[#00ff88]">{t('autotrader.bot_success_title')}</div>
          <div className="text-xs font-mono text-[#3d5a73] mt-0.5">
            {new Date().toLocaleString(undefined, { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}
          </div>
        </div>
        <div className={`ml-auto text-lg font-black ${result.bias==='LONG' ? 'text-[#00ff88]' : 'text-[#ff4466]'}`}>
          {result.bias==='LONG' ? '▲ LONG' : '▼ SHORT'}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: t('signal.entry').replace('Entry','').trim() || 'Pair',   value: result.pair,                                    color:'#e8f4ff', key:'pair' },
          { label: t('autotrader.bot_ai_confidence'),                        value: `${result.confidence}%`,                        color:'#00d4ff', key:'conf' },
          { label: t('autotrader.bot_entry_price'),                          value: `$${result.price?.toFixed(4)}`,                 color:'#e8f4ff', key:'price' },
          { label: t('autotrader.bot_leverage'),                             value: `${result.leverage ?? 1}×`,                     color:'#ff9900', key:'lev' },
          { label: t('signal.take_profit'),                                  value: result.take_profit ? `$${result.take_profit.toFixed(4)}` : '—', color:'#00ff88', key:'tp' },
          { label: t('signal.stop_loss'),                                    value: result.stop_loss   ? `$${result.stop_loss.toFixed(4)}`   : '—', color:'#ff4466', key:'sl' },
        ].map(item => (
          <div key={item.key} className="p-2.5 rounded-lg bg-[#0c1f35] border border-[#1a3a5c]">
            <div className="text-[10px] font-mono text-[#3d5a73] mb-0.5">{item.label}</div>
            <div className="text-xs font-bold font-mono" style={{ color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>
      <div className="p-2.5 rounded-lg bg-[#0c1f35] border border-[#1a3a5c]">
        <div className="text-[10px] font-mono text-[#3d5a73] mb-0.5">Order ID</div>
        <div className="text-[10px] font-mono text-[#8ba3be] break-all">{result.order_id}</div>
      </div>
      {result.signal?.analysis && (
        <div className="p-3 rounded-lg bg-[#00d4ff]/5 border border-[#00d4ff]/15">
          <div className="text-[10px] font-mono text-[#00d4ff] mb-1">{t('autotrader.bot_ai_analysis')}</div>
          <div className="text-[11px] font-mono text-[#8ba3be] leading-relaxed line-clamp-4">{result.signal.analysis}</div>
        </div>
      )}
    </motion.div>
  )

  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} className="space-y-3">
      <div className="flex items-center gap-3 p-4 rounded-xl bg-[#ffcc00]/5 border border-[#ffcc00]/20">
        <div className="w-10 h-10 rounded-full bg-[#ffcc00]/10 flex items-center justify-center flex-shrink-0">
          <Clock size={18} className="text-[#ffcc00]" />
        </div>
        <div>
          <div className="text-sm font-bold text-[#ffcc00]">{t('autotrader.bot_no_signal_title')}</div>
          <div className="text-xs font-mono text-[#3d5a73] mt-0.5 leading-relaxed">{result.reason}</div>
        </div>
      </div>
      {result.scanned && (
        <div className="text-[10px] font-mono text-[#3d5a73] text-center">{result.scanned} {t('autotrader.bot_pairs_analyzed')}</div>
      )}
    </motion.div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
export default function AutoTraderTab({ user }: { user: any }) {
  const t = useTranslations()
  const [section, setSection] = useState<'spot'|'futures'|'keys'|'history'>('spot')

  const [keys, setKeys]               = useState<ExchangeKey[]>([])
  const [selectedKey, setSelectedKey] = useState<number|null>(null)
  const [balance, setBalance]         = useState<BalanceCoin[]|null>(null)
  const [balLoading, setBalLoading]   = useState(false)

  const [selEx, setSelEx]           = useState('bybit')
  const [apiKey, setApiKey]         = useState('')
  const [apiSec, setApiSec]         = useState('')
  const [keyLabel, setKeyLabel]     = useState('')
  const [testnet, setTestnet]       = useState(false)
  const [connecting, setConnecting] = useState(false)

  const [spotPair,       setSpotPair]       = useState('BTC/USDT')
  const [spotSize,       setSpotSize]       = useState(10)
  const [spotSide,       setSpotSide]       = useState<'Buy'|'Sell'>('Buy')
  const [spotConfirm,    setSpotConfirm]    = useState(false)
  const [spotLoading,    setSpotLoading]    = useState(false)
  const [spotPairSearch, setSpotPairSearch] = useState('')

  const [botTf,      setBotTf]      = useState('1H')
  const [botSize,    setBotSize]    = useState(10)
  const [botLev,     setBotLev]     = useState(10)
  const [botRisk,    setBotRisk]    = useState<RiskProfile>('balanced')
  const [botMinConf, setBotMinConf] = useState(55)
  const [botStatus,  setBotStatus]  = useState<BotStatus>('idle')
  const [botResult,  setBotResult]  = useState<AIRunResult|null>(null)
  const [autoRepeat, setAutoRepeat] = useState(false)
  const [lastBotRun, setLastBotRun] = useState<any>(null)
  const autoRepeatRef = useRef(autoRepeat)
  const repeatTimer   = useRef<ReturnType<typeof setTimeout>|null>(null)
  useEffect(() => { autoRepeatRef.current = autoRepeat }, [autoRepeat])

  const [trades, setTrades] = useState<TradeLog[]>([])

  useEffect(() => () => { if (repeatTimer.current) clearTimeout(repeatTimer.current) }, [])

  const EXCHANGES = [
    {
      id: 'bybit',
      name: 'Bybit',
      logo: '🟡',
      url: 'https://www.bybit.com/app/user/api-management',
      testnetSupported: true,
      supportsSpot: true,
      supportsfutures: true,
      desc: t('autotrader.connect_bybit_desc'),
      hint: t('autotrader.connect_bybit_hint'),
      secretLabel: 'API Secret',
      secretPlaceholder: '••••••••••••',
    },
    {
      id: 'okx',
      name: 'OKX',
      logo: '🔷',
      url: 'https://www.okx.com/account/my-api',
      testnetSupported: true,
      supportsSpot: true,
      supportsfutures: true,
      desc: t('autotrader.connect_okx_desc'),
      hint: t('autotrader.connect_okx_hint'),
      secretLabel: 'Secret::Passphrase',
      secretPlaceholder: 'a1b2c3...::MyPassphrase',
    },
    {
      id: 'hyperliquid',
      name: 'Hyperliquid',
      logo: '🟣',
      url: 'https://app.hyperliquid.xyz/portfolio',
      testnetSupported: false,
      supportsSpot: false,
      supportsfutures: true,
      desc: t('autotrader.connect_hl_desc'),
      hint: t('autotrader.connect_hl_hint'),
      secretLabel: t('autotrader.connect_hl_note2').split('=')[0].trim(),
      secretPlaceholder: '0xabc123...',
    },
  ]

  const RISK_PROFILES = [
    { id: 'conservative' as RiskProfile, label: t('autotrader.risk_conservative'), desc: 'TP ×0.8 · SL ×0.5', color: '#00ff88' },
    { id: 'balanced'     as RiskProfile, label: t('autotrader.risk_balanced'),     desc: 'TP ×1.5 · SL ×1.0', color: '#00d4ff' },
    { id: 'aggressive'   as RiskProfile, label: t('autotrader.risk_aggressive'),   desc: 'TP ×3.0 · SL ×1.5', color: '#ff9900' },
  ]

  const selectedExchange = EXCHANGES.find(e => e.id === selEx)
  const selectedKeyObj   = keys.find(k => k.id === selectedKey)
  const selectedKeyEx    = EXCHANGES.find(e => e.id === selectedKeyObj?.exchange)

  const spotDisabledForExchange = selectedKeyObj?.exchange === 'hyperliquid'

  const loadKeys = useCallback(async () => {
    try {
      const r = await authFetch(`${API}/api/autotrader/keys`)
      if (r.ok) {
        const d = await r.json()
        setKeys(d)
        if (d.length > 0 && !selectedKey) setSelectedKey(d[0].id)
      }
    } catch {}
  }, [selectedKey])

  const loadBalance = useCallback(async (id: number, mode: TradeMode = 'spot') => {
    setBalLoading(true)
    try {
      const r = await authFetch(`${API}/api/autotrader/balance/${id}?mode=${mode}`)
      if (r.ok) {
        const d = await r.json()
        setBalance(d.coins)
        const usdt  = d.coins?.find((c: BalanceCoin) => c.coin === 'USDT' || c.coin === 'USDC')
        const total = d.coins?.reduce((s: number, c: BalanceCoin) => s + parseFloat(c.usd_value||'0'), 0) || 0
        if (usdt) logInfo(t('autotrader.balance_updated_msg'), `${usdt.coin}: $${parseFloat(usdt.balance).toFixed(2)} · Total: $${total.toFixed(2)}`)
      }
    } catch {}
    finally { setBalLoading(false) }
  }, [t])

  const loadTrades = useCallback(async () => {
    try { const r = await authFetch(`${API}/api/autotrader/trades`); if (r.ok) setTrades(await r.json()) } catch {}
  }, [])

  useEffect(() => { loadKeys(); loadTrades() }, [])
  useEffect(() => { if (selectedKey) loadBalance(selectedKey, section === 'futures' ? 'futures' : 'spot') }, [selectedKey])
  useEffect(() => { if (selectedKey) loadBalance(selectedKey, section === 'futures' ? 'futures' : 'spot') }, [section])

  useEffect(() => {
    if (selectedKey && keys.length) {
      const k = keys.find(k => k.id === selectedKey)
      if (k) logSuccess(`${t('autotrader.account_active_msg')}: ${k.label}`, `${EXCHANGES.find(e=>e.id===k.exchange)?.name}${k.testnet?' · TESTNET':''}`)
    }
  }, [selectedKey])

  async function connectKey() {
    if (!apiKey || !apiSec) return logError(t('autotrader.connect_error_fill'))
    setConnecting(true)
    try {
      const r = await authFetch(`${API}/api/autotrader/connect`, {
        method: 'POST',
        body: JSON.stringify({ exchange: selEx, api_key: apiKey, api_secret: apiSec, label: keyLabel || t('autotrader.connect_label_placeholder'), testnet }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || t('autotrader.connect_error'))
      logSuccess(`${EXCHANGES.find(e=>e.id===selEx)?.name} ${t('autotrader.account_connected_success')}`, `${t('autotrader.connect_success')} "${keyLabel || t('autotrader.connect_label_placeholder')}"`)
      setApiKey(''); setApiSec('')
      await loadKeys()
    } catch (e: any) {
      logError(t('autotrader.connect_error'), e.message)
    } finally { setConnecting(false) }
  }

  async function deleteKey(id: number) {
    const k = keys.find(k => k.id === id)
    await authFetch(`${API}/api/autotrader/keys/${id}`, { method: 'DELETE' })
    logWarning(`${t('autotrader.account_removed_msg')}: ${k?.label || id}`)
    setKeys(keys.filter(k => k.id !== id))
    if (selectedKey === id) { setSelectedKey(null); setBalance(null) }
  }

  async function executeSpot() {
    if (!selectedKey) return logError(t('autotrader.spot_execute_error_no_account'), t('autotrader.spot_execute_error_go_accounts'))
    if (spotDisabledForExchange) return logError(t('autotrader.spot_execute_error_hl'), t('autotrader.spot_execute_error_hl_hint'))
    if (!spotConfirm) return logError(t('autotrader.spot_execute_error_confirm'))
    setSpotLoading(true); setSpotConfirm(false)
    const dirLabel = spotSide === 'Buy' ? t('autotrader.spot_buy') : t('autotrader.spot_sell')
    logAction(`${dirLabel} ${spotPair}`, `$${spotSize} USDT`)
    try {
      const r = await authFetch(`${API}/api/autotrader/execute`, {
        method: 'POST',
        body: JSON.stringify({
          exchange_key_id: selectedKey,
          trade_mode:      'spot',
          pair:            spotPair,
          side:            spotSide,
          order_size_usdt: spotSize,
          leverage:        1,
          order_type:      'Market',
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || JSON.stringify(d))
      logSuccess(
        `${dirLabel} ${spotPair} ${t('autotrader.spot_executed_msg')}`,
        `Price: $${d.price?.toFixed?.(4) ?? '—'} · Order ID: ${d.order_id}`
      )
      await loadTrades()
      if (selectedKey) await loadBalance(selectedKey, 'spot')
    } catch (e: any) {
      logError(`${t('autotrader.spot_fail_msg')} ${dirLabel} ${spotPair}`, e.message)
    } finally { setSpotLoading(false) }
  }

  async function runBot() {
    if (!selectedKey) return logError(t('autotrader.spot_execute_error_no_account'), t('autotrader.spot_execute_error_go_accounts'))
    if (botStatus === 'scanning' || botStatus === 'executing') return
    setBotResult(null); setBotStatus('scanning')
    logAction(t('autotrader.bot_started_msg'), `Futures · ${botTf} · Min conf: ${botMinConf}%`)
    try {
      const r = await authFetch(`${API}/api/autotrader/ai-run`, {
        method: 'POST',
        body: JSON.stringify({
          exchange_key_id: selectedKey,
          trade_mode:      'futures',
          timeframe:       botTf,
          order_size_usdt: botSize,
          leverage:        botLev,
          risk_profile:    botRisk,
          min_confidence:  botMinConf,
        }),
      })
      const d: AIRunResult = await r.json()
      if (!r.ok) throw new Error((d as any).detail || JSON.stringify(d))

      if (d.executed) {
        setBotStatus('executing')
        await new Promise(res => setTimeout(res, 800))
        setBotStatus('done'); setBotResult(d)
        setLastBotRun({ ts: new Date(), pair: d.pair, bias: d.bias, confidence: d.confidence, executed: true })
        logSuccess(
          `${t('autotrader.bot_position_opened')}: ${d.bias} ${d.pair}`,
          `Confidence: ${d.confidence}% · Price: $${d.price?.toFixed(4)} · TP: $${d.take_profit?.toFixed(4) ?? '—'} · SL: $${d.stop_loss?.toFixed(4) ?? '—'}`
        )
        await loadTrades()
        if (selectedKey) await loadBalance(selectedKey, 'futures')
      } else {
        setBotStatus('done'); setBotResult(d)
        setLastBotRun({ ts: new Date(), pair: '', bias: '', confidence: 0, executed: false })
        logWarning(t('autotrader.bot_no_signal_msg'), d.reason || `${d.scanned ?? '—'} ${t('autotrader.bot_pairs_analyzed')}`)
      }
    } catch (e: any) {
      setBotStatus('error')
      setBotResult({ executed: false, reason: e.message })
      logError(t('autotrader.bot_error_msg'), e.message)
    }
    if (autoRepeatRef.current) {
      logInfo(t('autotrader.bot_auto_repeat_msg'), t('autotrader.bot_auto_repeat_next'))
      repeatTimer.current = setTimeout(() => { if (autoRepeatRef.current) runBot() }, 5 * 60 * 1000)
    }
  }

  function stopBot() {
    if (repeatTimer.current) clearTimeout(repeatTimer.current)
    setAutoRepeat(false); setBotStatus('idle')
    logWarning(t('autotrader.bot_stopped_msg'))
  }

  if (!user) return (
    <div className="glass-card p-12 text-center mt-4">
      <Bot size={48} className="text-[#1a3a5c] mx-auto mb-4" />
      <div className="text-lg font-bold text-[#3d5a73] mb-2">{t('autotrader.login_required')}</div>
    </div>
  )

  const botRunning    = botStatus === 'scanning' || botStatus === 'executing'
  const filteredPairs = SPOT_PAIRS.filter(p => p.toLowerCase().includes(spotPairSearch.toLowerCase()))

  return (
    <div className="space-y-4 mt-1">

      {/* ── Nav ──────────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Bot size={20} className="text-[#00d4ff]" /> {t('autotrader.title')}
            <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-[#ffcc00]/10 text-[#ffcc00] border border-[#ffcc00]/30">BETA</span>
          </h1>
          <div className="text-xs font-mono text-[#3d5a73]">{t('autotrader.subtitle')}</div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {([
            { id:'spot',    label: t('autotrader.tab_spot')     },
            { id:'futures', label: t('autotrader.tab_futures')  },
            { id:'keys',    label: t('autotrader.tab_accounts') },
            { id:'history', label: t('autotrader.tab_history')  },
          ] as const).map(s => (
            <button key={s.id} onClick={() => setSection(s.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-all border ${section===s.id ? 'bg-[#00d4ff]/10 text-[#00d4ff] border-[#00d4ff]/20' : 'text-[#8ba3be] border-[#1a3a5c] hover:border-[#00d4ff]/20'}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Account Status Bar ───────────────────────────────────────────────── */}
      <AccountStatusBar
        keyId={selectedKey}
        keyLabel={selectedKeyObj?.label || ''}
        walletMode={section === 'futures' ? 'futures' : 'spot'}
        exchange={selectedKeyObj?.exchange || ''}
        testnet={selectedKeyObj?.testnet || false}
        balance={balance}
        loading={balLoading}
        onRefresh={() => selectedKey && loadBalance(selectedKey, section === 'futures' ? 'futures' : 'spot')}
        lastBotRun={lastBotRun}
      />

      {/* ════ SPOT ════════════════════════════════════════════════════════════ */}
      {section === 'spot' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="glass-card p-5 space-y-5">

            <div className="flex items-center gap-2">
              <span className="text-xl">💰</span>
              <div>
                <div className="text-sm font-bold">{t('autotrader.spot_title')}</div>
                <div className="text-xs font-mono text-[#3d5a73]">{t('autotrader.spot_subtitle')}</div>
              </div>
            </div>

            {!selectedKey && (
              <div className="p-3 rounded-xl bg-[#ff4466]/5 border border-[#ff4466]/20 text-xs font-mono text-[#ff4466] flex items-center gap-2">
                <AlertTriangle size={13} />
                {t('autotrader.spot_no_account')} <button onClick={() => setSection('keys')} className="underline ml-1">{t('autotrader.tab_accounts')}</button>
              </div>
            )}

            {spotDisabledForExchange && (
              <div className="p-3 rounded-xl bg-[#ff9900]/5 border border-[#ff9900]/20 text-xs font-mono text-[#ff9900] flex items-center gap-2">
                <AlertTriangle size={13} />
                {t('autotrader.spot_disabled_hl')}{' '}
                <button onClick={() => setSection('futures')} className="underline ml-1">{t('autotrader.spot_disabled_hl_link')}</button>.
              </div>
            )}

            <div>
              <label className="block text-xs font-mono text-[#3d5a73] mb-2">{t('autotrader.spot_coin_label')}</label>
              <div className="relative mb-2">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3d5a73]" />
                <input
                  type="text"
                  value={spotPairSearch}
                  onChange={e => setSpotPairSearch(e.target.value.toUpperCase())}
                  placeholder={t('autotrader.spot_search_placeholder')}
                  className="w-full bg-[#0c1f35] border border-[#1a3a5c] rounded-lg pl-8 pr-3 py-2 text-xs text-[#e8f4ff] font-mono focus:outline-none focus:border-[#00d4ff]/50 placeholder-[#3d5a73]"
                />
              </div>
              <div className="grid grid-cols-4 gap-1.5 max-h-44 overflow-y-auto pr-1">
                {filteredPairs.map(pair => {
                  const base = pair.split('/')[0]
                  return (
                    <button
                      key={pair}
                      onClick={() => setSpotPair(pair)}
                      className={`py-2 px-1 rounded-lg text-[11px] font-bold font-mono border transition-all ${
                        spotPair === pair
                          ? 'bg-[#00d4ff]/15 text-[#00d4ff] border-[#00d4ff]/40'
                          : 'bg-[#0c1f35] text-[#8ba3be] border-[#1a3a5c] hover:border-[#00d4ff]/30 hover:text-[#e8f4ff]'
                      }`}>
                      {base}
                    </button>
                  )
                })}
              </div>
              <div className="mt-2 text-center text-xs font-mono text-[#3d5a73]">
                {t('autotrader.spot_selected')}: <span className="text-[#00d4ff] font-bold">{spotPair}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">{t('autotrader.spot_value_label')}</label>
              <input
                type="number" value={spotSize} min={1} step={1}
                onChange={e => setSpotSize(parseFloat(e.target.value) || 0)}
                className="w-full bg-[#0c1f35] border border-[#1a3a5c] rounded-lg px-3 py-2.5 text-sm text-[#e8f4ff] font-mono focus:outline-none focus:border-[#00d4ff]/50"
              />
              <div className="flex gap-1.5 mt-2">
                {[10, 25, 50, 100, 250].map(v => (
                  <button key={v} onClick={() => setSpotSize(v)}
                    className={`flex-1 py-1 rounded text-[10px] font-bold font-mono border transition-all ${
                      spotSize === v ? 'bg-[#00d4ff]/15 text-[#00d4ff] border-[#00d4ff]/40' : 'bg-[#0c1f35] text-[#3d5a73] border-[#1a3a5c] hover:border-[#00d4ff]/30'
                    }`}>
                    ${v}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">{t('autotrader.spot_operation_label')}</label>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setSpotSide('Buy')}
                  className={`py-3 rounded-xl text-sm font-bold font-mono border transition-all flex items-center justify-center gap-2 ${
                    spotSide === 'Buy'
                      ? 'bg-[#00ff88]/15 text-[#00ff88] border-[#00ff88]/40'
                      : 'text-[#3d5a73] border-[#1a3a5c] hover:border-[#00ff88]/30'
                  }`}>
                  <TrendingUp size={15} /> {t('autotrader.spot_buy')}
                </button>
                <button onClick={() => setSpotSide('Sell')}
                  className={`py-3 rounded-xl text-sm font-bold font-mono border transition-all flex items-center justify-center gap-2 ${
                    spotSide === 'Sell'
                      ? 'bg-[#ff4466]/15 text-[#ff4466] border-[#ff4466]/40'
                      : 'text-[#3d5a73] border-[#1a3a5c] hover:border-[#ff4466]/30'
                  }`}>
                  <TrendingDown size={15} /> {t('autotrader.spot_sell')}
                </button>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#0c1f35] border border-[#1a3a5c] space-y-1.5 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-[#3d5a73]">{t('autotrader.spot_summary_coin')}</span>
                <span className="font-bold text-[#e8f4ff]">{spotPair}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#3d5a73]">{t('autotrader.spot_summary_operation')}</span>
                <span className={`font-bold ${spotSide === 'Buy' ? 'text-[#00ff88]' : 'text-[#ff4466]'}`}>
                  {spotSide === 'Buy' ? `▲ ${t('autotrader.spot_buy')}` : `▼ ${t('autotrader.spot_sell')}`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#3d5a73]">{t('autotrader.spot_summary_value')}</span>
                <span className="font-bold">${spotSize} USDT</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#3d5a73]">{t('autotrader.spot_summary_exchange')}</span>
                <span className="text-[#8ba3be]">{selectedKeyEx?.name || '—'}</span>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <div onClick={() => setSpotConfirm(!spotConfirm)}
                className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${spotConfirm ? 'bg-[#00ff88] border-[#00ff88]' : 'border-[#3d5a73]'}`}>
                {spotConfirm && <span className="text-[#020b14] text-[10px] font-bold">✓</span>}
              </div>
              <span className="text-xs font-mono text-[#8ba3be]">{t('autotrader.spot_confirm_checkbox')}</span>
            </label>

            <button onClick={executeSpot} disabled={!selectedKey || !spotConfirm || spotLoading || spotDisabledForExchange}
              className={`w-full py-3.5 rounded-xl text-sm font-bold font-mono border transition-all flex items-center justify-center gap-2 disabled:opacity-40 ${
                spotSide === 'Buy'
                  ? 'bg-[#00ff88]/15 text-[#00ff88] border-[#00ff88]/40 hover:bg-[#00ff88]/25'
                  : 'bg-[#ff4466]/15 text-[#ff4466] border-[#ff4466]/40 hover:bg-[#ff4466]/25'
              }`}>
              {spotLoading ? <RefreshCw size={15} className="animate-spin" /> : <Play size={15} />}
              {spotSide === 'Buy' ? `${t('autotrader.spot_buy')} ${spotPair}` : `${t('autotrader.spot_sell')} ${spotPair}`}
            </button>

            <div className="p-3 rounded-xl bg-[#00d4ff]/5 border border-[#00d4ff]/10 flex items-start gap-2">
              <Info size={13} className="text-[#00d4ff] flex-shrink-0 mt-0.5" />
              <div className="text-[10px] font-mono text-[#3d5a73] leading-relaxed">
                {t('autotrader.spot_info')}{' '}
                <button onClick={() => setSection('futures')} className="text-[#00d4ff] underline">{t('autotrader.spot_info_futures_link')}</button>.
                {' '}{t('autotrader.spot_info_hl')}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <ActivityFeed maxVisible={14} />
          </div>
        </div>
      )}

      {/* ════ FUTUROS IA ══════════════════════════════════════════════════════ */}
      {section === 'futures' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="glass-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-[#ff9900]" />
              <div>
                <div className="text-sm font-bold">{t('autotrader.futures_title')}</div>
                <div className="text-xs font-mono text-[#3d5a73]">{t('autotrader.futures_subtitle')}</div>
              </div>
            </div>

            {!selectedKey && (
              <div className="p-3 rounded-xl bg-[#ff4466]/5 border border-[#ff4466]/20 text-xs font-mono text-[#ff4466] flex items-center gap-2">
                <AlertTriangle size={13} />
                {t('autotrader.spot_no_account')} <button onClick={() => setSection('keys')} className="underline ml-1">{t('autotrader.tab_accounts')}</button>
              </div>
            )}

            {selectedKeyObj?.exchange === 'hyperliquid' && (
              <div className="p-2.5 rounded-lg bg-[#b366ff]/10 border border-[#b366ff]/20 text-[10px] font-mono text-[#b366ff] flex items-center gap-2">
                🟣 {t('autotrader.futures_hl_note')}
              </div>
            )}

            <div>
              <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">{t('autotrader.futures_timeframe_label')}</label>
              <div className="grid grid-cols-6 gap-1.5">
                {FUTURES_TIMEFRAMES.map(tf => (
                  <button key={tf} onClick={() => setBotTf(tf)}
                    className={`py-1.5 rounded-lg text-[11px] font-bold font-mono border transition-all ${
                      botTf === tf
                        ? 'bg-[#ff9900]/20 text-[#ff9900] border-[#ff9900]/40'
                        : 'bg-[#0c1f35] text-[#3d5a73] border-[#1a3a5c] hover:border-[#ff9900]/30 hover:text-[#ff9900]/70'
                    }`}>
                    {tf}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">{t('autotrader.futures_order_size_label')}</label>
              <input type="number" value={botSize} min={1} step={1}
                onChange={e => setBotSize(parseFloat(e.target.value) || 0)}
                className="w-full bg-[#0c1f35] border border-[#1a3a5c] rounded-lg px-3 py-2.5 text-sm text-[#e8f4ff] font-mono focus:outline-none focus:border-[#ff9900]/50"
              />
              <div className="flex gap-1.5 mt-2">
                {[10, 25, 50, 100, 250].map(v => (
                  <button key={v} onClick={() => setBotSize(v)}
                    className={`flex-1 py-1 rounded text-[10px] font-bold font-mono border transition-all ${
                      botSize === v ? 'bg-[#ff9900]/15 text-[#ff9900] border-[#ff9900]/40' : 'bg-[#0c1f35] text-[#3d5a73] border-[#1a3a5c] hover:border-[#ff9900]/30'
                    }`}>
                    ${v}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">
                {t('autotrader.futures_leverage_label')} <span className="text-[#ff9900]">{botLev}×</span>
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {LEVERAGE_PRESETS.map(lev => (
                  <button key={lev} onClick={() => setBotLev(lev)}
                    className={`py-1.5 rounded-lg text-xs font-bold font-mono border transition-all ${
                      botLev === lev
                        ? 'bg-[#ff9900]/20 text-[#ff9900] border-[#ff9900]/40'
                        : 'bg-[#0c1f35] text-[#3d5a73] border-[#1a3a5c] hover:border-[#ff9900]/30 hover:text-[#ff9900]/70'
                    }`}>
                    {lev}×
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono text-[#3d5a73] mb-2">{t('autotrader.futures_risk_label')}</label>
              <div className="grid grid-cols-3 gap-2">
                {RISK_PROFILES.map(rp => (
                  <button key={rp.id} onClick={() => setBotRisk(rp.id)}
                    className="p-2.5 rounded-xl border text-center transition-all"
                    style={botRisk === rp.id ? { borderColor: rp.color, backgroundColor: `${rp.color}15` } : { borderColor: '#1a3a5c' }}>
                    <div className="text-xs font-bold font-mono" style={{ color: botRisk === rp.id ? rp.color : '#8ba3be' }}>{rp.label}</div>
                    <div className="text-[9px] font-mono text-[#3d5a73] mt-0.5">{rp.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">
                {t('autotrader.futures_confidence_label')}: <span className="text-[#00d4ff]">{botMinConf}%</span>
              </label>
              <input type="range" min={50} max={99} step={1} value={botMinConf}
                onChange={e => setBotMinConf(parseInt(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none bg-[#1a3a5c] accent-[#00d4ff]" />
              <div className="flex justify-between text-[9px] font-mono text-[#3d5a73] mt-1">
                <span>50% ({t('autotrader.futures_confidence_more')})</span><span>99% ({t('autotrader.futures_confidence_less')})</span>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-[#0c1f35] border border-[#1a3a5c]">
              <div>
                <div className="text-xs font-bold">{t('autotrader.futures_auto_repeat_title')}</div>
                <div className="text-[10px] font-mono text-[#3d5a73]">{t('autotrader.futures_auto_repeat_subtitle')}</div>
              </div>
              <button onClick={() => setAutoRepeat(!autoRepeat)}>
                {autoRepeat ? <ToggleRight size={24} className="text-[#00d4ff]" /> : <ToggleLeft size={24} className="text-[#3d5a73]" />}
              </button>
            </div>

            <div className="flex gap-3">
              <button onClick={runBot} disabled={!selectedKey || botRunning}
                className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-[#ff9900]/20 to-[#ff4466]/15 text-[#ff9900] border border-[#ff9900]/40 text-sm font-bold font-mono hover:from-[#ff9900]/30 hover:to-[#ff4466]/25 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                {botRunning
                  ? <><RefreshCw size={16} className="animate-spin" />{t('autotrader.futures_analyzing')}</>
                  : <><Sparkles size={16} />{t('autotrader.futures_run_bot')}</>}
              </button>
              {(botRunning || autoRepeat) && (
                <button onClick={stopBot}
                  className="px-4 py-3.5 rounded-xl bg-[#ff4466]/10 text-[#ff4466] border border-[#ff4466]/30 font-bold font-mono hover:bg-[#ff4466]/20 transition-all flex items-center gap-2">
                  <Square size={14} /> {t('autotrader.futures_stop')}
                </button>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="glass-card p-5">
              <BotResultCard status={botStatus} result={botResult} t={t} />
            </div>
            <ActivityFeed maxVisible={10} />
          </div>
        </div>
      )}

      {/* ════ CONTAS ══════════════════════════════════════════════════════════ */}
      {section === 'keys' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="glass-card p-5 space-y-4">
            <div className="flex items-center gap-2"><Key size={16} className="text-[#00d4ff]"/><span className="text-sm font-bold">{t('autotrader.connect_title')}</span></div>

            <div className="grid grid-cols-3 gap-2">
              {EXCHANGES.map(ex => (
                <button key={ex.id} onClick={() => { setSelEx(ex.id); setTestnet(false) }}
                  className={`p-3 rounded-xl border text-left transition-all ${selEx===ex.id ? 'border-[#00d4ff]/40 bg-[#00d4ff]/5' : 'border-[#1a3a5c]'}`}>
                  <div className="text-base">{ex.logo}</div>
                  <div className={`text-sm font-bold mt-0.5 ${selEx===ex.id ? 'text-[#00d4ff]' : 'text-[#e8f4ff]'}`}>{ex.name}</div>
                  <div className="text-[9px] font-mono text-[#3d5a73] mt-0.5 leading-tight">{ex.desc}</div>
                </button>
              ))}
            </div>

            <div className="flex items-start gap-2 p-3 rounded-lg bg-[#ffcc00]/5 border border-[#ffcc00]/20">
              <Info size={13} className="text-[#ffcc00] flex-shrink-0 mt-0.5"/>
              <div className="text-xs text-[#ffcc00]/80 font-mono leading-relaxed">
                {selectedExchange?.hint}{' '}
                <a href={selectedExchange?.url} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">
                  {t('autotrader.connect_open_api')} <ExternalLink size={10}/>
                </a>
              </div>
            </div>

            {selEx === 'hyperliquid' && (
              <div className="p-3 rounded-lg bg-[#b366ff]/5 border border-[#b366ff]/20 text-[10px] font-mono text-[#b366ff] leading-relaxed space-y-1">
                <div>🟣 <strong>API Key</strong> = {t('autotrader.connect_hl_note1')}</div>
                <div>🔑 <strong>{t('autotrader.connect_hl_note2').split('=')[0].trim()}</strong> = {t('autotrader.connect_hl_note2').split('=').slice(1).join('=').trim()}</div>
                <div className="text-[#ff9900]">{t('autotrader.connect_hl_warning')}</div>
              </div>
            )}

            {[
              { label: selEx === 'hyperliquid' ? t('autotrader.connect_wallet_label') : 'API Key', val:apiKey, set:setApiKey, ph: selEx === 'hyperliquid' ? '0x1234abcd...' : t('autotrader.connect_api_key_placeholder'), type:'text' },
              { label: selectedExchange?.secretLabel || 'API Secret', val:apiSec, set:setApiSec, ph: selectedExchange?.secretPlaceholder || '••••••••••••', type:'password' },
              { label: t('autotrader.connect_label_field'), val:keyLabel, set:setKeyLabel, ph: t('autotrader.connect_label_placeholder'), type:'text' },
            ].map(f => (
              <div key={f.label}>
                <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">{f.label}</label>
                <input type={f.type} value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.ph}
                  className="w-full bg-[#0c1f35] border border-[#1a3a5c] rounded-lg px-3 py-2.5 text-sm text-[#e8f4ff] font-mono focus:outline-none focus:border-[#00d4ff]/50 placeholder-[#3d5a73]" />
              </div>
            ))}

            {selectedExchange?.testnetSupported && selEx !== 'hyperliquid' && (
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-[#3d5a73]">{t('autotrader.connect_testnet')}</span>
                <button onClick={() => setTestnet(!testnet)} className="flex items-center gap-1.5">
                  {testnet ? <ToggleRight size={20} className="text-[#00d4ff]"/> : <ToggleLeft size={20} className="text-[#3d5a73]"/>}
                  <span className={`text-xs font-mono ${testnet ? 'text-[#00d4ff]' : 'text-[#3d5a73]'}`}>{testnet ? t('autotrader.connect_on') : t('autotrader.connect_off')}</span>
                </button>
              </div>
            )}

            <button onClick={connectKey} disabled={connecting || !apiKey || !apiSec}
              className="w-full py-2.5 rounded-xl bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/30 text-sm font-bold font-mono hover:bg-[#00d4ff]/25 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
              {connecting ? <RefreshCw size={14} className="animate-spin"/> : <Key size={14}/>}
              {t('autotrader.connect_btn')} {selectedExchange?.logo} {selectedExchange?.name}
            </button>
          </div>

          <div className="space-y-4">
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2"><Shield size={16} className="text-[#00ff88]"/><span className="text-sm font-bold">{t('autotrader.accounts_title')}</span></div>
                <button onClick={loadKeys} className="w-7 h-7 rounded-lg bg-[#0c1f35] border border-[#1a3a5c] flex items-center justify-center text-[#8ba3be] hover:text-[#00d4ff]"><RefreshCw size={12}/></button>
              </div>
              {keys.length === 0 ? (
                <div className="text-center py-8"><Key size={32} className="text-[#1a3a5c] mx-auto mb-2"/><div className="text-xs font-mono text-[#3d5a73]">{t('autotrader.accounts_none')}</div></div>
              ) : (
                <div className="space-y-2">
                  {keys.map(k => (
                    <div key={k.id} onClick={() => setSelectedKey(k.id)}
                      className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${selectedKey===k.id ? 'border-[#00d4ff]/40 bg-[#00d4ff]/5' : 'border-[#1a3a5c] hover:border-[#00d4ff]/20'}`}>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold">{k.label}</span>
                          <ExchangeBadge exchange={k.exchange}/>
                          {k.testnet && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#ffcc00]/10 text-[#ffcc00] border border-[#ffcc00]/30">TESTNET</span>}
                          {selectedKey===k.id && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/30">{t('autotrader.accounts_active_badge')}</span>}
                        </div>
                        <div className="text-xs font-mono text-[#3d5a73] mt-0.5">{k.api_key_preview}</div>
                      </div>
                      <button onClick={e => { e.stopPropagation(); deleteKey(k.id) }}
                        className="w-7 h-7 rounded-lg bg-[#ff4466]/10 border border-[#ff4466]/20 flex items-center justify-center text-[#ff4466] hover:bg-[#ff4466]/20 flex-shrink-0">
                        <Trash2 size={11}/>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {balance && balance.length > 0 && (
              <div className="glass-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Wallet size={14} className="text-[#00d4ff]"/><span className="text-sm font-bold">{t('autotrader.balance_title')}</span>
                  <button onClick={() => selectedKey && loadBalance(selectedKey, 'spot')}
                    className="ml-auto w-6 h-6 rounded bg-[#0c1f35] border border-[#1a3a5c] flex items-center justify-center text-[#8ba3be] hover:text-[#00d4ff]">
                    <RefreshCw size={10} className={balLoading ? 'animate-spin' : ''}/>
                  </button>
                </div>
                <div className="space-y-1 max-h-52 overflow-y-auto">
                  {balance.map(c => (
                    <div key={c.coin} className="flex justify-between text-xs font-mono py-1.5 border-b border-[#1a3a5c]/40 last:border-0">
                      <span className="font-bold text-[#e8f4ff]">{c.coin}</span>
                      <div className="text-right">
                        <span className="text-[#e8f4ff]">{parseFloat(c.balance).toFixed(4)}</span>
                        {parseFloat(c.usd_value||'0') > 0 && <span className="text-[#3d5a73] ml-2">${parseFloat(c.usd_value).toFixed(2)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <ActivityFeed maxVisible={6} collapsed />
          </div>
        </div>
      )}

      {/* ════ HISTÓRICO ═══════════════════════════════════════════════════════ */}
      {section === 'history' && (
        <div className="space-y-4">
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <span className="text-sm font-bold">{t('autotrader.orders_title')}</span>
              <button onClick={loadTrades} className="w-7 h-7 rounded-lg bg-[#0c1f35] border border-[#1a3a5c] flex items-center justify-center text-[#8ba3be] hover:text-[#00d4ff]"><RefreshCw size={12}/></button>
            </div>
            {trades.length === 0 ? (
              <div className="text-center py-12"><BarChart2 size={40} className="text-[#1a3a5c] mx-auto mb-3"/><div className="text-sm font-bold text-[#3d5a73]">{t('autotrader.orders_empty')}</div></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-[#3d5a73] border-b border-[#1a3a5c]">
                      <th className="text-left py-2 pr-3">{t('autotrader.orders_exchange')}</th>
                      <th className="text-left py-2 pr-3">{t('autotrader.orders_pair')}</th>
                      <th className="text-left py-2 pr-3">{t('autotrader.orders_operation')}</th>
                      <th className="text-left py-2 pr-3">{t('autotrader.orders_mode')}</th>
                      <th className="text-right py-2 pr-3">{t('autotrader.orders_price')}</th>
                      <th className="text-right py-2 pr-3">TP</th>
                      <th className="text-right py-2 pr-3">SL</th>
                      <th className="text-center py-2 pr-3">{t('autotrader.orders_status')}</th>
                      <th className="text-right py-2">{t('autotrader.orders_date')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map(tr => (
                      <tr key={tr.id} className="border-b border-[#1a3a5c]/30 hover:bg-[#0c1f35]/50">
                        <td className="py-2.5 pr-3"><ExchangeBadge exchange={tr.exchange||'bybit'}/></td>
                        <td className="py-2.5 pr-3 font-bold text-[#e8f4ff]">{tr.pair}</td>
                        <td className="py-2.5 pr-3">
                          <span className={`font-bold ${tr.side==='Buy' ? 'text-[#00ff88]' : 'text-[#ff4466]'}`}>
                            {tr.side==='Buy'
                              ? (tr.trade_mode==='futures' ? t('autotrader.orders_long')  : t('autotrader.orders_buy'))
                              : (tr.trade_mode==='futures' ? t('autotrader.orders_short') : t('autotrader.orders_sell'))}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className={`text-[10px] font-bold ${tr.trade_mode==='futures' ? 'text-[#ff9900]' : 'text-[#00ff88]'}`}>
                            {tr.trade_mode==='futures' ? t('autotrader.orders_futures') : t('autotrader.orders_spot')}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-right text-[#e8f4ff]">${tr.price?.toFixed(4)}</td>
                        <td className="py-2.5 pr-3 text-right text-[#00ff88]">{tr.take_profit>0 ? `$${tr.take_profit.toFixed(4)}` : '—'}</td>
                        <td className="py-2.5 pr-3 text-right text-[#ff4466]">{tr.stop_loss>0   ? `$${tr.stop_loss.toFixed(4)}`   : '—'}</td>
                        <td className="py-2.5 pr-3 text-center"><StatusBadge status={tr.status} t={t}/></td>
                        <td className="py-2.5 text-right text-[#3d5a73]">
                          {tr.created_at ? new Date(tr.created_at).toLocaleString(undefined,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <ActivityFeed maxVisible={15} />
        </div>
      )}
    </div>
  )
}
