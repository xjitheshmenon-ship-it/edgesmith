# CPCMS — Rule Book
## Webapp Business Rules, Cycle Mapping, and Calculations
## Edgesmith Tooling India Pvt Ltd

---

## 1. UID RULES

### Format
- 1 letter + 3 digits. E043, S012, O007.
- Maximum per series: 999. Next number after 999 = roll over to next available letter.

### Letter assignment
- EAT cycle → E series
- SWAN cycle → S series
- OVEN cycle → O series
- When a series hits 999, advance to the next letter in A–Z not currently in use by any active cycle type
- Letters already assigned to other active cycles are skipped during rollover

### Cycle type inheritance (Dharmapuri)
- Cycle type of a UID is determined at **TAG-01 (Tagging Table)** — not at BSW-01
- UID is **auto-generated the moment the operator opens the job at the Tagging Table** — no manual create button
- Cycle type is inherited from the **Faridabad dispatch batch** the block came from
- Cycle type is inherited from the **alloy steel grade** at Faridabad intake (via Admin-configured Grade → Cycle Type mapping)
- All plates cut from one block carry the **same cycle type** — no per-plate cycle type selection
- **Exception — Converting (Step 16):** child UIDs created from a split CAN be assigned a different cycle type from the parent. This is the only point in the system where a UID's cycle type can diverge from its origin block's cycle type.

### Receiving vs Tagging — two distinct operations
- **Receiving** — logs the physical arrival of a block from the rolling contractor at Dharmapuri. Handled on the Receiving page. No UIDs are created here.
- **Tagging (TAG-01)** — the physical station where plates are tagged after cutting. UIDs are auto-generated here when the operator opens the job. These are separate physical events that happen at different points in the flow:

```
Block arrives at Dharmapuri → Receiving event logged (Receiving page)
         ↓
BSW-01 — Band Saw Cutting — block cut into 2–3 plates
         ↓
TAG-01 — Tagging Table — operator opens job → UID auto-generated per plate
```

### UID child naming (Converting)
- Children of E043 are named E043-A, E043-B, E043-C (up to 4 children)
- Suffix letters: A, B, C, D in order of creation
- Minimum 1 child — Converting can produce a single resized output (e.g. 1500mm → 1424mm = 1 child only)

### After Converting — child UIDs go to TAG-01
After Step 16 (Converting at BSW-02), child UIDs are not tagged in place. They go to the Tagging Table:

```
BSW-02 — Converting (Step 16) — parent plate cut or resized
         ↓
TAG-01 — Tagging Table (Step 16B — Child Tagging) — child UID auto-generated and tagged onto each piece
```

Step 16B is now named **Child Tagging** (not "Child Tagging") and occurs at TAG-01, same workstation as initial UID creation.

---

## 2. CYCLE RULES

### Cycle types
- EAT, SWAN, OVEN — defined in Cycle Builder
- Each cycle type has its own versioned step sequence
- UIDs are pinned to the cycle version active at the time they were created
- In-progress UIDs follow their pinned version even after Admin publishes a new version
- New UIDs always use the current version

### Design lock
- Design must be confirmed on a UID before it can proceed past Step 15 (Straighten Manual)
- If design is not confirmed when the UID reaches Step 15: **hold is placed automatically**
- Step 16 (Converting) is **blocked** for any UID on hold due to missing design
- No override permitted on the design lock — Admin must confirm the design, then the Supervisor releases the hold

### Converting — Step 16 specific rules
- Parent UID status → done (frozen) once Converting is confirmed
- Children are created at Step 16B (Child Tagging) at workstation **TAG-01**
- Kerf per cut: **3mm**
- Scrap = input_length − Σ(child_lengths) − (cuts × 3mm)
- Scrap must be ≥ 0; system blocks Converting if it would produce negative scrap
- Minimum 1 child, maximum 4 children. Converting can be a simple resize (e.g. 1500mm → 1424mm, 1 child, 1 cut, 73mm scrap)
- Conversion pattern (from Master Lists) determines valid child-length combinations
- Authorisation by Supervisor required before Converting can be confirmed

---

## 3. FURNACE BATCH RULES

### Single cycle type per batch — HARD RULE
- One furnace batch (HT70, HT80, or HT90) must contain UIDs of **one cycle type only**
- EAT, SWAN, and OVEN cannot be mixed in the same furnace run
- This rule has **no override** — it cannot be bypassed by Supervisor or Admin
- Reason: each cycle type has its own Admin-configured target temperature and soak time. Mixing would mean applying one set of parameters to bars requiring different parameters.

### Bar size mixing — ALLOWED
- Different bar sizes (1424mm, 1500mm, 2750mm, 3000mm) **can be mixed freely** in one furnace batch
- Capacity is calculated in units based on 1500mm as the base: `capacity_units = ceil(bar_length / 1500)`

| Bar length | Capacity units consumed |
|---|---|
| 1424mm | 1 unit |
| 1500mm | 1 unit |
| 2750mm | 2 units |
| 3000mm | 2 units |

- Total capacity consumed by a batch = sum of capacity units across all bars in the batch
- Batch is full when total units consumed = max capacity for that furnace step

### Minimum queue threshold
- HT70 (Hardening): minimum **6 capacity units** before batch can start
- HT80 (Quenching): minimum **6 capacity units** before batch can start
- HT90 (all Tempering steps): minimum **80 capacity units** before batch can start
- When threshold is reached: workstation is flagged READY on Production Floor and Work Assignment
- Supervisor **multi-selects jobs** from the queue on Work Assignment and assigns them to the furnace workstation unit — this multi-selection automatically becomes the furnace batch record in the backend
- No separate batch-builder UI — assignment is batching (same pattern as grinding)
- Supervisor can **override** the minimum threshold to start with fewer units — requires a mandatory reason, logged to audit trail
- Threshold override IS permitted (unlike the cycle-type mixing rule, which is never overridable)

### Furnace capacity (unit-based)
Admin sets max capacity in **units** (not pieces) per furnace step in Cycle Builder. Each bar consumes units based on its length. System auto-calculates remaining slots as bars are added to a batch.

```
units_consumed_per_bar = ceil(bar_length_mm / 1500)
total_units_consumed   = sum of units_consumed across all bars in batch
batch_is_full          = total_units_consumed >= max_capacity_units
```

| Furnace | Max capacity (units) | Example: 80 units |
|---|---|---|
| HT70 | 6 units | 6× 1500mm bars, or 3× 2750mm bars, or any mix totalling ≤ 6 units |
| HT80 | 6 units | same as HT70 |
| HT90 | 80 units | 80× 1500mm bars, or 40× 3000mm bars, or any mix totalling ≤ 80 units |

### Furnace batch opening — cycle type parameters shown to operator and Supervisor
When a furnace batch is created (Supervisor multi-selects jobs and assigns to furnace on Work Assignment page), the system displays the following to both the Supervisor AND the operator before the batch is confirmed:
- Cycle type of the batch (EAT / SWAN / OVEN)
- Target temperature (°C) for this step and cycle type
- Target soak time (minutes) for this step and cycle type
- Tolerance values (±°C and ±minutes)

This ensures both operator and Supervisor are aware of the exact parameters before the furnace run begins, not just the Admin who configured them. The display is informational — it does not require a separate acknowledgement click, but it is always shown at batch-open time.

### Deviation flagging
After a furnace batch closes, actual temperature and actual soak time are compared against the Admin-configured targets for that step and cycle type. If either value falls outside tolerance, the batch is **deviation-flagged**. A deviation-flagged batch requires Supervisor acknowledgement before the step is considered complete for the UIDs in that batch. Deviation does not automatically place UIDs on hold — that is Supervisor's judgment call.

### Tempering step mapping
- Step 9 → Tempering 1 (HT90)
- Step 10 → Tempering 2 (HT90)
- Step 14 → Tempering 3 (HT90)
- Step 23 → Tempering 4 — Stress Relief (HT90)

Each has its own target temperature and soak time per cycle type, configured in Heat Treatment Parameters by Admin.

---

## 4. GRINDING BATCH RULES

### Machine length limits (HARD — physical constraint)

| Machine | Max bed length |
|---|---|
| SG-DLT (Surface Grinder Delta) | 3000mm |
| AG-GMM (Angle Grinder Gamma) | 3000mm |
| AG-BTA (Angle Grinder Beta) | 1500mm |
| AG-ALP (Angle Grinder Alpha) | 1500mm |

A bar whose length exceeds a machine's maximum cannot be assigned to that machine. System blocks the assignment.

### Pairing rule (SG-DLT and AG-GMM)
- Combined length of all bars in one batch must not exceed the machine's maximum (3000mm)
- No same-length requirement — bars of different lengths can be paired as long as they fit
- Valid: 1500 + 1424 = 2924mm ✓
- Valid: 2750 alone = 2750mm ✓
- Invalid: 2750 + any bar (exceeds 3000mm) ✗

### Bunch Grinding (Step 4 — SG-DLT) specific rules
- Bars are placed **side by side** in sets (bunched) on the magnetic chuck
- Sets are placed **end to end** along the 3000mm machine bed
- Bars per set: Admin-configurable (default **5**). Change takes effect on next batch only.
- Number of sets per run = floor(3000 / bar_length_mm), minimum 1

| Bar length | Sets per run | Total bars per run |
|---|---|---|
| 1500mm | 2 | 10 |
| 1424mm | 2 | 10 |
| 2750mm | 1 | 5 |

- All bars within one set must be the same length
- Two sets in one run may be different lengths provided combined total ≤ 3000mm

### How grinding batches are created
Grinding batches are **not built through a separate batch-builder UI**. The Supervisor simply multi-selects jobs on the Work Assignment page and assigns them to a specific grinding machine unit. That multi-selection automatically becomes a batch record in the backend. No separate "build batch" step exists — assignment is batching.

The length-fit rules above are enforced at the point of multi-select assignment: the system blocks adding a job to a machine assignment if the bar's length exceeds the machine's maximum, or if adding it would push the combined length over the machine maximum.

---

## 5. WORKSTATION CAPACITY RULES

### Capacity per step per unit
Each step in the Cycle Builder has a capacity value per workstation unit. This defines how many UIDs can run on that machine simultaneously at that step.

### Furnace steps
Capacity is set in **units** (base: 1500mm = 1 unit). Admin sets the max unit count per furnace step in Cycle Builder. System calculates units consumed per bar using `ceil(bar_length / 1500)` and tracks remaining capacity as bars are added.

### Grinding steps
Capacity is **length-based** (governed by the grinding rules above, not a fixed number). Shown as "Length-based" in Cycle Builder — no numeric capacity entry.

### All other steps
Fixed capacity (usually 1 per unit). Admin-editable per step in Cycle Builder.

### Multi-unit workstations
One operator can be assigned to multiple workstations simultaneously. Each workstation unit runs independently — one timer per unit, one job per unit at a time.

---

## 6. JOB EXECUTION RULES

### Job states — applies to both Dharmapuri and Faridabad
```
QUEUED → OPEN → IN PROGRESS → PAUSED → IN PROGRESS → CLOSED
                    ↓
                  HOLD (Supervisor/Admin only)
                    ↑
              OPEN → QUEUED (operator returns job, reason required,
                             notification to Supervisor/Admin)
```

Transitions:
- QUEUED → OPEN: operator opens job, sees source/destination storage
- OPEN → QUEUED: operator returns job without starting — mandatory reason, notification fired to Supervisor and Admin
- OPEN → IN PROGRESS: operator starts timer (Welding step: BOM must be selected first)
- IN PROGRESS → PAUSED: operator pauses, mandatory reason
- PAUSED → IN PROGRESS: operator resumes
- IN PROGRESS or PAUSED → HOLD: Supervisor/Admin only, mandatory reason
- HOLD → IN PROGRESS: Supervisor/Admin releases hold, mandatory reason
- IN PROGRESS → CLOSED: operator closes job, destination storage shown as non-blocking instruction
- Next job opens automatically after close

### Start
- Timer starts (net work time counter and total elapsed counter begin)
- Workstation unit auto-assigned by the system (picks available unit)

### Pause — mandatory reason
Pause requires selecting one of exactly 5 reasons (no exceptions):
1. Break
2. Machine issue
3. Material not ready
4. Waiting for supervisor
5. Other (free text required)

Timer stops. Net work time is preserved and frozen at its current value.

### Resume
Timer restarts. Active time counter resets to 00:00:00. Net work time continues accumulating from where it was.

### Welding BOM — Faridabad Welding step
When operator opens a Welding job, they must confirm taking 1 alloy steel piece and 1 MS piece from FAR-MC inventory before START is enabled:
- Pieces matched by **length only** (e.g. 1500mm) and cycle type
- Tracked as **quantity pool** — no individual piece IDs
- FAR-MC inventory count decrements by 1 alloy and 1 MS on START
- If either pool count is 0: START is blocked
- Applies to Faridabad Welding step only — all other steps on both locations have no BOM requirement

### Close
On close, the system records:
- Net work time (active time only, pauses excluded) — this is the primary performance metric
- Total elapsed time (including pauses — for context only, not the performance metric)
- QC result if required at this step

After close:
- UID advances to next step
- UID's storage location updates to the destination storage for that step
- QC fail → UID placed on hold automatically, Supervisor alerted
- Design not confirmed at next-step threshold → UID placed on hold automatically

### Furnace / batch jobs
Timer is on the **batch**, not the individual UID. All UIDs in the batch share one start, pause, and close event. Closing a furnace batch additionally requires actual temperature and actual soak time to be entered.

### Faridabad jobs
Close button reads "CLOSE — LOG OPERATION." On close, a weld log entry is recorded (feeding the running tally). For MS Cutting specifically, close panel requires confirming cut piece sizes and quantities — balance is then auto-calculated and recorded.

### Pause threshold alert
Admin configures a maximum acceptable pause duration per step. If any job remains paused beyond this threshold, Supervisor on duty receives an alert.

---

## 7. HOLD AND RELEASE RULES

### Hold placement
Holds are placed:
- **Automatically** by the system: QC fail, design not confirmed at Step 15/16, furnace deviation (Supervisor's judgment, not auto-hold)
- **Manually** by Supervisor or Admin only with a mandatory reason — operators cannot place holds

### Hold release
Only Supervisor, Manager, or Admin can release a hold. Release requires the underlying issue to be resolved first (e.g. design confirmed, rework completed). The reason for release is logged.

### Converting blocked on hold
A UID on hold cannot proceed to Step 16 (Converting) under any circumstances.

---

## 8. BADGE AND WORKSTATION ASSIGNMENT RULES

### Skill badge codes

Eight skill badges, all 12-month expiry, assigned to employees by Admin:

| Code | Skill | Workstations covered |
|---|---|---|
| GRIND | Grinding | SG-DLT, AG-ALP, AG-BTA, AG-GMM |
| HT | Heat Treatment | HT70, HT80, HT90 |
| MILL | Milling | MM22, MM11 |
| CUT | Cutting | BSW-01, BSW-02 |
| TAG | Tagging | TAG-01 |
| COAT | Coating | PRO |
| INSP | Inspection | HRC-01 |
| STR | Straightening | STR-MAN, STR-HYD |

Badges are skill-based, not per-workstation. One badge covers all workstations in its skill category. `badge_types.workstation_type_id` is NULL for all skill badges.

### Badge validation on assignment
When a Supervisor assigns an operator to a workstation:
- System checks the operator holds the required skill badge for that workstation's category
- System checks the badge has not expired (all badges expire after 12 months)
- If badge check fails: **warning shown, Supervisor can override with a mandatory reason** (logged to audit trail)

### HT badge — furnace verification rule (CRITICAL)
Furnace workstations (HT70, HT80, HT90) require a **two-step process** before operation starts:

**Step 1 — Operator with HT badge sets up the furnace:**
- Loads UIDs into the batch via Work Assignment multi-select
- System displays target temperature, soak time, and tolerances from Heat Treatment Parameters
- Operator confirms setup is ready

**Step 2 — Supervisor must verify before START is enabled:**
- Supervisor reviews operator's inputs on screen (UIDs selected, parameters displayed)
- Supervisor confirms the setup is correct
- Only after Supervisor confirmation does START become active
- Without Supervisor verification: START is permanently blocked — operator cannot bypass

This is a verification checkpoint, not an operational transfer. The operator does the physical work; the Supervisor provides mandatory sign-off before the furnace turns on. Supervisor verification is a role responsibility — the Supervisor does not need an HT badge to verify.

**Without HT badge:** operator cannot be assigned to furnace workstations. System blocks the assignment — no override permitted for this specific rule.

### HT badge — furnace detail visibility on UID Lookup
On UID Lookup, furnace step rows (Hardening, Quenching, Tempering 1–4) show full detail (target temp, actual temp, soak time, deviation flag) only to:
- Admin / Manager: always — oversight roles, no badge requirement
- Supervisor / Operator with valid HT badge: full furnace detail visible
- Supervisor / Operator without HT badge: step name, date, pass/fail only — no temperatures or deviation values

### One operator, multiple workstations
One operator can be assigned to multiple workstations in one shift. Each workstation runs its own independent job timer.

### Unassignment
Supervisor can drag a workstation assignment off an operator card at any time during the shift. Any in-progress job at that workstation must be reassigned or handed over.

---

## 9. SHIFT RULES

### Structure
- 3 shifts per day: Shift 1 (06:00–14:00), Shift 2 (14:00–22:00), Shift 3 (22:00–06:00)
- Applies to both Faridabad and Dharmapuri
- Shift timings are Admin-configurable

### Handover — mandatory
- Outgoing Supervisor must submit a handover before the incoming Supervisor can take over
- Handover captures: active workstation status (auto-populated), furnace batches running (auto-populated), UIDs on hold (auto-populated), equipment issues (free text), urgent notes (free text)
- Incoming Supervisor must acknowledge handover before outgoing Supervisor's record is closed
- Until acknowledged: outgoing Supervisor remains supervisor of record for that shift

### Shift record
Every step log, furnace batch, and job is tagged to the active shift automatically. If a furnace batch spans two shifts, both shifts are recorded against it.

---

## 10. LOCATION RULES

### Two locations
- **Dharmapuri** — all UID-tracked production, all 27 EAT cycle steps
- **Faridabad** — batch-level tracked production, 10-step Faridabad cycle, no UIDs

### Role access
- Admin: both locations — **unrestricted, the only truly cross-location role**
- Manager: their assigned location only — server-enforced, same as Supervisor
- Supervisor: their assigned location only — server-enforced
- Operator: their assigned location only — server-enforced
- Service: no location restriction — read-only UID Lookup only
  - Final Inspection Report view only (Step 26 QC results, material identity, dispatch status)
  - No individual step history, no furnace temperatures, no operator names, no pause records
  - Heat treatment confirmation shown as Y/N only — actual temperature values never shown to Service role

### Server-side enforcement
Location scoping is enforced by the backend independently of what the frontend sends. **Admin is the only role whose JWT carries no location restriction.** Manager, Supervisor, and Operator JWTs all carry a fixed location_id — any request for another location's data is rejected at the server regardless of UI state or topbar toggle position.

### Topbar toggle
The single topbar location toggle (Dharmapuri / Faridabad / Both) reshapes data on every page — Production Floor, My Workstation, Work Assignment, Shift Planner, Employee Profiles, Master Lists, Cycle Builder, Reports. There is exactly one location control in the entire app — the topbar pill. No page may implement its own separate location filter.

---

## 10A. FARIDABAD PIECE COUNT VERIFICATION RULE

At every step in the Faridabad cycle, before the operator can close a job and advance to the next step, the system requires a **piece count verification**:

- System shows the **expected piece count** for this step (based on what was logged at the previous step)
- Operator confirms the **actual piece count** in hand
- If counts match: job closes normally, pieces advance to next step storage
- If counts do not match: operator must enter a reason for the discrepancy before proceeding. Alert sent to Supervisor.

This applies to every one of the 10 Faridabad steps — not just Welding. Since Faridabad has no individual UID tracking, piece count verification at each step transition is the primary mechanism for detecting losses, miscounts, or material mix-ups between operations.

**Piece count is tracked per cycle type and per size** (e.g. "12 pieces of 1500mm EAT in FAR-MC") — not per individual piece.

**At Welding specifically:** piece count works slightly differently since two pieces (1 alloy + 1 MS) go in and 1 block comes out. Operator confirms:
- Alloy pieces taken from FAR-MC: expected 1, actual [N]
- MS pieces taken from FAR-MC: expected 1, actual [N]
- Blocks produced: expected 1, actual [N]

## 10B. FARIDABAD STORAGE LOCATIONS

| Code | Name | Holds |
|---|---|---|
| FAR-RM | Raw Material | Alloy steel bars and MS sheets on arrival |
| FAR-MC | Machining | In-process material through all prep steps to welding |
| FAR-DSP | Dispatch | Welded blocks ready for truck loading |

## 11. FARIDABAD MATERIAL TRACEABILITY RULES

### Heat number traceability — honest, not exact
- One truck dispatch can contain blocks made from multiple different alloy steel heat numbers
- Rolling erases individual block identity — blocks cannot be traced back to exactly one heat number after rolling
- System stores **possible heat numbers** as a list (all heat numbers used in intakes for that cycle type since the last dispatch)
- All displays of heat numbers — UID Detail, Service Call Lookup — must show "Possible heat numbers: X, Y, Z" with an explicit caveat that individual traceability is not available past the rolling stage
- Never display a single definitive heat number — this would imply false precision

### Color code traceability
- Each dispatch batch is assigned a **color code** (auto-picked, manual override allowed)
- The color is physically marked on the blocks before dispatch
- On arrival at Dharmapuri Receiving, the color is verified against the dispatch record
- Color mismatch requires Supervisor confirmation before the batch can be received
- Color code is tracked on every UID created from that batch (carried through on the UID record)

### Cycle type from alloy steel grade
- Cycle type (EAT/SWAN/OVEN) is determined by alloy steel **grade** at Faridabad intake
- Admin maintains a Grade → Cycle Type mapping table in Master Lists
- Selecting a grade at intake auto-displays the cycle type — it is not a free choice by the operator
- This cycle type carries through: Joining → Dispatch → Rolling → Dharmapuri Receiving → BSW-01 → all plates cut from that block

---

## 12. MS SHEET BALANCE CALCULATION (Faridabad MS Cutting — Step 5)

### Inputs
- Sheet dimensions from MS Intake: length (mm), width (mm), height/thickness (mm)
- One or more cut piece types, each with: piece length (mm), piece width (mm), quantity required
- Fixed cutting margin: **5mm deducted from both length and width of every individual piece**

### Grid-fit per piece type
For each piece type against available sheet width W and length L:

```
effective_piece_length = piece_length + 5mm   (the space each piece occupies on the sheet)
effective_piece_width  = piece_width  + 5mm

pieces_per_row    = floor(W / effective_piece_width)
pieces_per_column = floor(L / effective_piece_length)
max_pieces_fit    = pieces_per_row × pieces_per_column

used_width  = pieces_per_row    × effective_piece_width
used_length = pieces_per_column × effective_piece_length
```

If more pieces fit than are required, only the required quantity is cut. Fill order: rows first (left to right), then columns (top to bottom). The unused grid capacity remains part of the available sheet area for the next piece type.

Multiple piece types are allocated sequentially against the same sheet. Each subsequent type is fit against the remaining available area after prior types have claimed their space.

### Balance strips (two per sheet)

After all piece types are allocated:

```
Strip A (remaining width edge):
  strip_A_width  = sheet_width − used_width
  strip_A_length = sheet_length

Strip B (remaining length edge):
  strip_B_width  = used_width
  strip_B_length = sheet_length − used_length
```

### Balance weight (the primary reported metric)

```
strip_A_weight = 0.0000079 × strip_A_width × strip_A_length × height   (kg)
strip_B_weight = 0.0000079 × strip_B_width × strip_B_length × height   (kg)

total_balance_weight = strip_A_weight + strip_B_weight
```

The constant 0.0000079 is the steel density coefficient in kg/mm³.

**This weight is auto-calculated by the system — the operator never measures or enters it.** It appears on the MS Cutting close panel (read-only, auto-populated) and is the value recorded against the batch record.

### Reports
Primary: total balance weight per cutting run, per date range, per MS supplier, per cycle type.
Secondary: strip dimensions (for reference), number of pieces cut per run.

---

## 13. CONVERTING SCRAP CALCULATION (Dharmapuri — Step 16)

```
cuts        = number of child UIDs created
kerf_total  = cuts × 3mm
scrap_mm    = parent_length_mm − Σ(child_lengths_mm) − kerf_total
```

Scrap must be ≥ 0. System blocks Converting if calculation results in negative scrap (means child lengths exceed parent length, which is physically impossible).

Scrap is recorded on the split event record (mm). No weight formula for Dharmapuri scrap — dimensions only.

---

## 14. BATCH DISPATCH — FARIDABAD (two-leg model)

### Leg 1 — Dispatch to Rolling Contractor
- Supervisor creates dispatch batch on Faridabad Batch Tracker page
- Batch reference auto-generated (FAR-DISP-YYYY-NNN)
- Color code assigned (auto-pick with manual override)
- Possible heat numbers pulled from all undispatched weld log entries for this cycle type
- Block count entered by Supervisor (cannot exceed running tally for that cycle type)
- Truck capacity checked against Admin-configured maximum (partial dispatch allowed — no hard block, unlike furnace threshold)
- On confirm: weld log entries marked dispatched, batch status → "Dispatched to Rolling"

### Rolling duration tracking
- Days at rolling = current date − dispatch leg 1 date
- Alert fired if days at rolling > 15 days
- Status remains "At Rolling" until Supervisor logs Leg 2

### Leg 2 — Dispatch to Dharmapuri
- Supervisor logs on Faridabad Batch Tracker: rolling complete, dispatched onward
- Date of onward dispatch recorded
- Batch status → "Dispatched to Dharmapuri"
- Block never returns to Faridabad — rolling contractor ships directly onward

### Receipt at Dharmapuri
- Logged by Dharmapuri team on the Receiving page (color code verified on arrival)
- Faridabad Batch Tracker shows "Received at Dharmapuri" status pulled read-only from that receiving event
- No second data entry on the Faridabad side

---

## 15. SOFT DELETE RULE

Nothing in CPCMS is ever permanently deleted. Every record — UIDs, batches, cycles, employees, master list entries, audit log entries — is archived (status set to 'archived') rather than removed from the database. This applies without exception.

---

## 16. AUDIT LOG RULE

Every data write (create, update, status change) logs: who made the change, when, what the value was before, and what it is after. The audit log is append-only — entries are never modified or deleted. Override actions (threshold override, badge override, etc.) additionally log the stated reason.

