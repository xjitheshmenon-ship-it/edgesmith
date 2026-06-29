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
import ProductionFloor from './pages/ProductionFloor'
import Receiving from './pages/Receiving'
import UIDDetail from './pages/UIDDetail'
import BatchManagement from './pages/BatchManagement'
import QC from './pages/QC'
import Intake from './pages/Intake'
import Joining from './pages/Joining'
import Dispatch from './pages/Dispatch'
import Reports from './pages/Reports'
import JobAssignment from './pages/JobAssignment'
import JobExecution from './pages/JobExecution'
import MasterLists from './pages/MasterLists'
import Employees from './pages/Employees'

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
                  <Route path="/shopfloor" element={<Shopfloor />} />
                  <Route path="/queue" element={<OperatorQueue />} />

                  {/* Faridabad */}
                  <Route path="/intake" element={<ProtectedRoute roles={['admin', 'manager']}><Intake /></ProtectedRoute>} />
                  <Route path="/joining" element={<ProtectedRoute roles={['admin', 'manager']}><Joining /></ProtectedRoute>} />
                  <Route path="/dispatch" element={<ProtectedRoute roles={['admin', 'manager']}><Dispatch /></ProtectedRoute>} />
                  <Route path="/faridabad" element={<ProtectedRoute roles={['admin', 'manager']}><Faridabad /></ProtectedRoute>} />

                  {/* Dharmapuri */}
                  <Route path="/receiving" element={<ProtectedRoute roles={['admin', 'manager', 'supervisor']}><Receiving /></ProtectedRoute>} />
                  <Route path="/uids" element={<ProtectedRoute roles={['admin', 'manager', 'supervisor']}><UIDs /></ProtectedRoute>} />
                  <Route path="/production" element={<ProductionFloor />} />
                  <Route path="/job-execution" element={<JobExecution />} />
                  <Route path="/batches" element={<ProtectedRoute roles={['admin', 'manager', 'supervisor']}><BatchManagement /></ProtectedRoute>} />
                  <Route path="/qc" element={<ProtectedRoute roles={['admin', 'manager', 'supervisor', 'operator']}><QC /></ProtectedRoute>} />

                  {/* Management */}
                  <Route path="/manufacturing" element={<ProtectedRoute roles={['admin', 'manager']}><Manufacturing /></ProtectedRoute>} />
                  <Route path="/shifts" element={<ProtectedRoute roles={['admin', 'manager', 'supervisor']}><Shifts /></ProtectedRoute>} />
                  <Route path="/job-assignment" element={<ProtectedRoute roles={['admin', 'manager', 'supervisor']}><JobAssignment /></ProtectedRoute>} />
                  <Route path="/reports" element={<ProtectedRoute roles={['admin', 'manager', 'supervisor']}><Reports /></ProtectedRoute>} />
                  <Route path="/uid-lookup" element={<UIDLookup />} />
                  <Route path="/uid/:code" element={<UIDDetail />} />

                  {/* Configuration */}
                  <Route path="/config" element={<ProtectedRoute roles={['admin', 'manager']}><Config /></ProtectedRoute>} />
                  <Route path="/master-lists" element={<ProtectedRoute roles={['admin', 'manager']}><MasterLists /></ProtectedRoute>} />
                  <Route path="/tempering" element={<ProtectedRoute roles={['admin']}><Tempering /></ProtectedRoute>} />
                  <Route path="/employees" element={<ProtectedRoute roles={['admin', 'manager']}><Employees /></ProtectedRoute>} />
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
