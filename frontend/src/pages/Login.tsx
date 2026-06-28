import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api/client'
import { authStore } from '../store/auth'

export default function Login() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await authApi.login(username, password)
      const token = res.data.access_token
      localStorage.setItem('token', token)
      const me = await authApi.me()
      authStore.setAuth(token, me.data)
      navigate('/', { replace: true })
    } catch {
      setError('Invalid username or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 380 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: '0.22em',
            color: 'var(--accent)',
            marginBottom: 6,
          }}>
            CPCMS
          </div>
          <div style={{
            fontFamily: "'Archivo', sans-serif",
            fontWeight: 800,
            fontSize: 32,
            letterSpacing: '-0.035em',
            lineHeight: 1,
            color: 'var(--ink)',
          }}>
            edgesmith<span style={{ color: 'var(--accent)' }}>.</span>
          </div>
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            letterSpacing: '0.16em',
            color: 'var(--ink-2)',
            marginTop: 8,
          }}>
            INNOVATE. ENGINEER. EXCEL.
          </div>
        </div>

        {/* Card */}
        <div className="card" style={{ padding: '32px 28px' }}>
          <div style={{ marginBottom: 24 }}>
            <div style={{
              fontFamily: "'Archivo', sans-serif",
              fontWeight: 700,
              fontSize: 18,
              letterSpacing: '-0.02em',
              color: 'var(--ink)',
            }}>
              Sign in to CPCMS
            </div>
            <div style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10.5,
              color: 'var(--ink-2)',
              marginTop: 4,
              letterSpacing: '0.04em',
            }}>
              Manufacturing Management System
            </div>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{
                display: 'block',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10.5,
                letterSpacing: '0.08em',
                color: 'var(--ink-2)',
                marginBottom: 6,
              }}>USERNAME</label>
              <input
                className="input"
                style={{ width: '100%' }}
                placeholder="Enter username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
              />
            </div>
            <div>
              <label style={{
                display: 'block',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10.5,
                letterSpacing: '0.08em',
                color: 'var(--ink-2)',
                marginBottom: 6,
              }}>PASSWORD</label>
              <input
                className="input"
                style={{ width: '100%' }}
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div style={{
                padding: '8px 12px',
                borderRadius: 8,
                background: 'rgba(248,113,113,.12)',
                border: '1px solid rgba(248,113,113,.3)',
                color: 'var(--error)',
                fontSize: 13,
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn-primary"
              disabled={loading || !username || !password}
              style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        {/* Demo credentials */}
        <div className="card" style={{ padding: '16px 20px', marginTop: 16 }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, letterSpacing: '0.16em', color: 'var(--ink-3)', marginBottom: 10, textTransform: 'uppercase' }}>
            Demo Credentials
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { role: 'Admin',       user: 'admin',       pwd: 'admin123',   color: '#c4b5fd' },
              { role: 'Manager',     user: 'manager1',    pwd: 'manager123', color: '#93c5fd' },
              { role: 'Supervisor',  user: 'supervisor1', pwd: 'super123',   color: '#6ee7b7' },
              { role: 'Operator',    user: 'operator1',   pwd: 'op123',      color: '#fcd34d' },
            ].map(d => (
              <div
                key={d.role}
                onClick={() => { setUsername(d.user); setPassword(d.pwd) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 10px', borderRadius: 8,
                  background: 'var(--surface-2)', cursor: 'pointer',
                  border: '1px solid var(--line)', transition: 'border-color 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--line)'}
              >
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, color: d.color, width: 68 }}>{d.role}</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink)', flex: 1 }}>{d.user}</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--ink-2)' }}>{d.pwd}</span>
              </div>
            ))}
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: 'var(--ink-3)', marginTop: 8 }}>
            Click any row to fill credentials
          </div>
        </div>

        <div style={{
          textAlign: 'center',
          marginTop: 16,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          color: 'var(--ink-2)',
          letterSpacing: '0.04em',
        }}>
          Edgesmith Tooling India Pvt Ltd
        </div>
      </div>
    </div>
  )
}
