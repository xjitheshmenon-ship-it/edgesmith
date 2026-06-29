export interface User {
  id: number
  username: string
  full_name: string
  role: 'admin' | 'manager' | 'supervisor' | 'operator' | 'service' | 'shopfloor'
  primary_location_id: number | null
}

export interface FactoryLocation {
  id: number
  code: string
  name: string
}

export interface Workstation {
  id: number
  code: string
  name: string
  category: string
  is_active: boolean
  factory_location_id: number | null
}

export interface StorageLocation {
  id: number
  code: string
  name: string
  factory_location_id: number | null
}

export interface CycleStep {
  id: number
  step_number: string
  step_order: number
  operation_name: string
  workstation_id: number
  workstation_code: string
  workstation_name: string
  from_storage_id: number | null
  from_storage_code: string | null
  to_storage_id: number | null
  to_storage_code: string | null
  is_converting_step: boolean
  is_child_marking_step: boolean
  is_qc_step: boolean
}

export interface CycleVersion {
  id: number
  version_number: number
  is_current: boolean
  created_at: string
  change_notes: string | null
  steps: CycleStep[]
}

export interface CycleType {
  id: number
  name: string
  letter_prefix: string
  description: string | null
  is_active: boolean
  is_archived: boolean
  current_version: CycleVersion | null
  version_count: number
}

export interface Size {
  id: number
  value_mm: number
  is_active: boolean
}

export interface Design {
  id: number
  code: string
  description: string | null
  is_active: boolean
  valid_size_ids: number[]
  valid_sizes_mm: number[]
}

export interface UID {
  id: number
  code: string
  status: 'active' | 'on_hold' | 'converting' | 'converted' | 'dispatched' | 'archived'
  priority: 'normal' | 'high' | 'urgent'
  factory_location_id: number
  factory_location_code: string
  cycle_type_id: number
  cycle_type_name: string
  cycle_version_id: number
  current_step_id: number | null
  current_step_number: string | null
  current_step_name: string | null
  current_storage_id: number | null
  current_storage_code: string | null
  product_type_id: number | null
  size_id: number | null
  size_mm: number | null
  design_id: number | null
  design_code: string | null
  design_confirmed: boolean
  design_locked: boolean
  mo_id: number | null
  mo_number: string | null
  parent_uid_id: number | null
  parent_uid_code: string | null
  child_suffix: string | null
  children: { id: number; code: string; status: string }[]
  created_at: string
  notes: string | null
  step_history?: StepHistory[]
  // Material traceability
  faridabad_dispatch_id: number | null
  receiving_event_id: number | null
  alloy_supplier: string | null
  alloy_grade: string | null
  alloy_heat_number: string | null
  ms_supplier: string | null
  ms_grade: string | null
  ms_heat_number: string | null
  rolling_contractor: string | null
}

export interface StepHistory {
  id: number
  cycle_step_id: number
  step_number: string
  operation_name: string
  workstation_code: string | null
  performed_by: string | null
  performed_at: string
  qc_result: string | null
  qc_values: Record<string, unknown> | null
  notes: string | null
  child_uids_created: string[] | null
}

export interface ManufacturingOrder {
  id: number
  mo_number: string
  customer: string
  quantity: number
  status: string
  size_id: number | null
  size_mm: number | null
  design_id: number | null
  design_code: string | null
  uid_count: number
  notes: string | null
  created_at: string
}

export interface ConversionPattern {
  id: number
  name: string
  input_length_mm: number
  output_lengths_mm: number[]
  kerf_mm: number
  num_cuts: number
  scrap_mm: number
  is_active: boolean
}

export interface DashboardSummary {
  uid_total: number
  uid_active: number
  uid_on_hold: number
  uid_dispatched: number
  priority_urgent: number
  priority_high: number
  open_manufacturing_orders: number
  // 6 dashboard metric cards (Design Correction 6)
  awaiting_design_confirmation: number
  furnace_batches_running: number
  uids_dispatched_today: number
  faridabad_batches_in_transit: number
}

export interface ShopfloorStatus {
  location_id: number
  location_code: string
  location_name: string
  total_active_uids: number
  on_hold: number
  workstations: { workstation_id: number; code: string; name: string; category: string; uid_count: number }[]
  storage_locations: { storage_id: number; code: string; name: string; uid_count: number }[]
}
