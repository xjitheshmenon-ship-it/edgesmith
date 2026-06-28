import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Factory } from 'lucide-react'
import { authApi } from '../api/client'
import { authStore } from '../store/auth'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { data } = await authApi.login(username, password)
      authStore.setAuth(data.access_token, data.user)
      navigate('/')
    } catch {
      setError('Invalid username or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-3">
            <div className="w-14 h-14 bg-brand-500 rounded-2xl flex items-center justify-center">
              <Factory size={28} className="text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">CPCMS</h1>
          <p className="text-sm text-gray-500 mt-1">Edgesmith Tooling India</p>
        </div>

        <div className="card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Username</label>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
            </div>
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" className="btn-primary w-full justify-center" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-400 font-medium mb-2">Demo accounts</p>
            <div className="grid grid-cols-2 gap-1 text-xs text-gray-500">
              <span>admin / admin123</span><span>manager1 / manager123</span>
              <span>supervisor1 / super123</span><span>operator1 / op123</span>
              <span>service1 / svc123</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
