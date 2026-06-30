import { api } from './client';

export const batchesApi = {
  furnaceList: (filters) => api.get('/furnace-batches', filters),
  furnaceQueue: (cycleStepId, cycleCode) => api.get('/furnace-batches/queue', { cycle_step_id: cycleStepId, cycle_code: cycleCode }),
  furnaceCreate: (payload) => api.post('/furnace-batches', payload),
  furnaceComplete: (id, payload) => api.patch(`/furnace-batches/${id}/complete`, payload),
  furnaceAcknowledgeDeviation: (id) => api.post(`/furnace-batches/${id}/acknowledge-deviation`),
  furnaceUids: (id) => api.get(`/furnace-batches/${id}/uids`),

  grindingMachines: () => api.get('/grinding/machines'),
  validateGrindingCombination: (barLengthsMm, machineCode) => api.post('/grinding/validate-combination', { barLengthsMm, machineCode }),
  bunchGrindingCapacity: (barLengthMm) => api.post('/grinding/bunch-capacity', { barLengthMm }),

  // Bunch grinding (SG-DLT): operator loads several bars onto the machine at once.
  grindingQueue: () => api.get('/grinding/queue'),
  grindingActiveBatch: (workstationUnitId) => api.get('/grinding/batches/active', { workstation_unit_id: workstationUnitId }),
  grindingLoadBatch: (workstationUnitId, uidIds) => api.post('/grinding/batches', { workstationUnitId, uidIds }),
  grindingCloseBatch: (id) => api.post(`/grinding/batches/${id}/close`),
};
