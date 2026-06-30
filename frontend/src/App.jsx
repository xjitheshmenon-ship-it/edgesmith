import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './store/AuthContext';
import { AppProvider } from './store/AppContext';
import { NAV, SECTIONS_BY_ROLE, OPERATOR_ALLOWED_ROUTES } from './components/layout/nav';
import AppShell from './components/layout/AppShell';
import Login from './pages/Login';
import Placeholder from './pages/Placeholder';
import Dashboard from './pages/Dashboard';

/* Route keys built on the new foundation map to their component; everything
   else renders the Placeholder until rebuilt. */
const PAGES = {
  dashboard: Dashboard,
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
  return <Placeholder routeKey="uid" detailCode={code} />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<RequireAuth><AppShell /></RequireAuth>}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              {ALL_KEYS.map((key) => (
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
