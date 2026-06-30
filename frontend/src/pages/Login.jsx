import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/AuthContext';

export default function Login() {
  const navigate = useNavigate();
  const { login, loading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  // Demo accounts seeded by SEED_DEMO. Click one to fill the form.
  const DEMO_ACCOUNTS = [
    { role: 'Admin', username: 'admin', password: 'ChangeMe123!' },
    { role: 'Manager', username: 'manager', password: 'Demo123!' },
    { role: 'Supervisor', username: 'supervisor', password: 'Demo123!' },
    { role: 'Operator', username: 'operator', password: 'Demo123!' },
    { role: 'Service', username: 'service', password: 'Demo123!' },
    { role: 'Shopfloor', username: 'shopfloor', password: 'Demo123!' },
  ];

  function fill(acc) {
    setUsername(acc.username);
    setPassword(acc.password);
    setError('');
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      await login(username.trim(), password);
      navigate('/dashboard');
    } catch (err) {
      setError(err?.message || 'Login failed. Check your credentials.');
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#11305f', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 34, letterSpacing: '-0.035em', color: '#eaf4e4' }}>
            edgesmith<span style={{ color: '#d4eecb' }}>.</span>
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.18em', color: '#7d96bb', marginTop: 6 }}>
            INNOVATE · ENGINEER · EXCEL
          </div>
        </div>
        <form onSubmit={submit} style={{ background: '#fff', borderRadius: 16, padding: '26px 24px', boxShadow: '0 18px 50px rgba(0,0,0,.3)' }}>
          <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, fontSize: 18, color: '#15366a', marginBottom: 4 }}>Sign in to CPCMS</div>
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, color: '#5d7188', marginBottom: 20 }}>Production Cycle Management System</div>

          <label className="form-label">Username</label>
          <input className="form-input" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" style={{ marginBottom: 14 }} />

          <label className="form-label">Password</label>
          <input className="form-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" style={{ marginBottom: 18 }} />

          {error && (
            <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, color: '#c0392b', background: 'rgba(229,72,77,.1)', border: '1px solid rgba(229,72,77,.25)', borderRadius: 9, padding: '9px 12px', marginBottom: 16 }}>
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={loading || !username || !password} style={{ width: '100%', justifyContent: 'center' }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>

          {/* Demo credentials — click a role to fill the form */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #eef2ea' }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9bb4d4', marginBottom: 9 }}>
              Demo accounts · tap to fill
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.username}
                  type="button"
                  onClick={() => fill(acc)}
                  title={`${acc.username} / ${acc.password}`}
                  style={{ flex: '1 1 auto', minWidth: 96, cursor: 'pointer', textAlign: 'left', background: '#f6f9f4', border: '1px solid #e3ebde', borderRadius: 9, padding: '7px 10px' }}
                >
                  <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 600, fontSize: 12, color: '#15366a' }}>{acc.role}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#5d7188' }}>{acc.username}</div>
                </button>
              ))}
            </div>
            <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 10.5, color: '#9bb4d4', marginTop: 8 }}>
              Password: <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>Demo123!</span> (admin: <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>ChangeMe123!</span>)
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
