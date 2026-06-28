import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import UIDLookup from './pages/UIDLookup'
import Shopfloor from './pages/Shopfloor'
import OperatorQueue from './pages/OperatorQueue'
import UIDs from './pages/UIDs'
import Manufacturing from './pages/Manufacturing'
import Cycles from './pages/Cycles'
import Config from './pages/Config'
import Users from './pages/Users'

function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { user, isAuthenticated } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (roles && user && !roles.includes(user.role)) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  const { isAuthenticated } = useAuth()

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <Login />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/uid-lookup" element={<UIDLookup />} />
                  <Route path="/shopfloor" element={<Shopfloor />} />
                  <Route path="/queue" element={<OperatorQueue />} />
                  <Route path="/uids" element={<ProtectedRoute roles={['admin', 'manager', 'supervisor']}><UIDs /></ProtectedRoute>} />
                  <Route path="/manufacturing" element={<ProtectedRoute roles={['admin', 'manager']}><Manufacturing /></ProtectedRoute>} />
                  <Route path="/cycles" element={<ProtectedRoute roles={['admin', 'manager']}><Cycles /></ProtectedRoute>} />
                  <Route path="/config" element={<ProtectedRoute roles={['admin']}><Config /></ProtectedRoute>} />
                  <Route path="/users" element={<ProtectedRoute roles={['admin']}><Users /></ProtectedRoute>} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
