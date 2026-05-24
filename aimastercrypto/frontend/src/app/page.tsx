'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  TrendingUp, TrendingDown, Zap, Activity, BarChart3, Search, Star,
  Bell, Settings, ChevronRight, Globe, RefreshCw, Shield, Target,
  ArrowUpRight, ArrowDownRight, Minus, Brain, Waves, Eye, Filter,
  LayoutDashboard, Scan, BookOpen, Radio, PieChart, Lock, X,
} from 'lucide-react'
import {
  fetchMarketOverview, fetchTrending, fetchCoins, fetchFearGreed,
  analyzeSignal, runScan, runBacktest, fmtPrice, fmtPct, fmtLargeNum,
  createPriceWebSocket,
} from '@/lib/api'
import { useMarketStore, useSignalStore, useUIStore } from '@/stores'
import enTranslations from '@/locales/en/common.json'
import ptTranslations from '@/locales/pt/common.json'

const PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT', 'ADA/USDT', 'AVAX/USDT', 'LINK/USDT', 'TON/USDT', 'SUI/USDT']
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

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 75 ? '#00ff88' : value >= 60 ? '#00d4ff' : value >= 45 ? '#ffcc00' : '#ff4466'
  return (
    <div className="w-full h-1.5 bg-[#1a3a5c] rounded-full overflow-hidden">
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
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
  const rotation = ((value / 100) * 180) - 90

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
            <div className="text-xs font-mono text-[#8ba3be]">Confidence</div>
            <div className="text-sm font-bold font-mono" style={{ color: confidence >= 75 ? '#00ff88' : confidence >= 60 ? '#00d4ff' : '#ffcc00' }}>
              {confidence}%
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
          { label: 'Entry', value: fmtPrice(entry), color: '#00d4ff' },
          { label: 'Stop Loss', value: fmtPrice(stopLoss), color: '#ff4466' },
          { label: 'Take Profit', value: fmtPrice(takeProfit), color: '#00ff88' },
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
                {mtf.confluence}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {(tags || []).slice(0, 3).map((tag: string) => (
            <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-[#00d4ff]/5 border border-[#00d4ff]/20 text-[#8ba3be] font-mono">
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Indicators */}
      {indicators && (
        <div className="grid grid-cols-4 gap-1 px-4 py-3 border-b border-[#1a3a5c]">
          {[
            { k: 'EMA', v: indicators.ema },
            { k: 'MACD', v: indicators.macd },
            { k: `RSI ${indicators.rsi}`, v: indicators.rsi < 35 ? 'OVERSOLD' : indicators.rsi > 65 ? 'OVERBOUGHT' : 'NEUTRAL' },
            { k: 'STRUCTURE', v: indicators.structure },
          ].map(({ k, v }) => (
            <div key={k} className="bg-[#020b14] rounded p-2 text-center">
              <div className="text-[8px] font-mono uppercase tracking-wider text-[#3d5a73] mb-1">{k}</div>
              <div className={`text-[10px] font-bold font-mono ${v === 'BULLISH' || v === 'BOS' || v === 'OVERSOLD' ? 'text-[#00ff88]' : v === 'BEARISH' || v === 'CHOCH' || v === 'OVERBOUGHT' ? 'text-[#ff4466]' : 'text-[#ffcc00]'}`}>
                {v}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Analysis */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Brain size={12} className="text-[#b366ff]" />
          <span className="text-[9px] font-mono uppercase tracking-widest text-[#3d5a73]">AI Analysis</span>
        </div>
        <p className="text-xs text-[#8ba3be] leading-relaxed font-mono">{analysis}</p>
      </div>
    </motion.div>
  )
}

// ── Scan Results ──────────────────────────────────────────────────────────────

function ScanResultRow({ signal, onClick }: { signal: any; onClick: () => void }) {
  const { bias, confidence, scanned_pair: pair, quality, rr } = signal
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-center justify-between p-3 rounded-lg bg-[#071524] hover:bg-[#0c1f35] cursor-pointer transition-all border border-transparent hover:border-[#1a3a5c] group"
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <BiasBadge bias={bias} />
        <div>
          <div className="text-sm font-bold font-mono text-[#e8f4ff]">{pair}</div>
          <div className="text-[10px] font-mono text-[#3d5a73]">R/R {rr}</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {quality && <GradeBadge grade={quality.grade} />}
        <div className="text-right">
          <div className="text-sm font-bold font-mono" style={{ color: confidence >= 75 ? '#00ff88' : '#00d4ff' }}>
            {confidence}%
          </div>
          <ConfidenceBar value={confidence} />
        </div>
        <ChevronRight size={14} className="text-[#3d5a73] group-hover:text-[#00d4ff] transition-colors" />
      </div>
    </motion.div>
  )
}

// ── Backtest Panel ────────────────────────────────────────────────────────────

function BacktestPanel() {
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [pair, setPair] = useState('BTC/USDT')
  const [tf, setTf] = useState('1H')
  const t = useT()

  const run = async () => {
    setLoading(true)
    try {
      const data = await runBacktest(pair, tf, 500)
      setResult(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select value={pair} onChange={(e) => setPair(e.target.value)}
          className="bg-[#071524] border border-[#1a3a5c] rounded-lg px-3 py-2 text-sm font-mono text-[#e8f4ff] focus:border-[#00d4ff] outline-none">
          {PAIRS.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select value={tf} onChange={(e) => setTf(e.target.value)}
          className="bg-[#071524] border border-[#1a3a5c] rounded-lg px-3 py-2 text-sm font-mono text-[#e8f4ff] focus:border-[#00d4ff] outline-none">
          {TIMEFRAMES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <button onClick={run} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#00d4ff]/10 border border-[#00d4ff]/40 text-[#00d4ff] text-sm font-bold hover:bg-[#00d4ff]/20 disabled:opacity-40 transition-all">
          {loading ? <RefreshCw size={14} className="animate-spin" /> : <BarChart3 size={14} />}
          {loading ? t.backtest.running : t.backtest.run}
        </button>
      </div>

      {result && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: t.backtest.trades, value: result.trades, color: '#00d4ff' },
              { label: t.backtest.win_rate, value: `${result.win_rate}%`, color: result.win_rate >= 55 ? '#00ff88' : '#ffcc00' },
              { label: t.backtest.total_pnl, value: `${result.total_pnl_pct > 0 ? '+' : ''}${result.total_pnl_pct}%`, color: result.total_pnl_pct >= 0 ? '#00ff88' : '#ff4466' },
              { label: t.backtest.max_drawdown, value: `${result.max_drawdown}%`, color: '#ff4466' },
              { label: t.backtest.sharpe_ratio, value: result.sharpe_ratio, color: '#b366ff' },
              { label: t.backtest.profit_factor, value: result.profit_factor, color: '#00d4ff' },
              { label: t.backtest.wins, value: result.wins, color: '#00ff88' },
              { label: t.backtest.losses, value: result.losses, color: '#ff4466' },
            ].map(({ label, value, color }) => (
              <div key={label} className="glass-card p-3 text-center">
                <div className="text-[9px] font-mono uppercase tracking-wider text-[#3d5a73] mb-1">{label}</div>
                <div className="text-base font-bold font-mono" style={{ color }}>{value}</div>
              </div>
            ))}
          </div>

          {result.detail?.length > 0 && (
            <div className="glass-card overflow-hidden">
              <div className="p-3 border-b border-[#1a3a5c] text-[10px] font-mono uppercase tracking-wider text-[#3d5a73]">
                Recent Trades (last {result.detail.length})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="border-b border-[#1a3a5c]">
                      {['Bias', 'Entry', 'Exit', 'PnL %', 'Result', 'Balance'].map((h) => (
                        <th key={h} className="text-left p-2 text-[#3d5a73] font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.detail.slice(-15).reverse().map((trade: any, i: number) => (
                      <tr key={i} className="border-b border-[#071524] hover:bg-[#071524]/50 transition-colors">
                        <td className="p-2"><BiasBadge bias={trade.bias} /></td>
                        <td className="p-2 text-[#e8f4ff]">{fmtPrice(trade.entry)}</td>
                        <td className="p-2 text-[#e8f4ff]">{fmtPrice(trade.exit)}</td>
                        <td className={`p-2 font-bold ${trade.pnl_pct >= 0 ? 'text-[#00ff88]' : 'text-[#ff4466]'}`}>
                          {trade.pnl_pct >= 0 ? '+' : ''}{trade.pnl_pct}%
                        </td>
                        <td className="p-2">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${trade.result === 'WIN' ? 'badge-long' : 'badge-short'}`}>
                            {trade.result}
                          </span>
                        </td>
                        <td className="p-2 text-[#00d4ff]">${trade.balance.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  )
}

// ── Main App ─────────────────────────────────────────────────────────────────

export default function Home() {
  const t = useT()
  const { language, setLanguage, activeTab, setActiveTab, watchlist, addToWatchlist, removeFromWatchlist } = useUIStore()
  const { overview, setOverview, fearGreed, setFearGreed, trending, setTrending, coins, setCoins, prices, setPrices } = useMarketStore()
  const { currentSignal, setSignal, isLoadingSignal, setLoadingSignal, isScanning, setScanning, scanResults, setScanResults, selectedPair, setSelectedPair, selectedTf, setSelectedTf } = useSignalStore()

  const [scanTf, setScanTf] = useState('1H')
  const wsRef = useRef<WebSocket | null>(null)

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

  const handleAnalyze = async () => {
    setLoadingSignal(true)
    try {
      const s = await analyzeSignal(selectedPair, selectedTf)
      setSignal(s)
      setActiveTab('signal')
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingSignal(false)
    }
  }

  const handleScan = async () => {
    setScanning(true)
    try {
      const result = await runScan(scanTf, PAIRS)
      setScanResults(result.ranked || [])
    } catch (e) {
      console.error(e)
    } finally {
      setScanning(false)
    }
  }

  const navItems = [
    { id: 'dashboard', label: t.nav.dashboard, icon: LayoutDashboard },
    { id: 'scanner', label: t.nav.scanner, icon: Scan },
    { id: 'signal', label: t.nav.signals, icon: Zap },
    { id: 'backtest', label: t.nav.backtest, icon: BarChart3 },
    { id: 'watchlist', label: t.nav.watchlist, icon: Star },
    { id: 'news', label: t.nav.news, icon: BookOpen },
  ]

  const topCoins = [...(coins || [])]
    .sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h)

  return (
    <div className="min-h-screen" style={{ background: '#020b14' }}>
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
                  {new Date().toLocaleString()}
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
                      {isLoadingSignal ? 'Analyzing...' : 'Get AI Signal'}
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

              {scanResults.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { label: t.scanner.scanned, value: PAIRS.length, color: '#00d4ff' },
                    { label: t.scanner.actionable, value: scanResults.filter((s: any) => s.bias !== 'WAIT').length, color: '#00ff88' },
                    { label: 'Best Grade', value: scanResults[0]?.quality?.grade || '—', color: '#b366ff' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="glass-card p-3 text-center">
                      <div className="text-[9px] font-mono uppercase tracking-wider text-[#3d5a73]">{label}</div>
                      <div className="text-xl font-bold font-mono mt-1" style={{ color }}>{value}</div>
                    </div>
                  ))}
                </div>
              )}

              {isScanning ? (
                <div className="glass-card p-8 flex flex-col items-center justify-center gap-3">
                  <div className="w-12 h-12 rounded-full border-2 border-[#00d4ff]/30 border-t-[#00d4ff] animate-spin" />
                  <div className="text-sm font-mono text-[#8ba3be]">Scanning {PAIRS.length} pairs with AI...</div>
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
                      + {scanResults.filter((s: any) => s.bias === 'WAIT').length} pairs in WAIT mode
                    </div>
                  )}
                </div>
              ) : (
                <div className="glass-card p-12 flex flex-col items-center justify-center gap-3 text-center">
                  <Scan size={40} className="text-[#1a3a5c]" />
                  <div className="text-sm font-bold text-[#3d5a73]">Ready to scan</div>
                  <div className="text-xs text-[#3d5a73] font-mono">Select a timeframe and click Scan All Pairs</div>
                </div>
              )}
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
                  {isLoadingSignal ? 'Analyzing...' : t.scanner.analyze}
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

              {/* TradingView Widget */}
              <div className="glass-card overflow-hidden" style={{ height: 400 }}>
                <div className="p-3 border-b border-[#1a3a5c] flex items-center gap-2">
                  <BarChart3 size={14} className="text-[#00d4ff]" />
                  <span className="text-xs font-mono text-[#8ba3be]">{selectedPair} · {selectedTf} · TradingView</span>
                </div>
                <div style={{ height: 360 }}>
                  <iframe
                    src={`https://s.tradingview.com/widgetembed/?frameElementId=tv&symbol=${selectedPair.replace('/', '')}&interval=${selectedTf === '1H' ? '60' : selectedTf === '4H' ? '240' : selectedTf === '1D' ? 'D' : selectedTf.replace('m', '')}&theme=dark&style=1&locale=en&toolbar_bg=%23020b14&hide_side_toolbar=0&allow_symbol_change=1&withdateranges=1&hideideas=1`}
                    className="w-full h-full border-0"
                    style={{ background: '#020b14' }}
                  />
                </div>
              </div>

              {isLoadingSignal ? (
                <div className="glass-card p-8 flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-full border-2 border-[#00d4ff]/30 border-t-[#00d4ff] animate-spin" />
                  <div className="text-sm font-mono text-[#8ba3be]">AI analyzing {selectedPair} {selectedTf}...</div>
                </div>
              ) : currentSignal ? (
                <SignalCard signal={currentSignal} />
              ) : (
                <div className="glass-card p-12 text-center">
                  <Zap size={40} className="text-[#1a3a5c] mx-auto mb-3" />
                  <div className="text-sm text-[#3d5a73] font-mono">Select a pair and timeframe, then click Analyze</div>
                </div>
              )}
            </motion.div>
          )}

          {/* ─────────────────────────── BACKTEST ────────────────────────────── */}
          {activeTab === 'backtest' && (
            <motion.div key="backtest" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
              <h1 className="text-lg font-bold">{t.backtest.title}</h1>
              <BacktestPanel />
            </motion.div>
          )}

          {/* ─────────────────────────── WATCHLIST ───────────────────────────── */}
          {activeTab === 'watchlist' && (
            <motion.div key="watchlist" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
              <div className="flex items-center justify-between">
                <h1 className="text-lg font-bold">{t.nav.watchlist}</h1>
                <span className="text-xs font-mono text-[#3d5a73]">{watchlist.length} pairs</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {PAIRS.map((pair) => {
                  const coin = (coins || []).find((c: any) =>
                    c.symbol?.toUpperCase() === pair.split('/')[0]
                  )
                  const price = prices[pair] || coin?.current_price
                  const change = coin?.price_change_percentage_24h
                  const isWatched = watchlist.includes(pair)
                  return (
                    <div key={pair} className="glass-card p-4 hover:border-[#00d4ff]/30 transition-all">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          {coin?.image && <img src={coin.image} alt={pair} className="w-7 h-7 rounded-full" />}
                          <span className="font-bold">{pair.split('/')[0]}</span>
                        </div>
                        <button onClick={() => isWatched ? removeFromWatchlist(pair) : addToWatchlist(pair)}
                          className={`p-1.5 rounded-md transition-all ${isWatched ? 'text-[#ffcc00]' : 'text-[#3d5a73] hover:text-[#ffcc00]'}`}>
                          <Star size={14} fill={isWatched ? 'currentColor' : 'none'} />
                        </button>
                      </div>
                      <div className="text-xl font-bold font-mono text-[#e8f4ff] mb-1">{fmtPrice(price || 0)}</div>
                      {change !== undefined && (
                        <div className={`text-sm font-bold font-mono flex items-center gap-1 ${change >= 0 ? 'text-[#00ff88]' : 'text-[#ff4466]'}`}>
                          {change >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                          {fmtPct(change)}
                        </div>
                      )}
                      <button onClick={() => { setSelectedPair(pair); handleAnalyze() }}
                        className="mt-3 w-full py-1.5 rounded-md text-xs font-bold font-mono text-[#00d4ff] border border-[#00d4ff]/20 hover:bg-[#00d4ff]/10 transition-all">
                        Analyze
                      </button>
                    </div>
                  )
                })}
              </div>
            </motion.div>
          )}

          {/* ─────────────────────────── NEWS ────────────────────────────────── */}
          {activeTab === 'news' && (
            <motion.div key="news" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5">
              <h1 className="text-lg font-bold">{t.nav.news}</h1>
              <div className="text-sm text-[#8ba3be] glass-card p-8 text-center">
                <BookOpen size={32} className="mx-auto mb-3 text-[#1a3a5c]" />
                News feed connects to CryptoPanic API. Configure <code className="text-[#00d4ff]">CRYPTOPANIC_API_KEY</code> to enable.
              </div>
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
