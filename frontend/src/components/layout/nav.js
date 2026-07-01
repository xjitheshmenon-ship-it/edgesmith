/**
 * Sidebar navigation structure, matching the locked design's NAV array.
 * Each item: [routeKey, label, iconName, badgeCountKey(or null)]
 * badgeCountKey refers to a field on the badge counts object passed to
 * Sidebar (computed from live alert/queue data) — see Sidebar.jsx.
 */
export const NAV = [
  ['OVERVIEW', [
    ['dashboard', 'Dashboard', 'grid', 'dashboardAlerts'],
    ['shopfloor', 'Shopfloor Display', 'monitor', null],
    // Receiving / Intake, Production Floor, My Workstation and Batch Management are
    // shared across both factories — the topbar factory toggle selects which
    // factory's data (and page) is shown.
    ['receiving', 'Receiving / Intake', 'inbox', 'expectedArrivals'],
    ['floor', 'Production Floor', 'factory', 'onHoldUids'],
    ['jobexec', 'My Workstation', 'timer', null],
    ['shift', 'Shift Management', 'calendar', null],
    ['jobs', 'Job Assignment', 'assign', 'unassignedJobs'],
    ['batch', 'Batch Management', 'stack', 'activeBatches'],
  ]],
  ['FARIDABAD', [
    // Raw Material Intake is now the Faridabad variant of the shared
    // "Receiving / Intake" entry above (selected by the factory toggle). Its
    // /intake route stays registered for old links.
    ['joining', 'Joining Operation', 'link', null],
    // Faridabad Batch Management is now the Faridabad variant of the shared
    // "Batch Management" entry above (selected by the factory toggle). The
    // /farbatch route stays registered for old links.
    // Contractor Dispatch retired — dispatch creation now lives in Faridabad
    // Batch Management. The /dispatch route stays registered for old links.
  ]],
  ['DHARMAPURI', [
    ['uid', 'UID Creation', 'tag', null],
    ['qc', 'QC', 'check', 'pendingQc'],
  ]],
  ['OPERATIONS', [
    ['mo', 'MO Linking', 'doc', 'openMos'],
    ['reports', 'Reports', 'chart', null],
    ['service', 'Service Lookup', 'search', null],
  ]],
  ['CONFIGURATION', [
    ['cycle', 'Cycle Builder', 'flow', null],
    ['masters', 'Master Lists', 'list', null],
    ['temper', 'Tempering Parameters', 'thermo', null],
    ['employees', 'Employee Profiles', 'people', 'expiringBadges'],
    ['users', 'Users & Roles', 'lock', null],
    ['dataimport', 'Data Import', 'download', null],
    ['backup', 'Backup & Restore', 'db', null],
  ]],
];

/** Which NAV sections each role sees. Pages within a visible section may
 * still individually restrict write actions further (handled per-page via
 * useAuth role flags) — this controls what's visible in the sidebar at all. */
export const SECTIONS_BY_ROLE = {
  admin: ['OVERVIEW', 'FARIDABAD', 'DHARMAPURI', 'OPERATIONS', 'CONFIGURATION'],
  manager: ['OVERVIEW', 'FARIDABAD', 'DHARMAPURI', 'OPERATIONS', 'CONFIGURATION'],
  supervisor: ['OVERVIEW', 'DHARMAPURI', 'OPERATIONS'],
  operator: ['OVERVIEW', 'DHARMAPURI'], // filtered to My Workstation/QC below
  service: [],
  shopfloor: [],
};

/** Operators only see a narrow slice even within DHARMAPURI section */
export const OPERATOR_ALLOWED_ROUTES = ['jobexec', 'qc'];

export function routeTitle(routeKey) {
  for (const [, items] of NAV) {
    const found = items.find(([key]) => key === routeKey);
    if (found) return found[1];
  }
  return routeKey;
}
