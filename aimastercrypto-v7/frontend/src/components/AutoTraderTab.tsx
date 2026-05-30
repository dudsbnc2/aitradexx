'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bot, Key, Wallet, AlertTriangle, Play, Trash2, RefreshCw,
  ChevronDown, CheckCircle, X, Shield, Zap, TrendingUp, TrendingDown,
  Settings, ToggleLeft, ToggleRight, ExternalLink, Info,
} from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_URL || ''

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExchangeKey {
  id: number
  exchange: string
  label: string
  testnet: boolean
  api_key_preview: string
}

interface TradeConfig {
  id: number
  pair: string
  timeframe: string
  order_size_usdt: number
  leverage: number
  risk_profile: string
  tp_multiplier: number
  sl_multiplier: number
  max_open_trades: number
  auto_execute: boolean
  exchange_key_id: number
}

interface TradeLog {
  id: number
  pair: string
  side: string
  order_type: string
  qty: number
  price: number
  take_profit: number
  stop_loss: number
  status: string
  order_id: string
  error_msg: string
  created_at: string
}

interface BalanceCoin {
  coin: string
  balance: string
  available: string
  usd_value: string
}

const PAIRS = [
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT',
  'DOGE/USDT', 'ADA/USDT', 'AVAX/USDT', 'LINK/USDT', 'DOT/USDT',
  'TON/USDT', 'SUI/USDT', 'APT/USDT', 'NEAR/USDT', 'ARB/USDT',
  'OP/USDT', 'INJ/USDT', 'SEI/USDT', 'HYPE/USDT', 'WLD/USDT',
  'TIA/USDT', 'PYTH/USDT', 'JTO/USDT', 'ENA/USDT', 'EIGEN/USDT',
  'VIRTUAL/USDT', 'FET/USDT', 'RENDER/USDT', 'TAO/USDT', 'GRT/USDT',
  'LDO/USDT', 'PENDLE/USDT', 'IMX/USDT', 'PEPE/USDT', 'WIF/USDT',
  'BONK/USDT', 'POPCAT/USDT', 'TURBO/USDT', 'PENGU/USDT', 'GOAT/USDT',
]

const TIMEFRAMES = ['1m', '5m', '15m', '1H', '4H', '1D']

const RISK_PROFILES = [
  { id: 'conservative', label: 'Conservador', desc: 'TP pequeno, SL apertado, menos risco', color: '#00ff88' },
  { id: 'balanced', label: 'Balanceado', desc: 'Padrão do sinal, R:R equilibrado', color: '#00d4ff' },
  { id: 'aggressive', label: 'Agressivo', desc: 'TP maior, aceita mais volatilidade', color: '#ff9900' },
]

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    filled: 'text-[#00ff88] bg-[#00ff88]/10 border-[#00ff88]/30',
    pending: 'text-[#ffcc00] bg-[#ffcc00]/10 border-[#ffcc00]/30',
    failed: 'text-[#ff4466] bg-[#ff4466]/10 border-[#ff4466]/30',
    cancelled: 'text-[#8ba3be] bg-[#1a3a5c]/50 border-[#1a3a5c]',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono border ${map[status] || map.pending}`}>
      {status.toUpperCase()}
    </span>
  )
}

function Select({ value, onChange, options, className = '' }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full appearance-none bg-[#0c1f35] border border-[#1a3a5c] rounded-lg px-3 py-2.5 text-sm text-[#e8f4ff] font-mono focus:outline-none focus:border-[#00d4ff]/50 pr-8"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#3d5a73] pointer-events-none" />
    </div>
  )
}

function InputField({ label, value, onChange, type = 'text', min, max, step, placeholder }: any) {
  return (
    <div>
      <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
        min={min} max={max} step={step} placeholder={placeholder}
        className="w-full bg-[#0c1f35] border border-[#1a3a5c] rounded-lg px-3 py-2.5 text-sm text-[#e8f4ff] font-mono focus:outline-none focus:border-[#00d4ff]/50 placeholder-[#3d5a73]"
      />
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AutoTraderTab({ user }: { user: any }) {
  const [activeSection, setActiveSection] = useState<'connect' | 'trade' | 'history'>('connect')
  const [keys, setKeys] = useState<ExchangeKey[]>([])
  const [configs, setConfigs] = useState<TradeConfig[]>([])
  const [trades, setTrades] = useState<TradeLog[]>([])
  const [balance, setBalance] = useState<BalanceCoin[] | null>(null)
  const [selectedKey, setSelectedKey] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Connect form
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [keyLabel, setKeyLabel] = useState('Conta Principal')
  const [testnet, setTestnet] = useState(false)

  // Trade config form
  const [cfgPair, setCfgPair] = useState('BTC/USDT')
  const [cfgTf, setCfgTf] = useState('1H')
  const [cfgSize, setCfgSize] = useState(10)
  const [cfgLeverage, setCfgLeverage] = useState(1)
  const [cfgRisk, setCfgRisk] = useState('balanced')
  const [cfgTpMul, setCfgTpMul] = useState(1.0)
  const [cfgSlMul, setCfgSlMul] = useState(1.0)
  const [cfgMaxTrades, setCfgMaxTrades] = useState(3)
  const [cfgAutoExec, setCfgAutoExec] = useState(false)

  // Manual execute form
  const [execPair, setExecPair] = useState('BTC/USDT')
  const [execSide, setExecSide] = useState<'Buy' | 'Sell'>('Buy')
  const [execSize, setExecSize] = useState(10)
  const [execTp, setExecTp] = useState<number | ''>('')
  const [execSl, setExecSl] = useState<number | ''>('')
  const [execLev, setExecLev] = useState(1)
  const [execOrderType, setExecOrderType] = useState<'Market' | 'Limit'>('Market')
  const [execLimitPrice, setExecLimitPrice] = useState<number | ''>('')
  const [execConfirm, setExecConfirm] = useState(false)

  const showMsg = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 4000)
  }

  const loadKeys = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/autotrader/keys`, { headers: authHeaders() })
      if (r.ok) {
        const data = await r.json()
        setKeys(data)
        if (data.length > 0 && !selectedKey) setSelectedKey(data[0].id)
      }
    } catch {}
  }, [selectedKey])

  const loadConfigs = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/autotrader/config`, { headers: authHeaders() })
      if (r.ok) setConfigs(await r.json())
    } catch {}
  }, [])

  const loadTrades = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/autotrader/trades`, { headers: authHeaders() })
      if (r.ok) setTrades(await r.json())
    } catch {}
  }, [])

  const loadBalance = useCallback(async (keyId: number) => {
    try {
      const r = await fetch(`${API}/api/autotrader/balance/${keyId}`, { headers: authHeaders() })
      if (r.ok) {
        const data = await r.json()
        setBalance(data.coins)
      }
    } catch {}
  }, [])

  useEffect(() => {
    loadKeys()
    loadConfigs()
    loadTrades()
  }, [])

  useEffect(() => {
    if (selectedKey) loadBalance(selectedKey)
  }, [selectedKey])

  async function connectKey() {
    if (!apiKey || !apiSecret) return showMsg('err', 'Preenche a API Key e Secret')
    setLoading(true)
    try {
      const r = await fetch(`${API}/api/autotrader/connect`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ api_key: apiKey, api_secret: apiSecret, label: keyLabel, testnet }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || 'Erro ao conectar')
      showMsg('ok', `✓ Conta "${keyLabel}" conectada com sucesso!`)
      setApiKey(''); setApiSecret('')
      await loadKeys()
    } catch (e: any) {
      showMsg('err', e.message)
    } finally {
      setLoading(false)
    }
  }

  async function deleteKey(id: number) {
    await fetch(`${API}/api/autotrader/keys/${id}`, { method: 'DELETE', headers: authHeaders() })
    showMsg('ok', 'Chave removida')
    setKeys(keys.filter(k => k.id !== id))
    if (selectedKey === id) setSelectedKey(null)
  }

  async function saveConfig() {
    if (!selectedKey) return showMsg('err', 'Seleciona uma conta primeiro')
    setLoading(true)
    try {
      const r = await fetch(`${API}/api/autotrader/config`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          exchange_key_id: selectedKey,
          pair: cfgPair, timeframe: cfgTf,
          order_size_usdt: cfgSize, leverage: cfgLeverage,
          risk_profile: cfgRisk, tp_multiplier: cfgTpMul,
          sl_multiplier: cfgSlMul, max_open_trades: cfgMaxTrades,
          auto_execute: cfgAutoExec,
        }),
      })
      if (!r.ok) throw new Error((await r.json()).detail)
      showMsg('ok', `Config guardada para ${cfgPair}`)
      await loadConfigs()
    } catch (e: any) {
      showMsg('err', e.message)
    } finally {
      setLoading(false)
    }
  }

  async function executeOrder() {
    if (!selectedKey) return showMsg('err', 'Seleciona uma conta primeiro')
    if (!execConfirm) return showMsg('err', 'Confirma a ordem antes de executar')
    setLoading(true)
    setExecConfirm(false)
    try {
      const body: any = {
        exchange_key_id: selectedKey,
        pair: execPair,
        side: execSide,
        order_size_usdt: execSize,
        leverage: execLev,
        order_type: execOrderType,
      }
      if (execTp) body.take_profit = execTp
      if (execSl) body.stop_loss = execSl
      if (execOrderType === 'Limit' && execLimitPrice) body.limit_price = execLimitPrice

      const r = await fetch(`${API}/api/autotrader/execute`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail)
      showMsg('ok', `✓ Ordem ${execSide.toUpperCase()} ${execPair} executada! ID: ${data.order_id}`)
      await loadTrades()
      await loadBalance(selectedKey)
    } catch (e: any) {
      showMsg('err', e.message)
    } finally {
      setLoading(false)
    }
  }

  if (!user) {
    return (
      <div className="glass-card p-12 text-center mt-4">
        <Bot size={48} className="text-[#1a3a5c] mx-auto mb-4" />
        <div className="text-lg font-bold text-[#3d5a73] mb-2">Login necessário</div>
        <div className="text-sm text-[#3d5a73] font-mono">Faz login para aceder ao Auto Trade</div>
      </div>
    )
  }

  return (
    <div className="space-y-5 mt-1">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Bot size={20} className="text-[#00d4ff]" /> Auto Trade
            <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-[#ffcc00]/10 text-[#ffcc00] border border-[#ffcc00]/30">BETA</span>
          </h1>
          <div className="text-xs font-mono text-[#3d5a73] mt-0.5">Conecta a tua conta Bybit e opera diretamente</div>
        </div>
        <div className="flex gap-2">
          {(['connect', 'trade', 'history'] as const).map(s => (
            <button key={s} onClick={() => setActiveSection(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-all ${activeSection === s ? 'bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/20' : 'text-[#8ba3be] border border-[#1a3a5c] hover:border-[#00d4ff]/20'}`}>
              {s === 'connect' ? '🔑 Contas' : s === 'trade' ? '⚡ Operar' : '📋 Histórico'}
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

      {/* ── SECTION: CONNECT ─────────────────────────────────────────────── */}
      {activeSection === 'connect' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Connect new key */}
          <div className="glass-card p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Key size={16} className="text-[#00d4ff]" />
              <span className="text-sm font-bold">Conectar Bybit</span>
            </div>

            <div className="flex items-center gap-2 p-3 rounded-lg bg-[#ffcc00]/5 border border-[#ffcc00]/20">
              <Info size={14} className="text-[#ffcc00] flex-shrink-0" />
              <div className="text-xs text-[#ffcc00]/80 font-mono leading-relaxed">
                Cria uma API Key na Bybit com permissão <strong>Trade</strong>. Nunca actives Withdraw. 
                <a href="https://www.bybit.com/app/user/api-management" target="_blank" rel="noopener noreferrer"
                  className="ml-1 underline flex-inline items-center gap-1">Bybit API Settings <ExternalLink size={10} className="inline" /></a>
              </div>
            </div>

            <InputField label="API Key" value={apiKey} onChange={setApiKey} placeholder="aBcDeFgH..." />
            <InputField label="API Secret" value={apiSecret} onChange={(v: string) => setApiSecret(v)} placeholder="••••••••••••••" type="password" />
            <InputField label="Label (opcional)" value={keyLabel} onChange={setKeyLabel} placeholder="Conta Principal" />

            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-[#3d5a73]">Testnet (paper trading)</span>
              <button onClick={() => setTestnet(!testnet)} className="flex items-center gap-1.5 text-xs font-mono">
                {testnet
                  ? <ToggleRight size={20} className="text-[#00d4ff]" />
                  : <ToggleLeft size={20} className="text-[#3d5a73]" />}
                <span className={testnet ? 'text-[#00d4ff]' : 'text-[#3d5a73]'}>{testnet ? 'ON' : 'OFF'}</span>
              </button>
            </div>

            <button onClick={connectKey} disabled={loading || !apiKey || !apiSecret}
              className="w-full py-2.5 rounded-xl bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/30 text-sm font-bold font-mono hover:bg-[#00d4ff]/25 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Key size={14} />}
              Conectar e Verificar
            </button>
          </div>

          {/* Connected keys + balance */}
          <div className="space-y-4">
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Shield size={16} className="text-[#00ff88]" />
                  <span className="text-sm font-bold">Contas Conectadas</span>
                </div>
                <button onClick={loadKeys} className="w-7 h-7 rounded-lg bg-[#0c1f35] border border-[#1a3a5c] flex items-center justify-center text-[#8ba3be] hover:text-[#00d4ff] transition-all">
                  <RefreshCw size={12} />
                </button>
              </div>

              {keys.length === 0 ? (
                <div className="text-center py-6">
                  <Key size={32} className="text-[#1a3a5c] mx-auto mb-2" />
                  <div className="text-xs font-mono text-[#3d5a73]">Nenhuma conta conectada ainda</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {keys.map(k => (
                    <div key={k.id} onClick={() => setSelectedKey(k.id)}
                      className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${selectedKey === k.id ? 'border-[#00d4ff]/40 bg-[#00d4ff]/5' : 'border-[#1a3a5c] hover:border-[#00d4ff]/20'}`}>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold">{k.label}</span>
                          {k.testnet && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#ffcc00]/10 text-[#ffcc00] border border-[#ffcc00]/30">TESTNET</span>}
                          {selectedKey === k.id && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/30">ATIVO</span>}
                        </div>
                        <div className="text-xs font-mono text-[#3d5a73] mt-0.5">{k.exchange.toUpperCase()} · {k.api_key_preview}</div>
                      </div>
                      <button onClick={e => { e.stopPropagation(); deleteKey(k.id) }}
                        className="w-7 h-7 rounded-lg bg-[#ff4466]/10 border border-[#ff4466]/20 flex items-center justify-center text-[#ff4466] hover:bg-[#ff4466]/20 transition-all">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Balance */}
            {selectedKey && balance && (
              <div className="glass-card p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Wallet size={16} className="text-[#00d4ff]" />
                  <span className="text-sm font-bold">Saldo</span>
                  <button onClick={() => loadBalance(selectedKey)} className="ml-auto w-6 h-6 rounded bg-[#0c1f35] border border-[#1a3a5c] flex items-center justify-center text-[#8ba3be] hover:text-[#00d4ff]">
                    <RefreshCw size={10} />
                  </button>
                </div>
                <div className="space-y-1.5">
                  {balance.slice(0, 8).map(c => (
                    <div key={c.coin} className="flex justify-between items-center text-xs font-mono py-1 border-b border-[#1a3a5c]/50 last:border-0">
                      <span className="text-[#e8f4ff] font-bold">{c.coin}</span>
                      <div className="text-right">
                        <div className="text-[#e8f4ff]">{parseFloat(c.balance).toFixed(4)}</div>
                        <div className="text-[#3d5a73]">${parseFloat(c.usd_value || '0').toFixed(2)}</div>
                      </div>
                    </div>
                  ))}
                  {balance.length === 0 && <div className="text-xs text-[#3d5a73] text-center py-3">Saldo vazio</div>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SECTION: TRADE ───────────────────────────────────────────────── */}
      {activeSection === 'trade' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Manual execute */}
          <div className="glass-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-[#ffcc00]" />
              <span className="text-sm font-bold">Executar Ordem</span>
            </div>

            {!selectedKey ? (
              <div className="p-3 rounded-xl bg-[#ff4466]/5 border border-[#ff4466]/20 text-xs font-mono text-[#ff4466]">
                ⚠ Conecta uma conta primeiro na aba Contas
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">Par</label>
                    <Select value={execPair} onChange={setExecPair} options={PAIRS.map(p => ({ value: p, label: p }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">Tipo de Ordem</label>
                    <Select value={execOrderType} onChange={v => setExecOrderType(v as any)}
                      options={[{ value: 'Market', label: 'Market' }, { value: 'Limit', label: 'Limit' }]} />
                  </div>
                </div>

                {/* Buy/Sell toggle */}
                <div>
                  <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">Direção</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['Buy', 'Sell'] as const).map(s => (
                      <button key={s} onClick={() => setExecSide(s)}
                        className={`py-2.5 rounded-xl text-sm font-bold font-mono border transition-all flex items-center justify-center gap-2
                          ${execSide === s
                            ? s === 'Buy' ? 'bg-[#00ff88]/15 text-[#00ff88] border-[#00ff88]/40' : 'bg-[#ff4466]/15 text-[#ff4466] border-[#ff4466]/40'
                            : 'bg-transparent text-[#3d5a73] border-[#1a3a5c] hover:border-[#3d5a73]'}`}>
                        {s === 'Buy' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                        {s === 'Buy' ? 'COMPRAR' : 'VENDER'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Tamanho (USDT)" value={execSize} onChange={setExecSize} type="number" min={1} step={1} />
                  <InputField label="Leverage" value={execLev} onChange={setExecLev} type="number" min={1} max={100} step={1} />
                </div>

                {execOrderType === 'Limit' && (
                  <InputField label="Preço Limite" value={execLimitPrice} onChange={setExecLimitPrice} type="number" step={0.01} placeholder="0.00" />
                )}

                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Take Profit (opcional)" value={execTp} onChange={setExecTp} type="number" step={0.01} placeholder="0.00" />
                  <InputField label="Stop Loss (opcional)" value={execSl} onChange={setExecSl} type="number" step={0.01} placeholder="0.00" />
                </div>

                {/* Summary */}
                <div className="p-3 rounded-xl bg-[#0c1f35] border border-[#1a3a5c] space-y-1.5 text-xs font-mono">
                  <div className="flex justify-between"><span className="text-[#3d5a73]">Par</span><span className="text-[#e8f4ff] font-bold">{execPair}</span></div>
                  <div className="flex justify-between"><span className="text-[#3d5a73]">Direção</span>
                    <span className={execSide === 'Buy' ? 'text-[#00ff88] font-bold' : 'text-[#ff4466] font-bold'}>{execSide === 'Buy' ? '▲ LONG' : '▼ SHORT'}</span>
                  </div>
                  <div className="flex justify-between"><span className="text-[#3d5a73]">Tamanho</span><span className="text-[#e8f4ff]">${execSize} USDT</span></div>
                  {execLev > 1 && <div className="flex justify-between"><span className="text-[#3d5a73]">Leverage</span><span className="text-[#ffcc00]">{execLev}x</span></div>}
                  {execTp && <div className="flex justify-between"><span className="text-[#3d5a73]">Take Profit</span><span className="text-[#00ff88]">${execTp}</span></div>}
                  {execSl && <div className="flex justify-between"><span className="text-[#3d5a73]">Stop Loss</span><span className="text-[#ff4466]">${execSl}</span></div>}
                </div>

                {/* Confirm checkbox */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <div onClick={() => setExecConfirm(!execConfirm)}
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${execConfirm ? 'bg-[#00ff88] border-[#00ff88]' : 'border-[#3d5a73]'}`}>
                    {execConfirm && <span className="text-[#020b14] text-[10px] font-bold">✓</span>}
                  </div>
                  <span className="text-xs font-mono text-[#8ba3be]">Confirmo que quero executar esta ordem com dinheiro real</span>
                </label>

                <button onClick={executeOrder} disabled={loading || !execConfirm}
                  className={`w-full py-3 rounded-xl text-sm font-bold font-mono border transition-all flex items-center justify-center gap-2 disabled:opacity-40
                    ${execSide === 'Buy' ? 'bg-[#00ff88]/15 text-[#00ff88] border-[#00ff88]/40 hover:bg-[#00ff88]/25' : 'bg-[#ff4466]/15 text-[#ff4466] border-[#ff4466]/40 hover:bg-[#ff4466]/25'}`}>
                  {loading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                  {execSide === 'Buy' ? `EXECUTAR COMPRA — $${execSize}` : `EXECUTAR VENDA — $${execSize}`}
                </button>
              </>
            )}
          </div>

          {/* Auto config */}
          <div className="glass-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Settings size={16} className="text-[#00d4ff]" />
              <span className="text-sm font-bold">Config Automática</span>
            </div>
            <div className="text-xs font-mono text-[#3d5a73]">Define parâmetros para execução automática quando o sinal AI for gerado.</div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">Par</label>
                <Select value={cfgPair} onChange={setCfgPair} options={PAIRS.map(p => ({ value: p, label: p }))} />
              </div>
              <div>
                <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">Timeframe</label>
                <Select value={cfgTf} onChange={setCfgTf} options={TIMEFRAMES.map(t => ({ value: t, label: t }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <InputField label="Tamanho (USDT)" value={cfgSize} onChange={setCfgSize} type="number" min={1} step={1} />
              <InputField label="Leverage" value={cfgLeverage} onChange={setCfgLeverage} type="number" min={1} max={100} step={1} />
            </div>

            {/* Risk profile */}
            <div>
              <label className="block text-xs font-mono text-[#3d5a73] mb-2">Perfil de Risco</label>
              <div className="grid grid-cols-3 gap-2">
                {RISK_PROFILES.map(rp => (
                  <button key={rp.id} onClick={() => setCfgRisk(rp.id)}
                    className={`p-2.5 rounded-xl border text-center transition-all ${cfgRisk === rp.id ? 'border-opacity-60 bg-opacity-10' : 'border-[#1a3a5c] hover:border-opacity-30'}`}
                    style={cfgRisk === rp.id ? { borderColor: rp.color, backgroundColor: `${rp.color}15` } : {}}>
                    <div className="text-xs font-bold font-mono" style={{ color: cfgRisk === rp.id ? rp.color : '#8ba3be' }}>{rp.label}</div>
                    <div className="text-[9px] font-mono text-[#3d5a73] mt-0.5 leading-tight">{rp.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">Multiplicador TP</label>
                <input type="range" min={0.5} max={5} step={0.1} value={cfgTpMul} onChange={e => setCfgTpMul(parseFloat(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-[#1a3a5c] accent-[#00ff88]" />
                <div className="text-xs font-mono text-[#00ff88] mt-1 text-center">{cfgTpMul.toFixed(1)}×</div>
              </div>
              <div>
                <label className="block text-xs font-mono text-[#3d5a73] mb-1.5">Multiplicador SL</label>
                <input type="range" min={0.5} max={3} step={0.1} value={cfgSlMul} onChange={e => setCfgSlMul(parseFloat(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-[#1a3a5c] accent-[#ff4466]" />
                <div className="text-xs font-mono text-[#ff4466] mt-1 text-center">{cfgSlMul.toFixed(1)}×</div>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-[#0c1f35] border border-[#1a3a5c]">
              <div>
                <div className="text-xs font-bold">Execução Automática</div>
                <div className="text-[10px] font-mono text-[#3d5a73]">Executa ordens automaticamente quando AI gera sinal A/B</div>
              </div>
              <button onClick={() => setCfgAutoExec(!cfgAutoExec)} className="flex items-center gap-1.5">
                {cfgAutoExec
                  ? <ToggleRight size={24} className="text-[#00d4ff]" />
                  : <ToggleLeft size={24} className="text-[#3d5a73]" />}
              </button>
            </div>

            <button onClick={saveConfig} disabled={loading || !selectedKey}
              className="w-full py-2.5 rounded-xl bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/30 text-sm font-bold font-mono hover:bg-[#00d4ff]/25 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Settings size={14} />}
              Guardar Config
            </button>

            {/* Active configs */}
            {configs.length > 0 && (
              <div className="space-y-2 border-t border-[#1a3a5c] pt-4">
                <div className="text-xs font-mono text-[#3d5a73] mb-2">Configs ativas:</div>
                {configs.map(c => (
                  <div key={c.id} className="flex items-center justify-between p-2.5 rounded-lg bg-[#0c1f35] border border-[#1a3a5c] text-xs font-mono">
                    <div>
                      <span className="text-[#e8f4ff] font-bold">{c.pair}</span>
                      <span className="text-[#3d5a73] ml-2">{c.timeframe} · ${c.order_size_usdt} · {c.leverage}x</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold border"
                        style={{ color: RISK_PROFILES.find(r => r.id === c.risk_profile)?.color || '#8ba3be', borderColor: `${RISK_PROFILES.find(r => r.id === c.risk_profile)?.color || '#3d5a73'}40`, backgroundColor: `${RISK_PROFILES.find(r => r.id === c.risk_profile)?.color || '#3d5a73'}10` }}>
                        {c.risk_profile.toUpperCase()}
                      </span>
                      {c.auto_execute && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30">AUTO</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SECTION: HISTORY ─────────────────────────────────────────────── */}
      {activeSection === 'history' && (
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-bold">Histórico de Ordens</span>
            <button onClick={loadTrades} className="w-7 h-7 rounded-lg bg-[#0c1f35] border border-[#1a3a5c] flex items-center justify-center text-[#8ba3be] hover:text-[#00d4ff]">
              <RefreshCw size={12} />
            </button>
          </div>

          {trades.length === 0 ? (
            <div className="text-center py-12">
              <Bot size={40} className="text-[#1a3a5c] mx-auto mb-3" />
              <div className="text-sm font-bold text-[#3d5a73]">Sem ordens ainda</div>
              <div className="text-xs text-[#3d5a73] font-mono mt-1">As tuas ordens aparecerão aqui</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-[#3d5a73] border-b border-[#1a3a5c]">
                    <th className="text-left py-2 pr-4">Par</th>
                    <th className="text-left py-2 pr-4">Direção</th>
                    <th className="text-right py-2 pr-4">Qty</th>
                    <th className="text-right py-2 pr-4">Preço</th>
                    <th className="text-right py-2 pr-4">TP</th>
                    <th className="text-right py-2 pr-4">SL</th>
                    <th className="text-center py-2 pr-4">Status</th>
                    <th className="text-right py-2">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map(t => (
                    <tr key={t.id} className="border-b border-[#1a3a5c]/30 hover:bg-[#0c1f35]/50 transition-all">
                      <td className="py-2.5 pr-4 font-bold text-[#e8f4ff]">{t.pair}</td>
                      <td className="py-2.5 pr-4">
                        <span className={`font-bold ${t.side === 'Buy' ? 'text-[#00ff88]' : 'text-[#ff4466]'}`}>
                          {t.side === 'Buy' ? '▲ BUY' : '▼ SELL'}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-right text-[#8ba3be]">{t.qty.toFixed(5)}</td>
                      <td className="py-2.5 pr-4 text-right text-[#e8f4ff]">${t.price.toFixed(4)}</td>
                      <td className="py-2.5 pr-4 text-right text-[#00ff88]">{t.take_profit > 0 ? `$${t.take_profit.toFixed(4)}` : '—'}</td>
                      <td className="py-2.5 pr-4 text-right text-[#ff4466]">{t.stop_loss > 0 ? `$${t.stop_loss.toFixed(4)}` : '—'}</td>
                      <td className="py-2.5 pr-4 text-center"><StatusBadge status={t.status} /></td>
                      <td className="py-2.5 text-right text-[#3d5a73]">{t.created_at ? new Date(t.created_at).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
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
