import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/AuthContext';

export default function Login() {
  const navigate = useNavigate();
  const { login, loading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

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
        </form>
      </div>
    </div>
  );
}
