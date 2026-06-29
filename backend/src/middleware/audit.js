// Append-only audit log writer. Never throws into the request path —
// a failed audit insert is logged but does not break the operation.
import { query } from '../db/pool.js';

export async function writeAudit(userId, action, tableName, recordId, before = null, after = null) {
  try {
    await query(
      `INSERT INTO audit_log (user_id, action, table_name, record_id, before_val, after_val)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId ?? null,
        action,
        tableName ?? null,
        recordId != null ? String(recordId) : null,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
      ]
    );
  } catch (err) {
    console.error('[audit] failed:', err.message);
  }
}
