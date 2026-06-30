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
  ]],
  ['FARIDABAD', [
    ['intake', 'Raw Material Intake', 'inbox', null],
    ['joining', 'Joining Operation', 'link', null],
    ['dispatch', 'Contractor Dispatch', 'truck', 'pendingDispatch'],
  ]],
  ['DHARMAPURI', [
    ['receiving', 'Receiving', 'download', 'expectedArrivals'],
    ['uid', 'UID Creation', 'tag', null],
    ['floor', 'Production Floor', 'factory', 'onHoldUids'],
    ['jobexec', 'My Workstation', 'timer', null],
    ['batch', 'Batch Management', 'stack', 'activeBatches'],
    ['qc', 'QC', 'check', 'pendingQc'],
  ]],
  ['OPERATIONS', [
    ['mo', 'MO Linking', 'doc', 'openMos'],
    ['shift', 'Shift Management', 'calendar', null],
    ['jobs', 'Job Assignment', 'assign', 'unassignedJobs'],
    ['reports', 'Reports', 'chart', null],
    ['service', 'Service Lookup', 'search', null],
  ]],
  ['CONFIGURATION', [
    ['cycle', 'Cycle Builder', 'flow', null],
    ['masters', 'Master Lists', 'list', null],
    ['temper', 'Tempering Parameters', 'thermo', null],
    ['employees', 'Employee Profiles', 'people', 'expiringBadges'],
    ['users', 'Users & Roles', 'lock', null],
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
  operator: ['DHARMAPURI'], // operators land on My Workstation/QC only — filtered further below
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
