import { create } from 'zustand'

interface Price {
  [pair: string]: number
}

interface MarketState {
  prices: Price
  fearGreed: { value: number; classification: string } | null
  overview: Record<string, any> | null
  trending: any[]
  coins: any[]
  dexTrending: any[]
  news: any[]
  // Actions
  setPrices: (prices: Price) => void
  updatePrice: (pair: string, price: number) => void
  setFearGreed: (fg: any) => void
  setOverview: (data: any) => void
  setTrending: (data: any[]) => void
  setCoins: (data: any[]) => void
  setDexTrending: (data: any[]) => void
  setNews: (data: any[]) => void
}

export const useMarketStore = create<MarketState>((set) => ({
  prices: {},
  fearGreed: null,
  overview: null,
  trending: [],
  coins: [],
  dexTrending: [],
  news: [],

  setPrices: (prices) => set({ prices }),
  updatePrice: (pair, price) => set((s) => ({ prices: { ...s.prices, [pair]: price } })),
  setFearGreed: (fg) => set({ fearGreed: fg }),
  setOverview: (data) => set({ overview: data }),
  setTrending: (data) => set({ trending: data }),
  setCoins: (data) => set({ coins: data }),
  setDexTrending: (data) => set({ dexTrending: data }),
  setNews: (data) => set({ news: data }),
}))


// Signal store
interface Signal {
  id?: number
  pair: string
  timeframe: string
  bias: 'LONG' | 'SHORT' | 'WAIT'
  confidence: number
  entry: number
  stopLoss: number
  takeProfit: number
  rr: string
  analysis: string
  quality?: { overall: number; grade: string }
  indicators?: Record<string, any>
  tags?: string[]
  source?: string
  mtf?: Record<string, any>
}

interface SignalState {
  currentSignal: Signal | null
  scanResults: Signal[]
  isLoadingSignal: boolean
  isScanning: boolean
  selectedPair: string
  selectedTf: string
  setSignal: (s: Signal | null) => void
  setScanResults: (r: Signal[]) => void
  setLoadingSignal: (v: boolean) => void
  setScanning: (v: boolean) => void
  setSelectedPair: (p: string) => void
  setSelectedTf: (tf: string) => void
}

export const useSignalStore = create<SignalState>((set) => ({
  currentSignal: null,
  scanResults: [],
  isLoadingSignal: false,
  isScanning: false,
  selectedPair: 'BTC/USDT',
  selectedTf: '1H',

  setSignal: (s) => set({ currentSignal: s }),
  setScanResults: (r) => set({ scanResults: r }),
  setLoadingSignal: (v) => set({ isLoadingSignal: v }),
  setScanning: (v) => set({ isScanning: v }),
  setSelectedPair: (p) => set({ selectedPair: p }),
  setSelectedTf: (tf) => set({ selectedTf: tf }),
}))


// UI / preferences store
interface UIState {
  theme: 'dark' | 'neon' | 'midnight'
  language: 'en' | 'pt'
  sidebarOpen: boolean
  activeTab: string
  watchlist: string[]
  setTheme: (t: UIState['theme']) => void
  setLanguage: (l: UIState['language']) => void
  setSidebarOpen: (v: boolean) => void
  setActiveTab: (t: string) => void
  addToWatchlist: (pair: string) => void
  removeFromWatchlist: (pair: string) => void
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: 'dark',
  language: 'en',
  sidebarOpen: true,
  activeTab: 'dashboard',
  watchlist: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],

  setTheme: (t) => set({ theme: t }),
  setLanguage: (l) => set({ language: l }),
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setActiveTab: (t) => set({ activeTab: t }),
  addToWatchlist: (pair) => {
    const { watchlist } = get()
    if (!watchlist.includes(pair)) set({ watchlist: [...watchlist, pair] })
  },
  removeFromWatchlist: (pair) => set((s) => ({ watchlist: s.watchlist.filter((p) => p !== pair) })),
}))
