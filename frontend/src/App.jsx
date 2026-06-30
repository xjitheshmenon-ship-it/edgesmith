import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './store/AuthContext';
import { AppProvider } from './store/AppContext';
import { NAV, SECTIONS_BY_ROLE, OPERATOR_ALLOWED_ROUTES } from './components/layout/nav';
import AppShell from './components/layout/AppShell';
import Login from './pages/Login';
import Placeholder from './pages/Placeholder';
import Dashboard from './pages/Dashboard';
import UidCreation from './pages/UidCreation';
import UidDetail from './pages/UidDetail';
import ProductionFloor from './pages/ProductionFloor';
import MyWorkstation from './pages/MyWorkstation';
import BatchManagement from './pages/BatchManagement';
import QC from './pages/QC';
import RawMaterialIntake from './pages/RawMaterialIntake';
import JoiningOperation from './pages/JoiningOperation';
import ContractorDispatch from './pages/ContractorDispatch';
import FaridabadBatchManagement from './pages/FaridabadBatchManagement';
import ServiceLookup from './pages/ServiceLookup';
import MoLinking from './pages/MoLinking';
import MasterLists from './pages/MasterLists';
import UsersRoles from './pages/UsersRoles';
import Receiving from './pages/Receiving';
import ShiftManagement from './pages/ShiftManagement';
import TemperingParameters from './pages/TemperingParameters';
import BackupRestore from './pages/BackupRestore';
import ShopfloorDisplay from './pages/ShopfloorDisplay';
import EmployeeProfiles from './pages/EmployeeProfiles';
import JobAssignment from './pages/JobAssignment';
import Reports from './pages/Reports';
import CycleBuilder from './pages/CycleBuilder';

/* Route keys built on the new foundation map to their component; everything
   else renders the Placeholder until rebuilt. */
const PAGES = {
  dashboard: Dashboard,
  uid: UidCreation,
  floor: ProductionFloor,
  jobexec: MyWorkstation,
  batch: BatchManagement,
  qc: QC,
  intake: RawMaterialIntake,
  joining: JoiningOperation,
  dispatch: ContractorDispatch,
  farbatch: FaridabadBatchManagement,
  service: ServiceLookup,
  mo: MoLinking,
  masters: MasterLists,
  users: UsersRoles,
  receiving: Receiving,
  shift: ShiftManagement,
  jobs: JobAssignment,
  reports: Reports,
  cycle: CycleBuilder,
  temper: TemperingParameters,
  employees: EmployeeProfiles,
  backup: BackupRestore,
};

const ALL_KEYS = NAV.flatMap(([, items]) => items.map(([key]) => key));

function allowedKeysFor(role) {
  const sections = SECTIONS_BY_ROLE[role] || [];
  let keys = NAV.filter(([s]) => sections.includes(s)).flatMap(([, items]) => items.map(([k]) => k));
  if (role === 'operator') keys = keys.filter((k) => OPERATOR_ALLOWED_ROUTES.includes(k));
  return keys;
}

function RequireAuth({ children }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

/* Renders the page for a route key, gated by role. */
function PageRoute({ routeKey }) {
  const { user } = useAuth();
  const allowed = allowedKeysFor(user?.role || '');
  if (!allowed.includes(routeKey)) {
    const fallback = allowed[0] || 'dashboard';
    return <Navigate to={`/${fallback}`} replace />;
  }
  const Cmp = PAGES[routeKey];
  return Cmp ? <Cmp /> : <Placeholder routeKey={routeKey} />;
}

/* UID detail drill-in (the `uid` route also supports /uid/:code). */
function UidRoute() {
  const { code } = useParams();
  void code; // read by UidDetail via useParams()
  return <UidDetail />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <Routes>
            <Route path="/login" element={<Login />} />
            {/* Shopfloor Display is full-screen — rendered OUTSIDE the AppShell. */}
            <Route path="/shopfloor" element={<RequireAuth><ShopfloorDisplay /></RequireAuth>} />
            <Route element={<RequireAuth><AppShell /></RequireAuth>}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              {ALL_KEYS.filter((key) => key !== 'shopfloor').map((key) => (
                <Route key={key} path={`/${key}`} element={<PageRoute routeKey={key} />} />
              ))}
              <Route path="/uid/:code" element={<UidRoute />} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </AuthProvider>
  );
}
