import { api } from './client';

// Queue management (Production Floor drawer). Supervisor/Manager/Admin only.
export const queueApi = {
  get: (workstationCode) => api.get('/queue', { workstationCode }),
  setPriority: (uidCodes, priority) => api.patch('/queue/priority', { uidCodes, priority }),
  hold: (uidCodes, reason) => api.post('/queue/hold', { uidCodes, reason }),
  assign: (uidCode, operatorId) => api.post('/queue/assign', { uidCode, operatorId }),
};
