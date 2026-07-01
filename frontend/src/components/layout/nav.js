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
    // Receiving & Intake, Production Floor and My Workstation are shared across
    // both factories — the topbar factory toggle selects which factory's data
    // (and page) is shown. Batch Tracker is no longer a sidebar item: furnace
    // batching is done on Work Assignment; the tracker is reached via Reports.
    ['receiving', 'Receiving & Intake', 'inbox', 'expectedArrivals'],
    ['floor', 'Production Floor', 'factory', 'onHoldUids'],
    ['jobexec', 'My Workstation', 'timer', null],
    ['uid', 'UID Lookup', 'tag', null],
    ['shift', 'Shift Planner', 'calendar', null],
    ['jobs', 'Work Assignment', 'assign', 'unassignedJobs'],
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

/** Routes reachable (e.g. deep-linked from Reports) but NOT shown in the sidebar.
 *  Batch Tracker lives here — furnace batching is on Work Assignment; the tracker
 *  is opened from Reports. Not available to operators. */
export const HIDDEN_ROUTES = ['batch'];

export function routeTitle(routeKey) {
  for (const [, items] of NAV) {
    const found = items.find(([key]) => key === routeKey);
    if (found) return found[1];
  }
  return routeKey;
}
