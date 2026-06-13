import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient, Session } from '@supabase/supabase-js'

declare global {
  interface Window {
    __APP_ENV__?: {
      SUPABASE_URL?: string
      SUPABASE_ANON_KEY?: string
      VITE_SUPABASE_URL?: string
      VITE_SUPABASE_ANON_KEY?: string
    }
  }
}

const runtimeEnv = typeof window !== 'undefined' ? window.__APP_ENV__ : undefined
const supabaseUrl = runtimeEnv?.VITE_SUPABASE_URL || runtimeEnv?.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || ''
const supabaseKey = runtimeEnv?.VITE_SUPABASE_ANON_KEY || runtimeEnv?.SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || ''
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null

interface WorkerStats {
  hashrateRaw: number
  hashrate1m: number
  hashrate15m: number
  sharesGood: number
  sharesTotal: number
  ping: number
  uptime: number
  diff: number
  errors: number
  pool: string
  threads: number
  version: string
}

interface WorkerInfo {
  id: string
  monero_address: string
  worker_id: string
  hostname: string
  last_seen: string
  online: boolean
  stats: WorkerStats | null
  history: { ts: number; hashrate: number; shares: number; latency: number }[]
  is_local: boolean
}

function formatHashrate(hs: number | undefined | null) {
  if (!hs || hs === 0) return '0 H/s'
  if (hs >= 1e6) return `${(hs / 1e6).toFixed(2)} MH/s`
  if (hs >= 1e3) return `${(hs / 1e3).toFixed(2)} KH/s`
  return `${hs.toFixed(2)} H/s`
}

function formatTimeAgo(timestamp: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000))
  if (seconds < 60) return 'przed chwila'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min temu`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} godz temu`
  return `${Math.floor(seconds / 86400)} dni temu`
}

function formatUptime(seconds?: number) {
  if (!seconds) return '0 min'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 24) return `${Math.floor(hours / 24)} dni ${hours % 24} godz`
  if (hours > 0) return `${hours} godz ${minutes} min`
  return `${minutes} min`
}

function isFresh(worker: WorkerInfo) {
  return Date.now() - new Date(worker.last_seen).getTime() < 5 * 60 * 1000
}

function HashrateChart({ history }: { history: WorkerInfo['history'] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || history.length < 2) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const w = rect.width
    const h = rect.height
    const padding = { top: 8, right: 8, bottom: 18, left: 48 }
    const chartW = w - padding.left - padding.right
    const chartH = h - padding.top - padding.bottom

    ctx.clearRect(0, 0, w, h)

    const rates = history.map((entry) => entry.hashrate)
    const maxRate = Math.max(...rates, 1)

    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i += 1) {
      const y = padding.top + (chartH / 4) * i
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(w - padding.right, y)
      ctx.stroke()
    }

    ctx.fillStyle = 'rgba(240,244,248,0.55)'
    ctx.font = '10px Inter, sans-serif'
    ctx.textAlign = 'right'
    for (let i = 0; i <= 4; i += 1) {
      const val = maxRate - (maxRate / 4) * i
      const y = padding.top + (chartH / 4) * i
      ctx.fillText(formatHashrate(val), padding.left - 5, y + 3)
    }

    const gradient = ctx.createLinearGradient(0, padding.top, 0, h - padding.bottom)
    gradient.addColorStop(0, 'rgba(0, 212, 255, 0.24)')
    gradient.addColorStop(1, 'rgba(0, 212, 255, 0.02)')

    ctx.beginPath()
    ctx.moveTo(padding.left, h - padding.bottom)
    history.forEach((entry, index) => {
      const x = padding.left + (index / (history.length - 1)) * chartW
      const y = padding.top + (1 - entry.hashrate / maxRate) * chartH
      ctx.lineTo(x, y)
    })
    ctx.lineTo(w - padding.right, h - padding.bottom)
    ctx.closePath()
    ctx.fillStyle = gradient
    ctx.fill()

    ctx.beginPath()
    ctx.strokeStyle = '#00d4ff'
    ctx.lineWidth = 2
    history.forEach((entry, index) => {
      const x = padding.left + (index / (history.length - 1)) * chartW
      const y = padding.top + (1 - entry.hashrate / maxRate) * chartH
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }, [history])

  return <canvas ref={canvasRef} className="hashrate-chart" />
}

function Login({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setLoading(true)
    setError('')
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (signInError || !data.session) {
      setError(signInError?.message || 'Nie udalo sie zalogowac.')
      return
    }
    onSignedIn(data.session)
  }

  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={submit}>
        <div className="brand-mark">M</div>
        <h1>Mining Dashboard</h1>
        <p>Panel admina do monitorowania workerow XMRig w czasie rzeczywistym.</p>
        <label>
          Email admina
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required />
        </label>
        <label>
          Haslo
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required />
        </label>
        {error && <div className="error-box">{error}</div>}
        <button type="submit" disabled={loading}>{loading ? 'Logowanie...' : 'Zaloguj'}</button>
      </form>
    </main>
  )
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [workers, setWorkers] = useState<WorkerInfo[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cleanupLoading, setCleanupLoading] = useState(false)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      setError('Brakuje VITE_SUPABASE_URL albo VITE_SUPABASE_ANON_KEY w konfiguracji Bolt.')
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) setWorkers([])
    })

    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || !session) return

    let active = true

    async function fetchWorkers() {
      const { data, error: fetchError } = await supabase!
        .from('workers')
        .select('*')
        .order('last_seen', { ascending: false })

      if (!active) return
      if (fetchError) {
        setError(fetchError.message)
        return
      }
      setError('')
      setWorkers((data || []) as WorkerInfo[])
    }

    fetchWorkers()

    const channel = supabase
      .channel('workers-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workers' }, fetchWorkers)
      .subscribe()

    const refreshInterval = window.setInterval(fetchWorkers, 30000)
    const cleanupInterval = window.setInterval(() => {
      cleanupWorkers(false)
    }, 60000)

    return () => {
      active = false
      supabase.removeChannel(channel)
      window.clearInterval(refreshInterval)
      window.clearInterval(cleanupInterval)
    }
  }, [session])

  async function cleanupWorkers(showLoading = true) {
    if (!supabase || !session) return
    if (showLoading) setCleanupLoading(true)
    try {
      await fetch(`${supabaseUrl}/functions/v1/mining-api/workers/cleanup`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })
    } finally {
      if (showLoading) setCleanupLoading(false)
    }
  }

  async function signOut() {
    if (!supabase) return
    await supabase.auth.signOut()
  }

  const visibleWorkers = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return workers
    return workers.filter((worker) =>
      `${worker.worker_id} ${worker.hostname} ${worker.monero_address}`.toLowerCase().includes(needle),
    )
  }, [filter, workers])

  const activeWorkers = workers.filter((worker) => worker.online && isFresh(worker)).length
  const staleWorkers = workers.filter((worker) => worker.online && !isFresh(worker)).length
  const offlineWorkers = workers.filter((worker) => !worker.online).length
  const totalHashrate = workers
    .filter((worker) => worker.online && isFresh(worker))
    .reduce((sum, worker) => sum + (worker.stats?.hashrateRaw || 0), 0)
  const totalShares = workers.reduce((sum, worker) => sum + (worker.stats?.sharesGood || 0), 0)

  if (loading) return <div className="center-state">Ladowanie dashboardu...</div>
  if (!supabase) return <div className="center-state">{error}</div>
  if (!session) return <Login onSignedIn={setSession} />

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="title-group">
            <div className="brand-mark">M</div>
            <div>
              <h1>Mining Dashboard</h1>
              <p>Realtime monitoring workerow XMRig</p>
            </div>
          </div>
          <div className="topbar-actions">
            <button className="secondary-button" onClick={() => cleanupWorkers()} disabled={cleanupLoading}>
              {cleanupLoading ? 'Czyszczenie...' : 'Cleanup offline'}
            </button>
            <button className="secondary-button" onClick={signOut}>Wyloguj</button>
          </div>
        </div>
      </header>

      <main className="content">
        {error && <div className="error-box">{error}</div>}

        <section className="stats-grid">
          <div className="stat-card">
            <span>Aktywne</span>
            <strong>{activeWorkers}</strong>
          </div>
          <div className="stat-card">
            <span>Hashrate</span>
            <strong>{formatHashrate(totalHashrate)}</strong>
          </div>
          <div className="stat-card">
            <span>Share</span>
            <strong>{totalShares.toLocaleString()}</strong>
          </div>
          <div className="stat-card warn">
            <span>Nieaktualne</span>
            <strong>{staleWorkers}</strong>
          </div>
          <div className="stat-card danger">
            <span>Offline</span>
            <strong>{offlineWorkers}</strong>
          </div>
        </section>

        <section className="workers-section">
          <div className="section-header">
            <div>
              <h2>Workery</h2>
              <p>{workers.length} zarejestrowanych maszyn</p>
            </div>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filtr: worker, host, adres..."
            />
          </div>

          {visibleWorkers.length === 0 ? (
            <div className="empty-state">
              <strong>Brak workerow</strong>
              <span>Po uruchomieniu workera pojawi sie tutaj automatycznie.</span>
            </div>
          ) : (
            <div className="workers-grid">
              {visibleWorkers.map((worker) => {
                const fresh = isFresh(worker)
                const online = worker.online && fresh
                const status = online ? 'Online' : worker.online ? 'Stale' : 'Offline'
                return (
                  <article className={`worker-card ${online ? 'online' : 'offline'}`} key={worker.id}>
                    <div className="worker-head">
                      <div>
                        <h3>{worker.worker_id}</h3>
                        <span>{worker.hostname}</span>
                      </div>
                      <span className={`status-pill ${online ? 'ok' : worker.online ? 'warn' : 'bad'}`}>{status}</span>
                    </div>

                    <div className="metric-grid">
                      <div>
                        <span>Hashrate</span>
                        <strong>{formatHashrate(worker.stats?.hashrateRaw)}</strong>
                      </div>
                      <div>
                        <span>1m / 15m</span>
                        <strong>{formatHashrate(worker.stats?.hashrate1m)} / {formatHashrate(worker.stats?.hashrate15m)}</strong>
                      </div>
                      <div>
                        <span>Ping</span>
                        <strong>{worker.stats ? `${worker.stats.ping} ms` : 'N/A'}</strong>
                      </div>
                      <div>
                        <span>Uptime</span>
                        <strong>{formatUptime(worker.stats?.uptime)}</strong>
                      </div>
                    </div>

                    <div className="meta-row">
                      <span>Pool: {worker.stats?.pool || 'N/A'}</span>
                      <span>Watki: {worker.stats?.threads || 0}</span>
                      <span>Diff: {worker.stats?.diff || 0}</span>
                    </div>

                    {worker.history && worker.history.length > 2 && (
                      <div className="chart-panel">
                        <span>Historia hashrate</span>
                        <HashrateChart history={worker.history} />
                      </div>
                    )}

                    <div className="address">{worker.monero_address}</div>
                    <div className="last-seen">Ostatnio widziany: {formatTimeAgo(worker.last_seen)}</div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
