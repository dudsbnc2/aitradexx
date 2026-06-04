'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Wifi, WifiOff, Wallet, RefreshCw, CheckCircle, AlertCircle, Clock } from 'lucide-react'
import { useTranslations } from 'next-intl'

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
  bybit:       '🟡',
  okx:         '🔷',
  hyperliquid: '🟣',
  mexc:        '🔵',
}

export default function AccountStatusBar({
  keyId, keyLabel, exchange, testnet, balance, loading, walletMode = 'spot', onRefresh, lastBotRun,
}: Props) {
  const t = useTranslations()
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10000)
    return () => clearInterval(timer)
  }, [])

  if (!keyId) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#0c1f35] border border-[#1a3a5c]">
        <WifiOff size={14} className="text-[#ff4466]" />
        <span className="text-xs font-mono text-[#ff4466] font-bold">{t('autotrader.account_status_no_account')}</span>
        <span className="text-xs font-mono text-[#3d5a73]">{t('autotrader.account_status_no_account_hint')}</span>
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
          <div className="text-[10px] font-mono text-[#3d5a73]">{t('autotrader.account_status_active')}</div>
          <div className="text-xs font-bold font-mono text-[#00ff88] flex items-center gap-1">
            {logo} {keyLabel}
            {testnet && <span className="px-1 py-0.5 rounded text-[8px] bg-[#ffcc00]/10 text-[#ffcc00] border border-[#ffcc00]/30">TEST</span>}
          </div>
        </div>
      </div>

      {/* Balance USDT */}
      <div className="flex items-center gap-2 px-4 py-3 border-r border-[#1a3a5c]">
        <Wallet size={13} className={walletMode === 'futures' ? 'text-[#ff9900]' : 'text-[#00d4ff]'} />
        <div>
          <div className="text-[10px] font-mono text-[#3d5a73] flex items-center gap-1">
            {t('autotrader.account_status_balance')}
            <span className={`px-1 rounded text-[8px] font-bold border ${
              walletMode === 'futures'
                ? 'text-[#ff9900] border-[#ff9900]/30 bg-[#ff9900]/10'
                : 'text-[#00ff88] border-[#00ff88]/30 bg-[#00ff88]/10'
            }`}>
              {walletMode === 'futures' ? t('autotrader.orders_futures') : t('autotrader.orders_spot')}
            </span>
          </div>
          {loading ? (
            <div className="flex items-center gap-1">
              <RefreshCw size={10} className="animate-spin text-[#3d5a73]" />
              <span className="text-xs font-mono text-[#3d5a73]">{t('autotrader.account_status_loading')}</span>
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
            <div className="text-[10px] font-mono text-[#3d5a73]">{t('autotrader.balance_total')}</div>
            <div className="text-xs font-bold font-mono text-[#e8f4ff]">${totalUsd.toFixed(2)}</div>
          </div>
        </div>
      )}

      {/* Last bot run */}
      {lastBotRun && (
        <div className="flex items-center gap-2 px-4 py-3 border-r border-[#1a3a5c]">
          <div>
            <div className="text-[10px] font-mono text-[#3d5a73]">{t('autotrader.account_status_last_bot')}</div>
            {lastBotRun.executed ? (
              <div className="text-xs font-bold font-mono text-[#00ff88] flex items-center gap-1">
                <CheckCircle size={10} />
                {lastBotRun.pair} {lastBotRun.bias} {lastBotRun.confidence}%
              </div>
            ) : (
              <div className="text-xs font-mono text-[#ffcc00] flex items-center gap-1">
                <Clock size={10} />
                {t('autotrader.account_status_no_signal')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Ready to trade */}
      <div className="flex items-center gap-2 px-4 py-3 ml-auto">
        {usdtBal !== null && usdtBal >= 5 ? (
          <div className="flex items-center gap-1.5 text-xs font-mono text-[#00ff88]">
            <CheckCircle size={12} />
            <span className="font-bold">{t('autotrader.balance_ready')}</span>
          </div>
        ) : usdtBal !== null && usdtBal < 5 ? (
          <div className="flex items-center gap-1.5 text-xs font-mono text-[#ffcc00]">
            <AlertCircle size={12} />
            <span>{t('autotrader.balance_insufficient')}</span>
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
