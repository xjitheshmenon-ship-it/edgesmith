import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './store/AuthContext';
import { AppProvider, useApp } from './store/AppContext';
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
import FaridabadProductionFloor from './pages/FaridabadProductionFloor';
import FaridabadMyWorkstation from './pages/FaridabadMyWorkstation';
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
import DataImport from './pages/DataImport';

/* Route keys built on the new foundation map to their component; everything
   else renders the Placeholder until rebuilt. */
/* Production Floor and My Workstation are the same view for both factories —
   only the data differs — so a single nav entry renders the Dharmapuri or
   Faridabad variant based on the shared factory toggle in the topbar. */
function FactoryFloor() {
  const { location } = useApp();
  return location === 'faridabad' ? <FaridabadProductionFloor /> : <ProductionFloor />;
}
function FactoryWorkstation() {
  const { location } = useApp();
  return location === 'faridabad' ? <FaridabadMyWorkstation /> : <MyWorkstation />;
}
/* Batch Management is likewise one view per factory — a single nav entry that
   follows the shared factory toggle, same as Production Floor / My Workstation. */
function FactoryBatch() {
  const { location } = useApp();
  return location === 'faridabad' ? <FaridabadBatchManagement /> : <BatchManagement />;
}
/* "Material arriving" is one view per factory: Faridabad logs raw-material
   intake from suppliers, Dharmapuri logs blocks received from Faridabad. A
   single nav entry follows the shared factory toggle. */
function FactoryReceiving() {
  const { location } = useApp();
  return location === 'faridabad' ? <RawMaterialIntake /> : <Receiving />;
}

const PAGES = {
  dashboard: Dashboard,
  uid: UidCreation,
  floor: FactoryFloor,
  jobexec: FactoryWorkstation,
  batch: FactoryBatch,
  qc: QC,
  intake: RawMaterialIntake,
  joining: JoiningOperation,
  dispatch: ContractorDispatch,
  farbatch: FaridabadBatchManagement,
  farfloor: FaridabadProductionFloor,
  farstation: FaridabadMyWorkstation,
  service: ServiceLookup,
  mo: MoLinking,
  masters: MasterLists,
  users: UsersRoles,
  receiving: FactoryReceiving,
  shift: ShiftManagement,
  jobs: JobAssignment,
  reports: Reports,
  cycle: CycleBuilder,
  temper: TemperingParameters,
  employees: EmployeeProfiles,
  backup: BackupRestore,
  dataimport: DataImport,
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
