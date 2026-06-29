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
import Config from './pages/Config'
import Users from './pages/Users'
import Shifts from './pages/Shifts'
import Faridabad from './pages/Faridabad'
import Tempering from './pages/Tempering'
import Placeholder from './pages/Placeholder'
import ProductionFloor from './pages/ProductionFloor'
import Receiving from './pages/Receiving'

function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { user, isAuthenticated } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (roles && user && !roles.includes(user.role)) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  const { isAuthenticated } = useAuth()

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
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
                  <Route path="/config" element={<ProtectedRoute roles={['admin']}><Config /></ProtectedRoute>} />
                  <Route path="/shifts" element={<ProtectedRoute roles={['admin', 'manager', 'supervisor']}><Shifts /></ProtectedRoute>} />
                  <Route path="/users" element={<ProtectedRoute roles={['admin']}><Users /></ProtectedRoute>} />
                  <Route path="/faridabad" element={<ProtectedRoute roles={['admin', 'manager']}><Faridabad /></ProtectedRoute>} />
                  <Route path="/tempering" element={<ProtectedRoute roles={['admin', 'manager', 'supervisor']}><Tempering /></ProtectedRoute>} />
                  <Route path="/production" element={<ProductionFloor />} />
                  <Route path="/receiving" element={<ProtectedRoute roles={['admin', 'manager', 'supervisor']}><Receiving /></ProtectedRoute>} />
                  <Route path="/qc" element={<Placeholder title="Quality Control" />} />
                  <Route path="/reports" element={<ProtectedRoute roles={['admin', 'manager', 'supervisor']}><Placeholder title="Reports" /></ProtectedRoute>} />
                  <Route path="/employees" element={<ProtectedRoute roles={['admin', 'manager']}><Placeholder title="Employee Profiles & Badges" /></ProtectedRoute>} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
