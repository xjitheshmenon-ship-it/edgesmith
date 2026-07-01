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
    // Receiving & Intake, Production Floor, My Workstation and Batch Tracker are
    // shared across both factories — the topbar factory toggle selects which
    // factory's data (and page) is shown.
    ['receiving', 'Receiving & Intake', 'inbox', 'expectedArrivals'],
    ['floor', 'Production Floor', 'factory', 'onHoldUids'],
    ['jobexec', 'My Workstation', 'timer', null],
    ['uid', 'UID Lookup', 'tag', null],
    ['shift', 'Shift Planner', 'calendar', null],
    ['jobs', 'Work Assignment', 'assign', 'unassignedJobs'],
    ['batch', 'Batch Tracker', 'stack', 'activeBatches'],
  ]],
  ['OPERATIONS', [
    ['qc', 'Quality Control', 'check', 'pendingQc'],
    ['mo', 'Manufacturing Orders', 'doc', 'openMos'],
    ['reports', 'Reports', 'chart', null],
    ['activity', 'Activity Log', 'timer', null],
  ]],
  ['CONFIGURATION', [
    ['cycle', 'Cycle Builder', 'flow', null],
    ['masters', 'Master Lists', 'list', null],
    ['temper', 'Heat Treatment Parameters', 'thermo', null],
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
  admin: ['OVERVIEW', 'OPERATIONS', 'CONFIGURATION'],
  manager: ['OVERVIEW', 'OPERATIONS', 'CONFIGURATION'],
  supervisor: ['OVERVIEW', 'OPERATIONS'],
  operator: ['OVERVIEW', 'OPERATIONS'], // filtered to My Workstation/QC below (QC now lives in OPERATIONS)
  service: [],
  shopfloor: [],
};

/** Operators only see a narrow slice — My Workstation and Quality Control */
export const OPERATOR_ALLOWED_ROUTES = ['jobexec', 'qc'];

export function routeTitle(routeKey) {
  for (const [, items] of NAV) {
    const found = items.find(([key]) => key === routeKey);
    if (found) return found[1];
  }
  return routeKey;
}
