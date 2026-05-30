/**
 * AIMasterCrypto — QuantPanel V7
 * ================================
 * Painel de análise quantitativa para o SignalCard.
 * Mostra edge score, probabilidades, expected value e regime.
 *
 * USO no SignalCard:
 *   import QuantPanel from '@/components/QuantPanel'
 *
 *   // No JSX do SignalCard, após o AI analysis:
 *   {signal.quant && <QuantPanel quant={signal.quant} />}
 *
 * TIPO esperado para signal.quant:
 *   {
 *     regime: string           // TREND_UP | TREND_DOWN | RANGE | CHOPPY | VOLATILE
 *     regime_note: string      // descrição do regime
 *     edge_score: number       // 0-100
 *     tp_probability: number   // 0-100
 *     sl_probability: number   // 0-100
 *     expected_rr: number      // em múltiplos de risco (ex: +0.75)
 *     quant_bias: string       // LONG | SHORT | WAIT
 *     quant_confidence: number // 0-100
 *     entry_probability: number
 *   }
 */

import React from 'react'

// ── Tipos ────────────────────────────────────────────────────────────────────

interface QuantData {
  regime: string
  regime_note?: string
  edge_score: number
  tp_probability: number
  sl_probability: number
  expected_rr: number
  quant_bias: string
  quant_confidence: number
  entry_probability?: number
}

interface QuantPanelProps {
  quant: QuantData
  className?: string
}

// ── Configuração de regimes ───────────────────────────────────────────────────

const REGIME_CONFIG: Record<string, { color: string; label: string; desc: string }> = {
  TREND_UP:   { color: '#00ff88', label: 'Trend ↑', desc: 'Momentum bullish confirmado' },
  TREND_DOWN: { color: '#ff4466', label: 'Trend ↓', desc: 'Momentum bearish confirmado' },
  RANGE:      { color: '#ffcc00', label: 'Range',   desc: 'Mercado lateralizado' },
  CHOPPY:     { color: '#ff8833', label: 'Choppy',  desc: 'Alta incerteza — cuidado' },
  VOLATILE:   { color: '#b366ff', label: 'Volátil', desc: 'Volatilidade extrema' },
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function ProbBar({
  label,
  value,
  color,
  width = 'w-16',
}: {
  label: string
  value: number
  color: string
  width?: string
}) {
  return (
    <div className="flex items-center gap-3">
      <span className={`text-[9px] font-mono text-[#3d5a73] ${width} shrink-0`}>
        {label}
      </span>
      <div className="flex-1 h-1.5 bg-[#0c1f35] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.min(value, 100)}%`, background: color }}
        />
      </div>
      <span
        className="text-xs font-bold font-mono w-10 text-right shrink-0"
        style={{ color }}
      >
        {value.toFixed(1)}%
      </span>
    </div>
  )
}

function EdgeBar({ score }: { score: number }) {
  const color =
    score >= 75 ? '#00ff88'
    : score >= 55 ? '#00d4ff'
    : score >= 35 ? '#ffcc00'
    : '#ff4466'

  const label =
    score >= 75 ? 'Forte'
    : score >= 55 ? 'Moderado'
    : score >= 35 ? 'Fraco'
    : 'Sem edge'

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-mono text-[#3d5a73]">EDGE SCORE</span>
        <span className="text-[9px] font-mono" style={{ color }}>
          {label}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-[#0c1f35] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${score}%`, background: color }}
          />
        </div>
        <span className="text-sm font-bold font-mono" style={{ color }}>
          {score.toFixed(0)}
        </span>
        <span className="text-[9px] font-mono text-[#3d5a73]">/100</span>
      </div>
    </div>
  )
}

function ExpectedValue({ ev }: { ev: number }) {
  const positive = ev > 0
  const color = positive ? '#00ff88' : '#ff4466'
  const sign = ev > 0 ? '+' : ''

  return (
    <div>
      <div className="text-[9px] font-mono text-[#3d5a73] mb-1">VALOR ESPERADO</div>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-bold font-mono" style={{ color }}>
          {sign}{ev.toFixed(2)}
        </span>
        <span className="text-[9px] font-mono text-[#3d5a73]">R</span>
      </div>
      <div className="text-[8px] font-mono mt-0.5" style={{ color: `${color}80` }}>
        {positive
          ? `Por cada 1R arriscado, expectativa de ganho é ${ev.toFixed(2)}R`
          : 'Edge negativo — setup não recomendado'}
      </div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function QuantPanel({ quant, className = '' }: QuantPanelProps) {
  const regime = REGIME_CONFIG[quant.regime] ?? {
    color: '#8ba3be',
    label: quant.regime,
    desc: '',
  }

  const showWaitWarning = quant.quant_bias === 'WAIT'

  return (
    <div className={`border-t border-[#1a3a5c] ${className}`}>
      {/* Header */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 mb-1">
          {/* Indicador de regime */}
          <div
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ background: regime.color }}
          />
          <span className="text-[9px] font-mono uppercase tracking-widest text-[#3d5a73]">
            Análise Quantitativa
          </span>

          {/* Badge de regime */}
          <span
            className="ml-auto text-[9px] font-mono px-2 py-0.5 rounded border"
            style={{
              color: regime.color,
              borderColor: `${regime.color}40`,
              background: `${regime.color}10`,
            }}
          >
            {regime.label}
          </span>
        </div>

        {/* Nota do regime */}
        {quant.regime_note && (
          <p className="text-[8px] font-mono text-[#3d5a73] leading-relaxed">
            {quant.regime_note}
          </p>
        )}
      </div>

      {/* Warning se WAIT */}
      {showWaitWarning && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-lg bg-[#ff883310] border border-[#ff883330]">
          <span className="text-[10px] font-mono text-[#ff8833]">
            ⚠ Motor quant sem edge suficiente — setup não recomendado
          </span>
        </div>
      )}

      {/* Grid principal */}
      <div className="px-4 pb-3 space-y-4">

        {/* Edge Score */}
        <EdgeBar score={quant.edge_score} />

        {/* EV + Confidence em grid */}
        <div className="grid grid-cols-2 gap-4">
          <ExpectedValue ev={quant.expected_rr} />

          <div>
            <div className="text-[9px] font-mono text-[#3d5a73] mb-1">CONFIANÇA QUANT</div>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-bold font-mono text-[#00d4ff]">
                {quant.quant_confidence.toFixed(0)}
              </span>
              <span className="text-[9px] font-mono text-[#3d5a73]">%</span>
            </div>
            <div className="text-[8px] font-mono mt-0.5 text-[#3d5a73]">
              Calibrado por indicadores
            </div>
          </div>
        </div>

        {/* Barras de probabilidade */}
        <div className="space-y-2">
          <ProbBar
            label="P(TP HIT)"
            value={quant.tp_probability}
            color="#00ff88"
          />
          <ProbBar
            label="P(SL HIT)"
            value={quant.sl_probability}
            color="#ff4466"
          />
          {quant.entry_probability !== undefined && (
            <ProbBar
              label="P(ENTRY)"
              value={quant.entry_probability}
              color="#00d4ff"
            />
          )}
        </div>

        {/* Disclaimer */}
        <p className="text-[8px] font-mono text-[#2a4a63] leading-relaxed border-t border-[#1a3a5c] pt-2">
          Probabilidades estimadas com base em alinhamento de indicadores e regime de mercado.
          Não garantem resultados futuros.
        </p>
      </div>
    </div>
  )
}
