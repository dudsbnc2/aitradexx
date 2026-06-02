'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bot, Key, Wallet, AlertTriangle, Play, Square, Trash2, RefreshCw,
  ChevronDown, CheckCircle, Shield, Zap, TrendingUp, TrendingDown,
  Settings, ToggleLeft, ToggleRight, ExternalLink, Info, BarChart2,
  Sparkles, Activity, Clock, Target, Search, Radio,
} from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_URL || ''

// ── Types ──────────────────────────────────────────────────────────────────────
type TradeMode  = 'spot' | 'futures'
type RiskProfile = 'conservative' | 'balanced' | 'aggressive'
type BotStatus  = 'idle' | 'scanning' | 'found' | 'executing' | 'done' | 'error'

interface ExchangeKey {
  id: number; exchange: string; label: string; testnet: boolean; api_key_preview: string
}
interface TradeLog {
  id: number; pair: string; side: string; trade_mode: TradeMode; exchange: string
  qty: number; price: number; take_profit: number; stop_loss: number; leverage: number
  status: string; order_id: string; error_msg: string; created_at: string; triggered_by: string
}
interface BalanceCoin { coin: string; balance: string; available: string; usd_value: string }
interface AIRunResult {
  executed: boolean; reason?: string; pair?: string; bias?: string; side?: string
  confidence?: number; timeframe?: string; trade_mode?: string; price?: number
  qty?: number; take_profit?: number; stop_loss?: number; leverage?: number
  risk_profile?: string; order_id?: string; signal?: { analysis?: string; entry?: number }
  scanned?: number
}

// ── Constants ──────────────────────────────────────────────────────────────────
const SPOT_TIMEFRAMES    = ['1m','5m','15m','30m','1H','4H','1D']
const FUTURES_TIMEFRAMES = ['1m','3m','5m','15m','30m','1H','2H','4H','6H','12H','1D']
const LEVERAGE_PRESETS   = [1, 2, 3, 5, 10, 20, 25, 50, 75, 100, 125]

const RISK_PROFILES: { id: RiskProfile; label: string; desc: string; color: string; tp: string; sl: string }[] = [
  { id: 'conservative', label: 'Conservador', desc: 'TP ×0.8 · SL ×0.5',  color: '#00ff88', tp: '0.8×', sl: '0.5×' },
  { id: 'balanced',     label: 'Balanceado',  desc: 'TP ×1.5 · SL ×1.0',  color: '#00d4ff', tp: '1.5×', sl: '1.0×' },
  { id: 'aggressive',   label: 'Agressivo',   desc: 'TP ×3.0 · SL ×1.5',  color: '#ff9900', tp: '3.0×', sl: '1.5×' },
]

const EXCHANGES = [
  { id: 'bybit', name: 'Bybit', logo: '🟡', url: 'https://www.bybit.com/app/user/api-management', testnetSupported: true },
  { id: 'mexc',  name: 'MEXC',  logo: '🔵', url: 'https://www.mexc.com/user/openapi', testnetSupported: false },
]

// ── Auth-aware fetch com renovação automática de token ────────────────────────
async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> || {}),
  }
  const res = await fetch(url, { ...options, headers })
  if (res.status === 401) {
    try {
      const refresh = await fetch(`${API}/api/v1/auth/refresh-cookie`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      })
      if (refresh.ok) {
        const d = await refresh.json()
        if (d.access_token) {
          localStorage.setItem('access_token', d.access_token)
          return fetch(url, { ...options, headers: { ...headers, 'Authorization': `Bearer ${d.access_token}` } })
        }
      }
    } catch {}
  }
  return res
}

// ── Small helpers ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    filled:    'text-[#00ff88] bg-[#00ff88]/10 border-[#00ff88]/30',
    pending:   'text-[#ffcc00] bg-[#ffcc00]/10 border-[#ffcc00]/30',
    failed:    'text-[#ff4466] bg-[#ff4466]/10 border-[#ff4466]/30',
    cancelled: 'text-[#8ba3be] bg-[#1a3a5c]/50 border-[#1a3a5c]',
  }
  const labels: Record<string, string> = {
    filled: 'EXECUTADA', pending: 'PENDENTE', failed: 'FALHOU', cancelled: 'CANCELADA'
  }
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono border ${map[status] || map.pending}`}>
      {labels[status] || status.toUpperCase()}
    </span>
  )
}

function ExchangeBadge({ exchange }: { exchange: string }) {
  const ex = EXCHANGES.find(e => e.id === exchange)
  return (
    <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono border border-[#1a3a5c] text-[#8ba3be]">
      {ex?.logo} {ex?.name || exchange.toUpperCase()}
    </span>
  )
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div>
      {label && <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">{label}</label>}
      <div className="relative">
        <select value={value} onChange={e => onChange(e.target.value)}
          className="w-full appearance-none bg-[#0c1f35] border border-[#1a3a5c] rounded-lg px-3 py-2.5 text-sm text-[#e8f4ff] font-mono focus:outline-none focus:border-[#00d4ff]/50 pr-8">
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#3d5a73] pointer-events-none" />
      </div>
    </div>
  )
}

function InputField({ label, value, onChange, type = 'text', min, max, step, placeholder }: any) {
  return (
    <div>
      <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">{label}</label>
      <input type={type} value={value}
        onChange={e => onChange(type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
        min={min} max={max} step={step} placeholder={placeholder}
        className="w-full bg-[#0c1f35] border border-[#1a3a5c] rounded-lg px-3 py-2.5 text-sm text-[#e8f4ff] font-mono focus:outline-none focus:border-[#00d4ff]/50 placeholder-[#3d5a73]"
      />
    </div>
  )
}

// ── Bot Status Card ────────────────────────────────────────────────────────────
function BotStatusCard({ status, result, log }: { status: BotStatus; result: AIRunResult | null; log: string[] }) {
  const statusConfig: Record<BotStatus, { color: string; label: string; icon: React.ReactNode }> = {
    idle:      { color: '#3d5a73', label: 'À Espera',    icon: <Clock size={16} /> },
    scanning:  { color: '#00d4ff', label: 'A Varrer...',  icon: <Search size={16} className="animate-pulse" /> },
    found:     { color: '#ffcc00', label: 'Sinal!',       icon: <Target size={16} /> },
    executing: { color: '#ff9900', label: 'A Executar',   icon: <Radio size={16} className="animate-pulse" /> },
    done:      { color: '#00ff88', label: 'Executado ✓',  icon: <CheckCircle size={16} /> },
    error:     { color: '#ff4466', label: 'Erro',         icon: <AlertTriangle size={16} /> },
  }
  const { color, label, icon } = statusConfig[status]

  return (
    <div className="glass-card p-5 space-y-4">
      {/* Status header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2" style={{ color }}>
          {icon}
          <span className="text-sm font-bold font-mono">{label}</span>
          {(status === 'scanning' || status === 'executing') && (
            <div className="flex gap-1">
              {[0,1,2].map(i => (
                <motion.div key={i} className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: color }}
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }} />
              ))}
            </div>
          )}
        </div>
        {status !== 'idle' && (
          <span className="text-[10px] font-mono text-[#3d5a73] px-2 py-0.5 rounded bg-[#0c1f35] border border-[#1a3a5c]">
            {new Date().toLocaleTimeString('pt-PT')}
          </span>
        )}
      </div>

      {/* Resultado da execução IA */}
      {result && status === 'done' && result.executed && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-xl bg-[#00ff88]/5 border border-[#00ff88]/20 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-[#00ff88]" />
            <span className="text-sm font-bold text-[#00ff88]">Ordem Executada pela IA</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs font-mono">
            <div>
              <div className="text-[#3d5a73] mb-0.5">Par</div>
              <div className="font-bold text-[#e8f4ff] text-sm">{result.pair}</div>
            </div>
            <div>
              <div className="text-[#3d5a73] mb-0.5">Posição</div>
              <div className={`font-bold text-sm ${result.bias === 'LONG' ? 'text-[#00ff88]' : 'text-[#ff4466]'}`}>
                {result.bias === 'LONG' ? '▲ LONG' : '▼ SHORT'}
              </div>
            </div>
            <div>
              <div className="text-[#3d5a73] mb-0.5">Confiança IA</div>
              <div className="font-bold text-[#00d4ff]">{result.confidence}%</div>
            </div>
            <div>
              <div className="text-[#3d5a73] mb-0.5">Timeframe</div>
              <div className="font-bold text-[#e8f4ff]">{result.timeframe}</div>
            </div>
            <div>
              <div className="text-[#3d5a73] mb-0.5">Preço Entrada</div>
              <div className="font-bold text-[#e8f4ff]">${result.price?.toFixed(4)}</div>
            </div>
            <div>
              <div className="text-[#3d5a73] mb-0.5">Quantidade</div>
              <div className="font-bold text-[#e8f4ff]">{result.qty?.toFixed(5)}</div>
            </div>
            {result.take_profit && (
              <div>
                <div className="text-[#3d5a73] mb-0.5">Take Profit</div>
                <div className="font-bold text-[#00ff88]">${result.take_profit.toFixed(4)}</div>
              </div>
            )}
            {result.stop_loss && (
              <div>
                <div className="text-[#3d5a73] mb-0.5">Stop Loss</div>
                <div className="font-bold text-[#ff4466]">${result.stop_loss.toFixed(4)}</div>
              </div>
            )}
            {result.leverage && result.leverage > 1 && (
              <div>
                <div className="text-[#3d5a73] mb-0.5">Alavancagem</div>
                <div className="font-bold text-[#ff9900]">{result.leverage}×</div>
              </div>
            )}
            <div className="col-span-2">
              <div className="text-[#3d5a73] mb-0.5">Order ID</div>
              <div className="font-bold text-[#8ba3be] text-[10px] break-all">{result.order_id}</div>
            </div>
          </div>
          {result.signal?.analysis && (
            <div className="p-2.5 rounded-lg bg-[#0c1f35] border border-[#1a3a5c] text-[11px] font-mono text-[#8ba3be] leading-relaxed line-clamp-3">
              {result.signal.analysis}
            </div>
          )}
        </motion.div>
      )}

      {/* Sem sinal / não executado */}
      {result && !result.executed && (status === 'done' || status === 'error') && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-xl bg-[#ffcc00]/5 border border-[#ffcc00]/20">
          <div className="flex items-start gap-2">
            <Info size={13} className="text-[#ffcc00] flex-shrink-0 mt-0.5" />
            <div className="text-xs font-mono text-[#ffcc00]/80 leading-relaxed">{result.reason}</div>
          </div>
          {result.scanned && (
            <div className="text-[10px] font-mono text-[#3d5a73] mt-2">{result.scanned} pares analisados</div>
          )}
        </motion.div>
      )}

      {/* Log de actividade */}
      {log.length > 0 && (
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {log.map((line, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[10px] font-mono text-[#3d5a73]">
              <span className="text-[#1a3a5c] flex-shrink-0">›</span>
              <span>{line}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function AutoTraderTab({ user }: { user: any }) {
  const [activeSection, setActiveSection] = useState<'bot' | 'manual' | 'keys' | 'history'>('bot')

  // Keys
  const [keys, setKeys] = useState<ExchangeKey[]>([])
  const [selectedKey, setSelectedKey] = useState<number | null>(null)
  const [balance, setBalance] = useState<BalanceCoin[] | null>(null)

  // Connect form
  const [selectedExchange, setSelectedExchange] = useState('bybit')
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [keyLabel, setKeyLabel] = useState('Conta Principal')
  const [testnet, setTestnet] = useState(false)

  // Bot config
  const [botMode, setBotMode] = useState<TradeMode>('spot')
  const [botTf, setBotTf] = useState('1H')
  const [botSize, setBotSize] = useState(10)
  const [botLeverage, setBotLeverage] = useState(10)
  const [botRisk, setBotRisk] = useState<RiskProfile>('balanced')
  const [botMinConf, setBotMinConf] = useState(70)
  const [botPair, setBotPair] = useState('')  // vazio = IA escolhe

  // Bot state
  const [botStatus, setBotStatus] = useState<BotStatus>('idle')
  const [botLog, setBotLog] = useState<string[]>([])
  const [botResult, setBotResult] = useState<AIRunResult | null>(null)
  const [autoRepeat, setAutoRepeat] = useState(false)
  const autoRepeatRef = useRef(autoRepeat)
  useEffect(() => { autoRepeatRef.current = autoRepeat }, [autoRepeat])
  const repeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Manual order
  const [execMode, setExecMode] = useState<TradeMode>('spot')
  const [execPair, setExecPair] = useState('BTC/USDT')
  const [execSide, setExecSide] = useState<'Buy' | 'Sell'>('Buy')
  const [execSize, setExecSize] = useState(10)
  const [execLev, setExecLev] = useState(10)
  const [execTp, setExecTp] = useState<string>('')
  const [execSl, setExecSl] = useState<string>('')
  const [execConfirm, setExecConfirm] = useState(false)
  const [execLoading, setExecLoading] = useState(false)

  // History
  const [trades, setTrades] = useState<TradeLog[]>([])

  // Global msg
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [connecting, setConnecting] = useState(false)

  const showMsg = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text }); setTimeout(() => setMsg(null), 5000)
  }

  const addLog = (text: string) => {
    const ts = new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setBotLog(prev => [`[${ts}] ${text}`, ...prev].slice(0, 20))
  }

  const loadKeys = useCallback(async () => {
    try {
      const r = await authFetch(`${API}/api/autotrader/keys`)
      if (r.ok) { const d = await r.json(); setKeys(d); if (d.length > 0 && !selectedKey) setSelectedKey(d[0].id) }
    } catch {}
  }, [selectedKey])

  const loadTrades = useCallback(async () => {
    try { const r = await authFetch(`${API}/api/autotrader/trades`); if (r.ok) setTrades(await r.json()) } catch {}
  }, [])

  const loadBalance = useCallback(async (id: number) => {
    try { const r = await authFetch(`${API}/api/autotrader/balance/${id}`); if (r.ok) setBalance((await r.json()).coins) } catch {}
  }, [])

  useEffect(() => { loadKeys(); loadTrades() }, [])
  useEffect(() => { if (selectedKey) loadBalance(selectedKey) }, [selectedKey])

  // Cleanup timer on unmount
  useEffect(() => () => { if (repeatTimer.current) clearTimeout(repeatTimer.current) }, [])

  // ── Conectar exchange ──────────────────────────────────────────────────────
  async function connectKey() {
    if (!apiKey || !apiSecret) return showMsg('err', 'Preenche a API Key e Secret')
    setConnecting(true)
    try {
      const r = await authFetch(`${API}/api/autotrader/connect`, {
        method: 'POST',
        body: JSON.stringify({ exchange: selectedExchange, api_key: apiKey, api_secret: apiSecret, label: keyLabel, testnet }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || 'Erro ao conectar')
      showMsg('ok', `✓ ${EXCHANGES.find(e=>e.id===selectedExchange)?.name} "${keyLabel}" conectada!`)
      setApiKey(''); setApiSecret('')
      await loadKeys()
    } catch (e: any) { showMsg('err', e.message) }
    finally { setConnecting(false) }
  }

  // ── Botão principal: Executar IA ───────────────────────────────────────────
  async function runBot() {
    if (!selectedKey) return showMsg('err', 'Seleciona uma conta nas Contas')
    if (botStatus === 'scanning' || botStatus === 'executing') return

    setBotResult(null)
    setBotStatus('scanning')
    const pairLabel = botPair || 'todos os pares'
    addLog(`Início de análise — ${pairLabel} · ${botTf} · ${botMode}`)
    addLog(`Confiança mínima: ${botMinConf}% · Perfil: ${botRisk}`)

    try {
      addLog('A varrer mercado com IA...')
      const body: any = {
        exchange_key_id: selectedKey,
        trade_mode:      botMode,
        timeframe:       botTf,
        order_size_usdt: botSize,
        leverage:        botMode === 'spot' ? 1 : botLeverage,
        risk_profile:    botRisk,
        min_confidence:  botMinConf,
      }
      if (botPair) body.pair = botPair

      const r = await authFetch(`${API}/api/autotrader/ai-run`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const d: AIRunResult = await r.json()
      if (!r.ok) throw new Error((d as any).detail || JSON.stringify(d))

      if (d.executed) {
        setBotStatus('done')
        setBotResult(d)
        addLog(`✓ Sinal encontrado: ${d.pair} ${d.bias} (${d.confidence}%)`)
        addLog(`✓ Ordem executada: ${d.order_id}`)
        await loadTrades()
        if (selectedKey) await loadBalance(selectedKey)
      } else {
        setBotStatus('done')
        setBotResult(d)
        addLog(`⚠ ${d.reason || 'Sem sinal adequado'}`)
      }

    } catch (e: any) {
      setBotStatus('error')
      setBotResult({ executed: false, reason: e.message })
      addLog(`✗ Erro: ${e.message}`)
    }

    // Auto-repetição
    if (autoRepeatRef.current) {
      addLog('Próxima análise em 5 minutos...')
      repeatTimer.current = setTimeout(() => {
        if (autoRepeatRef.current) runBot()
      }, 5 * 60 * 1000)
    }
  }

  function stopBot() {
    if (repeatTimer.current) clearTimeout(repeatTimer.current)
    setAutoRepeat(false)
    setBotStatus('idle')
    addLog('Bot parado.')
  }

  // ── Ordem Manual ───────────────────────────────────────────────────────────
  async function executeManual() {
    if (!selectedKey) return showMsg('err', 'Seleciona uma conta')
    if (!execConfirm) return showMsg('err', 'Confirma a ordem primeiro')
    setExecLoading(true); setExecConfirm(false)
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
      if (execMode === 'futures' && execSl) body.stop_loss  = parseFloat(execSl)

      const r = await authFetch(`${API}/api/autotrader/execute`, {
        method: 'POST', body: JSON.stringify(body),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.detail || JSON.stringify(d))
      const label = execMode === 'futures'
        ? (execSide === 'Buy' ? 'LONG' : 'SHORT')
        : (execSide === 'Buy' ? 'COMPRA' : 'VENDA')
      showMsg('ok', `✓ ${label} ${execPair} executado · ID: ${d.order_id}`)
      await loadTrades()
      if (selectedKey) await loadBalance(selectedKey)
    } catch (e: any) { showMsg('err', e.message) }
    finally { setExecLoading(false) }
  }

  if (!user) return (
    <div className="glass-card p-12 text-center mt-4">
      <Bot size={48} className="text-[#1a3a5c] mx-auto mb-4" />
      <div className="text-lg font-bold text-[#3d5a73] mb-2">Login necessário</div>
      <div className="text-sm text-[#3d5a73] font-mono">Faz login para aceder ao Auto Trade</div>
    </div>
  )

  const selectedKeyObj = keys.find(k => k.id === selectedKey)
  const currentExInfo  = EXCHANGES.find(e => e.id === selectedExchange)!
  const botTimeframes  = botMode === 'futures' ? FUTURES_TIMEFRAMES : SPOT_TIMEFRAMES
  const execTimeframes = execMode === 'futures' ? FUTURES_TIMEFRAMES : SPOT_TIMEFRAMES

  const botRunning = botStatus === 'scanning' || botStatus === 'executing'

  return (
    <div className="space-y-5 mt-1">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Bot size={20} className="text-[#00d4ff]" />
            Auto Trade
            <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-[#ffcc00]/10 text-[#ffcc00] border border-[#ffcc00]/30">BETA</span>
          </h1>
          <div className="text-xs font-mono text-[#3d5a73] mt-0.5">
            A IA analisa · escolhe · executa autonomamente
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {([
            { id: 'bot',     label: '🤖 Bot IA' },
            { id: 'manual',  label: '⚡ Manual' },
            { id: 'keys',    label: '🔑 Contas' },
            { id: 'history', label: '📋 Histórico' },
          ] as const).map(s => (
            <button key={s.id} onClick={() => setActiveSection(s.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-all border ${activeSection === s.id ? 'bg-[#00d4ff]/10 text-[#00d4ff] border-[#00d4ff]/20' : 'text-[#8ba3be] border-[#1a3a5c] hover:border-[#00d4ff]/20'}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {msg && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-mono ${msg.type === 'ok' ? 'bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/30' : 'bg-[#ff4466]/10 text-[#ff4466] border-[#ff4466]/30'}`}>
            {msg.type === 'ok' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
            {msg.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── BOT IA ──────────────────────────────────────────────────────────── */}
      {activeSection === 'bot' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Config do bot */}
          <div className="glass-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-[#00d4ff]" />
              <span className="text-sm font-bold">Configurar Bot IA</span>
              {selectedKeyObj && <ExchangeBadge exchange={selectedKeyObj.exchange} />}
            </div>

            {!selectedKey && (
              <div className="p-3 rounded-xl bg-[#ff4466]/5 border border-[#ff4466]/20 text-xs font-mono text-[#ff4466]">
                ⚠ Vai a <button onClick={() => setActiveSection('keys')} className="underline">Contas</button> e conecta uma exchange primeiro
              </div>
            )}

            {/* Explicação simples */}
            <div className="p-3 rounded-xl bg-[#00d4ff]/5 border border-[#00d4ff]/20 text-xs font-mono text-[#8ba3be] leading-relaxed">
              Carrega em <span className="text-[#00d4ff] font-bold">Executar</span> e a IA
              varre todos os pares, identifica o melhor sinal no timeframe escolhido,
              calcula TP/SL automático e executa a ordem sozinha na exchange.
            </div>

            {/* Modo Spot / Futuros */}
            <div>
              <label className="block text-xs font-mono text-[#3d5a73] mb-2">Modo</label>
              <div className="flex gap-1 p-1 rounded-xl bg-[#0c1f35] border border-[#1a3a5c]">
                {(['spot', 'futures'] as TradeMode[]).map(m => (
                  <button key={m} onClick={() => { setBotMode(m); setBotTf(m === 'futures' ? '1H' : '1H') }}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold font-mono transition-all flex items-center justify-center gap-1.5 ${
                      botMode === m
                        ? m === 'futures' ? 'bg-[#ff9900]/20 text-[#ff9900] border border-[#ff9900]/30'
                        : 'bg-[#00ff88]/20 text-[#00ff88] border border-[#00ff88]/30'
                        : 'text-[#3d5a73] hover:text-[#8ba3be]'
                    }`}>
                    {m === 'spot' ? '💰 SPOT' : '⚡ FUTUROS'}
                  </button>
                ))}
              </div>
            </div>

            {/* Timeframe */}
            <SelectField label="Timeframe (a IA analisa neste período)" value={botTf} onChange={setBotTf}
              options={botTimeframes.map(t => ({ value: t, label: t }))} />

            {/* Tamanho */}
            <InputField label="Tamanho da ordem (USDT)" value={botSize} onChange={setBotSize}
              type="number" min={1} step={1} />

            {/* Alavancagem (só futuros) */}
            {botMode === 'futures' && (
              <div>
                <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">Alavancagem</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {LEVERAGE_PRESETS.map(lev => (
                    <button key={lev} onClick={() => setBotLeverage(lev)}
                      className={`py-1.5 rounded-lg text-xs font-bold font-mono border transition-all ${
                        botLeverage === lev
                          ? 'bg-[#ff9900]/20 text-[#ff9900] border-[#ff9900]/40'
                          : 'bg-[#0c1f35] text-[#3d5a73] border-[#1a3a5c] hover:border-[#ff9900]/30 hover:text-[#ff9900]/70'
                      }`}>
                      {lev}×
                    </button>
                  ))}
                </div>
                <div className="text-xs font-mono text-[#ff9900] mt-1 text-center">{botLeverage}× selecionado</div>
              </div>
            )}

            {/* Perfil de Risco */}
            <div>
              <label className="block text-xs font-mono text-[#3d5a73] mb-2">Perfil de Risco (TP/SL automático)</label>
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

            {/* Confiança mínima */}
            <div>
              <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">Confiança mínima para executar: <span className="text-[#00d4ff]">{botMinConf}%</span></label>
              <input type="range" min={50} max={99} step={1} value={botMinConf}
                onChange={e => setBotMinConf(parseInt(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none bg-[#1a3a5c] accent-[#00d4ff]" />
              <div className="flex justify-between text-[10px] font-mono text-[#3d5a73] mt-1">
                <span>50% (mais ordens)</span><span>99% (muito selectivo)</span>
              </div>
            </div>

            {/* Par fixo opcional */}
            <div>
              <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">
                Par específico <span className="text-[#1a3a5c]">(opcional — vazio = IA escolhe)</span>
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
                <div className="text-[10px] font-mono text-[#3d5a73]">Repete a cada 5 minutos até parar</div>
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
                  ? <><RefreshCw size={16} className="animate-spin" /> A analisar...</>
                  : <><Sparkles size={16} /> Executar Bot IA</>
                }
              </button>
              {(botRunning || autoRepeat) && (
                <button onClick={stopBot}
                  className="px-4 py-3.5 rounded-xl bg-[#ff4466]/10 text-[#ff4466] border border-[#ff4466]/30 font-bold font-mono hover:bg-[#ff4466]/20 transition-all flex items-center gap-2">
                  <Square size={14} /> Parar
                </button>
              )}
            </div>
          </div>

          {/* Status do bot */}
          <div className="space-y-4">
            <BotStatusCard status={botStatus} result={botResult} log={botLog} />

            {/* Saldo */}
            {selectedKey && balance && balance.length > 0 && (
              <div className="glass-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Wallet size={14} className="text-[#00d4ff]" />
                    <span className="text-xs font-bold">Saldo</span>
                    {selectedKeyObj && <ExchangeBadge exchange={selectedKeyObj.exchange} />}
                  </div>
                  <button onClick={() => loadBalance(selectedKey!)} className="w-6 h-6 rounded bg-[#0c1f35] border border-[#1a3a5c] flex items-center justify-center text-[#8ba3be] hover:text-[#00d4ff]">
                    <RefreshCw size={10} />
                  </button>
                </div>
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {balance.slice(0, 8).map(c => (
                    <div key={c.coin} className="flex justify-between text-xs font-mono py-1 border-b border-[#1a3a5c]/40 last:border-0">
                      <span className="font-bold text-[#e8f4ff]">{c.coin}</span>
                      <div className="text-right">
                        <span className="text-[#e8f4ff]">{parseFloat(c.balance).toFixed(4)}</span>
                        {parseFloat(c.usd_value || '0') > 0 && (
                          <span className="text-[#3d5a73] ml-2">${parseFloat(c.usd_value).toFixed(2)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Últimas ordens (mini) */}
            {trades.filter(t => t.triggered_by === 'ai_auto').slice(0, 3).length > 0 && (
              <div className="glass-card p-4">
                <div className="text-xs font-bold mb-3 flex items-center gap-2">
                  <Activity size={13} className="text-[#00d4ff]" />
                  Últimas ordens do Bot
                </div>
                <div className="space-y-2">
                  {trades.filter(t => t.triggered_by === 'ai_auto').slice(0, 3).map(t => (
                    <div key={t.id} className="flex items-center justify-between text-xs font-mono py-1.5 border-b border-[#1a3a5c]/40 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-bold ${t.side === 'Buy' ? 'text-[#00ff88]' : 'text-[#ff4466]'}`}>
                          {t.side === 'Buy' ? '▲' : '▼'} {t.pair}
                        </span>
                        <span className="text-[#3d5a73] text-[10px]">{t.trade_mode?.toUpperCase()}</span>
                      </div>
                      <StatusBadge status={t.status} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MANUAL ──────────────────────────────────────────────────────────── */}
      {activeSection === 'manual' && (
        <div className="glass-card p-5 space-y-4 max-w-lg">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-[#ffcc00]" />
            <span className="text-sm font-bold">Ordem Manual</span>
            <span className="text-[10px] font-mono text-[#3d5a73]">Para quando queres controlar tudo</span>
          </div>

          {!selectedKey && (
            <div className="p-3 rounded-xl bg-[#ff4466]/5 border border-[#ff4466]/20 text-xs font-mono text-[#ff4466]">
              ⚠ Conecta uma conta no separador <button onClick={() => setActiveSection('keys')} className="underline">Contas</button>
            </div>
          )}

          {/* Spot / Futuros */}
          <div className="flex gap-1 p-1 rounded-xl bg-[#0c1f35] border border-[#1a3a5c]">
            {(['spot', 'futures'] as TradeMode[]).map(m => (
              <button key={m} onClick={() => setExecMode(m)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold font-mono transition-all flex items-center justify-center gap-1.5 ${
                  execMode === m
                    ? m === 'futures' ? 'bg-[#ff9900]/20 text-[#ff9900] border border-[#ff9900]/30'
                    : 'bg-[#00ff88]/20 text-[#00ff88] border border-[#00ff88]/30'
                    : 'text-[#3d5a73]'
                }`}>
                {m === 'spot' ? '💰 SPOT' : '⚡ FUTUROS'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <InputField label="Par" value={execPair} onChange={setExecPair} placeholder="BTC/USDT" />
            <InputField label="Tamanho (USDT)" value={execSize} onChange={setExecSize} type="number" min={1} step={1} />
          </div>

          {/* Direcção */}
          <div>
            <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">
              {execMode === 'futures' ? 'Posição' : 'Direcção'}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['Buy', 'Sell'] as const).map(s => (
                <button key={s} onClick={() => setExecSide(s)}
                  className={`py-2.5 rounded-xl text-sm font-bold font-mono border transition-all flex items-center justify-center gap-2 ${
                    execSide === s
                      ? s === 'Buy' ? 'bg-[#00ff88]/15 text-[#00ff88] border-[#00ff88]/40'
                      : 'bg-[#ff4466]/15 text-[#ff4466] border-[#ff4466]/40'
                      : 'text-[#3d5a73] border-[#1a3a5c]'
                  }`}>
                  {s === 'Buy' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {s === 'Buy' ? (execMode === 'futures' ? 'ABRIR LONG' : 'COMPRAR') : (execMode === 'futures' ? 'ABRIR SHORT' : 'VENDER')}
                </button>
              ))}
            </div>
          </div>

          {/* Alavancagem — só futuros */}
          {execMode === 'futures' && (
            <div>
              <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">Alavancagem</label>
              <div className="grid grid-cols-5 gap-1.5">
                {LEVERAGE_PRESETS.map(lev => (
                  <button key={lev} onClick={() => setExecLev(lev)}
                    className={`py-1.5 rounded-lg text-xs font-bold font-mono border transition-all ${
                      execLev === lev ? 'bg-[#ff9900]/20 text-[#ff9900] border-[#ff9900]/40' : 'bg-[#0c1f35] text-[#3d5a73] border-[#1a3a5c]'
                    }`}>
                    {lev}×
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* TP / SL — só futuros */}
          {execMode === 'futures' && (
            <div className="grid grid-cols-2 gap-3">
              <InputField label="Take Profit (opcional)" value={execTp} onChange={setExecTp} type="number" step={0.01} placeholder="0.00" />
              <InputField label="Stop Loss (opcional)" value={execSl} onChange={setExecSl} type="number" step={0.01} placeholder="0.00" />
            </div>
          )}

          {/* Resumo */}
          <div className="p-3 rounded-xl bg-[#0c1f35] border border-[#1a3a5c] text-xs font-mono space-y-1.5">
            <div className="flex justify-between"><span className="text-[#3d5a73]">Par</span><span className="font-bold">{execPair}</span></div>
            <div className="flex justify-between"><span className="text-[#3d5a73]">{execMode === 'futures' ? 'Posição' : 'Direcção'}</span>
              <span className={`font-bold ${execSide === 'Buy' ? 'text-[#00ff88]' : 'text-[#ff4466]'}`}>
                {execSide === 'Buy' ? (execMode === 'futures' ? '▲ LONG' : '▲ COMPRA') : (execMode === 'futures' ? '▼ SHORT' : '▼ VENDA')}
              </span>
            </div>
            <div className="flex justify-between"><span className="text-[#3d5a73]">Tamanho</span><span>${execSize} USDT</span></div>
            {execMode === 'futures' && <div className="flex justify-between"><span className="text-[#3d5a73]">Alavancagem</span><span className="text-[#ff9900]">{execLev}×</span></div>}
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
              execSide === 'Buy' ? 'bg-[#00ff88]/15 text-[#00ff88] border-[#00ff88]/40 hover:bg-[#00ff88]/25' : 'bg-[#ff4466]/15 text-[#ff4466] border-[#ff4466]/40 hover:bg-[#ff4466]/25'
            }`}>
            {execLoading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            {execSide === 'Buy' ? (execMode === 'futures' ? `ABRIR LONG ${execPair}` : `COMPRAR ${execPair}`) : (execMode === 'futures' ? `ABRIR SHORT ${execPair}` : `VENDER ${execPair}`)}
          </button>
        </div>
      )}

      {/* ── CONTAS ──────────────────────────────────────────────────────────── */}
      {activeSection === 'keys' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Conectar */}
          <div className="glass-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Key size={16} className="text-[#00d4ff]" />
              <span className="text-sm font-bold">Conectar Exchange</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {EXCHANGES.map(ex => (
                <button key={ex.id} onClick={() => setSelectedExchange(ex.id)}
                  className={`p-3 rounded-xl border text-left transition-all ${selectedExchange === ex.id ? 'border-[#00d4ff]/40 bg-[#00d4ff]/5' : 'border-[#1a3a5c]'}`}>
                  <div className="text-base">{ex.logo}</div>
                  <div className={`text-sm font-bold mt-0.5 ${selectedExchange === ex.id ? 'text-[#00d4ff]' : 'text-[#e8f4ff]'}`}>{ex.name}</div>
                  <div className="text-[10px] font-mono text-[#3d5a73]">{ex.testnetSupported ? 'Testnet ✓' : 'Apenas Mainnet'}</div>
                </button>
              ))}
            </div>

            <div className="flex items-start gap-2 p-3 rounded-lg bg-[#ffcc00]/5 border border-[#ffcc00]/20">
              <Info size={13} className="text-[#ffcc00] flex-shrink-0 mt-0.5" />
              <div className="text-xs text-[#ffcc00]/80 font-mono leading-relaxed">
                Cria a key com permissão <strong>Trade</strong>. Nunca actives Withdraw.{' '}
                <a href={currentExInfo.url} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">
                  Abrir definições API <ExternalLink size={10} />
                </a>
              </div>
            </div>

            <InputField label="API Key" value={apiKey} onChange={setApiKey} placeholder="Cola a tua API key..." />
            <InputField label="API Secret" value={apiSecret} onChange={setApiSecret} placeholder="••••••••••••" type="password" />
            <InputField label="Etiqueta (nome para identificar)" value={keyLabel} onChange={setKeyLabel} placeholder="Conta Principal" />

            {currentExInfo.testnetSupported && (
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-[#3d5a73]">Testnet (simulação)</span>
                <button onClick={() => setTestnet(!testnet)} className="flex items-center gap-1.5">
                  {testnet ? <ToggleRight size={20} className="text-[#00d4ff]" /> : <ToggleLeft size={20} className="text-[#3d5a73]" />}
                  <span className={`text-xs font-mono ${testnet ? 'text-[#00d4ff]' : 'text-[#3d5a73]'}`}>{testnet ? 'LIGADO' : 'DESLIGADO'}</span>
                </button>
              </div>
            )}

            <button onClick={connectKey} disabled={connecting || !apiKey || !apiSecret}
              className="w-full py-2.5 rounded-xl bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/30 text-sm font-bold font-mono hover:bg-[#00d4ff]/25 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
              {connecting ? <RefreshCw size={14} className="animate-spin" /> : <Key size={14} />}
              Conectar {currentExInfo.logo} {currentExInfo.name}
            </button>
          </div>

          {/* Lista de keys + saldo */}
          <div className="space-y-4">
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2"><Shield size={16} className="text-[#00ff88]" /><span className="text-sm font-bold">Contas Conectadas</span></div>
                <button onClick={loadKeys} className="w-7 h-7 rounded-lg bg-[#0c1f35] border border-[#1a3a5c] flex items-center justify-center text-[#8ba3be] hover:text-[#00d4ff]"><RefreshCw size={12} /></button>
              </div>
              {keys.length === 0 ? (
                <div className="text-center py-8"><Key size={32} className="text-[#1a3a5c] mx-auto mb-2" /><div className="text-xs font-mono text-[#3d5a73]">Nenhuma conta conectada</div></div>
              ) : (
                <div className="space-y-2">
                  {keys.map(k => (
                    <div key={k.id} onClick={() => setSelectedKey(k.id)}
                      className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${selectedKey === k.id ? 'border-[#00d4ff]/40 bg-[#00d4ff]/5' : 'border-[#1a3a5c] hover:border-[#00d4ff]/20'}`}>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold">{k.label}</span>
                          <ExchangeBadge exchange={k.exchange} />
                          {k.testnet && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#ffcc00]/10 text-[#ffcc00] border border-[#ffcc00]/30">TESTNET</span>}
                          {selectedKey === k.id && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/30">ATIVA</span>}
                        </div>
                        <div className="text-xs font-mono text-[#3d5a73] mt-0.5">{k.api_key_preview}</div>
                      </div>
                      <button onClick={e => { e.stopPropagation(); authFetch(`${API}/api/autotrader/keys/${k.id}`, { method: 'DELETE' }).then(() => loadKeys()) }}
                        className="w-7 h-7 rounded-lg bg-[#ff4466]/10 border border-[#ff4466]/20 flex items-center justify-center text-[#ff4466] hover:bg-[#ff4466]/20 flex-shrink-0">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {balance && balance.length > 0 && (
              <div className="glass-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Wallet size={14} className="text-[#00d4ff]" /><span className="text-sm font-bold">Saldo</span>
                  <button onClick={() => selectedKey && loadBalance(selectedKey)} className="ml-auto w-6 h-6 rounded bg-[#0c1f35] border border-[#1a3a5c] flex items-center justify-center text-[#8ba3be] hover:text-[#00d4ff]"><RefreshCw size={10} /></button>
                </div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {balance.slice(0, 12).map(c => (
                    <div key={c.coin} className="flex justify-between text-xs font-mono py-1 border-b border-[#1a3a5c]/40 last:border-0">
                      <span className="font-bold text-[#e8f4ff]">{c.coin}</span>
                      <div className="text-right">
                        <span className="text-[#e8f4ff]">{parseFloat(c.balance).toFixed(4)}</span>
                        {parseFloat(c.usd_value || '0') > 0 && <span className="text-[#3d5a73] ml-2">${parseFloat(c.usd_value).toFixed(2)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── HISTÓRICO ───────────────────────────────────────────────────────── */}
      {activeSection === 'history' && (
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <span className="text-sm font-bold">Histórico de Ordens</span>
            <button onClick={loadTrades} className="w-7 h-7 rounded-lg bg-[#0c1f35] border border-[#1a3a5c] flex items-center justify-center text-[#8ba3be] hover:text-[#00d4ff]"><RefreshCw size={12} /></button>
          </div>
          {trades.length === 0 ? (
            <div className="text-center py-12"><BarChart2 size={40} className="text-[#1a3a5c] mx-auto mb-3" /><div className="text-sm font-bold text-[#3d5a73]">Sem ordens ainda</div></div>
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
                      <td className="py-2.5 pr-3"><ExchangeBadge exchange={t.exchange || 'bybit'} /></td>
                      <td className="py-2.5 pr-3 font-bold text-[#e8f4ff]">{t.pair}</td>
                      <td className="py-2.5 pr-3">
                        <span className={`font-bold ${t.side === 'Buy' ? 'text-[#00ff88]' : 'text-[#ff4466]'}`}>
                          {t.side === 'Buy' ? (t.trade_mode === 'futures' ? '▲ LONG' : '▲ COMPRA') : (t.trade_mode === 'futures' ? '▼ SHORT' : '▼ VENDA')}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className={`text-[10px] font-bold ${t.trade_mode === 'futures' ? 'text-[#ff9900]' : 'text-[#00ff88]'}`}>
                          {t.trade_mode === 'futures' ? '⚡ FUTUROS' : '💰 SPOT'}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right text-[#e8f4ff]">${t.price?.toFixed(4)}</td>
                      <td className="py-2.5 pr-3 text-right text-[#00ff88]">{t.take_profit > 0 ? `$${t.take_profit.toFixed(4)}` : '—'}</td>
                      <td className="py-2.5 pr-3 text-right text-[#ff4466]">{t.stop_loss > 0 ? `$${t.stop_loss.toFixed(4)}` : '—'}</td>
                      <td className="py-2.5 pr-3 text-center"><StatusBadge status={t.status} /></td>
                      <td className="py-2.5 pr-3 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${t.triggered_by === 'ai_auto' ? 'text-[#00d4ff] bg-[#00d4ff]/10 border-[#00d4ff]/30' : 'text-[#3d5a73] border-[#1a3a5c]'}`}>
                          {t.triggered_by === 'ai_auto' ? '🤖 AUTO' : '👆 MANUAL'}
                        </span>
                      </td>
                      <td className="py-2.5 text-right text-[#3d5a73]">
                        {t.created_at ? new Date(t.created_at).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
