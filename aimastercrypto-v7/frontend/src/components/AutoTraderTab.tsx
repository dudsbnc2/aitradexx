'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bot, Key, Wallet, AlertTriangle, Play, Square, Trash2, RefreshCw,
  ChevronDown, CheckCircle, Shield, Zap, TrendingUp, TrendingDown,
  Settings, ToggleLeft, ToggleRight, ExternalLink, Info, BarChart2,
  Sparkles, Activity, Clock, Target, Search, Radio,
} from 'lucide-react'
import ActivityFeed from './ActivityFeed'
import AccountStatusBar from './AccountStatusBar'
import { logSuccess, logError, logWarning, logInfo, logAction } from '@/lib/activity-log'

const API = process.env.NEXT_PUBLIC_API_URL || ''

type TradeMode   = 'spot' | 'futures'
type RiskProfile = 'conservative' | 'balanced' | 'aggressive'
type BotStatus   = 'idle' | 'scanning' | 'executing' | 'done' | 'error'

interface ExchangeKey  { id: number; exchange: string; label: string; testnet: boolean; api_key_preview: string }
interface BalanceCoin  { coin: string; balance: string; available: string; usd_value: string }
interface TradeLog     {
  id: number; pair: string; side: string; trade_mode: TradeMode; exchange: string
  qty: number; price: number; take_profit: number; stop_loss: number; leverage: number
  status: string; order_id: string; error_msg: string; created_at: string; triggered_by: string
}
interface AIRunResult  {
  executed: boolean; reason?: string; pair?: string; bias?: string; side?: string
  confidence?: number; timeframe?: string; trade_mode?: string; price?: number
  qty?: number; take_profit?: number; stop_loss?: number; leverage?: number
  order_id?: string; signal?: { analysis?: string; entry?: number }; scanned?: number
}

const SPOT_TIMEFRAMES    = ['1m','5m','15m','30m','1H','4H','1D']
const FUTURES_TIMEFRAMES = ['1m','3m','5m','15m','30m','1H','2H','4H','6H','12H','1D']
const LEVERAGE_PRESETS   = [1,2,3,5,10,20,25,50,75,100,125]

const RISK_PROFILES = [
  { id: 'conservative' as RiskProfile, label: 'Conservador', desc: 'TP ×0.8 · SL ×0.5', color: '#00ff88' },
  { id: 'balanced'     as RiskProfile, label: 'Balanceado',  desc: 'TP ×1.5 · SL ×1.0', color: '#00d4ff' },
  { id: 'aggressive'   as RiskProfile, label: 'Agressivo',   desc: 'TP ×3.0 · SL ×1.5', color: '#ff9900' },
]

const EXCHANGES = [
  { id: 'bybit', name: 'Bybit', logo: '🟡', url: 'https://www.bybit.com/app/user/api-management', testnetSupported: true  },
  { id: 'mexc',  name: 'MEXC',  logo: '🔵', url: 'https://www.mexc.com/user/openapi',            testnetSupported: false },
]

// ── Auth fetch with auto token refresh ────────────────────────────────────────
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

// ── Small UI helpers ───────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string,string> = {
    filled:    'text-[#00ff88] bg-[#00ff88]/10 border-[#00ff88]/30',
    pending:   'text-[#ffcc00] bg-[#ffcc00]/10 border-[#ffcc00]/30',
    failed:    'text-[#ff4466] bg-[#ff4466]/10 border-[#ff4466]/30',
    cancelled: 'text-[#8ba3be] bg-[#1a3a5c]/50 border-[#1a3a5c]',
  }
  const labels: Record<string,string> = { filled:'EXECUTADA', pending:'PENDENTE', failed:'FALHOU', cancelled:'CANCELADA' }
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono border ${map[status] || map.pending}`}>{labels[status] || status.toUpperCase()}</span>
}

function ExchangeBadge({ exchange }: { exchange: string }) {
  const ex = EXCHANGES.find(e => e.id === exchange)
  return <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono border border-[#1a3a5c] text-[#8ba3be]">{ex?.logo} {ex?.name || exchange.toUpperCase()}</span>
}

function SelectField({ label, value, onChange, options }: { label:string; value:string; onChange:(v:string)=>void; options:{value:string;label:string}[] }) {
  return (
    <div>
      {label && <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">{label}</label>}
      <div className="relative">
        <select value={value} onChange={e => onChange(e.target.value)}
          className="w-full appearance-none bg-[#0c1f35] border border-[#1a3a5c] rounded-lg px-3 py-2.5 text-sm text-[#e8f4ff] font-mono focus:outline-none focus:border-[#00d4ff]/50 pr-8">
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#3d5a73] pointer-events-none"/>
      </div>
    </div>
  )
}

function InputField({ label, value, onChange, type='text', min, max, step, placeholder }: any) {
  return (
    <div>
      <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">{label}</label>
      <input type={type} value={value}
        onChange={e => onChange(type==='number' ? parseFloat(e.target.value)||0 : e.target.value)}
        min={min} max={max} step={step} placeholder={placeholder}
        className="w-full bg-[#0c1f35] border border-[#1a3a5c] rounded-lg px-3 py-2.5 text-sm text-[#e8f4ff] font-mono focus:outline-none focus:border-[#00d4ff]/50 placeholder-[#3d5a73]"
      />
    </div>
  )
}

// ── Bot Result Card ────────────────────────────────────────────────────────────
function BotResultCard({ status, result }: { status: BotStatus; result: AIRunResult|null }) {
  if (status === 'idle') return (
    <div className="flex flex-col items-center justify-center py-10 text-center space-y-3">
      <div className="w-14 h-14 rounded-full bg-[#00d4ff]/5 border border-[#00d4ff]/10 flex items-center justify-center">
        <Bot size={24} className="text-[#1a3a5c]" />
      </div>
      <div className="text-sm font-bold text-[#3d5a73]">Bot em repouso</div>
      <div className="text-xs font-mono text-[#1a3a5c] max-w-xs">
        Configura os parâmetros e carrega em <span className="text-[#00d4ff]">Executar Bot IA</span>
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
        <div className="text-sm font-bold text-[#00d4ff]">A varrer o mercado...</div>
        <div className="text-xs font-mono text-[#3d5a73] mt-1">A IA está a analisar todos os pares</div>
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
        <div className="text-sm font-bold text-[#ff9900]">A enviar ordem...</div>
        <div className="text-xs font-mono text-[#3d5a73] mt-1">Sinal encontrado · A executar na exchange</div>
      </div>
    </div>
  )

  if (!result) return null

  if (result.executed) return (
    <motion.div initial={{ opacity:0, scale:0.97 }} animate={{ opacity:1, scale:1 }} className="space-y-4">
      {/* Success header */}
      <div className="flex items-center gap-3 p-4 rounded-xl bg-[#00ff88]/8 border border-[#00ff88]/20">
        <div className="w-10 h-10 rounded-full bg-[#00ff88]/15 flex items-center justify-center flex-shrink-0">
          <CheckCircle size={20} className="text-[#00ff88]" />
        </div>
        <div>
          <div className="text-sm font-bold text-[#00ff88]">Ordem executada com sucesso</div>
          <div className="text-xs font-mono text-[#3d5a73] mt-0.5">
            {new Date().toLocaleString('pt-PT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}
          </div>
        </div>
        <div className={`ml-auto text-lg font-black ${result.bias==='LONG' ? 'text-[#00ff88]' : 'text-[#ff4466]'}`}>
          {result.bias==='LONG' ? '▲ LONG' : '▼ SHORT'}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label:'Par',          value: result.pair,                       color:'#e8f4ff' },
          { label:'Confiança IA', value: `${result.confidence}%`,           color:'#00d4ff' },
          { label:'Preço entrada',value: `$${result.price?.toFixed(4)}`,    color:'#e8f4ff' },
          { label:'Quantidade',   value: result.qty?.toFixed(5),            color:'#e8f4ff' },
          { label:'Take Profit',  value: result.take_profit ? `$${result.take_profit.toFixed(4)}` : '—', color:'#00ff88' },
          { label:'Stop Loss',    value: result.stop_loss   ? `$${result.stop_loss.toFixed(4)}`   : '—', color:'#ff4466' },
          ...(result.leverage && result.leverage>1 ? [{ label:'Alavancagem', value:`${result.leverage}×`, color:'#ff9900' }] : []),
          { label:'Timeframe',    value: result.timeframe,                  color:'#8ba3be' },
        ].map(item => (
          <div key={item.label} className="p-2.5 rounded-lg bg-[#0c1f35] border border-[#1a3a5c]">
            <div className="text-[10px] font-mono text-[#3d5a73] mb-0.5">{item.label}</div>
            <div className="text-xs font-bold font-mono" style={{ color: item.color }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Order ID */}
      <div className="p-2.5 rounded-lg bg-[#0c1f35] border border-[#1a3a5c]">
        <div className="text-[10px] font-mono text-[#3d5a73] mb-0.5">Order ID</div>
        <div className="text-[10px] font-mono text-[#8ba3be] break-all">{result.order_id}</div>
      </div>

      {/* AI analysis */}
      {result.signal?.analysis && (
        <div className="p-3 rounded-lg bg-[#00d4ff]/5 border border-[#00d4ff]/15">
          <div className="text-[10px] font-mono text-[#00d4ff] mb-1">Análise IA</div>
          <div className="text-[11px] font-mono text-[#8ba3be] leading-relaxed line-clamp-4">{result.signal.analysis}</div>
        </div>
      )}
    </motion.div>
  )

  // Not executed / error
  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} className="space-y-3">
      <div className="flex items-center gap-3 p-4 rounded-xl bg-[#ffcc00]/5 border border-[#ffcc00]/20">
        <div className="w-10 h-10 rounded-full bg-[#ffcc00]/10 flex items-center justify-center flex-shrink-0">
          <Clock size={18} className="text-[#ffcc00]" />
        </div>
        <div>
          <div className="text-sm font-bold text-[#ffcc00]">Sem ordem executada</div>
          <div className="text-xs font-mono text-[#3d5a73] mt-0.5 leading-relaxed">{result.reason}</div>
        </div>
      </div>
      {result.scanned && (
        <div className="text-[10px] font-mono text-[#3d5a73] text-center">{result.scanned} pares analisados</div>
      )}
    </motion.div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function AutoTraderTab({ user }: { user: any }) {
  const [section, setSection] = useState<'bot'|'manual'|'keys'|'history'>('bot')

  // Account
  const [keys, setKeys]               = useState<ExchangeKey[]>([])
  const [selectedKey, setSelectedKey] = useState<number|null>(null)
  const [balance, setBalance]         = useState<BalanceCoin[]|null>(null)
  const [balLoading, setBalLoading]   = useState(false)

  // Connect form
  const [selEx, setSelEx]       = useState('bybit')
  const [apiKey, setApiKey]     = useState('')
  const [apiSec, setApiSec]     = useState('')
  const [keyLabel, setKeyLabel] = useState('Conta Principal')
  const [testnet, setTestnet]   = useState(false)
  const [connecting, setConnecting] = useState(false)

  // Bot config
  const [botMode,    setBotMode]    = useState<TradeMode>('spot')
  const [botTf,      setBotTf]      = useState('1H')
  const [botSize,    setBotSize]    = useState(10)
  const [botLev,     setBotLev]     = useState(10)
  const [botRisk,    setBotRisk]    = useState<RiskProfile>('balanced')
  const [botMinConf, setBotMinConf] = useState(70)
  const [botPair,    setBotPair]    = useState('')

  // Bot state
  const [botStatus,    setBotStatus]    = useState<BotStatus>('idle')
  const [botResult,    setBotResult]    = useState<AIRunResult|null>(null)
  const [autoRepeat,   setAutoRepeat]   = useState(false)
  const [lastBotRun,   setLastBotRun]   = useState<any>(null)
  const autoRepeatRef  = useRef(autoRepeat)
  const repeatTimer    = useRef<ReturnType<typeof setTimeout>|null>(null)
  useEffect(() => { autoRepeatRef.current = autoRepeat }, [autoRepeat])

  // Manual order
  const [execMode,    setExecMode]    = useState<TradeMode>('spot')
  const [execPair,    setExecPair]    = useState('BTC/USDT')
  const [execSide,    setExecSide]    = useState<'Buy'|'Sell'>('Buy')
  const [execSize,    setExecSize]    = useState(10)
  const [execLev,     setExecLev]     = useState(10)
  const [execTp,      setExecTp]      = useState('')
  const [execSl,      setExecSl]      = useState('')
  const [execConfirm, setExecConfirm] = useState(false)
  const [execLoading, setExecLoading] = useState(false)

  // History
  const [trades,      setTrades]      = useState<TradeLog[]>([])

  useEffect(() => () => { if (repeatTimer.current) clearTimeout(repeatTimer.current) }, [])

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
        const usdt = d.coins?.find((c: BalanceCoin) => c.coin === 'USDT')
        const total = d.coins?.reduce((s: number, c: BalanceCoin) => s + parseFloat(c.usd_value||'0'), 0) || 0
        const modeLabel = mode === 'futures' ? 'Futuros (Contract)' : 'Spot'
        if (usdt) {
          logInfo(
            `Saldo ${modeLabel} actualizado`,
            `USDT: $${parseFloat(usdt.balance).toFixed(2)} · Total: $${total.toFixed(2)}`
          )
        } else if (d.coins?.length > 0) {
          logInfo(
            `Saldo ${modeLabel} actualizado`,
            `${d.coins.length} moedas · Total: $${total.toFixed(2)}`
          )
        } else {
          logWarning(`Wallet ${modeLabel} vazia`, 'Sem saldo disponível nesta carteira')
        }
      }
    } catch {}
    finally { setBalLoading(false) }
  }, [])

  const loadTrades = useCallback(async () => {
    try { const r = await authFetch(`${API}/api/autotrader/trades`); if (r.ok) setTrades(await r.json()) } catch {}
  }, [])

  useEffect(() => { loadKeys(); loadTrades() }, [])
  // Recarregar saldo quando muda a conta OU o modo activo
  useEffect(() => { if (selectedKey) loadBalance(selectedKey, botMode) }, [selectedKey])
  // Recarregar quando muda o modo no bot
  useEffect(() => { if (selectedKey) loadBalance(selectedKey, botMode) }, [botMode])
  // Recarregar quando muda o modo no manual
  useEffect(() => { if (selectedKey) loadBalance(selectedKey, execMode) }, [execMode])

  // Auto-log when key is selected
  useEffect(() => {
    if (selectedKey && keys.length) {
      const k = keys.find(k => k.id === selectedKey)
      if (k) {
        const ex = EXCHANGES.find(e => e.id === k.exchange)
        logSuccess(
          `Conta activa: ${k.label}`,
          `${ex?.name || k.exchange}${k.testnet ? ' · TESTNET' : ''} · A carregar saldo...`
        )
      }
    }
  }, [selectedKey])

  // ── Connect ──────────────────────────────────────────────────────────────────
  async function connectKey() {
    if (!apiKey || !apiSec) return logError('Preenche a API Key e Secret')
    setConnecting(true)
    logAction('A conectar exchange...', `${EXCHANGES.find(e=>e.id===selEx)?.name} "${keyLabel}"`)
    try {
      const r = await authFetch(`${API}/api/autotrader/connect`, {
        method: 'POST',
        body: JSON.stringify({ exchange: selEx, api_key: apiKey, api_secret: apiSec, label: keyLabel, testnet }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Erro ao conectar')
      const ex = EXCHANGES.find(e => e.id === selEx)
      logSuccess(
        `${ex?.logo} ${ex?.name} conectada com sucesso!`,
        `Conta "${keyLabel}"${testnet ? ' (Testnet)' : ''} · A verificar saldo...`
      )
      setApiKey(''); setApiSec('')
      await loadKeys()
    } catch (e: any) {
      logError('Falha ao conectar exchange', e.message)
    } finally { setConnecting(false) }
  }

  async function deleteKey(id: number) {
    const k = keys.find(k => k.id === id)
    await authFetch(`${API}/api/autotrader/keys/${id}`, { method: 'DELETE' })
    logWarning(`Conta removida: ${k?.label || id}`)
    setKeys(keys.filter(k => k.id !== id))
    if (selectedKey === id) { setSelectedKey(null); setBalance(null) }
  }

  // ── Bot run ───────────────────────────────────────────────────────────────────
  async function runBot() {
    if (!selectedKey) return logError('Seleciona uma conta primeiro', 'Vai ao separador Contas')
    if (botStatus === 'scanning' || botStatus === 'executing') return

    setBotResult(null)
    setBotStatus('scanning')
    const pairLabel = botPair || 'todos os pares'
    logAction(
      'Bot IA iniciado',
      `Modo: ${botMode.toUpperCase()} · ${botTf} · ${pairLabel} · Confiança mín: ${botMinConf}%`
    )

    try {
      const body: any = {
        exchange_key_id: selectedKey,
        trade_mode:      botMode,
        timeframe:       botTf,
        order_size_usdt: botSize,
        leverage:        botMode === 'spot' ? 1 : botLev,
        risk_profile:    botRisk,
        min_confidence:  botMinConf,
      }
      if (botPair) body.pair = botPair

      logInfo('A analisar mercado com IA...', `Perfil de risco: ${botRisk}`)
      setBotStatus('scanning')

      const r = await authFetch(`${API}/api/autotrader/ai-run`, {
        method: 'POST', body: JSON.stringify(body),
      })
      const d: AIRunResult = await r.json()
      if (!r.ok) throw new Error((d as any).detail || JSON.stringify(d))

      if (d.executed) {
        setBotStatus('executing')
        // Small delay to show "executing" state
        await new Promise(res => setTimeout(res, 800))
        setBotStatus('done')
        setBotResult(d)
        setLastBotRun({ ts: new Date(), pair: d.pair, bias: d.bias, confidence: d.confidence, executed: true })
        logSuccess(
          `Ordem executada: ${d.bias} ${d.pair}`,
          `Confiança: ${d.confidence}% · Preço: $${d.price?.toFixed(4)} · TP: $${d.take_profit?.toFixed(4) ?? '—'} · SL: $${d.stop_loss?.toFixed(4) ?? '—'}`
        )
        logInfo('Order ID', d.order_id)
        await loadTrades()
        if (selectedKey) await loadBalance(selectedKey, botMode)
      } else {
        setBotStatus('done')
        setBotResult(d)
        setLastBotRun({ ts: new Date(), pair: '', bias: '', confidence: 0, executed: false })
        logWarning(
          'Sem sinal adequado neste momento',
          d.reason || `Analisados ${d.scanned ?? '—'} pares`
        )
      }
    } catch (e: any) {
      setBotStatus('error')
      setBotResult({ executed: false, reason: e.message })
      logError('Erro ao executar bot', e.message)
    }

    if (autoRepeatRef.current) {
      logInfo('Repetição automática activa', 'Próxima análise em 5 minutos')
      repeatTimer.current = setTimeout(() => { if (autoRepeatRef.current) runBot() }, 5 * 60 * 1000)
    }
  }

  function stopBot() {
    if (repeatTimer.current) clearTimeout(repeatTimer.current)
    setAutoRepeat(false)
    setBotStatus('idle')
    logWarning('Bot parado pelo utilizador')
  }

  // ── Manual order ──────────────────────────────────────────────────────────────
  async function executeManual() {
    if (!selectedKey) return logError('Seleciona uma conta primeiro')
    if (!execConfirm) return logError('Confirma a ordem antes de executar')
    setExecLoading(true); setExecConfirm(false)

    const dirLabel = execMode === 'futures'
      ? (execSide === 'Buy' ? 'LONG' : 'SHORT')
      : (execSide === 'Buy' ? 'COMPRAR' : 'VENDER')
    logAction(`Ordem manual: ${dirLabel} ${execPair}`, `$${execSize} USDT${execMode==='futures' ? ` · ${execLev}×` : ''}`)

    try {
      const body: any = {
        exchange_key_id: selectedKey,
        trade_mode:      execMode,
        pair:            execPair,
        side:            execSide,
        order_size_usdt: execSize,
        leverage:        execMode === 'spot' ? 1 : execLev,
        order_type:      'Market',
      }
      if (execMode === 'futures' && execTp) body.take_profit = parseFloat(execTp)
      if (execMode === 'futures' && execSl) body.stop_loss   = parseFloat(execSl)

      const r = await authFetch(`${API}/api/autotrader/execute`, {
        method: 'POST', body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || JSON.stringify(d))
      logSuccess(
        `${dirLabel} ${execPair} executado!`,
        `Order ID: ${d.order_id} · Preço: $${d.price?.toFixed?.(4) ?? '—'}`
      )
      await loadTrades()
      if (selectedKey) await loadBalance(selectedKey)
    } catch (e: any) {
      logError(`Falha ao executar ${dirLabel} ${execPair}`, e.message)
    } finally { setExecLoading(false) }
  }

  if (!user) return (
    <div className="glass-card p-12 text-center mt-4">
      <Bot size={48} className="text-[#1a3a5c] mx-auto mb-4" />
      <div className="text-lg font-bold text-[#3d5a73] mb-2">Login necessário</div>
    </div>
  )

  const selectedKeyObj  = keys.find(k => k.id === selectedKey)
  const botTimeframes   = botMode   === 'futures' ? FUTURES_TIMEFRAMES : SPOT_TIMEFRAMES
  const botRunning      = botStatus === 'scanning' || botStatus === 'executing'

  return (
    <div className="space-y-4 mt-1">

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Bot size={20} className="text-[#00d4ff]" /> Auto Trade
            <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-[#ffcc00]/10 text-[#ffcc00] border border-[#ffcc00]/30">BETA</span>
          </h1>
          <div className="text-xs font-mono text-[#3d5a73]">A IA analisa · escolhe · executa autonomamente</div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {([
            { id:'bot',     label:'🤖 Bot IA'   },
            { id:'manual',  label:'⚡ Manual'   },
            { id:'keys',    label:'🔑 Contas'   },
            { id:'history', label:'📋 Histórico'},
          ] as const).map(s => (
            <button key={s.id} onClick={() => setSection(s.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-all border ${section===s.id ? 'bg-[#00d4ff]/10 text-[#00d4ff] border-[#00d4ff]/20' : 'text-[#8ba3be] border-[#1a3a5c] hover:border-[#00d4ff]/20'}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Account Status Bar — always visible ─────────────────────────────── */}
      <AccountStatusBar
        keyId={selectedKey}
        keyLabel={selectedKeyObj?.label || ''}
        walletMode={section === 'manual' ? execMode : botMode}
        exchange={selectedKeyObj?.exchange || ''}
        testnet={selectedKeyObj?.testnet || false}
        balance={balance}
        loading={balLoading}
        onRefresh={() => selectedKey && loadBalance(selectedKey, section === 'manual' ? execMode : botMode)}
        lastBotRun={lastBotRun}
      />

      {/* ── BOT ─────────────────────────────────────────────────────────────── */}
      {section === 'bot' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Config */}
          <div className="glass-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-[#00d4ff]" />
              <span className="text-sm font-bold">Configurar Bot IA</span>
            </div>

            <div className="p-3 rounded-xl bg-[#00d4ff]/5 border border-[#00d4ff]/15 text-xs font-mono text-[#8ba3be] leading-relaxed">
              Carrega em <span className="text-[#00d4ff] font-bold">Executar Bot IA</span> — a IA varre todos os pares,
              encontra o melhor sinal no timeframe escolhido, calcula TP/SL e executa sozinha.
            </div>

            {/* Spot / Futuros */}
            <div className="flex gap-1 p-1 rounded-xl bg-[#0c1f35] border border-[#1a3a5c]">
              {(['spot','futures'] as TradeMode[]).map(m => (
                <button key={m} onClick={() => setBotMode(m)}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold font-mono transition-all flex items-center justify-center gap-1.5 ${
                    botMode===m
                      ? m==='futures' ? 'bg-[#ff9900]/20 text-[#ff9900] border border-[#ff9900]/30'
                      : 'bg-[#00ff88]/20 text-[#00ff88] border border-[#00ff88]/30'
                      : 'text-[#3d5a73] hover:text-[#8ba3be]'
                  }`}>
                  {m==='spot' ? '💰 SPOT' : '⚡ FUTUROS'}
                </button>
              ))}
            </div>

            <SelectField label="Timeframe (a IA analisa neste período)" value={botTf} onChange={setBotTf}
              options={botTimeframes.map(t => ({ value:t, label:t }))} />

            <InputField label="Tamanho da ordem (USDT)" value={botSize} onChange={setBotSize} type="number" min={1} step={1} />

            {/* Alavancagem presets — só futuros */}
            {botMode === 'futures' && (
              <div>
                <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">Alavancagem</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {LEVERAGE_PRESETS.map(lev => (
                    <button key={lev} onClick={() => setBotLev(lev)}
                      className={`py-1.5 rounded-lg text-xs font-bold font-mono border transition-all ${
                        botLev===lev ? 'bg-[#ff9900]/20 text-[#ff9900] border-[#ff9900]/40'
                        : 'bg-[#0c1f35] text-[#3d5a73] border-[#1a3a5c] hover:border-[#ff9900]/30 hover:text-[#ff9900]/70'
                      }`}>
                      {lev}×
                    </button>
                  ))}
                </div>
                <div className="text-xs font-mono text-[#ff9900] mt-1 text-center">{botLev}× seleccionado</div>
              </div>
            )}

            {/* Perfil risco */}
            <div>
              <label className="block text-xs font-mono text-[#3d5a73] mb-2">Perfil de Risco (TP/SL automático)</label>
              <div className="grid grid-cols-3 gap-2">
                {RISK_PROFILES.map(rp => (
                  <button key={rp.id} onClick={() => setBotRisk(rp.id)}
                    className="p-2.5 rounded-xl border text-center transition-all"
                    style={botRisk===rp.id ? { borderColor:rp.color, backgroundColor:`${rp.color}15` } : { borderColor:'#1a3a5c' }}>
                    <div className="text-xs font-bold font-mono" style={{ color: botRisk===rp.id ? rp.color : '#8ba3be' }}>{rp.label}</div>
                    <div className="text-[9px] font-mono text-[#3d5a73] mt-0.5">{rp.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Confiança mínima */}
            <div>
              <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">
                Confiança mínima: <span className="text-[#00d4ff]">{botMinConf}%</span>
              </label>
              <input type="range" min={50} max={99} step={1} value={botMinConf}
                onChange={e => setBotMinConf(parseInt(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none bg-[#1a3a5c] accent-[#00d4ff]" />
              <div className="flex justify-between text-[9px] font-mono text-[#3d5a73] mt-1">
                <span>50% (mais ordens)</span><span>99% (muito selectivo)</span>
              </div>
            </div>

            {/* Par opcional */}
            <div>
              <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">
                Par específico <span className="text-[#1a3a5c]">(opcional · vazio = IA escolhe)</span>
              </label>
              <input type="text" value={botPair} onChange={e => setBotPair(e.target.value.toUpperCase())}
                placeholder="Ex: BTC/USDT  ·  (deixa vazio para IA escolher)"
                className="w-full bg-[#0c1f35] border border-[#1a3a5c] rounded-lg px-3 py-2.5 text-sm text-[#e8f4ff] font-mono focus:outline-none focus:border-[#00d4ff]/50 placeholder-[#3d5a73]"
              />
            </div>

            {/* Auto-repetir */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-[#0c1f35] border border-[#1a3a5c]">
              <div>
                <div className="text-xs font-bold">Repetir automaticamente</div>
                <div className="text-[10px] font-mono text-[#3d5a73]">Repete a cada 5 minutos até parares</div>
              </div>
              <button onClick={() => setAutoRepeat(!autoRepeat)}>
                {autoRepeat ? <ToggleRight size={24} className="text-[#00d4ff]" /> : <ToggleLeft size={24} className="text-[#3d5a73]" />}
              </button>
            </div>

            {/* Botão principal */}
            <div className="flex gap-3">
              <button onClick={runBot} disabled={!selectedKey || botRunning}
                className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-[#00d4ff]/20 to-[#00ff88]/15 text-[#00d4ff] border border-[#00d4ff]/40 text-sm font-bold font-mono hover:from-[#00d4ff]/30 hover:to-[#00ff88]/25 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                {botRunning
                  ? <><RefreshCw size={16} className="animate-spin" />A analisar...</>
                  : <><Sparkles size={16} />Executar Bot IA</>}
              </button>
              {(botRunning || autoRepeat) && (
                <button onClick={stopBot}
                  className="px-4 py-3.5 rounded-xl bg-[#ff4466]/10 text-[#ff4466] border border-[#ff4466]/30 font-bold font-mono hover:bg-[#ff4466]/20 transition-all flex items-center gap-2">
                  <Square size={14} /> Parar
                </button>
              )}
            </div>
          </div>

          {/* Result + Activity */}
          <div className="space-y-4">
            <div className="glass-card p-5">
              <BotResultCard status={botStatus} result={botResult} />
            </div>
            {/* Activity feed */}
            <ActivityFeed maxVisible={10} />
          </div>
        </div>
      )}

      {/* ── MANUAL ──────────────────────────────────────────────────────────── */}
      {section === 'manual' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="glass-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-[#ffcc00]" />
              <span className="text-sm font-bold">Ordem Manual</span>
              <span className="text-[10px] font-mono text-[#3d5a73]">Controlas tudo tu</span>
            </div>

            {!selectedKey && (
              <div className="p-3 rounded-xl bg-[#ff4466]/5 border border-[#ff4466]/20 text-xs font-mono text-[#ff4466]">
                ⚠ Conecta uma conta no separador <button onClick={() => setSection('keys')} className="underline">Contas</button>
              </div>
            )}

            <div className="flex gap-1 p-1 rounded-xl bg-[#0c1f35] border border-[#1a3a5c]">
              {(['spot','futures'] as TradeMode[]).map(m => (
                <button key={m} onClick={() => setExecMode(m)}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold font-mono transition-all flex items-center justify-center gap-1.5 ${
                    execMode===m
                      ? m==='futures' ? 'bg-[#ff9900]/20 text-[#ff9900] border border-[#ff9900]/30'
                      : 'bg-[#00ff88]/20 text-[#00ff88] border border-[#00ff88]/30'
                      : 'text-[#3d5a73]'
                  }`}>
                  {m==='spot' ? '💰 SPOT' : '⚡ FUTUROS'}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <InputField label="Par" value={execPair} onChange={setExecPair} placeholder="BTC/USDT" />
              <InputField label="Tamanho (USDT)" value={execSize} onChange={setExecSize} type="number" min={1} step={1} />
            </div>

            <div>
              <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">{execMode==='futures' ? 'Posição' : 'Direcção'}</label>
              <div className="grid grid-cols-2 gap-2">
                {(['Buy','Sell'] as const).map(s => (
                  <button key={s} onClick={() => setExecSide(s)}
                    className={`py-2.5 rounded-xl text-sm font-bold font-mono border transition-all flex items-center justify-center gap-2 ${
                      execSide===s
                        ? s==='Buy' ? 'bg-[#00ff88]/15 text-[#00ff88] border-[#00ff88]/40'
                        : 'bg-[#ff4466]/15 text-[#ff4466] border-[#ff4466]/40'
                        : 'text-[#3d5a73] border-[#1a3a5c]'
                    }`}>
                    {s==='Buy' ? <TrendingUp size={14}/> : <TrendingDown size={14}/>}
                    {s==='Buy' ? (execMode==='futures' ? 'ABRIR LONG' : 'COMPRAR') : (execMode==='futures' ? 'ABRIR SHORT' : 'VENDER')}
                  </button>
                ))}
              </div>
            </div>

            {execMode === 'futures' && (
              <div>
                <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">Alavancagem</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {LEVERAGE_PRESETS.map(lev => (
                    <button key={lev} onClick={() => setExecLev(lev)}
                      className={`py-1.5 rounded-lg text-xs font-bold font-mono border transition-all ${
                        execLev===lev ? 'bg-[#ff9900]/20 text-[#ff9900] border-[#ff9900]/40' : 'bg-[#0c1f35] text-[#3d5a73] border-[#1a3a5c]'
                      }`}>
                      {lev}×
                    </button>
                  ))}
                </div>
              </div>
            )}

            {execMode === 'futures' && (
              <div className="grid grid-cols-2 gap-3">
                <InputField label="Take Profit (opcional)" value={execTp} onChange={setExecTp} type="number" step={0.01} placeholder="0.00" />
                <InputField label="Stop Loss (opcional)" value={execSl} onChange={setExecSl} type="number" step={0.01} placeholder="0.00" />
              </div>
            )}

            <div className="p-3 rounded-xl bg-[#0c1f35] border border-[#1a3a5c] text-xs font-mono space-y-1.5">
              <div className="flex justify-between"><span className="text-[#3d5a73]">Par</span><span className="font-bold">{execPair}</span></div>
              <div className="flex justify-between"><span className="text-[#3d5a73]">{execMode==='futures' ? 'Posição' : 'Direcção'}</span>
                <span className={`font-bold ${execSide==='Buy' ? 'text-[#00ff88]' : 'text-[#ff4466]'}`}>
                  {execSide==='Buy' ? (execMode==='futures' ? '▲ LONG' : '▲ COMPRA') : (execMode==='futures' ? '▼ SHORT' : '▼ VENDA')}
                </span>
              </div>
              <div className="flex justify-between"><span className="text-[#3d5a73]">Tamanho</span><span>${execSize} USDT</span></div>
              {execMode==='futures' && <div className="flex justify-between"><span className="text-[#3d5a73]">Alavancagem</span><span className="text-[#ff9900]">{execLev}×</span></div>}
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <div onClick={() => setExecConfirm(!execConfirm)}
                className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${execConfirm ? 'bg-[#00ff88] border-[#00ff88]' : 'border-[#3d5a73]'}`}>
                {execConfirm && <span className="text-[#020b14] text-[10px] font-bold">✓</span>}
              </div>
              <span className="text-xs font-mono text-[#8ba3be]">Confirmo que quero executar esta ordem com dinheiro real</span>
            </label>

            <button onClick={executeManual} disabled={!selectedKey || !execConfirm || execLoading}
              className={`w-full py-3 rounded-xl text-sm font-bold font-mono border transition-all flex items-center justify-center gap-2 disabled:opacity-40 ${
                execSide==='Buy' ? 'bg-[#00ff88]/15 text-[#00ff88] border-[#00ff88]/40 hover:bg-[#00ff88]/25'
                : 'bg-[#ff4466]/15 text-[#ff4466] border-[#ff4466]/40 hover:bg-[#ff4466]/25'
              }`}>
              {execLoading ? <RefreshCw size={14} className="animate-spin"/> : <Play size={14}/>}
              {execSide==='Buy' ? (execMode==='futures' ? `ABRIR LONG ${execPair}` : `COMPRAR ${execPair}`) : (execMode==='futures' ? `ABRIR SHORT ${execPair}` : `VENDER ${execPair}`)}
            </button>
          </div>

          {/* Activity na coluna da direita */}
          <div className="space-y-4">
            <ActivityFeed maxVisible={12} />
          </div>
        </div>
      )}

      {/* ── CONTAS ──────────────────────────────────────────────────────────── */}
      {section === 'keys' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="glass-card p-5 space-y-4">
            <div className="flex items-center gap-2"><Key size={16} className="text-[#00d4ff]"/><span className="text-sm font-bold">Conectar Exchange</span></div>

            <div className="grid grid-cols-2 gap-2">
              {EXCHANGES.map(ex => (
                <button key={ex.id} onClick={() => setSelEx(ex.id)}
                  className={`p-3 rounded-xl border text-left transition-all ${selEx===ex.id ? 'border-[#00d4ff]/40 bg-[#00d4ff]/5' : 'border-[#1a3a5c]'}`}>
                  <div className="text-base">{ex.logo}</div>
                  <div className={`text-sm font-bold mt-0.5 ${selEx===ex.id ? 'text-[#00d4ff]' : 'text-[#e8f4ff]'}`}>{ex.name}</div>
                  <div className="text-[10px] font-mono text-[#3d5a73]">{ex.testnetSupported ? 'Testnet ✓' : 'Apenas Mainnet'}</div>
                </button>
              ))}
            </div>

            <div className="flex items-start gap-2 p-3 rounded-lg bg-[#ffcc00]/5 border border-[#ffcc00]/20">
              <Info size={13} className="text-[#ffcc00] flex-shrink-0 mt-0.5"/>
              <div className="text-xs text-[#ffcc00]/80 font-mono leading-relaxed">
                Cria a key com permissão <strong>Trade</strong>. Nunca actives Withdraw.{' '}
                <a href={EXCHANGES.find(e=>e.id===selEx)?.url} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">
                  Definições API <ExternalLink size={10}/>
                </a>
              </div>
            </div>

            <InputField label="API Key" value={apiKey} onChange={setApiKey} placeholder="Cola a tua API key..." />
            <InputField label="API Secret" value={apiSec} onChange={setApiSec} placeholder="••••••••••••" type="password" />
            <InputField label="Etiqueta" value={keyLabel} onChange={setKeyLabel} placeholder="Conta Principal" />

            {EXCHANGES.find(e=>e.id===selEx)?.testnetSupported && (
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-[#3d5a73]">Testnet (simulação)</span>
                <button onClick={() => setTestnet(!testnet)} className="flex items-center gap-1.5">
                  {testnet ? <ToggleRight size={20} className="text-[#00d4ff]"/> : <ToggleLeft size={20} className="text-[#3d5a73]"/>}
                  <span className={`text-xs font-mono ${testnet ? 'text-[#00d4ff]' : 'text-[#3d5a73]'}`}>{testnet ? 'LIGADO' : 'DESLIGADO'}</span>
                </button>
              </div>
            )}

            <button onClick={connectKey} disabled={connecting || !apiKey || !apiSec}
              className="w-full py-2.5 rounded-xl bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/30 text-sm font-bold font-mono hover:bg-[#00d4ff]/25 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
              {connecting ? <RefreshCw size={14} className="animate-spin"/> : <Key size={14}/>}
              Conectar {EXCHANGES.find(e=>e.id===selEx)?.logo} {EXCHANGES.find(e=>e.id===selEx)?.name}
            </button>
          </div>

          <div className="space-y-4">
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2"><Shield size={16} className="text-[#00ff88]"/><span className="text-sm font-bold">Contas Conectadas</span></div>
                <button onClick={loadKeys} className="w-7 h-7 rounded-lg bg-[#0c1f35] border border-[#1a3a5c] flex items-center justify-center text-[#8ba3be] hover:text-[#00d4ff]"><RefreshCw size={12}/></button>
              </div>
              {keys.length === 0 ? (
                <div className="text-center py-8"><Key size={32} className="text-[#1a3a5c] mx-auto mb-2"/><div className="text-xs font-mono text-[#3d5a73]">Nenhuma conta conectada</div></div>
              ) : (
                <div className="space-y-2">
                  {keys.map(k => (
                    <div key={k.id} onClick={() => { setSelectedKey(k.id); logAction(`Conta seleccionada: ${k.label}`) }}
                      className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${selectedKey===k.id ? 'border-[#00d4ff]/40 bg-[#00d4ff]/5' : 'border-[#1a3a5c] hover:border-[#00d4ff]/20'}`}>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold">{k.label}</span>
                          <ExchangeBadge exchange={k.exchange}/>
                          {k.testnet && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#ffcc00]/10 text-[#ffcc00] border border-[#ffcc00]/30">TESTNET</span>}
                          {selectedKey===k.id && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/30">ATIVA</span>}
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
                  <Wallet size={14} className="text-[#00d4ff]"/><span className="text-sm font-bold">Saldo detalhado</span>
                  <button onClick={() => selectedKey && loadBalance(selectedKey)} className="ml-auto w-6 h-6 rounded bg-[#0c1f35] border border-[#1a3a5c] flex items-center justify-center text-[#8ba3be] hover:text-[#00d4ff]">
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

            {/* Activity feed no separador de contas */}
            <ActivityFeed maxVisible={6} collapsed />
          </div>
        </div>
      )}

      {/* ── HISTÓRICO ───────────────────────────────────────────────────────── */}
      {section === 'history' && (
        <div className="space-y-4">
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <span className="text-sm font-bold">Histórico de Ordens</span>
              <button onClick={loadTrades} className="w-7 h-7 rounded-lg bg-[#0c1f35] border border-[#1a3a5c] flex items-center justify-center text-[#8ba3be] hover:text-[#00d4ff]"><RefreshCw size={12}/></button>
            </div>
            {trades.length === 0 ? (
              <div className="text-center py-12"><BarChart2 size={40} className="text-[#1a3a5c] mx-auto mb-3"/><div className="text-sm font-bold text-[#3d5a73]">Sem ordens ainda</div></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-[#3d5a73] border-b border-[#1a3a5c]">
                      <th className="text-left py-2 pr-3">Exchange</th>
                      <th className="text-left py-2 pr-3">Par</th>
                      <th className="text-left py-2 pr-3">Posição</th>
                      <th className="text-left py-2 pr-3">Modo</th>
                      <th className="text-right py-2 pr-3">Preço</th>
                      <th className="text-right py-2 pr-3">TP</th>
                      <th className="text-right py-2 pr-3">SL</th>
                      <th className="text-center py-2 pr-3">Estado</th>
                      <th className="text-center py-2 pr-3">Origem</th>
                      <th className="text-right py-2">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map(t => (
                      <tr key={t.id} className="border-b border-[#1a3a5c]/30 hover:bg-[#0c1f35]/50">
                        <td className="py-2.5 pr-3"><ExchangeBadge exchange={t.exchange||'bybit'}/></td>
                        <td className="py-2.5 pr-3 font-bold text-[#e8f4ff]">{t.pair}</td>
                        <td className="py-2.5 pr-3">
                          <span className={`font-bold ${t.side==='Buy' ? 'text-[#00ff88]' : 'text-[#ff4466]'}`}>
                            {t.side==='Buy' ? (t.trade_mode==='futures' ? '▲ LONG' : '▲ COMPRA') : (t.trade_mode==='futures' ? '▼ SHORT' : '▼ VENDA')}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className={`text-[10px] font-bold ${t.trade_mode==='futures' ? 'text-[#ff9900]' : 'text-[#00ff88]'}`}>
                            {t.trade_mode==='futures' ? '⚡ FUTUROS' : '💰 SPOT'}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-right text-[#e8f4ff]">${t.price?.toFixed(4)}</td>
                        <td className="py-2.5 pr-3 text-right text-[#00ff88]">{t.take_profit>0 ? `$${t.take_profit.toFixed(4)}` : '—'}</td>
                        <td className="py-2.5 pr-3 text-right text-[#ff4466]">{t.stop_loss>0 ? `$${t.stop_loss.toFixed(4)}` : '—'}</td>
                        <td className="py-2.5 pr-3 text-center"><StatusBadge status={t.status}/></td>
                        <td className="py-2.5 pr-3 text-center">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${t.triggered_by==='ai_auto' ? 'text-[#00d4ff] bg-[#00d4ff]/10 border-[#00d4ff]/30' : 'text-[#3d5a73] border-[#1a3a5c]'}`}>
                            {t.triggered_by==='ai_auto' ? '🤖 AUTO' : '👆 MANUAL'}
                          </span>
                        </td>
                        <td className="py-2.5 text-right text-[#3d5a73]">
                          {t.created_at ? new Date(t.created_at).toLocaleString('pt-PT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—'}
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
