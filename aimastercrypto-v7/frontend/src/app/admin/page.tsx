'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Users, BarChart3, Activity, Shield, Ban, CheckCircle, XCircle,
  Search, RefreshCw, LogOut, Brain, TrendingUp, Zap, Eye, X,
  ChevronLeft, ChevronRight, Star, AlertTriangle
} from 'lucide-react'
import {
  getMe, adminStats, adminListUsers, adminBanUser, adminUnbanUser,
  adminUpdateUser, adminSignals, adminActivity, logout,
  adminOperations, adminSignalAnalytics
} from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────

interface AdminUser {
  id: number; email: string; username: string; role: string
  is_active: boolean; is_banned: boolean; ban_reason?: string
  email_verified: boolean; last_login?: string; created_at?: string
}

interface AdminSignal {
  id: number; pair: string; timeframe: string; bias: string
  confidence: number; quality_grade: string; result: string; created_at?: string
}

// ── Utility ───────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  admin: '#b366ff', superadmin: '#ff4466', premium: '#ffcc00', free: '#8ba3be',
}

const BIAS_COLORS: Record<string, string> = {
  LONG: '#00ff88', SHORT: '#ff4466', WAIT: '#ffcc00',
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase"
      style={{ color, background: `${color}15`, border: `1px solid ${color}30` }}>
      {label}
    </span>
  )
}

function StatCard({ label, value, icon: Icon, color }: any) {
  return (
    <div className="p-5 rounded-xl relative overflow-hidden"
      style={{ background: '#0a1f35', border: '1px solid #1a3a5c' }}>
      <div className="absolute top-0 right-0 w-20 h-20 rounded-full opacity-5 blur-2xl"
        style={{ background: color, transform: 'translate(30%, -30%)' }} />
      <div className="flex items-start justify-between mb-3">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[#8ba3be]">{label}</span>
        <Icon size={16} style={{ color }} className="opacity-60" />
      </div>
      <div className="text-3xl font-bold font-mono" style={{ color }}>{value ?? '—'}</div>
    </div>
  )
}

// ── Main Admin Panel ──────────────────────────────────────────────────────

export default function AdminPage() {
  const router = useRouter()
  const [authUser, setAuthUser] = useState<any>(null)
  const [checking, setChecking] = useState(true)
  const [tab, setTab] = useState<'overview' | 'users' | 'signals' | 'activity' | 'operations'>('overview')

  // Stats
  const [stats, setStats] = useState<any>(null)
  const [statsLoading, setStatsLoading] = useState(false)

  // Users
  const [users, setUsers] = useState<AdminUser[]>([])
  const [usersTotal, setUsersTotal] = useState(0)
  const [usersPage, setUsersPage] = useState(1)
  const [usersPages, setUsersPages] = useState(1)
  const [usersLoading, setUsersLoading] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [bannedFilter, setBannedFilter] = useState<boolean | undefined>()
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [banModal, setBanModal] = useState<AdminUser | null>(null)
  const [banReason, setBanReason] = useState('')
  const [banPermanent, setBanPermanent] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  // Signals
  const [signals, setSignals] = useState<AdminSignal[]>([])
  const [signalsStats, setSignalsStats] = useState<any>(null)
  const [signalsLoading, setSignalsLoading] = useState(false)
  const [signalsPage, setSignalsPage] = useState(1)
  const [signalsPages, setSignalsPages] = useState(1)

  // Activity
  const [activity, setActivity] = useState<any[]>([])
  const [activityLoading, setActivityLoading] = useState(false)

  // V7 — Operations dashboard
  const [ops, setOps] = useState<any>(null)
  const [opsLoading, setOpsLoading] = useState(false)
  const [signalAnalytics, setSignalAnalytics] = useState<any>(null)

  // Auth check
  useEffect(() => {
    getMe().then((u) => {
      if (u.role !== 'admin' && u.role !== 'superadmin') {
        router.replace('/')
        return
      }
      setAuthUser(u)
      setChecking(false)
    }).catch(() => router.replace('/login'))
  }, [router])

  // Load stats on overview tab
  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    try { setStats(await adminStats()) } catch { } finally { setStatsLoading(false) }
  }, [])

  useEffect(() => { if (!checking && tab === 'overview') loadStats() }, [tab, checking, loadStats])

  // Load users
  const loadUsers = useCallback(async () => {
    setUsersLoading(true)
    try {
      const data = await adminListUsers({
        page: usersPage, limit: 20,
        search: userSearch || undefined,
        role: roleFilter || undefined,
        banned: bannedFilter,
      })
      setUsers(data.users)
      setUsersTotal(data.total)
      setUsersPages(data.pages)
    } catch { } finally { setUsersLoading(false) }
  }, [usersPage, userSearch, roleFilter, bannedFilter])

  useEffect(() => { if (!checking && tab === 'users') loadUsers() }, [tab, checking, loadUsers])

  // Load signals
  const loadSignals = useCallback(async () => {
    setSignalsLoading(true)
    try {
      const data = await adminSignals({ page: signalsPage, limit: 50 })
      setSignals(data.signals)
      setSignalsStats(data.stats)
      setSignalsPages(data.pages)
    } catch { } finally { setSignalsLoading(false) }
  }, [signalsPage])

  useEffect(() => { if (!checking && tab === 'signals') loadSignals() }, [tab, checking, loadSignals])

  // Carregar dados de operations quando tab muda
  const loadOps = useCallback(async () => {
    setOpsLoading(true)
    try {
      const [opsData, analyticsData] = await Promise.all([
        adminOperations(),
        adminSignalAnalytics(30),
      ])
      setOps(opsData)
      setSignalAnalytics(analyticsData)
    } catch { } finally { setOpsLoading(false) }
  }, [])

  // Load activity
  useEffect(() => {
    if (!checking && tab === 'activity') {
      setActivityLoading(true)
      adminActivity(100).then(d => setActivity(d.activity || [])).catch(() => {}).finally(() => setActivityLoading(false))
    }
    if (!checking && tab === 'operations') loadOps()
  }, [tab, checking, loadOps])

  const handleBan = async () => {
    if (!banModal || !banReason) return
    setActionLoading(true)
    try {
      await adminBanUser(banModal.id, banReason, banPermanent)
      setBanModal(null)
      setBanReason('')
      loadUsers()
    } catch { } finally { setActionLoading(false) }
  }

  const handleUnban = async (user: AdminUser) => {
    setActionLoading(true)
    try { await adminUnbanUser(user.id); loadUsers() } catch { } finally { setActionLoading(false) }
  }

  const handleRoleChange = async (user: AdminUser, role: string) => {
    setActionLoading(true)
    try { await adminUpdateUser(user.id, { role }); loadUsers() } catch { } finally { setActionLoading(false) }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#020b14' }}>
        <div className="w-10 h-10 rounded-full border-2 border-[#b366ff]/30 border-t-[#b366ff] animate-spin" />
      </div>
    )
  }

  const navItems = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'signals', label: 'Signals', icon: Zap },
    { id: 'activity', label: 'Activity', icon: Activity },
    { id: 'operations', label: 'Ops V7', icon: Activity },
  ] as const

  return (
    <div className="min-h-screen" style={{ background: '#020b14' }}>
      {/* Ban Modal */}
      {banModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(2,11,20,0.9)', backdropFilter: 'blur(8px)' }}>
          <div className="w-full max-w-md rounded-2xl p-6"
            style={{ background: '#0a1f35', border: '1px solid #ff446640' }}>
            <div className="flex items-center gap-3 mb-4">
              <Ban size={18} className="text-[#ff4466]" />
              <h3 className="font-bold text-[#e8f4ff]">Ban User</h3>
            </div>
            <p className="text-sm text-[#8ba3be] mb-4">
              Ban <span className="text-[#e8f4ff] font-bold">{banModal.username}</span> ({banModal.email})
            </p>
            <textarea value={banReason} onChange={(e) => setBanReason(e.target.value)}
              placeholder="Reason for ban..."
              rows={3}
              className="w-full rounded-lg px-3 py-2.5 text-sm font-mono text-[#e8f4ff] outline-none resize-none mb-3"
              style={{ background: '#071524', border: '1px solid #1a3a5c' }} />
            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input type="checkbox" checked={banPermanent} onChange={(e) => setBanPermanent(e.target.checked)}
                className="w-4 h-4 rounded accent-[#ff4466]" />
              <span className="text-sm font-mono text-[#8ba3be]">Permanent ban</span>
            </label>
            <div className="flex gap-2">
              <button onClick={() => { setBanModal(null); setBanReason('') }}
                className="flex-1 py-2.5 rounded-lg text-sm font-bold text-[#8ba3be] transition-all"
                style={{ background: '#071524', border: '1px solid #1a3a5c' }}>
                Cancel
              </button>
              <button onClick={handleBan} disabled={!banReason || actionLoading}
                className="flex-1 py-2.5 rounded-lg text-sm font-bold transition-all disabled:opacity-40"
                style={{ background: '#ff446615', border: '1px solid #ff446640', color: '#ff4466' }}>
                {actionLoading ? <RefreshCw size={14} className="animate-spin mx-auto" /> : 'Confirm Ban'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <nav className="sticky top-0 z-40 border-b border-[#1a3a5c]"
        style={{ background: '#020b14cc', backdropFilter: 'blur(20px)' }}>
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <a href="/" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #b366ff, #7700cc)' }}>
                <Brain size={14} className="text-white" />
              </div>
              <span className="text-sm font-bold text-[#e8f4ff]">AIMasterCrypto</span>
            </a>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded"
              style={{ background: '#b366ff15', border: '1px solid #b366ff30', color: '#b366ff' }}>
              ADMIN
            </span>
          </div>

          <div className="flex items-center gap-2">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id as any)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={tab === id ? {
                  background: '#b366ff15', border: '1px solid #b366ff30', color: '#b366ff'
                } : { color: '#8ba3be' }}>
                <Icon size={12} />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:block text-xs font-mono text-[#8ba3be]">{authUser?.username}</span>
            <button onClick={logout}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8ba3be] hover:text-[#ff4466] transition-colors"
              style={{ background: '#0c1f35', border: '1px solid #1a3a5c' }}>
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-6">

        {/* ── OVERVIEW ─────────────────────────────────────────────────────── */}
        {tab === 'overview' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold text-[#e8f4ff]">Platform Overview</h1>
              <button onClick={loadStats} disabled={statsLoading}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono text-[#8ba3be] transition-all"
                style={{ background: '#0c1f35', border: '1px solid #1a3a5c' }}>
                <RefreshCw size={12} className={statsLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>

            {stats && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <StatCard label="Total Users" value={stats.users?.total} icon={Users} color="#00d4ff" />
                  <StatCard label="Verified" value={stats.users?.verified} icon={CheckCircle} color="#00ff88" />
                  <StatCard label="Premium" value={stats.users?.premium} icon={Star} color="#ffcc00" />
                  <StatCard label="Banned" value={stats.users?.banned} icon={Ban} color="#ff4466" />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* AI Providers */}
                  <div className="rounded-xl p-5" style={{ background: '#0a1f35', border: '1px solid #1a3a5c' }}>
                    <h3 className="text-sm font-bold text-[#e8f4ff] mb-4 flex items-center gap-2">
                      <Brain size={14} className="text-[#b366ff]" /> AI Providers
                    </h3>
                    {Object.entries(stats.ai_providers || {}).map(([key, active]: [string, any]) => (
                      <div key={key} className="flex items-center justify-between py-2 border-b border-[#071524] last:border-0">
                        <span className="text-xs font-mono uppercase text-[#8ba3be]">{key}</span>
                        <span className={`text-xs font-mono ${active ? 'text-[#00ff88]' : 'text-[#ff4466]'}`}>
                          {active ? '● Active' : '● Inactive'}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Signals */}
                  <div className="rounded-xl p-5" style={{ background: '#0a1f35', border: '1px solid #1a3a5c' }}>
                    <h3 className="text-sm font-bold text-[#e8f4ff] mb-4 flex items-center gap-2">
                      <TrendingUp size={14} className="text-[#00d4ff]" /> Signal Stats
                    </h3>
                    <div className="text-4xl font-bold font-mono text-[#00d4ff] mb-2">
                      {stats.signals?.total || 0}
                    </div>
                    <div className="text-xs font-mono text-[#3d5a73]">Total signals generated</div>
                  </div>
                </div>
              </>
            )}

            {statsLoading && (
              <div className="flex justify-center py-12">
                <div className="w-10 h-10 rounded-full border-2 border-[#b366ff]/30 border-t-[#b366ff] animate-spin" />
              </div>
            )}
          </div>
        )}

        {/* ── USERS ────────────────────────────────────────────────────────── */}
        {tab === 'users' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h1 className="text-xl font-bold text-[#e8f4ff]">
                Users <span className="text-sm text-[#3d5a73] font-normal">({usersTotal} total)</span>
              </h1>
              <button onClick={loadUsers}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono text-[#8ba3be]"
                style={{ background: '#0c1f35', border: '1px solid #1a3a5c' }}>
                <RefreshCw size={12} className={usersLoading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-48">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3d5a73]" />
                <input
                  value={userSearch} onChange={(e) => { setUserSearch(e.target.value); setUsersPage(1) }}
                  placeholder="Search email or username..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg text-xs font-mono text-[#e8f4ff] outline-none"
                  style={{ background: '#0a1f35', border: '1px solid #1a3a5c' }}
                />
              </div>
              <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setUsersPage(1) }}
                className="px-3 py-2 rounded-lg text-xs font-mono text-[#e8f4ff] outline-none"
                style={{ background: '#0a1f35', border: '1px solid #1a3a5c' }}>
                <option value="">All roles</option>
                <option value="free">Free</option>
                <option value="premium">Premium</option>
                <option value="admin">Admin</option>
              </select>
              <select
                value={bannedFilter === undefined ? '' : String(bannedFilter)}
                onChange={(e) => { setBannedFilter(e.target.value === '' ? undefined : e.target.value === 'true'); setUsersPage(1) }}
                className="px-3 py-2 rounded-lg text-xs font-mono text-[#e8f4ff] outline-none"
                style={{ background: '#0a1f35', border: '1px solid #1a3a5c' }}>
                <option value="">All status</option>
                <option value="false">Active</option>
                <option value="true">Banned</option>
              </select>
            </div>

            {/* Table */}
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1a3a5c' }}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background: '#0a1f35', borderBottom: '1px solid #1a3a5c' }}>
                      {['User', 'Role', 'Verified', 'Status', 'Last Login', 'Actions'].map(h => (
                        <th key={h} className="text-left p-4 font-mono text-[#3d5a73] font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {usersLoading ? (
                      <tr><td colSpan={6} className="p-8 text-center text-[#3d5a73] font-mono">Loading...</td></tr>
                    ) : users.length === 0 ? (
                      <tr><td colSpan={6} className="p-8 text-center text-[#3d5a73] font-mono">No users found</td></tr>
                    ) : users.map(u => (
                      <tr key={u.id}
                        style={{ background: u.is_banned ? '#ff446605' : '#071524', borderBottom: '1px solid #0a1f35' }}>
                        <td className="p-4">
                          <div className="font-bold text-[#e8f4ff]">{u.username}</div>
                          <div className="text-[#3d5a73] font-mono">{u.email}</div>
                        </td>
                        <td className="p-4">
                          <Badge label={u.role} color={ROLE_COLORS[u.role] || '#8ba3be'} />
                        </td>
                        <td className="p-4">
                          {u.email_verified
                            ? <CheckCircle size={14} className="text-[#00ff88]" />
                            : <XCircle size={14} className="text-[#ff4466]" />}
                        </td>
                        <td className="p-4">
                          {u.is_banned
                            ? <Badge label="BANNED" color="#ff4466" />
                            : <Badge label="ACTIVE" color="#00ff88" />}
                        </td>
                        <td className="p-4 font-mono text-[#3d5a73] whitespace-nowrap">
                          {u.last_login ? new Date(u.last_login).toLocaleDateString() : '—'}
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-1">
                            {/* Role quick change */}
                            {u.role === 'free' && (
                              <button onClick={() => handleRoleChange(u, 'premium')}
                                className="px-2 py-1 rounded text-[10px] font-mono font-bold transition-all"
                                style={{ background: '#ffcc0015', border: '1px solid #ffcc0030', color: '#ffcc00' }}
                                title="Upgrade to Premium">
                                + Premium
                              </button>
                            )}
                            {u.role === 'premium' && (
                              <button onClick={() => handleRoleChange(u, 'free')}
                                className="px-2 py-1 rounded text-[10px] font-mono font-bold transition-all"
                                style={{ background: '#8ba3be15', border: '1px solid #8ba3be30', color: '#8ba3be' }}
                                title="Downgrade to Free">
                                − Premium
                              </button>
                            )}
                            {/* Ban / Unban */}
                            {u.is_banned ? (
                              <button onClick={() => handleUnban(u)} disabled={actionLoading}
                                className="px-2 py-1 rounded text-[10px] font-mono font-bold transition-all"
                                style={{ background: '#00ff8815', border: '1px solid #00ff8830', color: '#00ff88' }}>
                                Unban
                              </button>
                            ) : u.role !== 'admin' && u.role !== 'superadmin' ? (
                              <button onClick={() => setBanModal(u)}
                                className="px-2 py-1 rounded text-[10px] font-mono font-bold transition-all"
                                style={{ background: '#ff446615', border: '1px solid #ff446630', color: '#ff4466' }}>
                                Ban
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
            {usersPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <button onClick={() => setUsersPage(p => Math.max(1, p - 1))} disabled={usersPage === 1}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8ba3be] disabled:opacity-30"
                  style={{ background: '#0a1f35', border: '1px solid #1a3a5c' }}>
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs font-mono text-[#8ba3be]">{usersPage} / {usersPages}</span>
                <button onClick={() => setUsersPage(p => Math.min(usersPages, p + 1))} disabled={usersPage === usersPages}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8ba3be] disabled:opacity-30"
                  style={{ background: '#0a1f35', border: '1px solid #1a3a5c' }}>
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── SIGNALS ──────────────────────────────────────────────────────── */}
        {tab === 'signals' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold text-[#e8f4ff]">Signal Monitor</h1>
              <button onClick={loadSignals}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono text-[#8ba3be]"
                style={{ background: '#0c1f35', border: '1px solid #1a3a5c' }}>
                <RefreshCw size={12} className={signalsLoading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>

            {signalsStats && (
              <div className="grid grid-cols-3 gap-4">
                <StatCard label="Win Rate" value={`${signalsStats.win_rate}%`} icon={TrendingUp} color="#00ff88" />
                <StatCard label="Wins" value={signalsStats.wins} icon={CheckCircle} color="#00ff88" />
                <StatCard label="Losses" value={signalsStats.losses} icon={XCircle} color="#ff4466" />
              </div>
            )}

            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1a3a5c' }}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background: '#0a1f35', borderBottom: '1px solid #1a3a5c' }}>
                      {['Pair', 'TF', 'Bias', 'Confidence', 'Grade', 'Result', 'Date'].map(h => (
                        <th key={h} className="text-left p-4 font-mono text-[#3d5a73] font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {signalsLoading ? (
                      <tr><td colSpan={7} className="p-8 text-center text-[#3d5a73] font-mono">Loading...</td></tr>
                    ) : signals.length === 0 ? (
                      <tr><td colSpan={7} className="p-8 text-center text-[#3d5a73] font-mono">No signals recorded yet</td></tr>
                    ) : signals.map(s => (
                      <tr key={s.id} style={{ background: '#071524', borderBottom: '1px solid #0a1f35' }}>
                        <td className="p-4 font-bold font-mono text-[#e8f4ff]">{s.pair}</td>
                        <td className="p-4 font-mono text-[#8ba3be]">{s.timeframe}</td>
                        <td className="p-4"><Badge label={s.bias} color={BIAS_COLORS[s.bias] || '#8ba3be'} /></td>
                        <td className="p-4">
                          <span className="font-mono font-bold" style={{
                            color: s.confidence >= 75 ? '#00ff88' : s.confidence >= 60 ? '#00d4ff' : '#ffcc00'
                          }}>{s.confidence}%</span>
                        </td>
                        <td className="p-4 font-mono font-bold" style={{ color: '#b366ff' }}>{s.quality_grade || '—'}</td>
                        <td className="p-4"><Badge label={s.result} color={s.result === 'WIN' ? '#00ff88' : s.result === 'LOSS' ? '#ff4466' : '#8ba3be'} /></td>
                        <td className="p-4 font-mono text-[#3d5a73]">
                          {s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── ACTIVITY ─────────────────────────────────────────────────────── */}
        {tab === 'activity' && (
          <div className="space-y-4">
            <h1 className="text-xl font-bold text-[#e8f4ff]">Login Activity</h1>
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1a3a5c' }}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background: '#0a1f35', borderBottom: '1px solid #1a3a5c' }}>
                      {['Email', 'IP Address', 'Status', 'Timestamp'].map(h => (
                        <th key={h} className="text-left p-4 font-mono text-[#3d5a73] font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activityLoading ? (
                      <tr><td colSpan={4} className="p-8 text-center text-[#3d5a73] font-mono">Loading...</td></tr>
                    ) : activity.length === 0 ? (
                      <tr><td colSpan={4} className="p-8 text-center text-[#3d5a73] font-mono">No activity logged yet</td></tr>
                    ) : activity.map((a, i) => (
                      <tr key={i} style={{ background: '#071524', borderBottom: '1px solid #0a1f35' }}>
                        <td className="p-4 font-mono text-[#8ba3be]">{a.email}</td>
                        <td className="p-4 font-mono text-[#3d5a73]">{a.ip_address}</td>
                        <td className="p-4">
                          {a.success
                            ? <Badge label="SUCCESS" color="#00ff88" />
                            : <Badge label="FAILED" color="#ff4466" />}
                        </td>
                        <td className="p-4 font-mono text-[#3d5a73]">
                          {a.created_at ? new Date(a.created_at).toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Operations V7 ─────────────────────────────────────────────── */}
        {tab === 'operations' && (
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white font-mono">Ops Dashboard V7</h2>
              <button onClick={loadOps} className="text-xs font-mono text-[#00d4ff] border border-[#00d4ff30] px-3 py-1 rounded hover:bg-[#00d4ff10]">
                ↻ Refresh
              </button>
            </div>
            {opsLoading && <p className="text-[#3d5a73] font-mono">A carregar métricas...</p>}
            {ops && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Background Tasks */}
                <div className="rounded-xl p-4 border border-[#1a3a5c]" style={{ background: '#071524' }}>
                  <p className="text-[10px] font-mono text-[#3d5a73] mb-3 uppercase tracking-widest">Background Tasks</p>
                  {ops.background_tasks ? (
                    <div className="space-y-1">
                      {Object.entries(ops.background_tasks).map(([k, v]) => (
                        <div key={k} className="flex justify-between">
                          <span className="text-xs font-mono text-[#8ba3be]">{k}</span>
                          <span className="text-xs font-mono text-white">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-xs font-mono text-[#3d5a73]">Não disponível</p>}
                </div>
                {/* WebSockets */}
                <div className="rounded-xl p-4 border border-[#1a3a5c]" style={{ background: '#071524' }}>
                  <p className="text-[10px] font-mono text-[#3d5a73] mb-3 uppercase tracking-widest">WebSocket Throttler</p>
                  {ops.websockets ? (
                    <div className="space-y-1">
                      {Object.entries(ops.websockets).map(([k, v]) => (
                        <div key={k} className="flex justify-between">
                          <span className="text-xs font-mono text-[#8ba3be]">{k}</span>
                          <span className="text-xs font-mono text-white">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-xs font-mono text-[#3d5a73]">Não disponível</p>}
                </div>
                {/* Redis */}
                <div className="rounded-xl p-4 border border-[#1a3a5c]" style={{ background: '#071524' }}>
                  <p className="text-[10px] font-mono text-[#3d5a73] mb-3 uppercase tracking-widest">Redis</p>
                  {ops.redis?.available ? (
                    <div className="space-y-1">
                      <div className="flex justify-between"><span className="text-xs font-mono text-[#8ba3be]">Clients</span><span className="text-xs font-mono text-white">{ops.redis.connected_clients}</span></div>
                      <div className="flex justify-between"><span className="text-xs font-mono text-[#8ba3be]">Memory</span><span className="text-xs font-mono text-white">{ops.redis.used_memory_human}</span></div>
                      <div className="flex justify-between"><span className="text-xs font-mono text-[#8ba3be]">Hit Rate</span><span className="text-xs font-mono text-[#00ff88]">{ops.redis.hit_rate_pct}%</span></div>
                      <div className="flex justify-between"><span className="text-xs font-mono text-[#8ba3be]">Keys</span><span className="text-xs font-mono text-white">{ops.redis.total_keys}</span></div>
                    </div>
                  ) : <p className="text-xs font-mono text-[#ff4466]">Redis não disponível</p>}
                </div>
                {/* AI Providers */}
                <div className="rounded-xl p-4 border border-[#1a3a5c]" style={{ background: '#071524' }}>
                  <p className="text-[10px] font-mono text-[#3d5a73] mb-3 uppercase tracking-widest">AI Providers</p>
                  <div className="space-y-1">
                    {Object.entries(ops.ai_providers || {}).map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <span className="text-xs font-mono text-[#8ba3be]">{k}</span>
                        <Badge label={v ? 'OK' : 'N/A'} color={v ? '#00ff88' : '#3d5a73'} />
                      </div>
                    ))}
                    <div className="flex justify-between mt-2">
                      <span className="text-xs font-mono text-[#8ba3be]">stripe</span>
                      <Badge label={ops.config?.stripe_configured ? 'OK' : 'N/A'} color={ops.config?.stripe_configured ? '#00ff88' : '#3d5a73'} />
                    </div>
                  </div>
                </div>
              </div>
            )}
            {/* Signal Analytics */}
            {signalAnalytics && (
              <div className="rounded-xl p-4 border border-[#1a3a5c]" style={{ background: '#071524' }}>
                <p className="text-[10px] font-mono text-[#3d5a73] mb-3 uppercase tracking-widest">Signal Analytics — 30 dias</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <StatCard label="Total" value={signalAnalytics.summary?.total_signals} icon={Zap} color="#00d4ff" />
                  <StatCard label="Win Rate" value={`${signalAnalytics.summary?.win_rate_pct}%`} icon={TrendingUp} color="#00ff88" />
                  <StatCard label="Wins" value={signalAnalytics.summary?.wins} icon={CheckCircle} color="#00ff88" />
                  <StatCard label="Avg Confidence" value={`${signalAnalytics.summary?.avg_confidence}%`} icon={Activity} color="#ffcc00" />
                </div>
                <table className="w-full text-xs font-mono">
                  <thead><tr style={{ borderBottom: '1px solid #1a3a5c' }}>
                    {['Timeframe','Total','Win Rate','Avg Conf','Avg Quality'].map(h => (
                      <th key={h} className="text-left p-2 text-[#3d5a73]">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {(signalAnalytics.by_timeframe || []).map((r: any) => (
                      <tr key={r.timeframe} style={{ borderBottom: '1px solid #0a1f35' }}>
                        <td className="p-2 text-white">{r.timeframe}</td>
                        <td className="p-2 text-[#8ba3be]">{r.total}</td>
                        <td className="p-2" style={{ color: r.win_rate_pct >= 55 ? '#00ff88' : '#ff4466' }}>{r.win_rate_pct}%</td>
                        <td className="p-2 text-[#8ba3be]">{r.avg_confidence}%</td>
                        <td className="p-2 text-[#8ba3be]">{r.avg_quality}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
