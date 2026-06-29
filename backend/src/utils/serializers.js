// Shared serialization helpers. The UID serializer mirrors the prior backend's
// uid_out() exactly so the SPA contract is unchanged.
import { query, one } from '../db/pool.js';

// Base SELECT for a fully-joined UID row (everything uid_out needs except history).
export const UID_SELECT = `
  SELECT u.*,
    fl.code AS factory_location_code,
    ct.name AS cycle_type_name,
    cs.step_number AS current_step_number,
    cs.operation_name AS current_step_name,
    cs.workstation_id AS current_step_workstation_id,
    cw.code AS current_step_workstation_code,
    cw.name AS current_step_workstation_name,
    sl.code AS current_storage_code,
    sz.value_mm AS size_mm,
    d.code AS design_code,
    mo.mo_number AS mo_number,
    pu.code AS parent_uid_code,
    COALESCE((
      SELECT json_agg(json_build_object('id', ch.id, 'code', ch.code, 'status', ch.status) ORDER BY ch.id)
      FROM uids ch WHERE ch.parent_uid_id = u.id
    ), '[]'::json) AS children
  FROM uids u
  LEFT JOIN factory_locations fl ON fl.id = u.factory_location_id
  LEFT JOIN cycle_types ct ON ct.id = u.cycle_type_id
  LEFT JOIN cycle_steps cs ON cs.id = u.current_step_id
  LEFT JOIN workstations cw ON cw.id = cs.workstation_id
  LEFT JOIN storage_locations sl ON sl.id = u.current_storage_id
  LEFT JOIN sizes sz ON sz.id = u.size_id
  LEFT JOIN designs d ON d.id = u.design_id
  LEFT JOIN manufacturing_orders mo ON mo.id = u.mo_id
  LEFT JOIN uids pu ON pu.id = u.parent_uid_id
`;

export function serializeUid(u) {
  return {
    id: u.id,
    code: u.code,
    status: u.status,
    priority: u.priority,
    factory_location_id: u.factory_location_id,
    factory_location_code: u.factory_location_code,
    cycle_type_id: u.cycle_type_id,
    cycle_type_name: u.cycle_type_name,
    cycle_version_id: u.cycle_version_id,
    current_step_id: u.current_step_id,
    current_step_number: u.current_step_number,
    current_step_name: u.current_step_name,
    current_step_workstation_id: u.current_step_workstation_id,
    current_step_workstation_code: u.current_step_workstation_code,
    current_step_workstation_name: u.current_step_workstation_name,
    current_storage_id: u.current_storage_id,
    current_storage_code: u.current_storage_code,
    product_type_id: u.product_type_id,
    size_id: u.size_id,
    size_mm: u.size_mm,
    design_id: u.design_id,
    design_code: u.design_code,
    design_confirmed: u.design_confirmed,
    design_locked: u.design_locked,
    mo_id: u.mo_id,
    mo_number: u.mo_number,
    parent_uid_id: u.parent_uid_id,
    parent_uid_code: u.parent_uid_code,
    child_suffix: u.child_suffix,
    children: u.children || [],
    created_at: u.created_at,
    notes: u.notes,
    faridabad_dispatch_id: u.faridabad_dispatch_id,
    receiving_event_id: u.receiving_event_id,
    alloy_supplier: u.alloy_supplier,
    alloy_grade: u.alloy_grade,
    alloy_heat_number: u.alloy_heat_number,
    ms_supplier: u.ms_supplier,
    ms_grade: u.ms_grade,
    ms_heat_number: u.ms_heat_number,
    rolling_contractor: u.rolling_contractor,
  };
}

export async function getUidStepHistory(uidId) {
  const rows = await query(
    `SELECT h.id, h.cycle_step_id, cs.step_number, cs.operation_name,
            w.code AS workstation_code, usr.full_name AS performed_by,
            h.performed_at, h.qc_result, h.qc_values, h.notes, h.child_uids_created
       FROM uid_step_history h
       LEFT JOIN cycle_steps cs ON cs.id = h.cycle_step_id
       LEFT JOIN workstations w ON w.id = h.workstation_id
       LEFT JOIN users usr ON usr.id = h.performed_by_id
      WHERE h.uid_id = $1
      ORDER BY h.performed_at`,
    [uidId]
  );
  return rows.map((h) => ({
    id: h.id,
    cycle_step_id: h.cycle_step_id,
    step_number: h.step_number,
    operation_name: h.operation_name,
    workstation_code: h.workstation_code,
    performed_by: h.performed_by,
    performed_at: h.performed_at,
    qc_result: h.qc_result,
    qc_values: h.qc_values,
    notes: h.notes,
    child_uids_created: h.child_uids_created,
  }));
}

// Fetch one UID by id or code, fully serialized. Optionally include step history.
export async function getUid({ id = null, code = null, includeHistory = false }) {
  const row = id
    ? await one(`${UID_SELECT} WHERE u.id = $1`, [id])
    : await one(`${UID_SELECT} WHERE u.code = $1`, [code]);
  if (!row) return null;
  const data = serializeUid(row);
  if (includeHistory) data.step_history = await getUidStepHistory(row.id);
  return data;
}
