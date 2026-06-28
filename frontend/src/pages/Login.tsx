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
      <div style={{ width: '100%', maxWidth: 360 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{
            fontFamily: "'Archivo', sans-serif",
            fontWeight: 800,
            fontSize: 34,
            letterSpacing: '-0.035em',
            lineHeight: 1,
            color: 'var(--ink)',
          }}>
            edgesmith<span style={{ color: 'var(--accent)' }}>.</span>
          </div>
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 9.5,
            letterSpacing: '0.16em',
            color: 'var(--ink-3)',
            marginTop: 8,
          }}>
            INNOVATE. ENGINEER. EXCEL.
          </div>
        </div>

        {/* Card */}
        <div className="card" style={{ padding: '28px 24px' }}>
          <div style={{ marginBottom: 22 }}>
            <div style={{
              fontFamily: "'Archivo', sans-serif",
              fontWeight: 700,
              fontSize: 17,
              letterSpacing: '-0.02em',
              color: 'var(--ink)',
            }}>
              Sign in
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
                letterSpacing: '0.1em',
                color: 'var(--ink-2)',
                marginBottom: 6,
              }}>
                USERNAME
              </label>
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
                letterSpacing: '0.1em',
                color: 'var(--ink-2)',
                marginBottom: 6,
              }}>
                PASSWORD
              </label>
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

        <div style={{
          textAlign: 'center',
          marginTop: 18,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 9.5,
          color: 'var(--ink-3)',
          letterSpacing: '0.04em',
        }}>
          Edgesmith Tooling India Pvt Ltd
        </div>
      </div>
    </div>
  )
}
