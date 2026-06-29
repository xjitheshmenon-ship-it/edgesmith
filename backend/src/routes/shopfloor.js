// Real-time shopfloor data — wall displays + dashboard.
import { Router } from 'express';
import { query, one } from '../db/pool.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Public — shopfloor wall display needs no auth.
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const locationId = req.query.location_id ? parseInt(req.query.location_id, 10) : null;
    const locations = locationId
      ? await query('SELECT * FROM factory_locations WHERE is_active = TRUE AND id = $1', [locationId])
      : await query('SELECT * FROM factory_locations WHERE is_active = TRUE ORDER BY id');

    const result = [];
    for (const loc of locations) {
      const wsCounts = await query(
        `SELECT cs.workstation_id, COUNT(u.id)::int AS count
           FROM cycle_steps cs
           JOIN uids u ON u.current_step_id = cs.id
          WHERE u.factory_location_id = $1 AND u.status = 'active'
          GROUP BY cs.workstation_id`,
        [loc.id]
      );
      const wsMap = Object.fromEntries(wsCounts.map((r) => [r.workstation_id, r.count]));

      const workstations = await query(
        `SELECT * FROM workstations
          WHERE (factory_location_id = $1 OR factory_location_id IS NULL) AND is_active = TRUE
          ORDER BY id`,
        [loc.id]
      );
      const wsStatus = workstations.map((w) => ({
        workstation_id: w.id,
        code: w.code,
        name: w.name,
        category: w.category,
        uid_count: wsMap[w.id] || 0,
      }));

      const storageCounts = await query(
        `SELECT current_storage_id, COUNT(id)::int AS count
           FROM uids WHERE factory_location_id = $1 AND status = 'active'
          GROUP BY current_storage_id`,
        [loc.id]
      );
      const storageMap = Object.fromEntries(storageCounts.map((r) => [r.current_storage_id, r.count]));

      const storages = await query(
        `SELECT * FROM storage_locations
          WHERE (factory_location_id = $1 OR factory_location_id IS NULL) AND is_active = TRUE
          ORDER BY id`,
        [loc.id]
      );
      const storageStatus = storages.map((s) => ({
        storage_id: s.id,
        code: s.code,
        name: s.name,
        uid_count: storageMap[s.id] || 0,
      }));

      const totalActive = await one(
        "SELECT COUNT(*)::int AS n FROM uids WHERE factory_location_id = $1 AND status = 'active'",
        [loc.id]
      );
      const onHold = await one(
        "SELECT COUNT(*)::int AS n FROM uids WHERE factory_location_id = $1 AND status = 'on_hold'",
        [loc.id]
      );

      result.push({
        location_id: loc.id,
        location_code: loc.code,
        location_name: loc.name,
        total_active_uids: totalActive.n,
        on_hold: onHold.n,
        workstations: wsStatus,
        storage_locations: storageStatus,
      });
    }
    res.json(result);
  })
);

// Manager dashboard — cross-location summary (6 metric cards + legacy fields).
router.get(
  '/dashboard',
  requireAuth,
  asyncHandler(async (req, res) => {
    const c = async (sql, params = []) => (await one(sql, params)).n;

    const total = await c('SELECT COUNT(*)::int AS n FROM uids');
    const active = await c("SELECT COUNT(*)::int AS n FROM uids WHERE status = 'active'");
    const onHold = await c("SELECT COUNT(*)::int AS n FROM uids WHERE status = 'on_hold'");
    const dispatched = await c("SELECT COUNT(*)::int AS n FROM uids WHERE status = 'dispatched'");
    const priorityUrgent = await c("SELECT COUNT(*)::int AS n FROM uids WHERE status = 'active' AND priority = 'urgent'");
    const priorityHigh = await c("SELECT COUNT(*)::int AS n FROM uids WHERE status = 'active' AND priority = 'high'");
    const openMos = await c("SELECT COUNT(*)::int AS n FROM manufacturing_orders WHERE status = 'open'");

    // Card 3 — UIDs at Step 15 or 16 with no confirmed design
    const awaitingDesign = await c(
      `SELECT COUNT(*)::int AS n FROM uids u
         JOIN cycle_steps cs ON cs.id = u.current_step_id
        WHERE cs.step_number IN ('15','16') AND u.design_confirmed = FALSE
          AND u.status NOT IN ('converted','dispatched','archived')`
    );
    // Card 4 — active tempering/furnace runs right now (started, not ended)
    const furnaceRunning = await c('SELECT COUNT(*)::int AS n FROM furnace_batches WHERE ended_at IS NULL');
    // Card 5 — UIDs that completed their final step today
    const dispatchedToday = await c(
      `SELECT COUNT(DISTINCT u.id)::int AS n FROM uids u
         JOIN uid_step_history h ON h.uid_id = u.id
        WHERE u.status = 'dispatched' AND h.performed_at::date = CURRENT_DATE`
    );
    // Card 6 — Faridabad batches dispatched but not yet fully received at Dharmapuri
    const inTransit = await c(
      `SELECT COUNT(*)::int AS n FROM faridabad_dispatches d
        WHERE COALESCE((SELECT SUM(num_billets_received) FROM receiving_events r WHERE r.faridabad_dispatch_id = d.id), 0)
              < d.num_billets_dispatched`
    );

    res.json({
      uid_total: total,
      uid_active: active,
      uid_on_hold: onHold,
      uid_dispatched: dispatched,
      priority_urgent: priorityUrgent,
      priority_high: priorityHigh,
      open_manufacturing_orders: openMos,
      // 6 dashboard metric cards (Design Correction 6)
      awaiting_design_confirmation: awaitingDesign,
      furnace_batches_running: furnaceRunning,
      uids_dispatched_today: dispatchedToday,
      faridabad_batches_in_transit: inTransit,
    });
  })
);

export default router;
