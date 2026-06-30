import { api } from './client';

export const cyclesApi = {
  list: () => api.get('/cycles'),
  create: (payload) => api.post('/cycles', payload),
  steps: (id) => api.get(`/cycles/${id}/steps`),
  updateSteps: (id, steps, changeSummary) => api.put(`/cycles/${id}/steps`, { steps, changeSummary }),
  versions: (id) => api.get(`/cycles/${id}/versions`),
  export: (id) => api.get(`/cycles/${id}/export`),
  import: (payload) => api.post('/cycles/import', payload),
};

export const faridabadApi = {
  intakes: (filters) => api.get('/faridabad/intakes', filters),
  createIntake: (payload) => api.post('/faridabad/intakes', payload),
  weldTally: () => api.get('/faridabad/weld-tally'),
  logWeld: (payload) => api.post('/faridabad/weld', payload),
  dispatches: () => api.get('/faridabad/dispatches'),
  createDispatch: (payload) => api.post('/faridabad/dispatches', payload),
};

export const receivingApi = {
  list: () => api.get('/receiving'),
  expected: () => api.get('/receiving/expected'),
  detail: (id) => api.get(`/receiving/${id}`),
  create: (payload) => api.post('/receiving', payload),
  confirmMismatch: (id) => api.patch(`/receiving/${id}/confirm-mismatch`),
};

export const shiftsApi = {
  current: (location) => api.get('/shifts/current', { location }),
  list: (filters) => api.get('/shifts', filters),
  schedule: (filters) => api.get('/shifts/schedule', filters),
  setSchedule: (payload) => api.put('/shifts/schedule', payload),
  publishSchedule: (payload) => api.post('/shifts/schedule/publish', payload),
  handover: (shiftId, payload) => api.post(`/shifts/${shiftId}/handover`, payload),
  acknowledge: (shiftId) => api.post(`/shifts/${shiftId}/acknowledge`),
};

export const employeesApi = {
  list: (filters) => api.get('/employees', filters),
  create: (payload) => api.post('/employees', payload),
  update: (id, fields) => api.patch(`/employees/${id}`, fields),
  badges: (id) => api.get(`/employees/${id}/badges`),
  addBadge: (id, payload) => api.post(`/employees/${id}/badges`, payload),
  removeBadge: (id, badgeId) => api.delete(`/employees/${id}/badges/${badgeId}`),
  canAssign: (employeeId, workstationTypeId) => api.get('/employees/badge-checks/can-assign', { employeeId, workstationTypeId }),
  badgeDashboard: () => api.get('/employees/badge-dashboard/summary'),
};

export const mosApi = {
  list: () => api.get('/mos'),
  create: (payload) => api.post('/mos', payload),
  update: (id, fields) => api.patch(`/mos/${id}`, fields),
  linkUids: (id, uidCodes, applyMoValues) => api.post(`/mos/${id}/link-uids`, { uidCodes, applyMoValues }),
};

export const qcApi = {
  pending: () => api.get('/qc/pending'),
  signOff: (uidCode, result, notes) => api.post('/qc/sign-off', { uidCode, result, notes }),
  log: (payload) => api.post('/qc/log', payload),
  rework: (uidCode, targetStep, reason) => api.post('/qc/rework', { uidCode, targetStep, reason }),
};

export const reportsApi = {
  production: (filters) => api.get('/reports/production', filters),
  wip: () => api.get('/reports/wip'),
  furnace: (filters) => api.get('/reports/furnace', filters),
  scrap: () => api.get('/reports/scrap'),
  moFulfilment: () => api.get('/reports/mo-fulfilment'),
  quality: () => api.get('/reports/quality'),
  traceability: (filters) => api.get('/reports/traceability', filters),
  shift: (filters) => api.get('/reports/shift', filters),
  capacity: () => api.get('/reports/capacity'),
};

export const serviceApi = {
  lookupUid: (code) => api.get(`/service/uid/${code}`),
};

export const masterApi = {
  workstationTypes: () => api.get('/master/workstation-types'),
  createWorkstationType: (p) => api.post('/master/workstation-types', p),
  updateWorkstationType: (id, p) => api.patch(`/master/workstation-types/${id}`, p),
  archiveWorkstationType: (id) => api.delete(`/master/workstation-types/${id}`),

  workstationUnits: () => api.get('/master/workstation-units'),
  createWorkstationUnit: (p) => api.post('/master/workstation-units', p),
  updateWorkstationUnit: (id, p) => api.patch(`/master/workstation-units/${id}`, p),

  products: () => api.get('/master/products'),
  createProduct: (p) => api.post('/master/products', p),

  sizes: () => api.get('/master/sizes'),
  createSize: (p) => api.post('/master/sizes', p),

  designs: () => api.get('/master/designs'),
  createDesign: (p) => api.post('/master/designs', p),
  designValidityMatrix: () => api.get('/master/designs/validity-matrix'),

  suppliers: () => api.get('/master/suppliers'),
  createSupplier: (p) => api.post('/master/suppliers', p),

  contractors: () => api.get('/master/contractors'),
  createContractor: (p) => api.post('/master/contractors', p),

  colorCodes: () => api.get('/master/color-codes'),
  createColorCode: (p) => api.post('/master/color-codes', p),

  truckCapacity: () => api.get('/master/truck-capacity'),
  createTruckCapacity: (p) => api.post('/master/truck-capacity', p),

  gradeCycleMap: () => api.get('/master/grade-cycle-map'),
  createGradeCycleMap: (p) => api.post('/master/grade-cycle-map', p),

  conversionPatterns: () => api.get('/master/conversion-patterns'),
  createConversionPattern: (p) => api.post('/master/conversion-patterns', p),

  storageLocations: () => api.get('/master/storage-locations'),
  createStorageLocation: (p) => api.post('/master/storage-locations', p),

  grindingRules: () => api.get('/master/grinding-rules'),
  updateGrindingRule: (id, p) => api.patch(`/master/grinding-rules/${id}`, p),
};

export const adminApi = {
  temperingParams: () => api.get('/admin/tempering-params'),
  updateTemperingParams: (cycleCode, temperingStep, payload) =>
    api.patch(`/admin/tempering-params/${cycleCode}/${temperingStep}`, payload),
  users: () => api.get('/admin/users'),
  auditLog: (filters) => api.get('/admin/audit-log', filters),
  shiftConfig: () => api.get('/admin/shift-config'),
  updateShiftConfig: (payload) => api.patch('/admin/shift-config', payload),
};

export const alertsApi = {
  list: () => api.get('/alerts'),
  dismiss: (id) => api.patch(`/alerts/${id}/dismiss`),
};

export const workstationAssignmentsApi = {
  list: (shiftId) => api.get('/workstation-assignments', { shift_id: shiftId }),
  unassigned: (shiftId, location) => api.get('/workstation-assignments/unassigned', { shift_id: shiftId, location }),
  assign: (payload) => api.post('/workstation-assignments', payload),
  unassign: (id) => api.delete(`/workstation-assignments/${id}`),
};
