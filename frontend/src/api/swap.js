import { api } from './client';

// Swap-pool rotation (Model 2 workstations: STR-MAN, PRO, PKG, HRC-01).
export const swapApi = {
  list: () => api.get('/swap-pools'),
  mySlots: () => api.get('/swap-pools/my-slots'),
  slots: (wtId) => api.get(`/swap-pools/${wtId}/slots`),
  generate: (wtId, intervalMinutes) => api.post(`/swap-pools/${wtId}/generate`, { intervalMinutes }),
  setInterval: (wtId, intervalMinutes) => api.patch(`/swap-pools/${wtId}/interval`, { intervalMinutes }),
  confirmSlot: (slotId) => api.post(`/swap-pools/slots/${slotId}/confirm`),
};
