import { api } from './client';

export const jobsApi = {
  list: (filters) => api.get('/jobs', filters),
  create: (payload) => api.post('/jobs', payload),
  unassign: (id) => api.delete(`/jobs/${id}`),
  start: (id) => api.post(`/jobs/${id}/start`),
  pause: (id, reason, notes) => api.post(`/jobs/${id}/pause`, { reason, notes }),
  resume: (id) => api.post(`/jobs/${id}/resume`),
  close: (id, payload) => api.post(`/jobs/${id}/close`, payload),
  autoAssignPreview: (shiftId) => api.post('/jobs/auto-assign', { shiftId }),
  autoAssignCommit: (shiftId, assignments) => api.post('/jobs/auto-assign/commit', { shiftId, assignments }),
};

export const PAUSE_REASONS = ['Break', 'Machine issue', 'Material not ready', 'Waiting for supervisor', 'Other'];
