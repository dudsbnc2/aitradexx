'use client'

/**
 * AccountStatusBar.tsx
 * Barra de estado da conta sempre visível no topo do AutoTrader.
 * Mostra: exchange conectada, saldo USDT, estado da ligação, último bot run.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Wifi, WifiOff, Wallet, RefreshCw, CheckCircle, AlertCircle, Clock } from 'lucide-react'

interface AccountInfo {
  keyId:     number
  label:     string
  exchange:  string
  testnet:   boolean
  usdtBalance: number
  totalUsdValue: number
  lastUpdated: Date
  status:    'connected' | 'connecting' | 'error'
}

interface Props {
  keyId:       number | null
  keyLabel:    string
  exchange:    string
  testnet:     boolean
  balance:     { coin: string; usd_value: string; balance: string }[] | null
  loading:     boolean
  walletMode?: 'spot' | 'futures'
  onRefresh?:  () => void
  lastBotRun?: { ts: Date; pair: string; bias: string; confidence: number; executed: boolean } | null
}

const EXCHANGE_LOGO: Record<string, string> = {
  bybit: '🟡',
  mexc:  '🔵',
}

export default function AccountStatusBar({
  keyId, keyLabel, exchange, testnet, balance, loading, walletMode = 'spot', onRefresh, lastBotRun,
}: Props) {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10000)
    return () => clearInterval(t)
  }, [])

  if (!keyId) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#0c1f35] border border-[#1a3a5c]">
        <WifiOff size={14} className="text-[#ff4466]" />
        <span className="text-xs font-mono text-[#ff4466] font-bold">Sem conta conectada</span>
        <span className="text-xs font-mono text-[#3d5a73]">— Vai a Contas e conecta uma exchange para começar</span>
      </div>
    )
  }

  const usdtCoin = balance?.find(c => c.coin === 'USDT' || c.coin === 'USDT-M')
  const usdtBal  = usdtCoin ? parseFloat(usdtCoin.balance) : null
  const totalUsd = balance?.reduce((s, c) => s + parseFloat(c.usd_value || '0'), 0) ?? 0

  const logo = EXCHANGE_LOGO[exchange] || '🔗'

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-0 rounded-xl overflow-hidden border border-[#1a3a5c] bg-[#0c1f35]"
    >
      {/* Exchange pill */}
      <div className="flex items-center gap-2 px-4 py-3 border-r border-[#1a3a5c] bg-[#00ff88]/5">
        <div className="relative">
          <Wifi size={13} className="text-[#00ff88]" />
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[#00ff88] animate-pulse" />
        </div>
        <div>
          <div className="text-[10px] font-mono text-[#3d5a73]">Conta activa</div>
          <div className="text-xs font-bold font-mono text-[#00ff88] flex items-center gap-1">
            {logo} {keyLabel}
            {testnet && <span className="px-1 py-0.5 rounded text-[8px] bg-[#ffcc00]/10 text-[#ffcc00] border border-[#ffcc00]/30">TEST</span>}
          </div>
        </div>
      </div>

      {/* Saldo USDT */}
      <div className="flex items-center gap-2 px-4 py-3 border-r border-[#1a3a5c]">
        <Wallet size={13} className={walletMode === 'futures' ? 'text-[#ff9900]' : 'text-[#00d4ff]'} />
        <div>
          <div className="text-[10px] font-mono text-[#3d5a73] flex items-center gap-1">
            Saldo USDT
            <span className={`px-1 rounded text-[8px] font-bold border ${
              walletMode === 'futures'
                ? 'text-[#ff9900] border-[#ff9900]/30 bg-[#ff9900]/10'
                : 'text-[#00ff88] border-[#00ff88]/30 bg-[#00ff88]/10'
            }`}>
              {walletMode === 'futures' ? '⚡ FUTUROS' : '💰 SPOT'}
            </span>
          </div>
          {loading ? (
            <div className="flex items-center gap-1">
              <RefreshCw size={10} className="animate-spin text-[#3d5a73]" />
              <span className="text-xs font-mono text-[#3d5a73]">a carregar...</span>
            </div>
          ) : usdtBal !== null ? (
            <div className="text-xs font-bold font-mono text-[#e8f4ff]">
              ${usdtBal.toFixed(2)} <span className="text-[#3d5a73] font-normal">USDT</span>
            </div>
          ) : (
            <div className="text-xs font-mono text-[#3d5a73]">—</div>
          )}
        </div>
      </div>

      {/* Total USD */}
      {totalUsd > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 border-r border-[#1a3a5c]">
          <div>
            <div className="text-[10px] font-mono text-[#3d5a73]">Total carteira</div>
            <div className="text-xs font-bold font-mono text-[#e8f4ff]">${totalUsd.toFixed(2)}</div>
          </div>
        </div>
      )}

      {/* Último bot run */}
      {lastBotRun && (
        <div className="flex items-center gap-2 px-4 py-3 border-r border-[#1a3a5c]">
          <div>
            <div className="text-[10px] font-mono text-[#3d5a73]">Último bot</div>
            {lastBotRun.executed ? (
              <div className="text-xs font-bold font-mono text-[#00ff88] flex items-center gap-1">
                <CheckCircle size={10} />
                {lastBotRun.pair} {lastBotRun.bias} {lastBotRun.confidence}%
              </div>
            ) : (
              <div className="text-xs font-mono text-[#ffcc00] flex items-center gap-1">
                <Clock size={10} />
                Sem sinal
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pronto a operar */}
      <div className="flex items-center gap-2 px-4 py-3 ml-auto">
        {usdtBal !== null && usdtBal >= 5 ? (
          <div className="flex items-center gap-1.5 text-xs font-mono text-[#00ff88]">
            <CheckCircle size={12} />
            <span className="font-bold">Pronto a operar</span>
          </div>
        ) : usdtBal !== null && usdtBal < 5 ? (
          <div className="flex items-center gap-1.5 text-xs font-mono text-[#ffcc00]">
            <AlertCircle size={12} />
            <span>Saldo insuficiente</span>
          </div>
        ) : null}
        {onRefresh && (
          <button onClick={onRefresh}
            className="w-6 h-6 rounded bg-[#0c1f35] border border-[#1a3a5c] flex items-center justify-center text-[#3d5a73] hover:text-[#00d4ff] transition-all">
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
          </button>
        )}
      </div>
    </motion.div>
  )
}
