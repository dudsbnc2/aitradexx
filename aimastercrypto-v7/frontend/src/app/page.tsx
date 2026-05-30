'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import {
  TrendingUp, TrendingDown, Zap, Activity, BarChart3, Search, Star,
  Bell, Settings, ChevronRight, Globe, RefreshCw, Shield, Target,
  ArrowUpRight, ArrowDownRight, Minus, Brain, Waves, Eye, Filter,
  LayoutDashboard, Scan, BookOpen, Radio, PieChart, Lock, X,
  LogIn, LogOut, UserPlus, User, Plus, Newspaper, CheckCircle, History,
} from 'lucide-react'
import {
  fetchMarketOverview, fetchTrending, fetchCoins, fetchFearGreed,
  analyzeSignal, runScan, runBacktest, fetchSignalHistory, fetchPerformanceStats,
  fmtPrice, fmtPct, fmtLargeNum,
  fetchNews, createPriceWebSocket, login, register, getMe, logout as apiLogout,
} from '@/lib/api'
import { useMarketStore, useSignalStore, useUIStore } from '@/stores'
import enTranslations from '@/locales/en/common.json'
import ptTranslations from '@/locales/pt/common.json'
import QuantPanel from '@/components/QuantPanel'
import RegimeWidget from '@/components/RegimeWidget'

const PAIRS = [
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT',
  'DOGE/USDT', 'ADA/USDT', 'AVAX/USDT', 'LINK/USDT', 'DOT/USDT',
  'MATIC/USDT', 'TON/USDT', 'SUI/USDT', 'APT/USDT', 'NEAR/USDT',
  'PEPE/USDT', 'WIF/USDT', 'BONK/USDT', 'FLOKI/USDT', 'SHIB/USDT',
  'UNI/USDT', 'AAVE/USDT', 'CRV/USDT', 'JUP/USDT', 'RAY/USDT',
  'ARB/USDT', 'OP/USDT', 'STX/USDT', 'INJ/USDT', 'SEI/USDT',
]
const ALL_PAIRS = PAIRS
const TIMEFRAMES = ['1m', '5m', '15m', '1H', '4H', '1D']


// ── Translations ─────────────────────────────────────────────────────────────
function useT() {
  const { language } = useUIStore()
  return language === 'pt' ? ptTranslations : enTranslations
}

// ── Utility Components ────────────────────────────────────────────────────────

function LiveDot() {
  return <span className="inline-block w-2 h-2 rounded-full bg-[#00ff88] shadow-[0_0_6px_#00ff88] animate-pulse" />
}

function GradeBadge({ grade }: { grade: string }) {
  const colors: Record<string, string> = {
    A: 'text-[#00ff88] bg-[#00ff88]/10 border-[#00ff88]/30',
    B: 'text-[#00d4ff] bg-[#00d4ff]/10 border-[#00d4ff]/30',
    C: 'text-[#ffcc00] bg-[#ffcc00]/10 border-[#ffcc00]/30',
    D: 'text-[#ff4466] bg-[#ff4466]/10 border-[#ff4466]/30',
  }
  return (
    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border font-bold font-mono text-sm ${colors[grade] || colors.D}`}>
      {grade}
    </span>
  )
}

function BiasBadge({ bias }: { bias: string }) {
  if (bias === 'LONG') return (
    <span className="px-3 py-1 rounded-md text-xs font-bold font-mono badge-long flex items-center gap-1.5">
      <ArrowUpRight size={12} /> LONG
    </span>
  )
  if (bias === 'SHORT') return (
    <span className="px-3 py-1 rounded-md text-xs font-bold font-mono badge-short flex items-center gap-1.5">
      <ArrowDownRight size={12} /> SHORT
    </span>
  )
  return (
    <span className="px-3 py-1 rounded-md text-xs font-bold font-mono badge-wait flex items-center gap-1.5">
      <Minus size={12} /> WAIT
    </span>
  )
}

function ConfidenceBar({ value }: { value: number | undefined }) {
  const v = value ?? 0
  const color = v >= 75 ? '#00ff88' : v >= 60 ? '#00d4ff' : v >= 45 ? '#ffcc00' : '#ff4466'
  return (
    <div className="w-full h-1.5 bg-[#1a3a5c] rounded-full overflow-hidden">
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
        initial={{ width: 0 }}
        animate={{ width: `${v}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />
    </div>
  )
}

function MetricCard({ label, value, sub, icon: Icon, color = '#00d4ff', change }: any) {
  return (
    <div className="glass-card p-4 relative overflow-hidden group hover:border-[#00d4ff]/30 transition-all duration-300">
      <div className="absolute top-0 right-0 w-24 h-24 rounded-full opacity-5 blur-2xl transition-opacity duration-300 group-hover:opacity-10"
        style={{ background: color, transform: 'translate(30%, -30%)' }} />
      <div className="flex items-start justify-between mb-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[#8ba3be]">{label}</span>
        {Icon && <Icon size={14} style={{ color }} className="opacity-60" />}
      </div>
      <div className="text-xl font-bold font-mono" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] text-[#3d5a73] mt-1 font-mono">{sub}</div>}
      {change !== undefined && (
        <div className={`text-xs font-mono mt-1 flex items-center gap-1 ${change >= 0 ? 'text-[#00ff88]' : 'text-[#ff4466]'}`}>
          {change >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
          {fmtPct(change)}
        </div>
      )}
    </div>
  )
}

function FearGreedGauge({ value, label }: { value: number; label: string }) {
  const color = value >= 75 ? '#00ff88' : value >= 55 ? '#66ff99' : value >= 45 ? '#ffcc00' : value >= 25 ? '#ff8833' : '#ff4466'
  return (
    <div className="glass-card p-4 flex flex-col items-center">
      <div className="text-[10px] font-mono uppercase tracking-widest text-[#8ba3be] mb-3">Fear & Greed</div>
      <div className="relative w-24 h-12 mb-2">
        <svg viewBox="0 0 100 50" className="w-full h-full">
          <path d="M 10 45 A 40 40 0 0 1 90 45" fill="none" stroke="#1a3a5c" strokeWidth="8" strokeLinecap="round" />
          <path d="M 10 45 A 40 40 0 0 1 90 45" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={`${(value / 100) * 125.7} 125.7`} />
        </svg>
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-lg font-bold font-mono" style={{ color }}>
          {value}
        </div>
      </div>
      <div className="text-xs font-bold" style={{ color }}>{label}</div>
    </div>
  )
}

// ── Signal Card ───────────────────────────────────────────────────────────────

function SignalCard({ signal }: { signal: any }) {
  if (!signal) return null
  const { bias, confidence, entry, stopLoss, takeProfit, rr, analysis, quality, tags, source, indicators, mtf } = signal

  // translate indicator labels to PT
  const indLabels: Record<string, string> = {
    ema: 'EMA', macd: 'MACD', rsi: 'RSI 26', structure: 'Estrutura',
  }
  const indPTValues: Record<string, string> = {
    BEARISH: 'BAIXISTA', BULLISH: 'ALTISTA', NEUTRAL: 'NEUTRO',
    OVERSOLD: 'SOBREVENDIDO', OVERBOUGHT: 'SOBRECOMPRADO', CHOCH: 'CHOCH',
  }
  const translateInd = (v: string) => indPTValues[v] || v

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card overflow-hidden border-l-2"
      style={{ borderLeftColor: bias === 'LONG' ? '#00ff88' : bias === 'SHORT' ? '#ff4466' : '#ffcc00' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[#1a3a5c]">
        <div className="flex items-center gap-3">
          <BiasBadge bias={bias} />
          <div>
            <div className="text-xs font-mono text-[#8ba3be]">Confiança</div>
            <div className="text-sm font-bold font-mono" style={{ color: (confidence ?? 0) >= 75 ? '#00ff88' : (confidence ?? 0) >= 60 ? '#00d4ff' : '#ffcc00' }}>
              {confidence ?? '—'}%
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {quality && <GradeBadge grade={quality.grade} />}
          <div className="text-right">
            <div className="text-[10px] font-mono text-[#3d5a73] uppercase tracking-wider">{source}</div>
            <div className="text-xs font-mono text-[#00d4ff]">Score {quality?.overall}/10</div>
          </div>
        </div>
      </div>

      {/* Confidence bar */}
      <div className="px-4 pt-3">
        <ConfidenceBar value={confidence} />
      </div>

      {/* Levels */}
      <div className="grid grid-cols-3 border-y border-[#1a3a5c] mt-3">
        {[
          { label: 'Entrada', value: fmtPrice(entry), color: '#00d4ff' },
          { label: 'Stop Loss', value: fmtPrice(stopLoss), color: '#ff4466' },
          { label: 'Alvo', value: fmtPrice(takeProfit), color: '#00ff88' },
        ].map(({ label, value, color }) => (
          <div key={label} className="p-3 text-center border-r border-[#1a3a5c] last:border-r-0">
            <div className="text-[9px] font-mono uppercase tracking-widest text-[#3d5a73] mb-1">{label}</div>
            <div className="text-sm font-bold font-mono" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* RR + MTF */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#1a3a5c]">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-[9px] font-mono uppercase tracking-wider text-[#3d5a73]">R/R </span>
            <span className="text-sm font-bold font-mono text-[#00d4ff]">{rr}</span>
          </div>
          {mtf && (
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-mono uppercase tracking-wider text-[#3d5a73]">MTF </span>
              <span className={`text-xs font-bold font-mono px-1.5 py-0.5 rounded ${mtf.confluence === 'BULLISH' ? 'text-[#00ff88] bg-[#00ff88]/10' : mtf.confluence === 'BEARISH' ? 'text-[#ff4466] bg-[#ff4466]/10' : 'text-[#ffcc00] bg-[#ffcc00]/10'}`}>
                {translateInd(mtf.confluence)}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {(tags || []).slice(0, 3).map((tag: string) => (
            <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-[#00d4ff]/5 border border-[#00d4ff]/20 text-[#8ba3be] font-mono">
              {translateInd(tag)}
            </span>
          ))}
        </div>
      </div>

      {/* Indicators */}
      {indicators && (
        <div className="grid grid-cols-4 border-b border-[#1a3a5c]">
          {Object.entries(indicators).map(([key, val]: [string, any]) => {
            const display = typeof val === 'object' ? val?.signal || val?.trend || JSON.stringify(val) : String(val)
            const color = ['BULLISH', 'ALTISTA', 'OVERSOLD', 'SOBREVENDIDO'].includes(translateInd(display))
              ? '#00ff88' : ['BEARISH', 'BAIXISTA'].includes(translateInd(display)) ? '#ff4466' : '#00d4ff'
            return (
              <div key={key} className="p-3 text-center border-r border-[#1a3a5c] last:border-r-0">
                <div className="text-[9px] font-mono uppercase tracking-wider text-[#3d5a73] mb-1">{indLabels[key] || key.toUpperCase()}</div>
                <div className="text-xs font-bold font-mono" style={{ color }}>{translateInd(display)}</div>
              </div>
            )
          })}
        </div>
      )}

      {/* AI Analysis */}
      {analysis && (
        <div className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Brain size={12} className="text-[#b366ff]" />
            <span className="text-[9px] font-mono uppercase tracking-widest text-[#3d5a73]">Análise IA</span>
          </div>
          <p className="text-xs text-[#8ba3be] leading-relaxed">{analysis}</p>
        </div>
      )}

      {/* Quant Panel V7 */}
      {signal.quant && (
        <>
          {signal.quant.regime && (
            <div className="px-4 pb-2">
              <RegimeWidget
                regime={signal.quant.regime}
                note={signal.quant.regime_note}
                size="sm"
              />
            </div>
          )}
          <QuantPanel quant={signal.quant} />
        </>
      )}
    </motion.div>
  )
}

// ── Scan Result Row ───────────────────────────────────────────────────────────

function ScanResultRow({ signal, onClick }: { signal: any; onClick: () => void }) {
  const { bias, confidence, pair, timeframe, quality, entry, stopLoss, takeProfit, source, rr } = signal
  const baseCoin = (pair || '—').split('/')[0]
  const quoteCoin = (pair || '').split('/')[1] || 'USDT'
  const isRuleEngine = !source || source === 'rule-engine'
  const rrVal = rr ? String(rr) : null

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      onClick={onClick}
      className="glass-card p-4 cursor-pointer hover:border-[#00d4ff]/30 transition-all group"
    >
      {/* Header row: pair + timeframe | grade + confidence */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <BiasBadge bias={bias} />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold font-mono text-[#e8f4ff] text-sm">{baseCoin}</span>
              <span className="text-[10px] font-mono text-[#3d5a73]">/{quoteCoin}</span>
              {timeframe && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#0c1f35] border border-[#1a3a5c] text-[#00d4ff]">
                  {timeframe}
                </span>
              )}
            </div>
            {/* Source indicator */}
            <div className="flex items-center gap-1 mt-0.5">
              {isRuleEngine ? (
                <span className="text-[9px] font-mono text-[#ffcc00]">⚙ Rule Engine</span>
              ) : (
                <span className="text-[9px] font-mono text-[#b366ff]">✦ {source}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {quality && <GradeBadge grade={quality.grade} />}
          <div className="text-right">
            <div className="text-xs font-mono font-bold" style={{ color: confidence >= 75 ? '#00ff88' : confidence >= 60 ? '#00d4ff' : '#ffcc00' }}>
              {confidence}%
            </div>
            <div className="text-[9px] font-mono text-[#3d5a73]">confiança</div>
          </div>
        </div>
      </div>

      <ConfidenceBar value={confidence} />

      {/* Price levels */}
      <div className="grid grid-cols-3 gap-2 mt-3 text-center">
        <div>
          <div className="text-[9px] text-[#3d5a73] font-mono">ENTRADA</div>
          <div className="text-xs font-bold font-mono text-[#00d4ff]">{fmtPrice(entry)}</div>
        </div>
        <div>
          <div className="text-[9px] text-[#3d5a73] font-mono">STOP</div>
          <div className="text-xs font-bold font-mono text-[#ff4466]">{fmtPrice(stopLoss)}</div>
        </div>
        <div>
          <div className="text-[9px] text-[#3d5a73] font-mono">ALVO</div>
          <div className="text-xs font-bold font-mono text-[#00ff88]">{fmtPrice(takeProfit)}</div>
        </div>
      </div>

      {/* Footer: RR + staleness + Ver sinal */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-2">
          {rrVal ? (
            <span className="text-[9px] font-mono text-[#3d5a73]">RR {rrVal}</span>
          ) : <span />}
          {/* Staleness V7 */}
          {signal.staleness && (
            <span className="text-[9px] font-mono" style={{
              color: signal.staleness.level === 'fresh' ? '#00ff88'
                : signal.staleness.level === 'aging' ? '#ffcc00'
                : '#ff4466'
            }}>
              {signal.staleness.icon} {signal.staleness.label}
            </span>
          )}
          {/* Regime V7 */}
          {signal.quant?.regime && (
            <RegimeWidget regime={signal.quant.regime} size="sm" animated={false} showDesc={false} />
          )}
        </div>
        <span className="text-[9px] font-mono text-[#3d5a73] group-hover:text-[#00d4ff] transition-colors">Ver sinal →</span>
      </div>
    </motion.div>
  )
}

// ── Backtest Panel ────────────────────────────────────────────────────────────

function BacktestPanel() {
  const [pair, setPair] = useState('BTC/USDT')
  const [tf, setTf] = useState('1H')
  const [candles, setCandles] = useState(500)
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const run = async () => {
    setLoading(true)
    try {
      const r = await runBacktest(pair, tf, candles)
      setResult(r)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex flex-wrap gap-3">
        <select value={pair} onChange={(e) => setPair(e.target.value)}
          className="bg-[#071524] border border-[#1a3a5c] rounded-lg px-3 py-2 text-sm font-mono text-[#e8f4ff] focus:border-[#00d4ff] outline-none">
          {PAIRS.map((p) => <option key={p}>{p}</option>)}
        </select>
        <div className="flex gap-1">
          {TIMEFRAMES.map((t) => (
            <button key={t} onClick={() => setTf(t)}
              className={`px-3 py-2 rounded-lg text-xs font-bold font-mono transition-all ${tf === t ? 'bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/30' : 'text-[#8ba3be] border border-[#1a3a5c] hover:border-[#00d4ff]/20'}`}>
              {t}
            </button>
          ))}
        </div>
        <select value={candles} onChange={(e) => setCandles(Number(e.target.value))}
          className="bg-[#071524] border border-[#1a3a5c] rounded-lg px-3 py-2 text-sm font-mono text-[#e8f4ff] focus:border-[#00d4ff] outline-none">
          {[100, 250, 500, 1000].map((c) => <option key={c} value={c}>{c} velas</option>)}
        </select>
        <button onClick={run} disabled={loading}
          className="flex items-center gap-2 px-5 py-2 rounded-lg font-bold text-sm transition-all disabled:opacity-40"
          style={{ background: '#b366ff15', border: '1px solid #b366ff40', color: '#b366ff' }}>
          {loading ? <RefreshCw size={14} className="animate-spin" /> : <BarChart3 size={14} />}
          {loading ? 'Executando...' : 'Executar Backtest'}
        </button>
      </div>

      {result && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Total Operações', value: result.total_trades, color: '#00d4ff' },
            { label: 'Taxa de Acerto', value: `${result.win_rate?.toFixed(1)}%`, color: result.win_rate >= 50 ? '#00ff88' : '#ff4466' },
            { label: 'PnL Total', value: `${result.total_pnl?.toFixed(2)}%`, color: result.total_pnl >= 0 ? '#00ff88' : '#ff4466' },
            { label: 'Max Drawdown', value: `${result.max_drawdown?.toFixed(1)}%`, color: '#ff4466' },
            { label: 'Sharpe', value: result.sharpe_ratio?.toFixed(2), color: '#b366ff' },
            { label: 'Fator de Lucro', value: result.profit_factor?.toFixed(2), color: '#ffcc00' },
          ].map(({ label, value, color }) => (
            <div key={label} className="glass-card p-3 text-center">
              <div className="text-[9px] font-mono uppercase tracking-wider text-[#3d5a73] mb-1">{label}</div>
              <div className="text-lg font-bold font-mono" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Auth Modal ────────────────────────────────────────────────────────────────

// ── History Panel ─────────────────────────────────────────────────────────────

function HistoryPanel() {
  const [history, setHistory] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [filterPair, setFilterPair] = useState('')
  const [filterSource, setFilterSource] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [h, s] = await Promise.all([
        fetchSignalHistory({ pair: filterPair || undefined, source: filterSource || undefined, limit: 100 }),
        fetchPerformanceStats(filterPair || undefined),
      ])
      setHistory(h)
      setStats(s)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const resultColor = (r: string) =>
    r === 'WIN' ? '#00ff88' : r === 'LOSS' ? '#ff4466' : r === 'OPEN' ? '#00d4ff' : '#3d5a73'

  const sourceLabel = (s: string) =>
    s === 'rule-engine' ? '⚙ Rule' : s?.includes('groq') ? '✦ Groq' : s?.includes('gemini') ? '✦ Gemini' : s?.includes('claude') ? '✦ Claude' : s || '?'

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <select value={filterPair} onChange={e => setFilterPair(e.target.value)}
          className="bg-[#0c1f35] border border-[#1a3a5c] rounded-lg px-3 py-1.5 text-xs font-mono text-[#e8f4ff]">
          <option value="">Todos os pares</option>
          {PAIRS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
          className="bg-[#0c1f35] border border-[#1a3a5c] rounded-lg px-3 py-1.5 text-xs font-mono text-[#e8f4ff]">
          <option value="">Todas as fontes</option>
          <option value="rule-engine">Rule Engine</option>
          <option value="groq-llama3.3-70b">Groq</option>
          <option value="gemini-1.5-flash">Gemini</option>
          <option value="claude-sonnet">Claude</option>
        </select>
        <button onClick={load} disabled={loading}
          className="px-4 py-1.5 rounded-lg bg-[#0c1f35] border border-[#1a3a5c] text-xs font-mono text-[#00d4ff] hover:border-[#00d4ff]/50 transition-all">
          {loading ? 'Carregando...' : 'Filtrar'}
        </button>
      </div>

      {/* Performance Stats */}
      {stats && stats.total > 0 && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Sinais Fechados', value: stats.total, color: '#00d4ff' },
              { label: 'Win Rate', value: `${stats.win_rate}%`, color: stats.win_rate >= 50 ? '#00ff88' : '#ff4466' },
              { label: 'Avg PnL', value: `${stats.avg_pnl > 0 ? '+' : ''}${stats.avg_pnl}%`, color: stats.avg_pnl >= 0 ? '#00ff88' : '#ff4466' },
              { label: 'W / L', value: `${stats.wins} / ${stats.losses}`, color: '#b366ff' },
            ].map(({ label, value, color }) => (
              <div key={label} className="glass-card p-3 text-center">
                <div className="text-[9px] font-mono uppercase tracking-wider text-[#3d5a73] mb-1">{label}</div>
                <div className="text-lg font-bold font-mono" style={{ color }}>{value}</div>
              </div>
            ))}
          </div>
          {/* By source breakdown */}
          {Object.keys(stats.by_source || {}).length > 0 && (
            <div className="glass-card p-4">
              <div className="text-[10px] font-mono text-[#3d5a73] mb-3 uppercase tracking-wider">Win rate por fonte</div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {Object.entries(stats.by_source).map(([src, d]: [string, any]) => (
                  <div key={src} className="bg-[#0c1f35] rounded-lg p-3 text-center">
                    <div className="text-[10px] font-mono text-[#b366ff] mb-1">{sourceLabel(src)}</div>
                    <div className="text-sm font-bold font-mono" style={{ color: d.win_rate >= 50 ? '#00ff88' : '#ff4466' }}>
                      {d.win_rate}%
                    </div>
                    <div className="text-[9px] font-mono text-[#3d5a73]">{d.wins}/{d.total}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Signal rows */}
      {history.length === 0 && !loading ? (
        <div className="glass-card p-8 text-center text-sm text-[#3d5a73] font-mono">
          Nenhum sinal guardado ainda. Os próximos sinais LONG/SHORT serão automaticamente registados.
        </div>
      ) : (
        <div className="space-y-2">
          {history.map((sig: any) => (
            <div key={sig.id} className="glass-card p-3 flex items-center gap-3 flex-wrap">
              {/* Pair + TF */}
              <div className="min-w-[90px]">
                <div className="text-xs font-bold font-mono text-[#e8f4ff]">{sig.pair}</div>
                <div className="text-[9px] font-mono text-[#3d5a73]">{sig.timeframe}</div>
              </div>
              {/* Bias */}
              <div className="min-w-[50px]">
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded"
                  style={{ background: sig.bias === 'LONG' ? '#00ff8820' : '#ff446620', color: sig.bias === 'LONG' ? '#00ff88' : '#ff4466' }}>
                  {sig.bias}
                </span>
              </div>
              {/* Levels */}
              <div className="flex gap-3 text-[10px] font-mono flex-1 flex-wrap">
                <span className="text-[#00d4ff]">E: {fmtPrice(sig.entry)}</span>
                <span className="text-[#ff4466]">SL: {fmtPrice(sig.stopLoss)}</span>
                <span className="text-[#00ff88]">TP: {fmtPrice(sig.takeProfit)}</span>
              </div>
              {/* Source */}
              <div className="text-[9px] font-mono text-[#b366ff] min-w-[70px] text-center">
                {sourceLabel(sig.source)}
              </div>
              {/* Grade */}
              {sig.quality_grade && (
                <div className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#0c1f35] text-[#00d4ff]">
                  {sig.quality_grade} {sig.quality_score}
                </div>
              )}
              {/* Result */}
              <div className="min-w-[60px] text-right">
                <div className="text-xs font-bold font-mono" style={{ color: resultColor(sig.result) }}>
                  {sig.result}
                </div>
                {sig.pnl_pct !== null && sig.pnl_pct !== undefined && (
                  <div className="text-[9px] font-mono" style={{ color: sig.pnl_pct >= 0 ? '#00ff88' : '#ff4466' }}>
                    {sig.pnl_pct >= 0 ? '+' : ''}{sig.pnl_pct}%
                  </div>
                )}
              </div>
              {/* Date */}
              <div className="text-[9px] font-mono text-[#3d5a73] min-w-[80px] text-right">
                {sig.created_at ? new Date(sig.created_at).toLocaleDateString('pt-PT') : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Auth Modal (original) ─────────────────────────────────────────────────────

function AuthModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (user: any, token: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    setLoading(true)
    setError('')
    try {
      let data
      if (mode === 'login') {
        data = await login(email, password)
      } else {
        data = await register(email, username, password)
      }
      // V7: token em memória via auth-manager (não localStorage)
      import('@/lib/auth-manager').then(({ setAccessToken }) => setAccessToken(data.access_token))
      onSuccess(data.user, data.access_token)
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Erro ao autenticar. Verifique os dados.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(2,11,20,0.85)', backdropFilter: 'blur(8px)' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass-card w-full max-w-md p-6 relative"
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-[#3d5a73] hover:text-[#e8f4ff] transition-colors">
          <X size={18} />
        </button>

        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #00d4ff, #0066aa)' }}>
            <Brain size={16} className="text-white" />
          </div>
          <span className="text-base font-bold gradient-text">AIMasterCrypto</span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 p-1 bg-[#0c1f35] rounded-lg">
          {(['login', 'register'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`flex-1 py-2 rounded-md text-xs font-bold font-mono transition-all ${mode === m ? 'bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/30' : 'text-[#8ba3be] hover:text-[#e8f4ff]'}`}>
              {m === 'login' ? 'Entrar' : 'Registar'}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-mono uppercase tracking-wider text-[#8ba3be] mb-1 block">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@exemplo.com"
              className="w-full bg-[#071524] border border-[#1a3a5c] rounded-lg px-3 py-2.5 text-sm font-mono text-[#e8f4ff] focus:border-[#00d4ff] outline-none transition-colors"
            />
          </div>
          {mode === 'register' && (
            <div>
              <label className="text-[10px] font-mono uppercase tracking-wider text-[#8ba3be] mb-1 block">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="o_teu_username"
                className="w-full bg-[#071524] border border-[#1a3a5c] rounded-lg px-3 py-2.5 text-sm font-mono text-[#e8f4ff] focus:border-[#00d4ff] outline-none transition-colors"
              />
            </div>
          )}
          <div>
            <label className="text-[10px] font-mono uppercase tracking-wider text-[#8ba3be] mb-1 block">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              className="w-full bg-[#071524] border border-[#1a3a5c] rounded-lg px-3 py-2.5 text-sm font-mono text-[#e8f4ff] focus:border-[#00d4ff] outline-none transition-colors"
            />
          </div>

          {error && (
            <div className="text-xs text-[#ff4466] font-mono bg-[#ff4466]/10 border border-[#ff4466]/20 rounded-lg p-2">
              {error}
            </div>
          )}

          <button onClick={handleSubmit} disabled={loading}
            className="w-full py-3 rounded-lg font-bold text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2 mt-2"
            style={{ background: 'linear-gradient(135deg, #00d4ff22, #0099bb22)', border: '1px solid #00d4ff44', color: '#00d4ff' }}>
            {loading ? <RefreshCw size={14} className="animate-spin" /> : mode === 'login' ? <LogIn size={14} /> : <UserPlus size={14} />}
            {loading ? 'A processar...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ── Add Pair Modal ────────────────────────────────────────────────────────────

function AddPairModal({ watchlist, onAdd, onClose }: { watchlist: string[]; onAdd: (p: string) => void; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const filtered = ALL_PAIRS.filter(p => p.toLowerCase().includes(search.toLowerCase()) && !watchlist.includes(p))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(2,11,20,0.85)', backdropFilter: 'blur(8px)' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass-card w-full max-w-sm p-5 relative"
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-[#3d5a73] hover:text-[#e8f4ff] transition-colors">
          <X size={18} />
        </button>
        <h3 className="font-bold text-sm mb-4">Adicionar par aos favoritos</h3>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pesquisar par..."
          className="w-full bg-[#071524] border border-[#1a3a5c] rounded-lg px-3 py-2.5 text-sm font-mono text-[#e8f4ff] focus:border-[#00d4ff] outline-none mb-3"
        />
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {filtered.map(p => (
            <button key={p} onClick={() => { onAdd(p); onClose() }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[#0c1f35] transition-colors text-sm font-mono text-[#e8f4ff]">
              <span>{p}</span>
              <Plus size={14} className="text-[#00d4ff]" />
            </button>
          ))}
          {filtered.length === 0 && <div className="text-xs text-[#3d5a73] font-mono text-center py-4">Nenhum par encontrado</div>}
        </div>
      </motion.div>
    </div>
  )
}

// ── News Card ─────────────────────────────────────────────────────────────────

function NewsCard({ article }: { article: any }) {
  const sentiment = article.sentiment || 'neutral'
  const color = sentiment === 'positive' ? '#00ff88' : sentiment === 'negative' ? '#ff4466' : '#8ba3be'
  return (
    <a href={article.link} target="_blank" rel="noopener noreferrer"
      className="glass-card p-4 hover:border-[#00d4ff]/30 transition-all block">
      <div className="flex items-start gap-3">
        {article.image_url && (
          <img src={article.image_url} alt="" className="w-16 h-12 object-cover rounded-md shrink-0" onError={(e: any) => { e.target.style.display = 'none' }} />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ color, background: `${color}15`, border: `1px solid ${color}30` }}>
              {sentiment === 'positive' ? 'POSITIVO' : sentiment === 'negative' ? 'NEGATIVO' : 'NEUTRO'}
            </span>
            <span className="text-[9px] font-mono text-[#3d5a73]">{article.source_id?.toUpperCase()}</span>
          </div>
          <div className="text-sm font-semibold text-[#e8f4ff] leading-snug line-clamp-2 mb-1">{article.title}</div>
          {article.description && (
            <div className="text-xs text-[#8ba3be] line-clamp-2 leading-relaxed">{article.description}</div>
          )}
          <div className="text-[9px] font-mono text-[#3d5a73] mt-2">
            {article.pubDate ? new Date(article.pubDate).toLocaleString('pt-PT') : ''}
          </div>
        </div>
      </div>
    </a>
  )
}

// ── Main App ─────────────────────────────────────────────────────────────────

export default function Home() {
  const t = useT()
  const { language, setLanguage, activeTab, setActiveTab, watchlist, addToWatchlist, removeFromWatchlist } = useUIStore()
  const { overview, setOverview, fearGreed, setFearGreed, trending, setTrending, coins, setCoins, prices, setPrices } = useMarketStore()
  const { currentSignal, setSignal, isLoadingSignal, setLoadingSignal, isScanning, setScanning, scanResults, setScanResults, selectedPair, setSelectedPair, selectedTf, setSelectedTf } = useSignalStore()

  const [scanTf, setScanTf] = useState('1H')
  const [signalError, setSignalError] = useState('')
  const wsRef = useRef<WebSocket | null>(null)

  // Auth state
  const [user, setUser] = useState<any>(null)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [showAddPairModal, setShowAddPairModal] = useState(false)

  // News state
  const [news, setNews] = useState<any[]>([])
  const [newsLoading, setNewsLoading] = useState(false)
  const [newsFilter, setNewsFilter] = useState<'all' | 'positive' | 'negative'>('all')

  const router = useRouter()

  // Auth gate V7: usa auth-manager em vez de localStorage
  useEffect(() => {
    import('@/lib/auth-manager').then(({ getAccessToken, clearAuth }) => {
      const token = getAccessToken()
      if (!token) {
        // Tentar renovar via httpOnly cookie antes de redirecionar
        import('@/lib/auth-manager').then(({ initAuth }) => initAuth()).then((renewed) => {
          if (!renewed) router.replace('/login')
        })
        return
      }
      getMe()
        .then((u) => {
          setUser(u)
          // email verification disabled — all users auto-verified on register
        })
        .catch(() => {
          clearAuth()
          document.cookie = 'aic_auth=; path=/; max-age=0'
          router.replace('/login')
        })
    })
  }, [router])

  // Load market data
  useEffect(() => {
    const load = async () => {
      try {
        const [ov, fg, tr, cs] = await Promise.all([
          fetchMarketOverview(), fetchFearGreed(), fetchTrending(), fetchCoins(),
        ])
        setOverview(ov)
        setFearGreed(fg)
        setTrending(tr)
        setCoins(cs)
      } catch (e) {
        console.error('Market data load:', e)
      }
    }
    load()
    const interval = setInterval(load, 60000)
    return () => clearInterval(interval)
  }, [])

  // WebSocket price feed
  useEffect(() => {
    wsRef.current = createPriceWebSocket(PAIRS, (msg) => {
      if (msg.type === 'prices') setPrices(msg.data)
    })
    return () => wsRef.current?.close()
  }, [])

  // Load news via backend (proxy para newsdata.io)
  const loadNews = async () => {
    setNewsLoading(true)
    try {
      const data = await fetchNews()
      if (Array.isArray(data)) setNews(data)
    } catch (e) {
      console.error('News load error:', e)
    } finally {
      setNewsLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'news') loadNews()
  }, [activeTab])

  const handleAnalyze = async () => {
    setLoadingSignal(true)
    setSignalError('')
    try {
      const s = await analyzeSignal(selectedPair, selectedTf)
      setSignal(s)
      setActiveTab('signal')
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || 'Erro ao gerar sinal. Tenta novamente.'
      setSignalError(msg)
      setActiveTab('signal')
      console.error(e)
    } finally {
      setLoadingSignal(false)
    }
  }

  const handleScan = async () => {
    setScanning(true)
    try {
      const result = await runScan(scanTf, PAIRS)
      // Normalize: backend returns scanned_pair, component reads pair
      const normalized = (result.ranked || []).map((s: any) => ({
        ...s,
        pair: s.pair || s.scanned_pair || '—',
        timeframe: s.timeframe || scanTf,
      }))
      setScanResults(normalized)
    } catch (e) {
      console.error(e)
    } finally {
      setScanning(false)
    }
  }

  const handleLogout = () => {
    apiLogout()
  }

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'
  const navItems = [
    { id: 'dashboard', label: t.nav.dashboard, icon: LayoutDashboard },
    { id: 'scanner', label: t.nav.scanner, icon: Scan },
    { id: 'signal', label: t.nav.signals, icon: Zap },
    ...(isAdmin ? [{ id: 'backtest', label: t.nav.backtest, icon: BarChart3 }] : []),
    { id: 'history', label: 'Histórico', icon: History },
    { id: 'watchlist', label: t.nav.watchlist, icon: Star },
    { id: 'news', label: t.nav.news, icon: BookOpen },
  ]

  const topCoins = [...(coins || [])].sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h)
  const filteredNews = news.filter((item) => {
  if (newsFilter === 'all') return true

  const text = (
    (item.title || '') +
    ' ' +
    (item.description || '')
  ).toLowerCase()

  const positiveWords = [
    'bull',
    'surge',
    'pump',
    'rise',
    'gain',
    'growth',
    'breakout',
    'rebound',
    'up'
  ]

  const negativeWords = [
    'crash',
    'dump',
    'fall',
    'bear',
    'loss',
    'fear',
    'collapse',
    'selloff',
    'down'
  ]

  const isPositive = positiveWords.some(word => text.includes(word))
  const isNegative = negativeWords.some(word => text.includes(word))

  if (newsFilter === 'positive') return isPositive
  if (newsFilter === 'negative') return isNegative

  return true
})

  // TradingView interval mapping (support seconds)
  const tvInterval = selectedTf === '1m' ? '1S' : selectedTf === '5m' ? '5' : selectedTf === '15m' ? '15' : selectedTf === '1H' ? '60' : selectedTf === '4H' ? '240' : 'D'

  // Show loading while checking auth
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#020b14' }}>
        <div className="space-y-3 text-center">
          <div className="w-12 h-12 rounded-full border-2 border-[#00d4ff]/30 border-t-[#00d4ff] animate-spin mx-auto" />
          <p className="text-xs font-mono text-[#3d5a73]">Authenticating...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: '#020b14' }}>
      {/* Auth Modal */}
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={(u, token) => { setUser(u); setShowAuthModal(false) }}
        />
      )}

      {/* Add Pair Modal */}
      {showAddPairModal && (
        <AddPairModal
          watchlist={watchlist}
          onAdd={addToWatchlist}
          onClose={() => setShowAddPairModal(false)}
        />
      )}

      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full opacity-[0.03] blur-3xl"
          style={{ background: 'radial-gradient(circle, #00d4ff, transparent)' }} />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full opacity-[0.03] blur-3xl"
          style={{ background: 'radial-gradient(circle, #b366ff, transparent)' }} />
      </div>

      {/* Top Navbar */}
      <nav className="sticky top-0 z-50 border-b border-[#1a3a5c] bg-[#020b14]/95 backdrop-blur-xl">
        <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #00d4ff, #0066aa)' }}>
              <Brain size={14} className="text-white" />
            </div>
            <div>
              <span className="text-sm font-bold tracking-tight gradient-text">AIMasterCrypto</span>
              <span className="hidden sm:inline text-[9px] font-mono text-[#3d5a73] ml-2 uppercase tracking-widest">v1.0</span>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 ml-2 px-2 py-0.5 rounded bg-[#00ff88]/10 border border-[#00ff88]/20">
              <LiveDot />
              <span className="text-[9px] font-mono text-[#00ff88] uppercase tracking-wider">Live</span>
            </div>
          </div>

          {/* Nav tabs */}
          <div className="hidden md:flex items-center gap-1 overflow-x-auto">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setActiveTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${activeTab === id ? 'bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/20' : 'text-[#8ba3be] hover:text-[#e8f4ff] hover:bg-[#0c1f35]'}`}>
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setLanguage(language === 'en' ? 'pt' : 'en')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0c1f35] border border-[#1a3a5c] text-xs font-mono text-[#8ba3be] hover:text-[#00d4ff] hover:border-[#00d4ff]/30 transition-all">
              <Globe size={12} />
              <span className="uppercase">{language}</span>
            </button>

            {user ? (
              <div className="flex items-center gap-2">
                <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0c1f35] border border-[#1a3a5c]">
                  <User size={12} className="text-[#00d4ff]" />
                  <span className="text-xs font-mono text-[#e8f4ff]">{user.username || user.email?.split('@')[0]}</span>
                  {user.role === 'admin' && (
                    <span className="text-[9px] px-1 rounded bg-[#b366ff]/20 text-[#b366ff] font-mono">
                      ADMIN
                    </span>
                  )}

                  {isAdmin && (
                    <a
                      href="/admin"
                      className="text-[9px] px-1.5 py-0.5 rounded font-mono text-[#b366ff] hover:bg-[#b366ff]/20 transition-colors border border-[#b366ff]/30"
                    >
                      Panel
                    </a>
                  )}
                </div>
                <button onClick={handleLogout}
                  className="w-8 h-8 rounded-lg bg-[#0c1f35] border border-[#1a3a5c] flex items-center justify-center text-[#8ba3be] hover:text-[#ff4466] hover:border-[#ff4466]/30 transition-all"
                  title="Sair">
                  <LogOut size={14} />
                </button>
              </div>
            ) : (
              <button onClick={() => setShowAuthModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-all"
                style={{ background: '#00d4ff15', border: '1px solid #00d4ff40', color: '#00d4ff' }}>
                <LogIn size={12} />
                Entrar
              </button>
            )}

            <button className="w-8 h-8 rounded-lg bg-[#0c1f35] border border-[#1a3a5c] flex items-center justify-center text-[#8ba3be] hover:text-[#00d4ff] hover:border-[#00d4ff]/30 transition-all">
              <Bell size={14} />
            </button>
          </div>
        </div>

        {/* Mobile nav */}
        <div className="md:hidden flex overflow-x-auto gap-1 px-4 pb-2">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-all whitespace-nowrap ${activeTab === id ? 'bg-[#00d4ff]/10 text-[#00d4ff]' : 'text-[#8ba3be] bg-[#071524]'}`}>
              <Icon size={11} />
              {label}
            </button>
          ))}
        </div>
      </nav>

      <div className="max-w-[1600px] mx-auto px-4 py-5">
        <AnimatePresence mode="wait">

          {/* ─────────────────────────── DASHBOARD ────────────────────────────── */}
          {activeTab === 'dashboard' && (
            <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
              <div className="flex items-center justify-between">
                <h1 className="text-lg font-bold">{t.dashboard.title}</h1>
                <div className="text-[10px] font-mono text-[#3d5a73]">
                  {new Date().toLocaleString('pt-PT')}
                </div>
              </div>

              {/* Market metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <MetricCard label={t.dashboard.market_cap} value={fmtLargeNum(overview?.total_market_cap_usd)}
                  sub="Total crypto market" icon={PieChart} color="#00d4ff" change={overview?.market_cap_change_24h} />
                <MetricCard label={t.dashboard.volume_24h} value={fmtLargeNum(overview?.total_volume_24h)}
                  sub="24h trading volume" icon={Activity} color="#b366ff" />
                <MetricCard label={t.dashboard.btc_dominance} value={`${overview?.btc_dominance || 0}%`}
                  sub={`ETH: ${overview?.eth_dominance || 0}%`} icon={Shield} color="#ffcc00" />
                <MetricCard label="Active Crypto" value={(overview?.active_cryptocurrencies || 0).toLocaleString()}
                  sub="Listed assets" icon={Globe} color="#00ff88" />
                {fearGreed && <FearGreedGauge value={fearGreed.value} label={fearGreed.classification} />}
              </div>

              {/* AI Summary */}
              {overview?.ai_summary && (
                <div className="glass-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Brain size={14} className="text-[#b366ff]" />
                    <span className="text-[10px] font-mono uppercase tracking-widest text-[#3d5a73]">{t.dashboard.ai_summary}</span>
                  </div>
                  <p className="text-sm text-[#8ba3be] leading-relaxed">{overview.ai_summary}</p>
                </div>
              )}

              {/* Coins table + Trending */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Coins table */}
                <div className="lg:col-span-2 glass-card overflow-hidden">
                  <div className="flex items-center justify-between p-4 border-b border-[#1a3a5c]">
                    <span className="text-sm font-bold">{t.dashboard.top_gainers}</span>
                    <div className="flex gap-2">
                      {['24h', '7d'].map((p) => (
                        <button key={p} className="text-[10px] px-2 py-1 rounded bg-[#0c1f35] font-mono text-[#8ba3be] hover:text-[#00d4ff] transition-colors">{p}</button>
                      ))}
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[#071524]">
                          {['#', 'Asset', 'Price', '24h', '7d', 'Cap'].map((h) => (
                            <th key={h} className="text-left p-3 font-mono text-[#3d5a73] font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(topCoins || []).slice(0, 12).map((coin: any, i) => (
                          <tr key={coin.id} className="border-b border-[#071524]/50 hover:bg-[#071524] transition-colors group">
                            <td className="p-3 font-mono text-[#3d5a73]">{coin.market_cap_rank || i + 1}</td>
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                {coin.image && <img src={coin.image} alt={coin.symbol} className="w-6 h-6 rounded-full" />}
                                <div>
                                  <div className="font-bold text-[#e8f4ff] uppercase">{coin.symbol}</div>
                                  <div className="text-[9px] text-[#3d5a73]">{coin.name}</div>
                                </div>
                              </div>
                            </td>
                            <td className="p-3 font-mono font-bold text-[#e8f4ff]">{fmtPrice(coin.current_price)}</td>
                            <td className={`p-3 font-mono font-bold ${(coin.price_change_percentage_24h || 0) >= 0 ? 'text-[#00ff88]' : 'text-[#ff4466]'}`}>
                              {fmtPct(coin.price_change_percentage_24h)}
                            </td>
                            <td className={`p-3 font-mono font-bold ${(coin.price_change_percentage_7d_in_currency || 0) >= 0 ? 'text-[#00ff88]' : 'text-[#ff4466]'}`}>
                              {fmtPct(coin.price_change_percentage_7d_in_currency)}
                            </td>
                            <td className="p-3 font-mono text-[#8ba3be]">{fmtLargeNum(coin.market_cap)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Trending + Quick Actions */}
                <div className="space-y-4">
                  <div className="glass-card overflow-hidden">
                    <div className="p-4 border-b border-[#1a3a5c] flex items-center gap-2">
                      <TrendingUp size={14} className="text-[#00ff88]" />
                      <span className="text-sm font-bold">{t.dashboard.trending}</span>
                    </div>
                    <div className="divide-y divide-[#071524]">
                      {(trending || []).slice(0, 8).map((coin: any, i) => (
                        <div key={coin.id} className="flex items-center justify-between p-3 hover:bg-[#071524] transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-[#3d5a73] w-4">{i + 1}</span>
                            {coin.thumb && <img src={coin.thumb} alt={coin.symbol} className="w-5 h-5 rounded-full" />}
                            <span className="text-xs font-bold uppercase">{coin.symbol}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-[#3d5a73]">#{coin.market_cap_rank}</span>
                            <span className="text-[#00d4ff]">🔥</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Quick Analyze */}
                  <div className="glass-card p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Zap size={14} className="text-[#00d4ff]" />
                      <span className="text-sm font-bold">Quick Analyze</span>
                    </div>
                    <select value={selectedPair} onChange={(e) => setSelectedPair(e.target.value)}
                      className="w-full bg-[#020b14] border border-[#1a3a5c] rounded-lg px-3 py-2 text-sm font-mono text-[#e8f4ff] mb-2 focus:border-[#00d4ff] outline-none">
                      {PAIRS.map((p) => <option key={p}>{p}</option>)}
                    </select>
                    <div className="grid grid-cols-3 gap-1 mb-3">
                      {TIMEFRAMES.map((tf) => (
                        <button key={tf} onClick={() => setSelectedTf(tf)}
                          className={`py-1.5 rounded-md text-xs font-bold font-mono transition-all ${selectedTf === tf ? 'bg-[#00d4ff]/20 text-[#00d4ff] border border-[#00d4ff]/40' : 'bg-[#020b14] text-[#8ba3be] border border-[#1a3a5c] hover:border-[#00d4ff]/20'}`}>
                          {tf}
                        </button>
                      ))}
                    </div>
                    <button onClick={handleAnalyze} disabled={isLoadingSignal}
                      className="w-full py-2.5 rounded-lg font-bold text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                      style={{ background: 'linear-gradient(135deg, #00d4ff22, #0099bb22)', border: '1px solid #00d4ff44', color: '#00d4ff' }}>
                      {isLoadingSignal ? <RefreshCw size={14} className="animate-spin" /> : <Brain size={14} />}
                      {isLoadingSignal ? 'Analisando...' : 'Obter Sinal IA'}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ─────────────────────────── SCANNER ─────────────────────────────── */}
          {activeTab === 'scanner' && (
            <motion.div key="scanner" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h1 className="text-lg font-bold">{t.scanner.title}</h1>
                <div className="flex items-center gap-3">
                  <div className="flex gap-1">
                    {TIMEFRAMES.map((tf) => (
                      <button key={tf} onClick={() => setScanTf(tf)}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold font-mono transition-all ${scanTf === tf ? 'bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/30' : 'text-[#8ba3be] border border-[#1a3a5c] hover:border-[#00d4ff]/20'}`}>
                        {tf}
                      </button>
                    ))}
                  </div>
                  <button onClick={handleScan} disabled={isScanning}
                    className="flex items-center gap-2 px-5 py-2 rounded-lg font-bold text-sm transition-all disabled:opacity-40"
                    style={{ background: '#00d4ff15', border: '1px solid #00d4ff40', color: '#00d4ff' }}>
                    {isScanning ? <RefreshCw size={14} className="animate-spin" /> : <Scan size={14} />}
                    {isScanning ? t.scanner.scanning : t.scanner.scan_all}
                  </button>
                </div>
              </div>

              {/* Stats — sempre visíveis */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { label: t.scanner.scanned, value: scanResults.length > 0 ? PAIRS.length : PAIRS.length, color: '#00d4ff', sub: `${PAIRS.length} pares disponíveis` },
                  { label: t.scanner.actionable, value: scanResults.filter((s: any) => s.bias !== 'WAIT').length || '—', color: '#00ff88', sub: scanResults.length > 0 ? 'sinais ativos' : 'clique em Escanear' },
                  { label: 'Melhor Nota', value: scanResults[0]?.quality?.grade || '—', color: '#b366ff', sub: scanResults.length > 0 ? scanResults[0]?.pair : 'após scan' },
                ].map(({ label, value, color, sub }) => (
                  <div key={label} className="glass-card p-4 text-center">
                    <div className="text-[9px] font-mono uppercase tracking-wider text-[#3d5a73] mb-1">{label}</div>
                    <div className="text-2xl font-bold font-mono mt-1" style={{ color }}>{value}</div>
                    <div className="text-[10px] font-mono text-[#3d5a73] mt-1">{sub}</div>
                  </div>
                ))}
              </div>

              {/* Pares monitorados */}
              {scanResults.length === 0 && !isScanning && (
                <div className="glass-card p-4">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[#3d5a73] mb-3">Pares a monitorizar</div>
                  <div className="flex flex-wrap gap-2">
                    {PAIRS.map((pair) => {
                      const coin = (coins || []).find((c: any) => c.symbol?.toUpperCase() === pair.split('/')[0])
                      const price = prices[pair] || coin?.current_price
                      const change = coin?.price_change_percentage_24h
                      return (
                        <div key={pair} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0c1f35] border border-[#1a3a5c]">
                          {coin?.image && <img src={coin.image} alt="" className="w-4 h-4 rounded-full" />}
                          <span className="text-xs font-bold font-mono text-[#e8f4ff]">{pair.split('/')[0]}</span>
                          {price && <span className="text-xs font-mono text-[#8ba3be]">{fmtPrice(price)}</span>}
                          {change !== undefined && (
                            <span className={`text-[10px] font-mono ${change >= 0 ? 'text-[#00ff88]' : 'text-[#ff4466]'}`}>{fmtPct(change)}</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {isScanning ? (
                <div className="glass-card p-8 flex flex-col items-center justify-center gap-3">
                  <div className="w-12 h-12 rounded-full border-2 border-[#00d4ff]/30 border-t-[#00d4ff] animate-spin" />
                  <div className="text-sm font-mono text-[#8ba3be]">A escanear {PAIRS.length} pares com IA...</div>
                </div>
              ) : scanResults.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {scanResults.filter((s: any) => s.bias !== 'WAIT' && !s.error).map((signal: any, i) => (
                    <ScanResultRow key={i} signal={signal} onClick={() => {
                      setSignal(signal)
                      setActiveTab('signal')
                    }} />
                  ))}
                  {scanResults.filter((s: any) => s.bias === 'WAIT').length > 0 && (
                    <div className="glass-card p-4 text-center text-sm text-[#3d5a73] font-mono col-span-full">
                      + {scanResults.filter((s: any) => s.bias === 'WAIT').length} pares em modo AGUARDAR
                    </div>
                  )}
                </div>
              ) : null}
            </motion.div>
          )}

          {/* ─────────────────────────── SIGNAL ──────────────────────────────── */}
          {activeTab === 'signal' && (
            <motion.div key="signal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
              {/* Controls */}
              <div className="flex flex-wrap items-center gap-3">
                <select value={selectedPair} onChange={(e) => setSelectedPair(e.target.value)}
                  className="bg-[#071524] border border-[#1a3a5c] rounded-lg px-3 py-2 text-sm font-mono text-[#e8f4ff] focus:border-[#00d4ff] outline-none">
                  {PAIRS.map((p) => <option key={p}>{p}</option>)}
                </select>
                <div className="flex gap-1">
                  {TIMEFRAMES.map((tf) => (
                    <button key={tf} onClick={() => setSelectedTf(tf)}
                      className={`px-3 py-2 rounded-lg text-xs font-bold font-mono transition-all ${selectedTf === tf ? 'bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/30' : 'text-[#8ba3be] border border-[#1a3a5c] hover:border-[#00d4ff]/20'}`}>
                      {tf}
                    </button>
                  ))}
                </div>
                <button onClick={handleAnalyze} disabled={isLoadingSignal}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg font-bold text-sm transition-all disabled:opacity-40"
                  style={{ background: '#00d4ff15', border: '1px solid #00d4ff40', color: '#00d4ff' }}>
                  {isLoadingSignal ? <RefreshCw size={14} className="animate-spin" /> : <Brain size={14} />}
                  {isLoadingSignal ? 'Analisando...' : t.scanner.analyze}
                </button>
                {prices[selectedPair] && (
                  <div className="ml-auto flex items-center gap-2 px-3 py-2 rounded-lg bg-[#071524] border border-[#1a3a5c]">
                    <LiveDot />
                    <span className="text-sm font-bold font-mono text-[#e8f4ff]">
                      {fmtPrice(prices[selectedPair])}
                    </span>
                  </div>
                )}
              </div>

              {/* TradingView Widget — com intervalo em segundos para 1m */}
              <div className="glass-card overflow-hidden" style={{ height: 420 }}>
                <div className="p-3 border-b border-[#1a3a5c] flex items-center gap-2">
                  <BarChart3 size={14} className="text-[#00d4ff]" />
                  <span className="text-xs font-mono text-[#8ba3be]">{selectedPair} · {selectedTf} · TradingView</span>
                  {selectedTf === '1m' && (
                    <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-[#00ff88]/10 text-[#00ff88] font-mono border border-[#00ff88]/20">⚡ 1S live</span>
                  )}
                </div>
                <div style={{ height: 380 }}>
                  <iframe
                    key={`${selectedPair}-${selectedTf}`}
                    src={`https://s.tradingview.com/widgetembed/?frameElementId=tv&symbol=BINANCE:${selectedPair.replace('/', '')}&interval=${tvInterval}&theme=dark&style=1&locale=pt&toolbar_bg=%23020b14&hide_side_toolbar=0&allow_symbol_change=1&withdateranges=1&hideideas=1&save_image=0`}
                    className="w-full h-full border-0"
                    style={{ background: '#020b14' }}
                  />
                </div>
              </div>

              {isLoadingSignal ? (
                <div className="glass-card p-8 flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-full border-2 border-[#00d4ff]/30 border-t-[#00d4ff] animate-spin" />
                  <div className="text-sm font-mono text-[#8ba3be]">IA analisando {selectedPair} {selectedTf}...</div>
                </div>
              ) : signalError ? (
                <div className="glass-card p-8 flex flex-col items-center gap-3 border border-red-500/30">
                  <div className="text-red-400 text-sm font-mono text-center">⚠️ {signalError}</div>
                  <button onClick={handleAnalyze} className="text-xs font-mono px-4 py-2 rounded border border-[#00d4ff]/30 text-[#00d4ff] hover:bg-[#00d4ff]/10 transition-colors">
                    Tentar novamente
                  </button>
                </div>
              ) : currentSignal ? (
                <SignalCard signal={currentSignal} />
              ) : (
                <div className="glass-card p-12 text-center">
                  <Zap size={40} className="text-[#1a3a5c] mx-auto mb-3" />
                  <div className="text-sm text-[#3d5a73] font-mono">Seleciona um par e timeframe, depois clica em Analisar</div>
                </div>
              )}
            </motion.div>
          )}

          {/* ─────────────────────────── BACKTEST ────────────────────────────── */}
          {activeTab === 'backtest' && isAdmin && (
            <motion.div key="backtest" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
              <h1 className="text-lg font-bold">{t.backtest.title}</h1>
              <BacktestPanel />
            </motion.div>
          )}

          {/* ─────────────────────────── HISTÓRICO ───────────────────────────── */}
          {activeTab === 'history' && (
            <motion.div key="history" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
              <div className="flex items-center justify-between">
                <h1 className="text-lg font-bold">Histórico de Sinais</h1>
                <div className="text-[10px] font-mono text-[#3d5a73]">
                  Sinais LONG/SHORT guardados automaticamente · outcomes verificados após cada janela
                </div>
              </div>
              <HistoryPanel />
            </motion.div>
          )}

          {/* ─────────────────────────── FAVORITOS ───────────────────────────── */}
          {activeTab === 'watchlist' && (
            <motion.div key="watchlist" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-lg font-bold">{t.nav.watchlist}</h1>
                  <div className="text-xs font-mono text-[#3d5a73] mt-0.5">
                    {watchlist.length} {watchlist.length === 1 ? 'par' : 'pares'} guardados
                  </div>
                </div>
                <button onClick={() => setShowAddPairModal(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all"
                  style={{ background: '#00ff8815', border: '1px solid #00ff8840', color: '#00ff88' }}>
                  <Plus size={14} />
                  Adicionar par
                </button>
              </div>

              {watchlist.length === 0 ? (
                <div className="glass-card p-12 text-center">
                  <Star size={40} className="text-[#1a3a5c] mx-auto mb-3" />
                  <div className="text-sm font-bold text-[#3d5a73] mb-2">Sem favoritos ainda</div>
                  <div className="text-xs text-[#3d5a73] font-mono mb-4">Clica em "Adicionar par" para começar</div>
                  <button onClick={() => setShowAddPairModal(true)}
                    className="px-4 py-2 rounded-lg text-xs font-bold font-mono text-[#00d4ff] border border-[#00d4ff]/30 hover:bg-[#00d4ff]/10 transition-all">
                    + Adicionar primeiro par
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {watchlist.map((pair) => {
                    const coin = (coins || []).find((c: any) =>
                      c.symbol?.toUpperCase() === pair.split('/')[0]
                    )
                    const price = prices[pair] || coin?.current_price
                    const change = coin?.price_change_percentage_24h
                    return (
                      <div key={pair} className="glass-card p-4 hover:border-[#00d4ff]/30 transition-all">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            {coin?.image && <img src={coin.image} alt={pair} className="w-7 h-7 rounded-full" />}
                            <div>
                              <span className="font-bold">{pair.split('/')[0]}</span>
                              <div className="text-[9px] font-mono text-[#3d5a73]">{coin?.name || pair}</div>
                            </div>
                          </div>
                          <button onClick={() => removeFromWatchlist(pair)}
                            className="p-1.5 rounded-md transition-all text-[#ffcc00] hover:text-[#ff4466] hover:bg-[#ff4466]/10"
                            title="Remover dos favoritos">
                            <Star size={14} fill="currentColor" />
                          </button>
                        </div>
                        <div className="flex items-end justify-between mb-3">
                          <div className="text-xl font-bold font-mono text-[#e8f4ff]">{fmtPrice(price || 0)}</div>
                          {change !== undefined && (
                            <div className={`text-sm font-bold font-mono flex items-center gap-1 ${change >= 0 ? 'text-[#00ff88]' : 'text-[#ff4466]'}`}>
                              {change >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                              {fmtPct(change)}
                            </div>
                          )}
                        </div>
                        {coin && (
                          <div className="text-[10px] font-mono text-[#3d5a73] mb-3">
                            Cap: {fmtLargeNum(coin.market_cap)}
                          </div>
                        )}
                        <button onClick={() => { setSelectedPair(pair); handleAnalyze() }}
                          className="w-full py-1.5 rounded-md text-xs font-bold font-mono text-[#00d4ff] border border-[#00d4ff]/20 hover:bg-[#00d4ff]/10 transition-all">
                          Analisar
                        </button>
                      </div>
                    )
                  })}

                  {/* Add more card */}
                  <button onClick={() => setShowAddPairModal(true)}
                    className="glass-card p-4 border-dashed hover:border-[#00d4ff]/30 transition-all flex flex-col items-center justify-center gap-2 min-h-[160px]">
                    <div className="w-10 h-10 rounded-full border border-[#1a3a5c] flex items-center justify-center">
                      <Plus size={18} className="text-[#3d5a73]" />
                    </div>
                    <span className="text-xs font-mono text-[#3d5a73]">Adicionar par</span>
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {/* ─────────────────────────── NOTÍCIAS ────────────────────────────── */}
          {activeTab === 'news' && (
            <motion.div key="news" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h1 className="text-lg font-bold">{t.nav.news}</h1>
                  <div className="text-xs font-mono text-[#3d5a73] mt-0.5">via newsdata.io</div>
                </div>
                <div className="flex items-center gap-2">
                  {(['all', 'positive', 'negative'] as const).map((f) => (
                    <button key={f} onClick={() => setNewsFilter(f)}
                      className={`px-3 py-1.5 rounded-md text-xs font-bold font-mono transition-all ${newsFilter === f
                        ? f === 'positive' ? 'bg-[#00ff88]/15 text-[#00ff88] border border-[#00ff88]/30'
                          : f === 'negative' ? 'bg-[#ff4466]/15 text-[#ff4466] border border-[#ff4466]/30'
                          : 'bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/30'
                        : 'text-[#8ba3be] border border-[#1a3a5c] hover:border-[#00d4ff]/20'}`}>
                      {f === 'all' ? 'Todas' : f === 'positive' ? 'Positivas' : 'Negativas'}
                    </button>
                  ))}
                  <button onClick={loadNews} disabled={newsLoading}
                    className="w-8 h-8 rounded-lg bg-[#0c1f35] border border-[#1a3a5c] flex items-center justify-center text-[#8ba3be] hover:text-[#00d4ff] transition-all disabled:opacity-40">
                    <RefreshCw size={13} className={newsLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              {newsLoading ? (
                <div className="glass-card p-12 flex flex-col items-center gap-3">
                  <div className="w-10 h-10 rounded-full border-2 border-[#00d4ff]/30 border-t-[#00d4ff] animate-spin" />
                  <div className="text-sm font-mono text-[#8ba3be]">A carregar notícias...</div>
                </div>
              ) : filteredNews.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {filteredNews.map((article, i) => (
                    <NewsCard key={i} article={article} />
                  ))}
                </div>
              ) : (
                <div className="glass-card p-12 text-center">
                  <Newspaper size={40} className="text-[#1a3a5c] mx-auto mb-3" />
                  <div className="text-sm font-bold text-[#3d5a73] mb-1">Sem notícias disponíveis</div>
                  <div className="text-xs text-[#3d5a73] font-mono">Clica em atualizar para carregar</div>
                </div>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* Footer */}
      <footer className="border-t border-[#1a3a5c] mt-10 py-6 text-center">
        <div className="text-xs font-mono text-[#3d5a73]">
          AIMasterCrypto © 2025 · <span className="text-[#00d4ff]">aimastercrypto.com</span> · Not financial advice
        </div>
      </footer>
    </div>
  )
}
