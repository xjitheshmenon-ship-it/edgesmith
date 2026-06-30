const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRole, enforceLocationScope } = require('../middleware/rbac');
const { auditContext } = require('../middleware/audit');
const ctrl = require('../controllers/uidsController');

const router = express.Router();
router.use(authenticate, auditContext);

router.get('/', listAsync(ctrl.listUids));
router.post('/', requireRole(['admin', 'manager', 'supervisor']), listAsync(ctrl.bulkCreateUids));
router.get('/preview', listAsync(ctrl.previewGeneration));
router.get('/summary/wip', listAsync(ctrl.wipSummary));
router.get('/summary/stations', listAsync(ctrl.stationSummary));

router.get('/:code', listAsync(ctrl.getUidDetail));
router.patch('/:code', requireRole(['admin', 'manager', 'supervisor']), listAsync(ctrl.updateUid));
router.post('/:code/advance', requireRole(['admin', 'manager', 'supervisor', 'operator']), listAsync(ctrl.advanceUid));
router.post('/:code/hold', requireRole(['admin', 'manager', 'supervisor']), listAsync(ctrl.holdUid));
router.post('/:code/release', requireRole(['admin', 'manager', 'supervisor']), listAsync(ctrl.releaseUid));
router.post('/:code/converting', requireRole(['admin', 'manager', 'supervisor']), listAsync(ctrl.convertUid));
router.get('/:code/lineage', listAsync(ctrl.getLineage));

// Express 5 natively forwards rejected promises from async handlers to the
// error middleware (verified — see app.js comment), so this wrapper is
// belt-and-braces rather than strictly required. Kept for explicitness
// since this file routes to controller functions defined elsewhere, where
// it's less immediately obvious at the call site that they're async.
function listAsync(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = router;
