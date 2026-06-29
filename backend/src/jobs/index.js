// In-process background jobs (cron-style). Kept defensive: a failing job logs
// and never crashes the server process.
import cron from 'node-cron';
import { query } from '../db/pool.js';

const tasks = [];

export function startJobs() {
  // Every 5 minutes: flag Faridabad dispatches not fully received after 7 days.
  tasks.push(
    cron.schedule('*/5 * * * *', async () => {
      try {
        const rows = await query(
          `SELECT COUNT(*)::int AS n FROM faridabad_dispatches d
            WHERE d.date_dispatched < (CURRENT_DATE - INTERVAL '7 days')
              AND COALESCE((SELECT SUM(num_billets_received) FROM receiving_events r WHERE r.faridabad_dispatch_id = d.id), 0)
                  < d.num_billets_dispatched`
        );
        if (rows[0]?.n > 0) console.log(`[jobs] overdue receiving: ${rows[0].n} dispatch(es) in transit > 7 days`);
      } catch (err) {
        console.error('[jobs] overdueReceiving failed:', err.message);
      }
    })
  );

  console.log(`[jobs] started ${tasks.length} background job(s)`);
}

export function stopJobs() {
  for (const t of tasks) t.stop();
}
