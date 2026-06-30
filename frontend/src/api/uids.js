import { api } from './client';

export const uidsApi = {
  list: (filters) => api.get('/uids', filters),
  detail: (code) => api.get(`/uids/${code}`),
  bulkCreate: (payload) => api.post('/uids', payload),
  preview: (cycle, qty) => api.get('/uids/preview', { cycle, qty }),
  update: (code, fields) => api.patch(`/uids/${code}`, fields),
  advance: (code, payload) => api.post(`/uids/${code}/advance`, payload),
  hold: (code, reason) => api.post(`/uids/${code}/hold`, { reason }),
  release: (code) => api.post(`/uids/${code}/release`),
  convert: (code, payload) => api.post(`/uids/${code}/converting`, payload),
  lineage: (code) => api.get(`/uids/${code}/lineage`),
  wipSummary: () => api.get('/uids/summary/wip'),
  stationSummary: () => api.get('/uids/summary/stations'),
  shopfloorSummary: (location) => api.get('/uids/summary/shopfloor', { location }),
};
