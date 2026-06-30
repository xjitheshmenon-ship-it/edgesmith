# CPCMS — Page Instructions
## How Each Page Works, What It Shows, and How Operations Connect
## Edgesmith Tooling India Pvt Ltd

---

## NAVIGATION STRUCTURE

```
FARIDABAD SIDE
  ├── Raw Material Intake
  ├── Joining Operation
  └── Contractor Dispatch

DHARMAPURI SIDE
  ├── Receiving
  ├── UID Creation (BSW-01)
  ├── Production Floor
  ├── Shopfloor Display (wall screen)
  ├── Batch Management
  └── QC

OPERATIONS
  ├── Dashboard
  ├── MO Linking
  └── Reports

SERVICE
  └── Service Call Lookup

ADMIN / CONFIGURATION
  ├── Cycle Builder
  ├── Master Lists
  ├── Tempering Parameters
  └── Users and Roles
```

---

## WHO SEES WHAT

| Page | Admin | Manager | Supervisor | Operator | Service | Shopfloor |
|---|---|---|---|---|---|---|
| Raw Material Intake | ✓ | ✓ | — | — | — | — |
| Joining Operation | ✓ | ✓ | — | — | — | — |
| Contractor Dispatch | ✓ | ✓ | — | — | — | — |
| Receiving | ✓ | ✓ | ✓ | — | — | — |
| UID Creation | ✓ | ✓ | ✓ | — | — | — |
| Production Floor | ✓ | ✓ | ✓ | ✓ | — | — |
| Shopfloor Display | — | — | — | — | — | ✓ |
| Batch Management | ✓ | ✓ | ✓ | — | — | — |
| QC | ✓ | ✓ | ✓ | log only | — | — |
| Dashboard | ✓ | ✓ | ✓ | — | — | — |
| MO Linking | ✓ | ✓ | — | — | — | — |
| Reports | ✓ | ✓ | limited | — | — | — |
| Service Call Lookup | ✓ | ✓ | ✓ | — | ✓ | — |
| Cycle Builder | ✓ | view | — | — | — | — |
| Master Lists | ✓ | view | — | — | — | — |
| Tempering Parameters | ✓ | — | — | — | — | — |
| Users and Roles | ✓ | — | — | — | — | — |

---

## PAGE 1 — DASHBOARD

### Purpose
Single view of the entire operation across both locations. First page seen by Manager, Supervisor, and Admin on login.

### Layout
Top row: key metric cards.
Middle: alerts panel + priority queue side by side.
Bottom: WIP by storage location + active station summary.

### Metric cards (top row)
- **Total active UIDs** — count of all UIDs currently in production at Dharmapuri
- **On hold** — UIDs blocked (design not confirmed, QC failed, other hold). Clicking opens UID list filtered to hold status.
- **Awaiting design confirmation** — UIDs at Step 15 or Step 16 with no design set. Clicking opens UID list filtered to these UIDs.
- **Furnace batches running** — count of active tempering runs right now
- **UIDs dispatched today** — count of UIDs that completed Step 27 today
- **Faridabad batches in transit** — batches dispatched to rolling contractor, not yet received at Dharmapuri

### Alerts panel
Shows any condition that needs immediate attention. Each alert is a single line with a link to the relevant page.
- UIDs on hold with reason
- Furnace batches with deviation flags (actual parameters outside tolerance)
- UIDs at Step 15 with no design (approaching design lock point)
- QC failures pending supervisor sign-off
- Receiving events pending (billets expected but not yet logged)

Alerts sorted by severity. Most critical at top. Each alert dismissible after action is taken.

### Priority queue
Table of all High priority UIDs currently in production.
Columns: UID, Cycle, Current step, Current storage, Design, MO number, Waiting time at current step.
Sorted by waiting time descending — longest waiting High priority piece at top.
Clicking any UID row opens the UID Detail page for that piece.

### WIP by storage location (Dharmapuri)
A row of storage location tiles: RM → RM-Q → RM-D → HT-Q → HT-D → MC-Q → MC-D → QC-Q → QC-D → FG.
Each tile shows: location code, current UID count, and a small bar showing count relative to typical capacity.
Clicking any tile opens Production Floor filtered to that storage location.

### Active workstation summary
List of all workstations currently running with UID counts.
Columns: Workstation code, name, UIDs currently running, UIDs queued waiting, status (running / idle / hold).
Clicking a workstation row opens Production Floor scrolled to that workstation.

### Location filter
Manager and Admin can toggle between: Dharmapuri only / Faridabad only / Both combined.
Supervisor sees their assigned location by default.

---

## PAGE 2 — RAW MATERIAL INTAKE (Faridabad)

### Purpose
Log incoming alloy steel and MS bar deliveries from suppliers. Every delivery is recorded with full material traceability details before any processing begins.

### How it works
Each delivery creates one intake record. Alloy steel and MS are logged separately because they come from different suppliers with different heat numbers.

### Form — create new intake record
- Material type: Alloy Steel or MS (dropdown, required)
- Supplier name (dropdown from Admin-managed supplier list, with option to add new)
- Heat number (text field, required — taken from the supplier's material test certificate)
- Steel grade (text field, required)
- Weight received (kg, required)
- Number of bars received (required)
- Bar dimensions — diameter or cross-section (mm, required)
- Date received (date picker, defaults to today)
- Purchase order reference (optional, links to Odoo PO)
- Notes (optional)
- Attach material test certificate (file upload, optional but recommended)

### Intake log (below form)
Table of all recent intake records.
Columns: Date, Material type, Supplier, Heat number, Steel grade, Weight (kg), Bar count, Dimensions, Status (available / in joining / used / archived).
Filterable by material type, supplier, date range, status.
Clicking any row shows full intake record detail.

### Connection to next step
Intake records flow into the Joining Operation page. When a joining batch is created, the operator selects specific intake records for alloy steel and MS from this log.

---

## PAGE 3 — JOINING OPERATION (Faridabad)

### Purpose
Log the in-house welding of alloy steel bars and MS bars into composite billets. Each joining event is one production run — one set of bars joined in one session.

### How it works
Operator selects which alloy steel intake record and which MS intake record they are joining. Same-size bars only (system validates dimensions match). Creates a joining batch record linking both heat numbers.

### Form — create new joining batch
- Alloy steel intake record (dropdown from available alloy steel intakes, shows supplier + heat number + dimensions)
- MS intake record (dropdown from available MS intakes, shows supplier + heat number + dimensions — only shows records matching the selected alloy steel bar dimensions)
- Number of billets to be joined in this run (required)
- Operator name (required)
- Date (defaults to today)
- Joining method (dropdown: Flash Welding / Friction Welding / Other — Admin configures options)
- Output billet dimensions (mm, required)
- Notes (optional)

### Output
On save, system creates a joining batch record with:
- Auto-generated joining batch reference (e.g. FAR-JOIN-2024-041)
- Alloy steel: supplier, heat number, grade (from selected intake)
- MS: supplier, heat number, grade (from selected intake)
- Billet count, dimensions, date, operator

### Joining batch log
Table of all joining batches.
Columns: Joining batch ref, Date, Alloy heat number, MS heat number, Billet count, Dimensions, Status (joined / dispatched / partially dispatched).
Clicking any row shows batch detail including dispatch history.

### Connection to next step
Joining batch records flow into the Contractor Dispatch page.

---

## PAGE 4 — CONTRACTOR DISPATCH (Faridabad)

### Purpose
Log the dispatch of joined billets to the third party rolling contractor. This is the last Faridabad operation — after dispatch the material goes directly to Dharmapuri and Faridabad's tracking of that batch ends.

### How it works
Manager selects one or more joining batches to dispatch. Assigns the rolling contractor. Logs date and billet count.

### Form — create dispatch record
- Joining batch(es) being dispatched (multi-select from available joining batches)
- Rolling contractor (dropdown from Admin-managed contractor list)
- Number of billets in this dispatch (auto-filled from selected batches, editable if partial dispatch)
- Date dispatched (required)
- Expected delivery date at Dharmapuri (optional, for tracking)
- Dispatch reference / challan number (optional)
- Notes

### What happens on save
- Each selected joining batch status updates to dispatched (or partially dispatched if split)
- Dispatch record created, linked to joining batches
- Dharmapuri's Receiving page now shows this dispatch as an expected incoming consignment

### Dispatch log
Table of all dispatches.
Columns: Date dispatched, Contractor, Joining batch refs, Billet count, Expected at Dharmapuri, Received status (pending / partially received / fully received).

### Connection to next step
Dispatch records appear in the Dharmapuri Receiving page as expected consignments.

---

## PAGE 5 — RECEIVING (Dharmapuri)

### Purpose
Log the arrival of rolled composite billets from the rolling contractor at Dharmapuri. Links incoming material to the Faridabad dispatch and joining records.

### How it works
When billets arrive, the receiving operator creates a receiving event. Selects the matching Faridabad dispatch record. Logs what arrived and its condition. One Faridabad batch can arrive in multiple receiving events over time.

### Expected consignments panel (top)
List of dispatches from Faridabad that have not yet been fully received.
Columns: Dispatch date, Contractor, Faridabad batch refs, Total billets dispatched, Billets received so far, Remaining.
Clicking a row pre-fills the receiving form.

### Form — create receiving event
- Faridabad dispatch reference (dropdown or auto-filled if clicked from expected panel)
- Rolling contractor name (auto-filled from dispatch record)
- Date received (required)
- Number of billets in this delivery (required)
- Condition on arrival (dropdown: Good / Minor damage noted / Significant damage — if damage, notes required)
- Received by (operator name, required)
- Notes (optional)

### What is shown after receiving event is saved
- Receiving event reference (e.g. DHR-RCV-2024-088)
- Linked Faridabad batch reference
- Alloy steel: supplier, heat number, grade (pulled from joining batch via dispatch)
- MS: supplier, heat number, grade (pulled from joining batch via dispatch)
- Rolling contractor name
- Billet count and arrival condition
- Remaining billets still in transit (if partial)

### Receiving log
Table of all receiving events.
Columns: Date, Receiving ref, Faridabad batch ref, Contractor, Billets received, Condition, Status (awaiting BSW-01 / in production / complete).
Clicking any row shows full detail and which UIDs were created from this receiving event.

### Connection to next step
Receiving events flow into the UID Creation page (BSW-01). Operator selects a receiving event when cutting billets and assigning UIDs.

---

## PAGE 6 — UID CREATION (BSW-01 — Dharmapuri)

### Purpose
The UID birth point. Each billet from a receiving event is loaded onto BSW-01, cut into 2 or 3 pieces, and each piece is immediately assigned a UID. This is the entry point into the 27-step individual tracking cycle.

### How it works
Operator selects a receiving event, selects a billet from that event, enters cut details, and the system generates the UIDs. All material traceability from Faridabad is automatically carried onto every UID created here.

### Form — create UIDs from a billet
- Receiving event (dropdown, shows ref + contractor + date + billet count remaining)
- Billet reference within that event (sequential — billet 1 of 12, billet 2 of 12 etc.)
- Number of pieces this billet will be cut into (2 or 3)
- For each resulting piece:
  - Cycle type (EAT / SWAN / OVEN — can be different per piece)
  - Size in mm (auto-suggested from billet dimensions and cut count, editable)
- Design (optional at this stage — can be confirmed later before Step 16)
- Priority (High / Normal / Low, defaults to Normal)
- MO number (optional, can be linked later)

### UID generation preview
Before confirming, system shows:
- List of UIDs that will be created (e.g. E044, E045, E046)
- Each UID with its assigned cycle type, size, and inherited material details
- Scrap from this cut: billet length minus sum of piece lengths minus (cuts × 3mm kerf)
- Warning if scrap is negative (blocks creation)

### On confirm
- UIDs created in the system, each carrying:
  - Faridabad batch reference
  - Alloy steel: supplier, heat number, grade
  - MS: supplier, heat number, grade
  - Rolling contractor name
  - Receiving event reference
  - Cycle type, size, priority, MO if set
- UIDs status set to active, current step = 1 (BSW-01), storage = RM-Q
- Step 1 log entry written automatically
- Printable UID list generated for tagging station (operator uses this at Step 2 RCV-01 to physically stamp UIDs onto pieces)

### Bulk UID creation (alternative flow)
For situations where UIDs are being created without a direct billet reference (e.g. pre-production planning):
- Manager enters quantity, cycle type, and optionally size, design, priority, MO
- System generates UIDs in sequence
- Confirmation list shown before committing
- Printable and exportable list produced
- Material traceability fields left blank — to be linked to a receiving event later

### Recently created UIDs (below form)
Table of UIDs created today.
Columns: UID, Cycle, Size, Design, Priority, MO, Receiving event, Created at.

### Connection to next step
Created UIDs appear immediately on the Production Floor page at Step 1 / BSW-01 workstation.

---

## PAGE 7 — PRODUCTION FLOOR (Dharmapuri)

### Purpose
The primary operational page. Shows every active UID on the floor, what workstation it is at, what step it is on, and allows operators and supervisors to advance UIDs through steps.

### Layout
Top: status bar + filter controls.
Main area: workstation cards arranged by production flow order.
Side panel (collapsible): storage location counts.

### Status bar
- Total UIDs on floor right now
- Count by status: Active / On hold / In furnace batch
- Count of workstations running / idle / hold
- Location toggle: Dharmapuri (Operators and Supervisors see only their location)

### Filter controls
- Filter by: workstation / storage location / cycle type / priority / step range
- Search by UID code

### Workstation cards
One card per workstation. Cards arranged in the order of the production cycle flow — so the floor reads left to right, top to bottom roughly matching how a piece moves through the factory.

Each workstation card shows:
- Workstation code and name
- Current status: Running / Idle / Hold (colour coded)
- Number of UIDs currently being processed
- Number of UIDs queued and waiting (in the source storage for this step)
- List of UIDs currently at this workstation:
  - UID code
  - Cycle type badge
  - Step number and name
  - How long it has been at this step
  - Priority badge (High shown prominently)
  - Status badge (Active / Hold)
  - For tempering steps: furnace batch number

### Actions on each UID (from workstation card)
**Operator:**
- Mark step complete — advances UID to next step, updates storage, writes step log. For tempering steps this opens the furnace batch workflow instead.
- Flag issue — raises an alert to supervisor without advancing the step

**Supervisor:**
- All operator actions plus:
- Place hold — blocks UID from advancing, requires reason
- Release hold — releases a held UID back to active
- Override step — advance or move a UID to a specific step with reason log

**Manager:**
- All supervisor actions plus:
- Confirm design — if UID is at Step 15 or 16 with no design, opens design confirmation inline
- Change priority — dropdown on the UID card

### Workstation card capacity display

Every workstation card on the Production Floor shows a capacity bar:

```
MM22 — OP10 Rough Mill                    STR-MAN — Straightening
● Running  [██░░] 1/1 slot used           ● Running  [█░] 1/1 slot used
  E043 — In progress  [Mark done]           E044 — In progress  [Mark done]
  ─────────────────────                     Queued: 3 UIDs waiting
  Queued: 4 UIDs waiting

HT70 — Hardening                          HT90 — Tempering 1
● Running  [████░░] 5/6 slots             ● Running  [████████░░] 72/80 slots
  E043, E044, E046,                         E018...E089 (72 UIDs)
  E049, E051 — In progress                  [View batch →]
  Queued: 8 UIDs                            Queued: 14 UIDs waiting

SG-DLT — Surface Grind 1                 BSW-02 — Converting
● Running  [████░░░░░░] 2924/3000mm        ● Running  [█] 1/1 slot used
  E043 (1500mm) + E047 (1424mm)             E042 — Step 16 In progress
  — In progress  [Mark done]                [Open Converting →]
  Queued: 6 UIDs waiting

MM11 — OP20 Semi-finish Mill             PKG — Packing and Dispatch
● Running  [█░] 1/1 slot used             ● Running  [█░] 1/1 slot used
  E041-A — In progress  [Mark done]         O006 — In progress  [Mark done]
  Queued: 2 UIDs waiting                    Queued: 1 UID waiting

PRO — Anti-rust Coat                      HRC-01 — QC Inspection
● Running  [█░] 1/1 slot used             ● Awaiting sign-off
  S011 — In progress  [Mark done]           E039 — [Sign off →]
  Queued: 5 UIDs waiting
```

Workstations with 0 UIDs are shown as idle tiles — smaller, greyed out, no queue info.

Furnace workstations (HT70, HT80, HT90): clicking "View batch →" opens the furnace batch detail in Batch Management.
Converting workstation (BSW-02): clicking "Open Converting →" opens the Converting workflow inline.
QC workstation (HRC-01): clicking "Sign off →" opens the QC Sign-off panel inline.

### Tempering step flow (Steps 9, 10, 14, 23)
When operator marks a tempering step complete, instead of a simple confirmation it opens the furnace batch workflow:
1. System shows target temperature and soak time for this step (Admin-configured, read-only)
2. Operator selects or creates a furnace batch:
   - If a furnace batch is already open for this step: add UIDs to it
   - If no open batch: create new — system auto-generates batch number
3. All UIDs being added to this batch are listed
4. Operator enters actual temperature achieved and actual soak time held
5. On confirm: step log written for all UIDs in batch, furnace batch record saved
6. System automatically checks actual vs target against Admin-configured tolerance and flags if outside

### Converting — Step 16 flow
When Supervisor or Manager marks Step 16 (Converting):
1. System checks design is confirmed. If not: shows error, prompts to confirm design first.
2. Opens the Converting panel:
   - Parent UID details shown
   - Suggested conversion pattern (based on UID size) pre-filled
   - Child pieces editable: count (2, 3, or 4), dimensions, cycle type for each
   - Scrap auto-calculated and shown
3. On confirm: parent UID frozen, child UIDs created, step 16B assigned
4. System immediately moves to Step 16B — shows child UIDs needing physical marking confirmation

### Step 16B — Child UID Marking flow
After Converting:
- List of child UIDs shown with their dimensions
- Operator physically stamps each piece, then confirms each UID in the system
- Checkbox per child UID — must confirm all before proceeding
- Once all confirmed: all children advance to Step 17, storage set to QC-Q

### Hold state display
UIDs on hold shown with red indicator and hold reason.
- Design not confirmed: prompts Manager to confirm design inline
- QC failed: shows which QC check failed, links to QC page
- Manual hold: shows reason entered by Supervisor

### Side panel — storage location counts
Collapsible panel showing live count of UIDs in each storage location.
RM / RM-Q / RM-D / HT-Q / HT-D / MC-Q / MC-D / QC-Q / QC-D / FG
Clicking any location filters the workstation cards to show only UIDs from that storage.

### Connection to other pages
- Clicking a UID code anywhere on this page opens the UID Detail page
- Tempering steps open the Batch Management page context
- QC steps open the QC page context
- Step 16 opens Converting flow inline

---

## PAGE 8 — SHOPFLOOR DISPLAY (Dharmapuri — wall screen)

### Purpose
Read-only display for wall-mounted screens on the factory floor. Shows live status of all workstations and storage locations. No login required. Auto-refreshes every 30 seconds.

### Layout
Full screen, dark background. No navigation menu. Large text readable from a distance.

### Header bar
- Company name and location: EDGESMITH TOOLING — DHARMAPURI
- Current date and time (live)
- Summary counts: X UIDs active / X on hold / X stations running
- Last refresh timestamp

### Workstation grid
All active workstations displayed as large tiles in production flow order.
Each tile shows:
- Workstation code (large, bold)
- Status indicator: green = running, amber = idle, red = hold
- Number of UIDs currently at this workstation
- Number queued waiting
- If any UID is on hold: hold indicator shown prominently in red

### Storage location bar
Bottom of screen: a row of tiles for all 10 storage locations.
Each tile: location code + current UID count (large number).
Tiles with high counts highlighted in amber.

### Furnace status (if any tempering batch is running)
A panel showing any currently active furnace batches:
- Furnace batch number
- Which tempering step (Tempering 1 / 2 / 3 / 4)
- UIDs in this batch
- Time elapsed
- Target temperature and soak time (countdown if soak time is tracked live)

### No actions
This page has no buttons, forms, or clickable elements. Display only.

---

## PAGE 9 — BATCH MANAGEMENT

### Purpose
Manage furnace batches for tempering operations and general production batches for other workstations. Supervisors control when batches are triggered and record actual process parameters.

### Two sections: Furnace Batches / Production Batches

---

### Furnace Batches section

#### Active furnace batches
Cards for each currently running furnace batch.
Each card shows:
- Furnace batch number (auto-generated, e.g. HT90-2024-441)
- Tempering step (Tempering 1 / 2 / 3 / 4)
- Cycle type of UIDs in this batch
- Target temperature (Admin-configured, read-only)
- Target soaking time (Admin-configured, read-only)
- UIDs in this batch: list of UID codes
- Start time
- Status: Loading / Running / Awaiting actual entry / Complete

#### Create / trigger a furnace batch
1. Supervisor selects tempering step
2. System shows UIDs queued for this step (in the source storage, matching cycle type if same-cycle-only rule applies)
3. UIDs shown sorted by priority then wait time
4. Supervisor selects which UIDs to include (up to configured capacity)
5. System shows target temperature and soak time (read-only, from Admin config)
6. Supervisor confirms — furnace batch number auto-generated, batch status set to Running
7. When run is complete: Supervisor or Operator enters actual temperature and actual soak time
8. System compares actual vs target:
   - Within tolerance: batch marked complete, all UID step logs written
   - Outside tolerance: deviation flag raised, batch and all UIDs flagged, Supervisor must acknowledge
9. Supervisor acknowledges any deviation (adds a note) before UIDs advance to next step

#### Furnace batch log
Historical table of all furnace batches.
Columns: Batch number, Step, Cycle type, UID count, Target temp, Target soak, Actual temp, Actual soak, Deviation flag, Date, Operator.
Filterable by step, date range, deviation flag.
Clicking any row shows all UIDs in that batch and their current status.

---

### Furnace Batches — All Steps (HT70, HT80, HT90)

The furnace batch workflow is identical for all six furnace steps. The step determines which parameters are loaded from Admin config.

| Step | Operation | Furnace | Base capacity (1500mm) | Base capacity (2750mm) |
|---|---|---|---|---|
| 6 | Hardening | HT70 | 6 bars | 3 bars |
| 7 | Quenching | HT80 | 6 bars | 3 bars |
| 9 | Tempering 1 | HT90 | 80 bars | 43 bars |
| 10 | Tempering 2 | HT90 | 80 bars | 43 bars |
| 14 | Tempering 3 | HT90 | 80 bars | 43 bars |
| 23 | Tempering 4 — Stress Relief | HT90 | 80 bars | 43 bars |

For HT70 and HT80 (Hardening and Quenching):
- The same furnace batch workflow applies — Supervisor creates batch, selects UIDs up to capacity, logs actual temperature and soak time
- Deviation check runs against Admin-configured tolerance for that step
- Furnace batch number auto-generated per step (e.g. HT70-2024-112 for Hardening, HT80-2024-089 for Quenching)

For HT90 (all four Tempering steps):
- Each tempering step has its own separate Admin-configured target temperature and soak time
- A Tempering 1 batch and a Tempering 2 batch are separate batch records even though they use the same physical furnace
- Furnace batch numbers carry the step reference: HT90-T1-2024-441 for Tempering 1, HT90-T2-2024-442 for Tempering 2, etc.
- All four have the same 80-bar base capacity at 1500mm

---

### Grinding Batches section

Three grinding batch types are managed here — Bunch Grinding, Surface Grinding, and Bevel Grinding. All use dynamic length-based batching decided by Supervisor just before the run.

#### Bunch Grinding batches (Step 4 — SG-DLT)

The set builder panel shows:

```
Bunch Grinding — SG-DLT — Step 4
Bars per set: 5  [Admin configurable — change in Master Lists]
Machine bed: 3000mm

Set 1 — Position 1
  ┌──────────────────────────────────────┐
  │ E043  1500mm  ● High Priority       │
  │ E044  1500mm  ● Normal              │
  │ E046  1500mm  ● Normal              │
  │ E049  1500mm  ● Normal              │
  │ E051  1500mm  ● Normal              │
  └──────────────────────────────────────┘
  5 / 5 bars  ✓ Set complete  (1500mm used)

Set 2 — Position 2
  ┌──────────────────────────────────────┐
  │ E052  1500mm  ● Normal              │
  │ E053  1500mm  ● Normal              │
  │ E054  1500mm  ● Normal              │
  │ — empty —                           │
  │ — empty —                           │
  └──────────────────────────────────────┘
  3 / 5 bars  ⚠ Partial set

Total bed: 3000 / 3000mm  [██████████] 100%
[Auto-suggest]  [Confirm Run]
```

Rules enforced:
- All bars in one set must be the same length
- Two sets must fit within 3000mm combined
- Partial sets allowed — Supervisor decides whether to wait or run
- Mark Run Complete applies to all bars in all sets simultaneously

#### Surface Grinding batches (Steps 12 and 20 — SG-DLT)

Machine assignment board with length-based pairing:

```
Surface Grind 1 — SG-DLT — Step 12

  SG-DLT    [████████░░] 2924 / 3000mm
    E043 (1500mm) + E047 (1424mm) — In progress
    [Mark done — both bars]

  Queued: 9 bars waiting
  Next suggested: E048 (1500mm) + E051 (1500mm) = 3000mm
  [Auto-suggest]  [Confirm batch]
```

Valid pairings system enforces:
- 1500 + 1500 = 3000mm ✓
- 1500 + 1424 = 2924mm ✓
- 1424 + 1424 = 2848mm ✓
- 2750 alone = 2750mm ✓ (no pairing possible)
- Any combination exceeding 3000mm ✗ blocked

#### Bevel Grinding batches (Step 22 — AG-ALP / AG-BTA / AG-GMM)

Four-machine assignment board:

```
Bevel Grinding — Step 22

  AG-ALP (max 1500mm)    [██████████] 1500 / 1500mm
    E043 (1500mm) — In progress         [Mark done]

  AG-BTA (max 1500mm)    [████████░░] 1424 / 1500mm
    E047 (1424mm) — In progress         [Mark done]

  AG-GMM (max 3000mm)    [████████░░] 2924 / 3000mm
    E044 (1500mm) + E052 (1424mm) — In progress  [Mark done]

  Queued: 6 bars waiting
  [Auto-suggest]  [Confirm all]
```

2750mm bars: AG-GMM only (AG-ALP and AG-BTA max 1500mm — blocked automatically).

---

### Production Batches section

#### Queue view
For each non-furnace workstation with UIDs waiting:
- Workstation code and name
- Number of UIDs queued
- Batch rule summary (capacity, selection rule, trigger mode)
- Auto-trigger status: on or off

#### Creating a manual batch
For workstations with trigger mode set to manual:
- Supervisor selects workstation
- System shows queued UIDs sorted by priority then wait time
- Supervisor selects UIDs for this batch (up to capacity)
- Confirms — UIDs assigned to this batch, operator notified

---

## PAGE 10 — QC (Quality Control)

### Purpose
Log QC measurements and sign off inspections. Supervisors sign off pass/fail. Operators log measurements. Failed UIDs go on hold automatically.

### Layout
Left panel: pending sign-offs.
Right panel: log new QC measurement.
Bottom: QC history log.

### Pending sign-offs (left panel)
List of UIDs that have reached a QC step and need Supervisor sign-off.
Primary QC step is Step 26 (QC Inspection — HRC-01) but QC checks can be configured at any step.

Each pending item shows:
- UID code (clickable → UID Detail)
- Step number and name
- Workstation
- QC check type required (hardness / dimensional / visual / straightness)
- Measurements already logged by operator (if any)
- Time waiting for sign-off

Actions per pending item:
- **Pass** — UID advances to next step, QC pass logged
- **Fail** — UID placed on hold, QC fail reason required, fail logged
- **Request rework** — UID sent back to a specified earlier step (Supervisor selects target step, reason required)

### Log QC measurement (right panel)
For operators logging measurements before Supervisor sign-off.

Form:
- UID (scan or type)
- Step number (auto-filled based on UID's current step)
- QC check type (dropdown: Hardness HRC / Diameter mm / Length mm / Straightness / Visual / Other)
- Measured value (numeric for measurable types)
- Result (Pass / Fail / Borderline)
- Notes (required if Fail or Borderline)
- Logged by (auto-filled from login)

On save:
- Measurement saved to UID step log
- If result is Fail: UID placed on hold automatically, Supervisor alerted
- If result is Borderline: UID flagged for Supervisor attention, not held automatically
- QC entry appears in pending sign-offs for Supervisor

### QC history log (bottom)
Table of all QC records.
Columns: Date, UID, Step, Check type, Measured value, Result, Logged by, Supervisor sign-off, Notes.
Filterable by date range, result, step, cycle type.
Exportable to CSV.

### Connection to other pages
- Failing a UID here places it on hold and shows it in the Dashboard alerts panel
- Requesting rework moves the UID back to the specified step on the Production Floor

---

## PAGE 11 — UID DETAIL

### Purpose
Complete lifetime record of one piece. Accessible from any page by clicking a UID code.

### Header
- UID code (large)
- Current status badge: Active / On Hold / Dispatched / Scrapped
- Cycle type badge
- Priority badge
- Quick actions (based on role): Confirm design / Link MO / Change priority / Place hold / Release hold

### Material origin section
- Faridabad batch reference (clickable → shows full Faridabad batch record)
- Alloy steel: supplier name, steel grade, heat number
- MS: supplier name, steel grade, heat number
- Rolling contractor name
- Receiving event reference and date at Dharmapuri

### Current production status
- Current step number and name
- Current workstation
- Current storage location
- Time at current step
- If on hold: hold reason and who placed the hold

### Step progress tracker
Visual representation of all steps in the cycle (EAT = 27 steps).
Each step shown as a node:
- Completed steps: filled, with date and operator on hover
- Current step: highlighted and pulsing
- Upcoming steps: outlined
- Tempering steps: marked distinctly, show furnace batch number on hover
- Split step (Step 16): marked distinctly, shows child UIDs created
Scrollable horizontally.

### Product details
- Product type
- Size (mm)
- Design / drawing number
- MO number (with link to MO record)
- If design is pending: prominent warning and confirm design button (Manager only)

### Step history table
Full chronological log of every completed step.
Columns: Step no., Operation, Workstation, Operator, Started, Completed, Duration, QC result, QC value, Notes.

For tempering steps an expanded row shows:
- Furnace batch number (clickable → Furnace Batch detail)
- Target temperature / Target soaking time
- Actual temperature / Actual soaking time
- Deviation flag if any

### Lineage section
- If this is a split child: shows parent UID with link, shows sibling UIDs with links
- If this UID was split during Converting: shows all child UIDs with links and their current status
- Family tree view: parent → children → grandchildren (if multiple levels of splits)

### Split event record (if this UID was involved in Converting)

**If this UID is a parent (was converted at Step 16):**
- Split event reference number
- Date and time of Converting
- Conversion pattern used (Pattern A / Pattern B / Custom)
- Input length (mm)
- Child UIDs created: list with each child's size and cycle type
- Number of cuts and total kerf (cuts × 3mm)
- Scrap: calculated mm and reason (Kerf + end trim / Defect / Dimensional error / Other)
- Authorised by (Supervisor name)
- All child UIDs shown as clickable links → their UID Detail pages

**If this UID is a child (was created by Converting):**
- Parent UID reference (clickable link)
- Split event reference
- Its own assigned size and cycle type at time of split
- Sibling UIDs (other children from same split) shown as clickable links

### Furnace batch summary
Quick list of all tempering runs this UID went through:
- Tempering step, furnace batch number, date, actual parameters, deviation flag

---

## PAGE 12 — MO LINKING

### Purpose
Create and manage Manufacturing Orders. Link MOs to UIDs at any time.

### Layout
Left: MO list.
Right: create new MO / link UIDs to MO.

### MO list (left)
Table of all MOs.
Columns: MO number, Customer, Required qty, Size, Design, Priority, Status, UIDs linked, UIDs dispatched, Remaining.
Status values: Open (no UIDs linked) / In progress (UIDs linked and in production) / Partially dispatched / Fully dispatched.
Clicking any MO opens its detail panel showing all linked UIDs and their current status.

### Create new MO
Form:
- MO number (required, from Odoo or manual)
- Customer name
- Quantity required
- Size (mm) — dropdown from standard sizes
- Design — dropdown filtered by selected size
- Priority (High / Normal / Low)
- Required delivery date (optional)
- Notes

### Link UIDs to MO
- Select MO from list
- Search or filter UIDs to link (by cycle, size, design, status)
- Select UIDs by checkbox
- Option: apply MO's size and design to all selected UIDs (yes/no)
- Confirm — UIDs now carry MO reference

### MO fulfilment tracker
For each MO: progress bar showing how many UIDs have been dispatched vs total quantity required. Colour coded: on track / behind / complete.

---

## PAGE 13 — REPORTS

### Purpose
Operational and management reporting across both locations. All reports filterable by location, date range, cycle type, and other relevant dimensions.

---

### Report 1 — Production Output

**What it shows:** How many UIDs completed each step per day/week/month. Which workstations processed the most pieces. Output trend over time.

**Key metrics:**
- UIDs created (new UID generation count by day)
- UIDs dispatched (completed Step 27)
- UIDs per step completed per period
- Average time per step per workstation
- Workstation throughput comparison

**Filters:** Date range, cycle type, workstation, location.

---

### Report 2 — WIP Summary

**What it shows:** Snapshot of work in progress across the floor right now and over time.

**Key metrics:**
- Current UIDs in each storage location
- Current UIDs at each workstation
- Age distribution of WIP (how long pieces have been in production)
- UIDs on hold by reason
- Average cycle time per UID from creation to dispatch

**Filters:** Location, cycle type, priority, date range.

---

### Report 3 — Furnace Batch Log

**What it shows:** Complete record of all tempering runs with target vs actual parameters.

**Key metrics:**
- All furnace batches in period
- Target vs actual temperature and soak time per batch
- Deviation frequency (how often actuals fall outside tolerance)
- UIDs processed per batch
- Furnace utilisation (batches per day / capacity used)

**Columns in detail table:** Batch number, Tempering step, Cycle type, UID count, Target temp, Actual temp, Temp deviation, Target soak, Actual soak, Soak deviation, Deviation flag, Date, Operator.

**Filters:** Date range, tempering step, cycle type, deviation flag.

---

### Report 4 — Scrap and Yield

**What it shows:** Material utilisation from Converting operations (Step 16). How much raw material becomes finished product vs scrap.

**Key metrics:**
- Total input length (mm and kg equivalent) processed at Step 16
- Total output length across all child UIDs
- Total scrap length and estimated weight
- Scrap by reason (kerf / defect / dimensional error)
- Yield percentage per conversion pattern
- Scrap trend over time

**Filters:** Date range, conversion pattern, cycle type.

---

### Report 5 — MO Fulfilment

**What it shows:** Status of all Manufacturing Orders — how many pieces are in production, dispatched, or remaining.

**Key metrics:**
- Per MO: required qty, linked UIDs, UIDs dispatched, remaining, % complete
- Overdue MOs (delivery date passed, not fully dispatched)
- MOs with UIDs on hold (risk to delivery)
- Dispatch trend (pieces dispatched per day)

**Filters:** Date range, customer, priority, status.

---

### Report 6 — Quality Report

**What it shows:** QC pass and fail rates across all steps and workstations.

**Key metrics:**
- Pass / fail rate per QC step
- QC failures by step and reason
- Rework frequency (UIDs sent back to earlier step)
- Furnace deviation rate (batches outside tolerance)
- UIDs on hold by reason over time

**Filters:** Date range, step, cycle type, QC check type.

---

### Report 7 — Material Traceability Report

**What it shows:** For any given heat number, supplier, or Faridabad batch — which UIDs were made from that material and what is their current status.

**Use case:** If a material defect is discovered in a supplier's heat number, this report immediately shows all UIDs made from that heat number, their current location, and whether they have been dispatched.

**Search by:** Heat number / Supplier name / Faridabad batch reference / Receiving event.

**Output:**
- All UIDs linked to the searched material
- Current status of each UID (in production / dispatched / scrapped)
- If dispatched: MO number and dispatch date
- Step history summary per UID

---

## PAGE 14 — SERVICE CALL LOOKUP

### Purpose
Field service teams enter a UID stamped on a product in the field and retrieve the complete manufacturing and material history. Designed for speed — one field, one search, complete record.

### Layout
Search bar prominently at top. Results fill the page below.

### Search
- Single input field: UID code
- Barcode / QR scan option (if device has camera)
- No other fields required — UID alone retrieves everything

### Results page — what is shown

**Product summary card (top)**
- UID code
- Product type, size, design
- Cycle type
- Status: Dispatched / (if still in production: current step)
- Date of dispatch
- MO number and customer name

**Material origin card**
- Faridabad batch reference
- Alloy steel: supplier name, steel grade, heat number
- MS: supplier name, steel grade, heat number
- Rolling contractor name and dispatch date from Faridabad
- Date received at Dharmapuri

**Production history timeline**
Every step from Step 1 to Step 27 shown in chronological order.
Each step: step number, operation name, workstation, operator, date, duration, QC result.
For tempering steps: furnace batch number, target parameters, actual parameters, deviation flag if any.

**QC summary card**
- QC inspection result from Step 26 (final QC)
- All intermediate QC measurements logged during production
- Any deviation flags from furnace batches

**Family record (if applicable)**
- If this UID was created by Converting: parent UID and link
- If this UID was split into children: list of child UIDs and their dispatch status

### Access
Available to: Admin, Manager, Supervisor, Service role.
Service role sees this page only — no access to any other page.
Record is read-only. Nothing can be modified from this page.

---

## PAGE 15 — CYCLE BUILDER (Admin)

### Purpose
Define and manage production cycle types. Add new cycles, edit step sequences, manage versions.

### Cycle list (left panel)
All cycle types: EAT, SWAN, OVEN, and any added later.
Each shows: name, number of steps, current version number, status (active / archived).
Add new cycle button at top.

### Step editor (right panel — opens when cycle selected)
List of all steps in selected cycle, in order.
Each step row shows: step number, operation name, workstation (dropdown), source storage (dropdown), destination storage (dropdown).
Special step types marked: tempering steps (shows configured parameters), split step (Step 16 / 16B marked distinctly).

**Step actions:**
- Drag to reorder
- Add step (inserts at selected position)
- Edit step details inline
- Delete step (blocked if any UID is currently at this step — shows count)

**Version management:**
- Current version shown at top
- Save changes creates a new version automatically
- Version history list: each version with date, changed by, summary of changes
- Rollback to previous version (creates a new version identical to the selected old one — does not overwrite history)

**Import / Export:**
- Export button: downloads current cycle definition as a JSON file
- Import button: opens file picker, validates structure, shows step preview, asks confirm before importing
- Import creates a new cycle or new version of existing cycle — never overwrites without confirmation

### Step capacity editing in Cycle Builder

Each step row in the editor has a CAP field. How it displays and is edited depends on the workstation type:

**Fixed capacity steps (all 1 at a time — most steps):**
- CAP shows: 1
- Admin clicks to edit, enters a number, saves
- Applies to: Steps 1, 2, 3, 5, 8, 11, 13, 15, 16, 16B, 17, 18, 19, 21, 24, 25, 26, 27

**Furnace steps (HT70, HT80, HT90):**
- CAP shows: base value at 1500mm (e.g. 6 for HT70, 80 for HT90)
- Admin clicks — expands to show all three sizes:
  ```
  Base capacity (1500mm): [ 6 ]
    1424mm: 6 bars  (auto: floor(6 × 1500/1424))
    2750mm: 3 bars  (auto: floor(6 × 1500/2750))
  ```
- Admin edits only the 1500mm base value. 1424mm and 2750mm are auto-calculated and read-only.
- Applies to: Steps 6 (HT70), 7 (HT80), 9 / 10 / 14 / 23 (HT90)

**Grinding steps (SG-DLT, AG-ALP, AG-BTA, AG-GMM):**
- CAP shows: "Length-based"
- Clicking opens the grinding rules summary (machine max lengths, pairing rules)
- No number to edit — governed by machine physical limits
- Applies to: Steps 12, 20 (SG-DLT surface grinding), Step 22 (AG-ALP / AG-BTA / AG-GMM bevel grinding)

**Bunch Grinding step (SG-DLT — Step 4):**
- CAP shows: "5 bars / set · Length-based"
- Clicking expands to show:
  ```
  Bars per set: [ 5 ]   (Admin editable)
  Machine bed: 3000mm   (fixed)
    1500mm: 2 sets × 5 = 10 bars per run
    1424mm: 2 sets × 5 = 10 bars per run
    2750mm: 1 set × 5 = 5 bars per run
  ```
- Admin can change bars per set — takes effect on next batch

All capacity changes are versioned with the cycle and logged in the audit trail.

### Connection
Changes here are versioned. In-progress UIDs follow the version they were created under. New UIDs pick up the latest version automatically.

---

## PAGE 16 — MASTER LISTS (Admin / Manager view)

### Purpose
Manage all reference data used across the system.

### Sections (tabs or sub-pages)

**Workstations**
Table: code, name, category, location (Faridabad / Dharmapuri / Both), status.
Add / edit / archive. Archive blocked if UIDs currently at that workstation.

**Products**
Table: product name, product code, valid cycle types, default cycle type, status.
Add / edit / archive.

**Sizes**
Table: size in mm, description, status.
Add / edit / archive.

**Designs**
Table: drawing number / design code, description, valid sizes, status.
Each design shows which sizes it is valid for.
Add / edit design — includes setting valid size combinations.
Validity matrix view: grid of all sizes vs all designs showing valid combinations.

**Suppliers**
Table: supplier name, material type (Alloy Steel / MS / Both), contact details, status.
Add / edit / archive.

**Rolling Contractors**
Table: contractor name, contact details, status.
Add / edit / archive.

**Conversion Patterns**
Table: pattern name, input length (mm), child lengths, cut count, kerf total, scrap.
Add / edit / archive.
Scrap auto-calculated: input minus sum of children minus (cuts × 3mm).

**Storage Locations**
Table: location code, name, location (Faridabad / Dharmapuri), status.
Add / edit / archive.

---

## PAGE 17 — TEMPERING PARAMETERS (Admin only)

### Purpose
Set target temperatures and soaking times for all four tempering steps per cycle type. Set deviation tolerances.

### Layout
Table view: rows = cycle types (EAT / SWAN / OVEN), columns = all four tempering steps.

```
              Tempering 1    Tempering 2    Tempering 3    Tempering 4
              (Step 9)       (Step 10)      (Step 14)      (Step 23 — SR)
              HT90           HT90           HT90           HT90
EAT    Temp:  [ 180°C ]      [ 160°C ]      [ 150°C ]      [ 140°C ]
       Soak:  [ 90 min ]     [ 90 min ]     [ 60 min ]     [ 60 min ]
       Tol:   [ ±5°C ]       [ ±5°C ]       [ ±5°C ]       [ ±5°C ]
              [ ±5 min ]     [ ±5 min ]     [ ±5 min ]     [ ±5 min ]

SWAN   Temp:  [ 175°C ]      [ 155°C ]      [ 145°C ]      [ 135°C ]
       ...

OVEN   Temp:  [ 185°C ]      [ 165°C ]      [ 155°C ]      [ 145°C ]
       ...
```

Each cell is editable inline — Admin clicks any value to change it.

All four tempering steps on each row must be configured:
- **Tempering 1** (Step 9, HT90) — first temper after hardening and quenching
- **Tempering 2** (Step 10, HT90) — second temper, same furnace, different parameters
- **Tempering 3** (Step 14, HT90) — third temper after first machining phase
- **Tempering 4 — Stress Relief** (Step 23, HT90) — stress relief after bevel grinding

### What is editable (Admin only)
- Target temperature (°C) per tempering step per cycle type — all four steps
- Target soaking time (minutes) per tempering step per cycle type — all four steps
- Temperature tolerance (±°C) per step — how far actual can deviate before flagging
- Soaking time tolerance (±minutes) per step — how far actual can deviate before flagging

### Version note
Changing a parameter creates a new parameter version with timestamp and changed-by. Historical furnace batches retain the parameter values that were active when they ran.

---

## PAGE 18 — USERS AND ROLES (Admin only)

### Purpose
Manage system users, their roles, and location assignments.

### User list
Table: name, username, role, location assignment, status (active / inactive).

### Create / edit user
- Full name
- Username and password
- Role: Admin / Manager / Supervisor / Operator / Service / Shopfloor View
- Location: Faridabad / Dharmapuri / Both
- Status: active / inactive

### Role behaviour
- Admin and Manager: see both locations
- Supervisor and Operator: see their assigned location, with option to view other
- Service: only Service Call Lookup page
- Shopfloor View: only Shopfloor Display page, no login required (PIN or open access)

---

## HOW PAGES CONNECT — OPERATION FLOW

```
Raw Material Intake (Faridabad)
  ↓  [intake records selected in]
Joining Operation (Faridabad)
  ↓  [joining batch dispatched in]
Contractor Dispatch (Faridabad)
  ↓  [dispatch appears as expected in]
Receiving (Dharmapuri)
  ↓  [receiving event selected in]
UID Creation — BSW-01 (Dharmapuri)
  ↓  [UIDs appear on]
Production Floor (Dharmapuri)
  ↓  [tempering steps open]
Batch Management
  ↓  [QC steps open]
QC Page
  ↓  [completed UIDs visible in]
Dashboard + Reports
  ↓  [dispatched UIDs searchable in]
Service Call Lookup
```

Every UID code shown on any page is a link to the UID Detail page.
Every Faridabad batch reference shown on any page is a link to the batch record.
Every furnace batch number shown on any page is a link to the furnace batch detail in Batch Management.
Every MO number shown on any page is a link to the MO record in MO Linking.

---

## KEY UX RULES FOR THE DEVELOPER

1. Every UID code on every page is always a clickable link to UID Detail
2. Dashboard alerts link directly to the relevant page and pre-filter to the alerting records
3. Operators see only their location by default — no configuration per session needed
4. Furnace tempering steps always show Admin-configured parameters as read-only context so operators know what they are aiming for before entering actuals
5. Hold reasons are always visible — never show a held UID without showing why it is held
6. Converting (Step 16) is never a simple "mark complete" — always opens the full Converting workflow
7. Design confirmation is a distinct action — never buried in a form — always prominently shown when a UID needs it
8. All tables support search and filter — no page should show unfiltered data when large volumes are present (12,000 UIDs)
9. Furnace batch deviation flags are always shown in red and require explicit Supervisor acknowledgement before UIDs can advance
10. Nothing in the system is ever permanently deleted — archive only


---

## SHIFT, WORKSTATION, AND JOB ASSIGNMENT

---

## SHIFTS

### Structure

Three shifts run daily at both Faridabad and Dharmapuri:
- **Shift 1:** 06:00 – 14:00
- **Shift 2:** 14:00 – 22:00
- **Shift 3:** 22:00 – 06:00 (next day)

Shift timings are configured by Admin and apply to both locations. Admin can adjust timings if they change.

### Shift schedule

Manager creates the shift schedule. The schedule assigns:
- Which supervisor covers each shift at each location
- Which operators are on each shift at each location
- Which workstations are active in each shift (some workstations may not run on all shifts)

Manager plans the schedule weekly (or for any period). Once published, the schedule is visible to all staff. Manager can edit the schedule at any time — changes apply from the next shift onwards unless urgently overridden.

### Shift record

Every shift generates a shift record automatically when it starts:
- Shift number and date
- Location (Faridabad / Dharmapuri)
- Supervisor on duty (from schedule)
- Operators on duty (from schedule)
- Active workstations for this shift
- Shift start time (actual clock-in time, not just scheduled)

### Shift handover

When a shift ends, the outgoing supervisor performs a formal handover in the system before the incoming supervisor takes over.

**Outgoing supervisor logs:**
- UIDs currently in progress at each workstation (auto-populated from system, supervisor confirms)
- Any furnace batches currently running or mid-soak (critical — incoming supervisor must know)
- UIDs on hold and reasons
- Any equipment issues or workstation problems noted during shift
- QC failures that need attention
- General notes for incoming supervisor

**Incoming supervisor acknowledges:**
- Reads the handover notes
- Confirms they have taken over
- System timestamps the handover and both supervisors are named

Until the incoming supervisor acknowledges, the outgoing supervisor remains the active supervisor of record.

Handover record is permanent — viewable in shift history and in reports.

### Shift visibility in the system

Every action taken in the system is tagged to the current shift automatically:
- Every step log entry shows: shift number, shift date, operator, supervisor on duty
- Every furnace batch is tagged to the shift it started in
- Every QC entry is tagged to the shift
- If a furnace batch spans two shifts (started in Shift 1, completed in Shift 2): both shifts are recorded on the batch — started in Shift 1 by Supervisor A, completed in Shift 2 by Supervisor B

---

## EMPLOYEE PROFILES AND SKILL BADGES

### Employee profile

Every person in the system has an employee profile:
- Full name
- Employee ID
- Role (Admin / Manager / Supervisor / Operator / Service)
- Location assignment (Faridabad / Dharmapuri / Both)
- Active / inactive status
- Skill badges held (see below)
- Shift eligibility (which shifts this employee can be scheduled for)

### Skill badges

Admin creates badge types. Each badge type represents a specific training or certification for a workstation or operation.

**Badge type record (Admin creates):**
- Badge name (e.g. "HT90 Furnace Certified", "VMC MM22 Operator", "BSW-01 Band Saw")
- Workstation it applies to (one badge per workstation, or one badge covering multiple)
- Description of what the training covers
- Whether the badge expires (yes/no) and if yes, validity period in months

**Assigning badges to employees:**
- Admin selects employee, assigns one or more badge types
- For each badge assigned: date of certification, certified by (trainer name), expiry date if applicable
- Badge shown on employee profile with status: Valid / Expiring soon (within 30 days) / Expired

**Badge requirements on workstations:**
- Admin sets which badges are required to operate each workstation
- A workstation can require one badge or multiple badges
- Furnace workstations (HT70, HT80, HT90) additionally require Supervisor role — operators cannot be assigned to these even if they hold the badge
- If a workstation has no badge requirement: any operator can be assigned

**System enforcement:**
- When assigning an operator to a workstation (manual or auto), system checks:
  1. Does the employee hold all required badges for that workstation?
  2. Are all held badges currently valid (not expired)?
  3. For furnace workstations: is the employee a Supervisor?
- If any check fails: assignment is blocked and reason shown
- Expired badge alert: system notifies Admin when any employee's badge is expiring within 30 days

**Badge dashboard (Admin):**
- List of all employees with badge status
- Employees with expired badges highlighted
- Employees with expiring badges highlighted
- Workstations that currently have no qualified operator available (risk alert)

---

## PAGE 19 — SHIFT MANAGEMENT

### Purpose
Manager plans shift schedules. Supervisors perform handovers. System records all shift activity.

### Layout
Three tabs: Schedule / Active Shift / Shift History

---

### Schedule tab

**Calendar view**
Weekly or monthly calendar showing all shifts across both locations.
Each shift cell shows: supervisor name, operator count, active workstations.
Colour coded by location: Faridabad / Dharmapuri.

**Create / edit shift schedule**
Manager selects a date range and fills in:
- For each shift (1, 2, 3) at each location:
  - Supervisor on duty (dropdown from qualified supervisors at that location)
  - Operators on duty (multi-select from operators at that location)
  - Active workstations for this shift (which workstations will run)
  - Notes (optional)

Auto-fill option: copy last week's schedule as a starting point, then adjust.

System warns if:
- A supervisor is scheduled for two overlapping shifts
- A workstation is scheduled as active but no qualified operator is assigned to it
- An operator with an expired badge is assigned to a workstation requiring that badge

**Publish schedule**
Manager publishes the schedule — it becomes visible to all staff.
Unpublished schedules are drafts visible to Manager and Admin only.

---

### Active Shift tab

**Current shift status**
Shows the currently running shift at each location:
- Shift number, date, location
- Supervisor on duty (with contact)
- Operators on duty and their assigned workstations
- Time remaining in shift
- Handover countdown (shows when shift is within 30 minutes of ending)

**Workstation assignment for current shift**
Table showing all active workstations for this shift:
- Workstation code and name
- Assigned operator(s)
- Current job status (idle / running / on hold)
- UIDs currently being processed

Supervisor can reassign operators to workstations within the active shift here — changes take effect immediately and are logged.

**Shift handover panel (appears 30 minutes before shift end)**
Outgoing supervisor fills in:
- Current status of each active workstation (auto-populated, confirm or edit)
- Furnace batches in progress (auto-populated from Batch Management)
- UIDs on hold (auto-populated from Production Floor)
- Equipment issues (free text, optional)
- Urgent notes for incoming supervisor (free text)
- Submit handover button

Incoming supervisor:
- Reads the handover
- Acknowledges and takes over
- System records timestamp, both supervisor names

---

### Shift History tab

Table of all completed shifts.
Columns: Date, Shift number, Location, Supervisor, Operator count, UIDs processed, UIDs dispatched, Handover submitted, Handover acknowledged.
Clicking any row shows full shift record including handover notes.
Filterable by location, date range, supervisor.

---

## PAGE 20 — JOB ASSIGNMENT

### Purpose
Assign jobs to operators for each shift. Both automatic (system assigns based on priority, skill, and availability) and manual (Supervisor overrides) assignment supported.

### What is a job

A job is the unit of work assigned to an operator at a workstation for a shift.

- **For one-by-one operations** (VMC machining, straightening, bevel grinding, OP10, OP20, OP30 etc.): one job = one UID to be processed at one workstation. An operator may have a queue of multiple jobs in sequence.
- **For batch operations** (furnace tempering, surface grinding bunches, anti-rust coating etc.): one job = one batch of UIDs to be processed together at one workstation. The batch is the job.

### Layout
Left panel: unassigned jobs queue.
Right panel: operator assignment board for current shift.

---

### Unassigned jobs queue (left panel)

List of all UIDs or batches that are ready for their next step but have no operator assigned.
Sorted by: priority (High first) then wait time (longest waiting first).

Each item shows:
- UID code (for one-by-one) or batch reference (for batch jobs)
- Cycle type
- Step number and name
- Workstation required
- Priority badge
- Time waiting at this step
- Required skill badges for this workstation
- Estimated duration (if configured per step in Admin)

Filter by: workstation, cycle type, priority, step.

---

### Operator assignment board (right panel)

Grid showing all operators on the current shift with their current assignments.

Each operator card shows:
- Operator name and employee ID
- Skill badges held (icons)
- Current workstation assignment
- Current job status: idle / working / break
- Jobs assigned for this shift: list of jobs in queue order
- Capacity: jobs assigned vs estimated shift capacity

---

### Auto assignment

**How it works:**
Supervisor clicks "Auto assign" — system runs the assignment logic:

1. Takes all unassigned jobs from the queue
2. For each job, identifies which operators on the current shift:
   - Hold all required skill badges for the workstation
   - Have capacity remaining in the shift
   - Are not already assigned to a conflicting workstation
3. Assigns jobs to operators optimising for:
   - Priority (High priority jobs assigned first)
   - Skill match (operator most qualified for that workstation)
   - Load balancing (spread jobs evenly across available operators)
   - Continuity (if an operator was working a job in the previous shift and it is not complete, prefer assigning them to continue)
4. Shows the proposed assignment for Supervisor review before committing
5. Supervisor can accept all, modify individual assignments, or reject and do manual

**Auto assignment does not:**
- Assign furnace steps to operators (furnace steps always go to the Supervisor on duty)
- Assign operators to workstations where their badge has expired
- Override a manual assignment already made by the Supervisor

---

### Manual assignment

Supervisor drags a job from the unassigned queue onto an operator card.
System checks skill requirements:
- If operator is qualified: assignment accepted
- If operator is not qualified: system shows warning with missing badge details. Supervisor can override with a reason (logged) or cancel.

Supervisor can also:
- Reassign a job from one operator to another mid-shift (logged, reason required)
- Remove a job from an operator's queue and return it to unassigned
- Create a new job manually (for unplanned work, with reason)

---

### Furnace job assignment

Furnace steps (Tempering 1, 2, 3, 4 on HT90, and Hardening on HT70, Quenching on HT80) are always assigned to the Supervisor on duty for that shift.

The Supervisor's assignment board shows furnace jobs automatically.
Supervisor cannot delegate furnace jobs to operators.
If a furnace batch spans two shifts, the incoming Supervisor inherits the in-progress furnace job via the handover process.

---

### Job status tracking

Once a job is assigned and the operator starts it:
- Job status: Queued → In Progress → Completed
- In Progress: step log entry started, timer running
- Completed: operator marks done, step log entry closed, UID advances

For batch jobs:
- All UIDs in the batch move through the same status together
- Individual UIDs can be marked as exceptions within a batch (e.g. one piece removed from furnace early — logged with reason)

---

### Job assignment in relation to shifts

- Jobs are assigned per shift — an operator's job queue resets each shift
- Incomplete jobs at the end of a shift are flagged in the handover
- The incoming shift Supervisor decides whether to reassign incomplete jobs to the new shift's operators or continue with auto-assignment

---

## HOW SHIFT, JOB, AND WORKSTATION ASSIGNMENT CONNECT

```
Manager creates shift schedule
  ↓
Shift starts — supervisor and operators clocked in
  ↓
Supervisor opens Job Assignment page
  ↓
Unassigned jobs queue populated automatically
(all UIDs/batches ready for their next step)
  ↓
Auto assign (system proposes) OR Manual assign (supervisor drags)
  ↓
Operators see their job queue on Production Floor page
  ↓
Operator selects job, marks steps complete
  ↓
Completed jobs removed from queue, new jobs appear as UIDs advance
  ↓
30 minutes before shift end: handover panel opens
  ↓
Outgoing supervisor submits handover
  ↓
Incoming supervisor acknowledges, takes over
  ↓
Repeat
```

---

## UPDATED PAGE ACCESS TABLE (additions)

| Page | Admin | Manager | Supervisor | Operator | Service | Shopfloor |
|---|---|---|---|---|---|---|
| Shift Management | ✓ | ✓ | view + handover | view | — | — |
| Job Assignment | ✓ | ✓ | ✓ | view own queue | — | — |
| Employee Profiles + Badges | ✓ | view | view | view own | — | — |

---

## ADDITIONAL REPORT — SHIFT REPORT

### Report 8 — Shift Performance Report

**What it shows:** Production output and activity broken down by shift, supervisor, and operator.

**Key metrics:**
- UIDs processed per shift per location
- Steps completed per shift
- Jobs completed per operator per shift
- Idle time per workstation per shift
- Handover completion rate (how often handover is submitted on time)
- Furnace batches run per shift with parameter compliance
- QC pass rate per shift

**Filters:** Date range, location, shift number, supervisor, operator.

**Use case:** Manager uses this to identify which shifts are most productive, which operators need support, and whether night shift (Shift 3) is keeping pace with day shifts.


---

## WEBAPP STRUCTURE — SHELL, SIDEBAR, AND PAGE INTERCONNECTIONS

---

## OVERALL SHELL LAYOUT

The webapp has four persistent zones that never change regardless of which page is open:

```
┌─────────────────────────────────────────────────────────────────┐
│  TOPBAR — always visible                                         │
├──────────────┬──────────────────────────────────────────────────┤
│              │                                                   │
│   SIDEBAR    │   MAIN CONTENT AREA                              │
│   always     │   (current page renders here)                    │
│   visible    │                                                   │
│              │                                                   │
├──────────────┴──────────────────────────────────────────────────┤
│  STATUS BAR — always visible (bottom)                           │
└─────────────────────────────────────────────────────────────────┘
```

Exception: Shopfloor Display page hides sidebar and topbar completely — full screen only.

---

## TOPBAR (always visible, top of every page)

### Left side
- **App logo and name:** CPCMS — Edgesmith Tooling India
- **Current page title** (breadcrumb if nested — e.g. Reports > Furnace Batch Log)

### Centre
- **Location indicator:** pill showing current active location context
  - Dharmapuri (blue) / Faridabad (orange) / Both (grey)
  - Clicking toggles location context — affects all data shown across all pages
  - Admin and Manager can switch between locations
  - Supervisor and Operator are locked to their assigned location (pill shown but not clickable)

### Right side (left to right)
- **Current shift indicator:**
  - Shift number (1 / 2 / 3) + time remaining in shift
  - Colour: green if >2 hours remaining, amber if <2 hours, red if <30 minutes (handover imminent)
  - Clicking opens the Active Shift tab of Shift Management page
- **Handover alert button** (appears red and pulsing when shift is within 30 minutes of ending)
  - Only visible to the supervisor on duty
  - Clicking opens handover panel directly
- **Alerts bell icon**
  - Badge count showing number of unacknowledged alerts
  - Clicking opens alerts dropdown (see below)
- **Logged-in user name and role badge**
  - Clicking opens a small dropdown: View my profile / Change password / Logout
- **Clock:** live time display (HH:MM:SS)

### Alerts dropdown (from bell icon)
Opens an overlay panel listing all active alerts in priority order:
- 🔴 UIDs on hold (count + link to UID list filtered to hold)
- 🔴 Furnace batches with deviation flag (count + link to Batch Management)
- 🔴 Handover overdue (if outgoing supervisor has not submitted)
- 🟠 UIDs at Step 15 with no design (count + link to UID list)
- 🟠 Operator badge expiring within 30 days (count + link to Employee Profiles)
- 🟡 QC borderline results pending supervisor review (count + link to QC page)
- 🟡 Expected consignments not yet received (count + link to Receiving page)
Each alert is a clickable link. Alerts auto-dismiss when the condition is resolved.

---

## SIDEBAR (always visible, left side)

Sidebar is collapsible — full width (220px) showing icon + label, or narrow (52px) showing icon only. User preference saved per session.

### Top of sidebar
- **Factory logo / company initials**
- **Collapse / expand toggle button**

### Navigation sections

Sidebar groups pages into sections with section headers. Sections and items shown depend on the logged-in role.

---

#### SECTION: OVERVIEW
Visible to: Admin, Manager, Supervisor

| Item | Icon | Link to | Badge |
|---|---|---|---|
| Dashboard | Grid icon | Dashboard page | Count of active alerts |

---

#### SECTION: FARIDABAD
Visible to: Admin, Manager

| Item | Icon | Link to | Badge |
|---|---|---|---|
| Raw Material Intake | Inbox icon | Raw Material Intake page | — |
| Joining Operation | Link icon | Joining Operation page | — |
| Contractor Dispatch | Truck icon | Contractor Dispatch page | Pending dispatches count |

---

#### SECTION: DHARMAPURI
Visible to: Admin, Manager, Supervisor, Operator

| Item | Icon | Link to | Badge | Operator sees? |
|---|---|---|---|---|
| Receiving | Download icon | Receiving page | Expected arrivals count | No |
| UID Creation | Tag icon | UID Creation page | — | No |
| Production Floor | Factory icon | Production Floor page | On-hold UID count | Yes |
| Batch Management | Stack icon | Batch Management page | Active batches count | No |
| QC | Checkmark icon | QC page | Pending sign-offs count | Log only |

---

#### SECTION: MY WORK
Visible to: Operator only

| Item | Icon | Link to | Badge |
|---|---|---|---|
| My Jobs | Clipboard icon | Production Floor filtered to this operator's assignments | Count of assigned jobs |
| Log QC | Check icon | QC page (log measurement tab only) | — |
| Scan UID | Barcode icon | UID Detail lookup | — |

---

#### SECTION: OPERATIONS
Visible to: Admin, Manager

| Item | Icon | Link to | Badge |
|---|---|---|---|
| MO Linking | Document icon | MO Linking page | Open MOs count |
| Shift Management | Calendar icon | Shift Management page | — |
| Job Assignment | Assign icon | Job Assignment page | Unassigned jobs count |
| Reports | Chart icon | Reports page (landing) | — |
| Service Lookup | Search icon | Service Call Lookup | — |

---

#### SECTION: CONFIGURATION
Visible to: Admin only (Manager sees grayed read-only versions)

| Item | Icon | Link to | Badge |
|---|---|---|---|
| Cycle Builder | Flow icon | Cycle Builder page | — |
| Master Lists | List icon | Master Lists page | — |
| Tempering Parameters | Thermometer icon | Tempering Parameters page | — |
| Employee Profiles | People icon | Employee Profiles and Badges page | Expiring badges count |
| Users and Roles | Lock icon | Users and Roles page | — |

---

#### SECTION: DISPLAY (bottom of sidebar)
Visible to: All roles

| Item | Icon | Link to |
|---|---|---|
| Shopfloor Display | Monitor icon | Opens Shopfloor Display in new full-screen tab |

---

### Bottom of sidebar (always shown, above footer)
- **Current shift summary strip:**
  - Shift 1 / 2 / 3 label
  - Supervisor on duty name
  - Time remaining
- **My badge strip** (for Operators and Supervisors):
  - Small icons for each skill badge the logged-in user holds
  - Hovering any badge icon shows badge name and expiry date
  - Expired badges shown in red

---

## STATUS BAR (always visible, bottom of every page)

Thin bar across the full bottom of the screen. Always visible regardless of page.

### Left side
- **Active UIDs:** live count of all UIDs currently in production at the active location
- **On Hold:** count of UIDs on hold (red if > 0)
- **In Furnace:** count of UIDs currently in an active furnace batch

### Centre
- **Current shift:** Shift N · Location · Supervisor name · HH:MM remaining

### Right side
- **Last data refresh timestamp:** "Updated 12 seconds ago"
- **Connection status:** green dot if live / amber if reconnecting / red if offline

---

## PAGE INTERCONNECTION MAP

Every connection below represents a clickable link or navigation trigger. Nothing requires the user to navigate back to the sidebar to reach a related page — related pages are always reachable from within context.

```
┌─────────────────────────────────────────────────────────────────┐
│  FARIDABAD FLOW                                                  │
│                                                                  │
│  Raw Material Intake ──────────────────────────────────────┐    │
│       │ intake records selectable in                       │    │
│       ▼                                                    │    │
│  Joining Operation ─────────────────────────────────────┐  │    │
│       │ joining batch dispatched in                      │  │    │
│       ▼                                                  │  │    │
│  Contractor Dispatch                                     │  │    │
│       │ appears as expected consignment in               │  │    │
│       ▼                                                  │  │    │
└───────────────────────────────────────────────────────── │ ─│───┘
                                                           │  │
┌───────────────────────────────────────────────────────── │ ─│───┐
│  DHARMAPURI FLOW                                          │  │   │
│       ▼                                                   │  │   │
│  Receiving ◄──────────────────────────────────────────────┘  │   │
│    │ shows alloy heat no. + MS heat no. from ────────────────┘   │
│    │ receiving event selected in                                   │
│    ▼                                                              │
│  UID Creation (BSW-01)                                           │
│    │ UIDs created, appear on                                      │
│    ▼                                                              │
│  Production Floor ◄────────────────────────────────────────────┐ │
│    │   │   │   │                                               │ │
│    │   │   │   └── Step 16 Converting ──► child UIDs back to ─┘ │
│    │   │   │        Production Floor at Step 17                  │
│    │   │   │                                                      │
│    │   │   └── Tempering steps open ──────────────────────────┐  │
│    │   │                                                        │  │
│    │   └── QC steps open ────────────────────────────────────┐ │  │
│    │                                                          │ │  │
│    └── Any UID click ──► UID Detail (full record)            │ │  │
│              │                                               │ │  │
│              ├── Parent UID link ──► UID Detail (parent)     │ │  │
│              ├── Sibling UID links ──► UID Detail (sibling)  │ │  │
│              ├── Faridabad batch link ──► Joining batch rec  │ │  │
│              ├── MO link ──► MO Linking                      │ │  │
│              └── Furnace batch link ──► Batch Management     │ │  │
│                                                              │ │  │
│  Batch Management ◄──────────────────────────────────────────┘ │  │
│    │ furnace batch completion writes to Production Floor        │  │
│    └── furnace batch number link ──► UID Detail               │  │
│                                                               │  │
│  QC Page ◄────────────────────────────────────────────────────┘  │
│    │ pass ──► UID advances on Production Floor                    │
│    │ fail ──► UID placed on hold on Production Floor              │
│    └── rework ──► UID moved to earlier step on Production Floor   │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  OPERATIONS FLOW                                                 │
│                                                                  │
│  Dashboard                                                       │
│    │ alert links ──► relevant pages (UID list / QC / Batch)     │
│    │ WIP tiles ──► Production Floor filtered by storage          │
│    │ station tiles ──► Production Floor filtered by workstation  │
│    │ priority queue UID links ──► UID Detail                     │
│    └── Faridabad batch tiles ──► Contractor Dispatch status      │
│                                                                  │
│  MO Linking                                                      │
│    │ UID links ──► UID Detail                                    │
│    └── linked UIDs production status ──► Production Floor        │
│                                                                  │
│  Shift Management                                                │
│    │ active shift workstation grid ──► Production Floor          │
│    │ handover panel ──► links to Batch Management (furnace)      │
│    └── shift history ──► links to Reports (shift report)         │
│                                                                  │
│  Job Assignment                                                  │
│    │ unassigned job ──► Production Floor (workstation card)      │
│    │ operator card ──► Employee Profile                          │
│    └── assigned job ──► Production Floor (operator view)         │
│                                                                  │
│  Reports                                                         │
│    │ UID in any report ──► UID Detail                            │
│    │ furnace batch in report ──► Batch Management                │
│    │ MO in report ──► MO Linking                                 │
│    └── shift in report ──► Shift Management (shift history)      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  SERVICE FLOW                                                    │
│                                                                  │
│  Service Call Lookup                                             │
│    └── read-only view of UID Detail                              │
│        (same data, no links to other pages)                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  CONFIGURATION FLOW (Admin)                                      │
│                                                                  │
│  Cycle Builder                                                   │
│    └── step workstation dropdown ──► Master Lists (workstations) │
│                                                                  │
│  Master Lists                                                    │
│    └── workstation badge requirements ──► Employee Profiles      │
│                                                                  │
│  Tempering Parameters                                            │
│    └── parameters applied in ──► Batch Management               │
│        and shown read-only in ──► Production Floor               │
│                                                                  │
│  Employee Profiles and Badges                                    │
│    └── badge validation enforced in ──► Job Assignment           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## CONTEXT PANELS — QUICK ACCESS WITHOUT LEAVING CURRENT PAGE

Several actions can be performed inline without navigating away. These appear as side panels or modals that overlay the current page:

| Trigger | Opens | On which pages |
|---|---|---|
| Click any UID code | UID Detail side panel (full record, read-only quick view) | All pages |
| Click any furnace batch number | Furnace Batch detail panel | Production Floor, Reports, UID Detail |
| Click any MO number | MO summary panel | Production Floor, UID Detail, Reports |
| Click any Faridabad batch ref | Faridabad batch record panel | Receiving, UID Detail, Reports |
| Click any employee name | Employee profile panel (name, role, badges) | Shift Management, Job Assignment |
| Alert bell item click | Jumps to relevant page with pre-applied filter | Topbar (all pages) |
| Design pending warning | Design confirmation inline panel | Production Floor, Dashboard, UID Detail |
| Hold badge on UID | Hold detail panel (reason, who placed, when) | Production Floor, UID Detail |

Full navigation (clicking the expand icon on any panel) opens the full dedicated page for that record.

---

## OPERATOR-SPECIFIC VIEW OF PRODUCTION FLOOR

When an Operator logs in, the Production Floor page is their primary page and it shows differently from the Supervisor / Manager view:

**Operator sees:**
- Only the workstations they are assigned to for the current shift (from Job Assignment)
- Only UIDs in their personal job queue
- Their next assigned job highlighted at top
- Simple controls: Start job / Mark complete / Flag issue / Log QC
- No batch management controls
- No hold / release controls
- No Converting controls

**What auto-updates for the operator:**
- When a job is completed, the next job in their queue moves to top automatically
- When the Supervisor assigns a new job to them, it appears in their queue immediately
- When a UID they are working on is placed on hold by the Supervisor, it is flagged in their view with the reason

---

## NOTIFICATION AND ALERT ROUTING

Every alert in the system is routed to the right person automatically:

| Event | Notified via | Who receives |
|---|---|---|
| UID placed on hold | Alert bell + Dashboard alert | Manager + Supervisor on duty |
| Design not confirmed at Step 15 | Alert bell + Dashboard alert | Manager |
| Furnace batch deviation flagged | Alert bell + red badge on Batch Management | Supervisor on duty |
| QC failure logged | Alert bell + pending sign-off in QC page | Supervisor on duty |
| Operator badge expiring | Alert bell + Employee Profiles badge panel | Admin |
| Handover not submitted 15 min before shift end | Alert bell + topbar pulse | Outgoing Supervisor |
| New job assigned | Notification on their Production Floor view | Operator assigned |
| Expected consignment not received (overdue) | Alert bell | Manager |
| Converting blocked — design missing | Inline warning on Production Floor | Supervisor attempting action |

Alerts are never emails or external notifications — all in-app only. Every alert links directly to the page and record that needs action.

---

## SEARCH — GLOBAL SEARCH BAR

A global search field is accessible from the topbar on all pages (keyboard shortcut: press / to focus).

Searching returns results grouped by type:
- **UIDs** — matching UID codes, shows cycle + step + status
- **MOs** — matching MO numbers, shows customer + status
- **Faridabad batches** — matching batch references
- **Furnace batches** — matching batch numbers
- **Employees** — matching names
- **Workstations** — matching codes or names

Clicking any result navigates to the relevant page for that record or opens its context panel inline.

---

## ROLE-BY-ROLE: WHAT EACH USER SEES ON LOGIN

### Admin
- Lands on Dashboard showing both locations combined
- Full sidebar visible with all sections
- Topbar shows location toggle (both selected by default)
- Badge expiry alerts visible

### Manager
- Lands on Dashboard showing both locations combined
- Sidebar shows Overview, Faridabad, Dharmapuri, Operations sections
- Configuration section visible but grayed (read-only)
- MO alert count in sidebar badge
- Unassigned jobs count in sidebar badge

### Supervisor
- Lands on Production Floor for their assigned location
- Sidebar shows Overview (Dashboard), Dharmapuri, Operations sections
- Faridabad section not visible
- Shift handover alert visible in topbar when shift nearing end
- Pending QC sign-offs badge visible on QC sidebar item
- Active batches count visible on Batch Management sidebar item

### Operator
- Lands on Production Floor filtered to their job queue
- Sidebar shows only: My Work section (My Jobs, Log QC, Scan UID) + Shopfloor Display link
- Topbar shows shift info and alert bell (only alerts relevant to them)
- My badge strip visible at bottom of sidebar
- No location toggle — locked to their location

### Service
- Lands on Service Call Lookup page
- No sidebar — just the search page
- Topbar shows only: app name + logged-in user + logout
- No navigation to any other page

### Shopfloor View
- Opens directly to Shopfloor Display full screen
- No topbar, no sidebar, no status bar
- Auto-refreshes every 30 seconds
- Single button: back to login (bottom corner, small)


---

## PAGE 21 — EMPLOYEE PROFILES AND BADGES (Admin)

### Purpose
Manage all employee records and their skill badge assignments. Controls which operators can be assigned to which workstations throughout the system.

### Layout
Left panel: employee list.
Right panel: employee detail and badge management.

---

### Employee list (left panel)

Table of all employees.
Columns: Name, Employee ID, Role, Location (Faridabad / Dharmapuri / Both), Badge count, Badge status, Active/Inactive.

Badge status column:
- ✅ All valid — all held badges are current
- ⚠ Expiring soon — one or more badges expire within 30 days
- ❌ Expired — one or more badges have expired

Filter by: role, location, badge status.
Search by name or employee ID.

Add new employee button at top → opens form.

---

### Employee detail (right panel)

Opens when any employee row is clicked.

**Profile section:**
- Full name, Employee ID
- Role (dropdown — Admin / Manager / Supervisor / Operator / Service / Shopfloor View)
- Location assignment (Faridabad / Dharmapuri / Both)
- Active / Inactive toggle
- Contact details (optional)

**Skill badges section:**
List of all badges held by this employee.

Each badge row shows:
- Badge name (e.g. HT90 Furnace Certified)
- Workstation it applies to (e.g. HT90)
- Date certified
- Certified by (trainer name)
- Expiry date (if applicable) with days remaining
- Status: Valid / Expiring soon (amber, <30 days) / Expired (red)
- Remove badge button

**Assign new badge button:**
Opens a form:
- Badge type dropdown (from Admin-created badge types)
- Date of certification
- Certified by (text field)
- Expiry date (date picker, optional — only shown if badge type has expiry enabled)
- Save

---

### Badge types management (sub-section within this page)

Admin manages the library of badge types from a collapsible panel on this page.

Table of all badge types:
- Badge name
- Workstation it applies to
- Whether it expires (yes/no)
- Validity period in months (if expires)
- How many employees currently hold it
- Active / archived status

Add new badge type:
- Badge name
- Workstation (dropdown from Master Lists)
- Expires: yes/no toggle
- If yes: validity period in months
- Description of what the training covers

---

### Badge expiry dashboard (top of page)

Summary strip at top of page showing:
- Employees with expired badges: count (red)
- Employees with badges expiring in <30 days: count (amber)
- Workstations currently with no qualified operator available: count (red alert)

The "no qualified operator" alert is critical — if a workstation has no employee with a valid badge for it, jobs cannot be auto-assigned there. Clicking this alert shows which workstations are at risk and which employees could be trained.

---

### Connection to other pages
- Badge validation enforced on Job Assignment page — invalid or expired badge blocks assignment
- Furnace workstations (HT70, HT80, HT90) additionally require Supervisor role — badge alone is not sufficient
- Badge expiry alerts appear in topbar alert bell and Dashboard alerts panel
- Shift Management — only employees with valid role and badge show in supervisor/operator dropdowns

---

## WORKSTATION UNITS AND STEP CAPACITY — PAGE IMPLICATIONS

### Master Lists — Workstation Units (new sub-section)

Admin registers each physical machine unit under its parent workstation code.

Table columns: Unit code, Parent workstation, Unit name, Location, Status (active / maintenance / archived).

Actions: Add unit, edit unit details, set status. Archiving a unit removes it from capacity calculations. Setting to maintenance temporarily removes it from available capacity without archiving.

When a unit is set to maintenance:
- Its capacity is removed from the step total immediately
- Any jobs currently on that unit are flagged on the Production Floor
- Supervisor is alerted to reassign those jobs

---

### Cycle Builder — Step Capacity field

When Admin configures a step in the Cycle Builder, the step editor shows:

- Workstation selected for this step (dropdown)
- Once workstation is selected: list of all active units of that workstation at the relevant location appears below
- For each unit: capacity input field (number of UIDs this unit can handle simultaneously at this step)
- Total capacity shown as a calculated summary: sum of all unit capacities = total simultaneous slots for this step

Example display in Cycle Builder for Step 5 (OP10, MM22):
```
Workstation: MM22
  MM22-1    capacity at this step: [ 1 ] UIDs
  MM22-2    capacity at this step: [ 1 ] UIDs
  ─────────────────────────────────────────
  Total simultaneous capacity: 2 UIDs
```

Example for Step 6 (Hardening, HT70):
```
Workstation: HT70
  HT70-1    capacity at this step: [ 40 ] UIDs
  ─────────────────────────────────────────
  Total simultaneous capacity: 40 UIDs
```

Capacity values are saved as part of the step definition and are versioned with the cycle — changing capacity creates a new cycle version, protecting in-progress UIDs.

---

### Production Floor — capacity display on workstation cards

Each workstation card on the Production Floor now shows a capacity bar:

```
MM22 — OP10 Rough Mill
● Running  [██░░] 2 / 2 slots used
  E043 — Slot 1 — In progress  [Mark done]
  E044 — Slot 2 — In progress  [Mark done]
  ─────────────────────────────
  Queued: 7 UIDs waiting
```

```
SG-DLT — Surface Grind 1
● Running  [███░░░░░░░] 3 / 6 slots used
  E041-A — In progress
  E041-B — In progress
  E047   — In progress
  ─────────────────────────────
  Queued: 12 UIDs waiting
```

When all slots are full: card shows "● Full — N UIDs queued".
When a slot opens (operator marks complete): next queued UID auto-highlighted for assignment.

---

### Job Assignment — capacity-aware auto assignment

Auto assignment logic uses step capacity to determine how many jobs to assign simultaneously:

- System checks total available slots for each step (sum of unit capacities minus currently running jobs)
- Assigns jobs up to available slot count only
- If 2 slots available at MM22 and 10 UIDs queued: assigns next 2 highest priority UIDs
- Remaining 8 stay in queue and are assigned as slots open

Manual assignment in Job Assignment page also shows capacity status:
- Each workstation row shows: total slots / slots in use / slots available
- Dragging a job to a full workstation shows warning: "MM22 is at full capacity (2/2). This job will be queued."
- Supervisor can still queue it — it will wait until a slot opens

---

### Dashboard — capacity utilisation metrics

Dashboard adds workstation utilisation to the active station summary:

Table columns: Workstation, Total capacity (slots), In use, Available, Queued UIDs, Utilisation %.

Workstations at 100% utilisation highlighted — these are the current bottlenecks.
Workstations with long queues relative to capacity flagged in amber.

---

### Reports — Workstation Capacity Report (new report)

**Report 9 — Workstation Capacity and Utilisation**

What it shows: How efficiently each workstation's capacity is being used over time.

Key metrics:
- Average utilisation % per workstation per shift and per day
- Time spent at full capacity (bottleneck time)
- Queue depth over time (how many UIDs waiting per workstation)
- Throughput per unit per shift (UIDs processed per slot)
- Maintenance downtime per unit (time units were in maintenance status)

Filters: Date range, location, workstation, shift.

Use case: Manager uses this to decide whether to add another physical unit of a bottleneck workstation or redistribute work across shifts.


---

## GRINDING MACHINE BATCH RULES — PAGE IMPLICATIONS

### Machine length limits and assignment

Four grinding machines handle surface and angle grinding steps:

| Machine | Max length | Bars per run |
|---|---|---|
| SG-DLT (Surface Grinder Delta) | 3000mm | Up to 2 bars if combined length ≤ 3000mm |
| AG-GMM (Angle Grinder Gamma) | 3000mm | Up to 2 bars if combined length ≤ 3000mm |
| AG-BTA (Angle Grinder Beta) | 1500mm | 1 bar at a time (1500mm or 1424mm only) |
| AG-ALP (Angle Grinder Alpha) | 1500mm | 1 bar at a time (1500mm or 1424mm only) |

Batching rule: total combined length of bars in one batch must not exceed machine maximum. No same-length requirement — a 1500mm and 1424mm bar can be paired together (2924mm total, fits within 3000mm).

---

### Batch Management — Grinding Batch Panel

Grinding batches (Steps 4, 12, 20, 22) are decided dynamically just before the operation — not pre-configured in cycle step capacity.

**How the grinding batch panel works:**

When Supervisor opens Batch Management for a grinding step, the panel shows:

**Left side — Queued bars**
List of all UIDs queued for this grinding step, sorted by priority then wait time.
Each UID shows: UID code, cycle type, bar length (mm), priority, wait time.

**Right side — Machine assignment board**
Four columns, one per machine (Delta / Gamma / Beta / Alpha).
Each column shows: machine code, max length, current batch being built, combined length so far, remaining capacity.

**Assigning bars to machines:**
Supervisor drags a UID from the queued list onto a machine column.
System checks:
- Bar length ≤ machine maximum → allowed
- Combined length of all bars in that machine's batch ≤ machine maximum → allowed
- Bar length > machine maximum → blocked, error shown: "2750mm bar cannot run on Beta (max 1500mm)"
- Adding bar would exceed machine capacity → blocked, error shown: "Combined length 3250mm exceeds Delta capacity of 3000mm"

**System pairing suggestions (auto-suggest):**
Before the Supervisor manually assigns, system shows suggested pairings:
- Groups bars that can be combined efficiently to maximise machine utilisation
- 2750mm bars assigned to Delta or Gamma alone
- 1500mm and 1424mm bars paired where possible to fill machine capacity
- High priority bars surfaced first in suggestions

Supervisor can accept suggestions, modify, or build batches manually.

**Confirm batch:**
Once all machines are loaded and Supervisor is satisfied with the groupings, confirm all batches at once. All UIDs in confirmed batches move to In Progress status. Operator receives job assignment for each machine.

---

### Production Floor — Grinding workstation cards

Grinding workstation cards show machine-level detail:

```
SG-DLT — Surface Grind 1
● Running

  Delta    [████████░░] 2924 / 3000mm
    E043 (1500mm) — In progress
    E047 (1424mm) — In progress
                              [Mark done]

  Queued: 8 bars waiting
  Next suggested: E048 (1500mm) + E051 (1500mm) = 3000mm on Delta
```

```
AG-ALP / AG-BTA / AG-GMM — Bevel Grinding
● Running

  Alpha    [██████████] 1500 / 1500mm
    E043 (1500mm) — In progress       [Mark done]

  Beta     [████████░░] 1424 / 1500mm
    E047 (1424mm) — In progress       [Mark done]

  Gamma    [████████░░] 2924 / 3000mm
    E044 (1500mm) — In progress
    E052 (1424mm) — In progress       [Mark done]

  Queued: 5 bars waiting
```

Mark done button applies to all bars in that machine's current batch simultaneously — the entire batch completes together, not bar by bar.

---

### Job Assignment — Grinding steps

For grinding steps, the Job Assignment page shows machine-level assignment instead of UID-level:

- Operator is assigned to a machine (e.g. "Ravi K. — SG-DLT Delta")
- The batch on that machine is their job
- Multiple operators can work the same grinding step simultaneously, one per machine unit
- Required badge check: operator must hold the grinding badge for the assigned machine type

---

### Cycle Builder — Grinding step capacity display

For grinding steps in the Cycle Builder, the capacity display shows machine-level limits instead of a simple number:

```
Step 12 — Surface Grind 1
Workstation: SG-DLT

  Machine units at Dharmapuri:
  SG-DLT-Delta    max length: 3000mm    batch rule: combined ≤ 3000mm
  SG-DLT-Beta     max length: 1500mm    batch rule: 1 bar only

  Capacity note: Batches are determined dynamically at runtime
  based on bar lengths. Not a fixed count capacity.
```

---

### Reports — Grinding utilisation

Report 9 (Workstation Capacity) includes a grinding-specific section:

**Grinding machine utilisation:**
- Average batch fill percentage per machine per shift
  (e.g. Delta average 94% fill = most runs near 3000mm capacity)
- Bars processed per machine per shift
- How often 2750mm bars caused single-bar runs on Delta/Gamma
  (capacity wasted because no pairing possible)
- Wait time of 2750mm bars vs 1500mm/1424mm bars
  (2750mm bars may wait longer because pairing options are limited)


---

## BUNCH GRINDING BATCH RULES — PAGE IMPLICATIONS (Step 4 — SG-DLT)

Bunch grinding uses a different batching model from surface and angle grinding. Bars are placed side by side in sets on the magnetic chuck, then sets are placed end to end along the 3000mm machine bed.

### Key parameters (Admin configurable)

- **Bars per set:** default 5, Admin can change at any time from Master Lists
- **Machine bed length:** 3000mm (fixed hardware limit)
- **Sets per run:** determined by bar length — 1 or 2 sets depending on whether two sets fit within 3000mm

### How capacity works

| Bar length | Sets per run | Bars per run |
|---|---|---|
| 1500mm | 2 | 10 |
| 1424mm | 2 | 10 |
| 2750mm | 1 | 5 |

Each set must contain bars of the same length. Two sets in one run may be different lengths as long as combined total ≤ 3000mm.

---

### Batch Management — Bunch Grinding Panel

When Supervisor opens Batch Management for Step 4 (Bunch Grinding):

**Queued bars list (left)**
All UIDs queued for bunch grinding, sorted by priority then wait time.
Each UID shows: UID code, bar length, cycle type, priority, wait time.

**Set builder (right)**

```
Bunch Grinding — SG-DLT
Bars per set: 5  [Admin setting — change in Master Lists]
Machine bed: 3000mm

Set 1 — Position 1 (0–1500mm)
  ┌─────────────────────────────────────┐
  │ E043  1500mm  ● High               │
  │ E044  1500mm  ● Normal             │
  │ E046  1500mm  ● Normal             │
  │ E049  1500mm  ● Normal             │
  │ E051  1500mm  ● Normal             │
  └─────────────────────────────────────┘
  5 / 5 bars  ✓ Set complete

Set 2 — Position 2 (1500–3000mm)
  ┌─────────────────────────────────────┐
  │ E052  1500mm  ● Normal             │
  │ E053  1500mm  ● Normal             │
  │ E054  1500mm  ● Normal             │
  │ ─ empty slot ─                     │
  │ ─ empty slot ─                     │
  └─────────────────────────────────────┘
  3 / 5 bars  ⚠ Incomplete set

Total bed used: 3000 / 3000mm
```

**Rules enforced in the panel:**
- All bars in a set must be the same length — mixing lengths within a set is blocked
- Two sets must fit within 3000mm combined — second set only shown if bar length ≤ (3000 − first set bar length)
- A set can be run with fewer than the configured number if not enough bars are queued — Supervisor decides whether to wait for more bars or run a partial set
- High priority bars are always surfaced first in suggestions

**Auto-suggest button:**
System automatically fills sets from the queued list optimally — fills Set 1 completely first with highest priority bars of matching length, then fills Set 2 if possible.

**Confirm run:**
Supervisor confirms — all bars in confirmed sets move to In Progress. Operator is assigned the job.

---

### Master Lists — Bunch Grinding Set Size

In Master Lists under Workstation Configuration for SG-DLT, Admin can change the bars-per-set value:

```
SG-DLT — Surface Grinder Delta
  Bunch Grinding set size: [5] bars per set   [Edit]
  Machine bed length: 3000mm (fixed)
```

Changing the set size takes effect immediately on the next batch. Currently running batches are not affected. Change is logged in the audit trail with who changed it and when.

---

### Production Floor — Bunch Grinding workstation card

```
SG-DLT — Bunch Grinding (Step 4)
● Running

  Bed used: 3000 / 3000mm  [██████████] 100%

  Set 1 (1500mm × 5 bars)
    E043, E044, E046, E049, E051 — In progress

  Set 2 (1500mm × 5 bars)
    E052, E053, E054, E055, E056 — In progress

  [Mark Run Complete]

  Queued: 23 bars waiting
```

Mark Run Complete applies to all 10 bars simultaneously. All bars in the run advance to the next step together.

---

### Reports — Bunch Grinding utilisation

Bunch grinding section in Report 9 (Workstation Capacity):

- Average bars per run vs maximum capacity (10 for 1500mm/1424mm, 5 for 2750mm)
- Partial set frequency — how often runs started with fewer than the configured set size
- Runs per shift
- Wait time for bars queued for bunch grinding (to identify if this step is a bottleneck)


---

## STEP CAPACITY IN CYCLE BUILDER — PAGE DETAIL

### How capacity is displayed and edited per step type

When Admin opens a step in the Cycle Builder, the capacity field adapts based on the workstation type:

---

**Fixed capacity steps (all 1 at a time):**
Simple number input. Default and current value shown. Admin edits and saves.

```
Step 5 — OP10 Rough Mill
Workstation: MM22
Capacity: [ 1 ] bars at a time
```

Applies to: Steps 1, 2, 3, 5, 8, 11, 13, 15, 16, 16B, 17, 18, 19, 21, 24, 25, 26, 27

---

**Furnace steps (HT70, HT80, HT90) — base capacity with auto-scaling:**

Admin enters base capacity at 1500mm. System calculates and displays derived capacities for other sizes automatically. Admin can see but not directly edit derived values — they are always calculated from the base.

```
Step 6 — Hardening
Workstation: HT70
Base capacity (1500mm): [ 6 ] bars
  └── 1424mm: 6 bars  (auto-calculated)
  └── 2750mm: 3 bars  (auto-calculated)
Formula: floor(base × 1500 / bar_length)
```

```
Step 9 — Tempering 1
Workstation: HT90
Base capacity (1500mm): [ 80 ] bars
  └── 1424mm: 80 bars  (auto-calculated)
  └── 2750mm: 43 bars  (auto-calculated)
```

Same display for Steps 7, 10, 14, 23 (same formula, Admin edits base only).

---

**Grinding steps (SG-DLT, AG-ALP, AG-BTA, AG-GMM) — length-based:**

No fixed number. Shows the length-based rule summary with link to grinding configuration.

```
Step 12 — Surface Grind 1
Workstation: SG-DLT
Capacity: Length-based batch
  SG-DLT max bed: 3000mm
  Rule: combined bar lengths ≤ 3000mm
  → 2 bars of 1500mm or 1424mm per run
  → 1 bar of 2750mm per run
  [Edit grinding rules →]
```

```
Step 22 — Bevel Grinding
Workstation: AG-ALP / AG-BTA / AG-GMM
Capacity: Length-based batch
  AG-ALP max: 1500mm — 1 bar at a time
  AG-BTA max: 1500mm — 1 bar at a time
  AG-GMM max: 3000mm — combined ≤ 3000mm
  [Edit grinding rules →]
```

---

**Bunch Grinding step (SG-DLT Step 4) — set-based:**

Shows set size configuration alongside the length rule.

```
Step 4 — Bunch Grinding
Workstation: SG-DLT
Bars per set: [ 5 ]   (Admin configurable)
Machine bed: 3000mm
  → 1500mm bars: 2 sets × 5 = 10 bars per run
  → 1424mm bars: 2 sets × 5 = 10 bars per run
  → 2750mm bars: 1 set × 5 = 5 bars per run
```

---

### Capacity change audit

Every time Admin changes a capacity value, the system logs:
- Who changed it
- What it was before
- What it changed to
- Date and time

This log is visible in the step detail within Cycle Builder and in the Admin audit log.

---

## UPDATED REPORT — CAPACITY UTILISATION

Report 9 (Workstation Capacity and Utilisation) now shows furnace capacity by bar size:

**Furnace utilisation breakdown:**
- Batches run per step per shift — split by bar size (1500mm / 1424mm / 2750mm)
- Average batch fill vs maximum capacity:
  - e.g. HT70 ran 5 batches: avg 5.2 bars per batch vs max 6 → 87% utilisation
- Times capacity was hit exactly (full batches) vs partial batches
- Estimated throughput per furnace per shift by bar size

This helps Manager decide whether furnace capacity is the bottleneck and whether changing the base capacity (after physical furnace expansion) would be worthwhile.


---

## PAGE 22 — JOB EXECUTION (Operator / Supervisor / Manager)

### Purpose

The primary operational interface for anyone performing work on the floor. This is the page where every job is started, paused, resumed, and closed. Every action is timestamped. Every minute of active work and every pause is recorded against the UID and the operator.

This page is the single source of truth for job timing across the entire system.

---

### Who sees this page and what they see

| Role | What they see |
|---|---|
| Operator | Only jobs assigned to them at their location |
| Supervisor | All jobs at their assigned location — can act on any job |
| Manager | All jobs at their assigned location — can act on any job |
| Admin | All jobs across both locations |

Location scoping is enforced by the backend. A Manager at Dharmapuri cannot see or act on Faridabad jobs. A Supervisor at Faridabad cannot see Dharmapuri jobs.

---

### Layout

**Mobile / tablet (primary operator view):**
Single column. One active job card fills the top of the screen. Queue of upcoming jobs below. Large tap targets throughout — minimum 56px height on all action buttons.

**Desktop / shared terminal:**
Two-column layout. Active job on the left, job queue on the right. Supervisor and Manager see a wider view with all workstations visible.

---

### Job states and transitions

```
         ┌─────────────────────────────────────────┐
         │              QUEUED                     │
         │  Job assigned, waiting for operator     │
         └──────────────────┬──────────────────────┘
                            │ Operator taps START
                            ▼
         ┌─────────────────────────────────────────┐
         │             IN PROGRESS                 │
         │  Timer running. Green indicator.        │◄──────┐
         └──────────┬──────────────────────────────┘       │
                    │ Operator taps PAUSE                   │ Operator taps
                    ▼                                       │ RESUME
         ┌─────────────────────────────────────────┐       │
         │               PAUSED                   │───────┘
         │  Timer stopped. Reason recorded.       │
         │  Amber indicator.                      │
         └──────────┬──────────────────────────────┘
                    │ Operator taps CLOSE
                    ▼
         ┌─────────────────────────────────────────┐
         │               CLOSED                   │
         │  Job complete. UID advances to next     │
         │  step. Full timing record saved.        │
         └─────────────────────────────────────────┘
```

State is saved to the database on every transition. If the device loses connection mid-job, the state is preserved and the timer continues from where it was when connection restores.

---

### Active job card — IN PROGRESS state

```
┌──────────────────────────────────────────────────────────────────┐
│  ● IN PROGRESS                                    Shift 2 · MM22 │
│                                                                  │
│  E043                                                            │
│  OP10 Rough Mill · MM22 · Step 5                                 │
│  EAT  ·  1500mm  ·  Plain  ·  MO-2024-089  ·  ● HIGH            │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  ACTIVE TIME                    TOTAL ELAPSED              │  │
│  │  00:23:41                       00:23:41                   │  │
│  │  (since last resume)            (net work time)            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Step progress ──────────────────────────────────────────────►   │
│  [1][2][3][4][●5][6][7][8][9][10]...                             │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐                      │
│  │  ⏸  PAUSE        │  │  ✓  CLOSE JOB    │                      │
│  │  (record reason) │  │  (mark complete) │                      │
│  └──────────────────┘  └──────────────────┘                      │
│                                                                  │
│  🚩 Flag issue (does not pause timer)                            │
└──────────────────────────────────────────────────────────────────┘
```

**Timer display:**
- **Active time** — time since the last Resume (or Start if no pauses). Resets on each Resume.
- **Total elapsed** — wall clock time from first Start to now (includes pause durations for reference)
- **Net work time** — active time only, pauses excluded. This is the figure used in reports and performance tracking.
- All timers show HH:MM:SS and update every second.

**Step progress tracker:** same 27-node horizontal track as UID Detail. Current step highlighted with pulsing animation.

---

### START action

When operator taps START on a queued job:
- Job status → In Progress
- Start timestamp recorded (date + time + operator)
- Timer begins
- Workstation unit auto-assigned (system picks available unit — e.g. MM22-1 or MM22-2)
- Active job card replaces the queued job card

If starting a furnace batch job: START applies to the entire batch. All UIDs in the batch move to In Progress simultaneously.

---

### PAUSE action

Tapping PAUSE opens a mandatory reason selector. Job does not pause until a reason is selected.

```
┌──────────────────────────────────────────────────────────────────┐
│  Pause reason — required                                         │
│                                                                  │
│  ○  Break                                                        │
│  ○  Machine issue                                                │
│  ○  Material not ready                                           │
│  ○  Waiting for supervisor                                       │
│  ○  Other (enter reason below)                                   │
│                                                                  │
│  [ Optional notes field — free text                           ]  │
│                                                                  │
│  [ CANCEL ]                        [ CONFIRM PAUSE ]            │
└──────────────────────────────────────────────────────────────────┘
```

On confirm:
- Job status → Paused
- Pause timestamp recorded
- Pause reason and notes saved
- Timer stops — net work time preserved
- Active job card shows amber PAUSED state with reason and pause duration counting up

A job can be paused and resumed multiple times. Each pause/resume cycle is a separate log entry.

---

### Active job card — PAUSED state

```
┌──────────────────────────────────────────────────────────────────┐
│  ⏸ PAUSED — Machine issue                        Shift 2 · MM22 │
│                                                                  │
│  E043                                                            │
│  OP10 Rough Mill · MM22 · Step 5                                 │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  PAUSED FOR               NET WORK TIME SO FAR             │  │
│  │  00:04:17                 00:23:41                         │  │
│  │  (pause duration)         (active time only)               │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  ▶  RESUME JOB                                           │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Pause history this job:                                         │
│  14:23 — Break (5 min 12 sec)                                    │
│  15:41 — Machine issue (ongoing)                                 │
└──────────────────────────────────────────────────────────────────┘
```

---

### RESUME action

Tapping RESUME:
- Job status → In Progress
- Resume timestamp recorded
- Timer restarts
- Active time counter resets to 00:00:00 (showing time since this resume)
- Net work time continues accumulating from where it was

---

### CLOSE JOB action

Tapping CLOSE JOB opens the completion panel:

```
┌──────────────────────────────────────────────────────────────────┐
│  Close Job — E043 · Step 5 · OP10 Rough Mill                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Net work time:   00:31:14                                 │  │
│  │  Total elapsed:   00:38:42  (incl. pauses)                 │  │
│  │  Pauses:          2  (Machine issue · Break)               │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  QC check required at this step?                                 │
│  ○ No QC check for this step                                     │
│  ○ Hardness (HRC)                                                │
│  ○ Width (mm)                                                    │
│  ○ Straightness                                                  │
│  ○ Visual                                                        │
│                                                                  │
│  Measured value: [              ]                                │
│  Result:  ● Pass   ○ Fail   ○ Borderline                        │
│                                                                  │
│  Notes (optional): [                                          ]  │
│                                                                  │
│  [ CANCEL ]               [ CONFIRM CLOSE — ADVANCE TO STEP 6 ] │
└──────────────────────────────────────────────────────────────────┘
```

On confirm:
- Job status → Closed
- Close timestamp recorded
- Net work time finalised
- QC result (if any) saved to step log
- UID current step advances to next step
- UID storage location updates to destination storage for this step
- If QC result is Fail: UID placed on hold automatically, Supervisor alerted
- Next job in operator's queue becomes the active job card

**Special close flows:**

- **Tempering steps (9, 10, 14, 23):** Close panel additionally requires actual temperature achieved and actual soak time held. System compares against Admin-configured target and flags deviation if outside tolerance.
- **Converting — Step 16:** Close panel opens the full Converting workflow (child UID creation, pattern selection, scrap calculation). Cannot be closed with a simple confirm.
- **Step 16B — Child UID Marking:** Close panel shows each child UID and requires physical marking confirmation for each before closing.
- **QC Inspection — Step 26:** Close panel requires QC result — cannot be closed without Pass or Fail selection.

---

### Job queue (below active job card)

List of all jobs in the operator's queue for this shift, in priority order.

Each queued job shows:
- UID code and step name
- Workstation code
- Wait time (how long this job has been waiting)
- Priority badge
- Estimated duration (if configured for this step)

Operator cannot reorder their own queue. Priority order is set by the system (High first, then Normal, then Low, FIFO within same priority). Supervisor can reorder the queue from Job Assignment page.

---

### Supervisor / Manager view — all jobs at their location

Supervisors and Managers see an expanded view showing all jobs across all workstations at their location.

**Layout — desktop:**
Grid of workstation panels. Each panel shows the active job with its live timer.

```
┌─────────────────────────────┐  ┌─────────────────────────────┐
│  MM22 — OP10 Rough Mill     │  │  HT70 — Hardening           │
│  ● IN PROGRESS              │  │  ● IN PROGRESS              │
│  E043  ·  00:31:14          │  │  Batch HT70-2024-112        │
│  Ravi K.   ● HIGH           │  │  6 bars  ·  00:45:00        │
│  [View]  [Pause]  [Close]   │  │  S. Kumar (Supervisor)      │
│                             │  │  [View]  [Pause]  [Close]   │
│  Queued: 4 UIDs             │  │  Queued: 8 UIDs             │
└─────────────────────────────┘  └─────────────────────────────┘

┌─────────────────────────────┐  ┌─────────────────────────────┐
│  SG-DLT — Surface Grind 1  │  │  STR-MAN — Straightening    │
│  ⏸ PAUSED — Break          │  │  ○ IDLE                     │
│  E041-A + E041-B            │  │  No active job              │
│  Priya S.  ·  paused 3m    │  │                             │
│  [View]  [Resume]           │  │  Queued: 2 UIDs             │
│                             │  │                             │
│  Queued: 6 UIDs             │  │                             │
└─────────────────────────────┘  └─────────────────────────────┘
```

Supervisor can Start, Pause, Resume, or Close any job from this view — not just their own. Useful when an operator is absent or needs assistance.

---

### Batch job timing (furnace and grinding batches)

For batch jobs, the timer applies to the entire batch — all UIDs share one set of timing records.

**Furnace batch timing:**
- One START timestamp for the batch
- Pause/Resume applies to the whole batch (e.g. furnace paused for maintenance)
- On Close: one actual temperature and soak time entered for the batch
- All UIDs in the batch get the same timing record stamped on their step log
- Net work time = time from Start to Close, minus pauses

**Grinding batch timing:**
- One START timestamp for the batch (all bars on the machine)
- One net work time for the whole batch
- On Close: all bars in the batch advance to next step simultaneously
- Each UID's step log shows the same start/close timestamps and net work time

---

### Where timing is shown across the system

**1. Job Execution page (this page) — live:**
- Active time counter (HH:MM:SS, live)
- Net work time counter (HH:MM:SS, live)
- Pause duration counter when paused

**2. Production Floor (Page 7) — per workstation:**
Each workstation card shows:
- Current job status (● IN PROGRESS / ⏸ PAUSED / ○ IDLE)
- Elapsed time on current job: e.g. "Running 00:31:14"
- Paused indicator with reason if paused: "⏸ Paused — Break · 00:04:17"

**3. UID Detail page (Page 11) — per step:**
Step history table gains timing columns:
- Started at (timestamp)
- Closed at (timestamp)
- Net work time (HH:MM:SS — active time only, pauses excluded)
- Pause count
- Pause detail (expandable — each pause with reason, duration, timestamp)

**4. Reports (Page 13) — aggregate:**
Report 10 — Job Timing Report (new report):

**What it shows:**
- Average net work time per step per workstation across any date range
- Comparison: average vs actual for individual UIDs (which jobs ran long, which ran short)
- Pause frequency and reasons per step and per operator
- Time per operator per shift (how much active work time vs idle vs pause)
- Longest running jobs (UIDs that spent the most time at a specific step — potential quality or machine issues)

**Filters:** Date range, location, workstation, step, operator, cycle type, shift.

---

### Timing record stored per job

Each job close event saves a complete timing record:

```json
{
  "uid": "E043",
  "step": 5,
  "operation": "OP10 Rough Mill",
  "workstation": "MM22",
  "workstation_unit": "MM22-1",
  "operator_id": "EMP-042",
  "operator_name": "Ravi K.",
  "shift_id": "SHIFT-2024-1115-2",
  "batch_id": null,
  "started_at": "2024-11-15T14:22:00",
  "closed_at": "2024-11-15T15:01:42",
  "net_work_seconds": 1874,
  "total_elapsed_seconds": 2322,
  "pauses": [
    {
      "paused_at": "2024-11-15T14:38:17",
      "resumed_at": "2024-11-15T14:43:29",
      "reason": "Break",
      "notes": "",
      "duration_seconds": 312
    },
    {
      "paused_at": "2024-11-15T14:55:00",
      "resumed_at": "2024-11-15T14:59:44",
      "reason": "Machine issue",
      "notes": "Chuck re-tightened",
      "duration_seconds": 284
    }
  ],
  "qc_result": "Pass",
  "qc_value": "",
  "qc_type": null
}
```

---

### Role-by-role: what each sees on login

**Operator:**
- Lands directly on Job Execution page
- Sees only their assigned jobs at their location
- Active job card at top, queue below
- Large touch targets — optimised for tablet and phone
- Cannot see other operators' jobs

**Supervisor:**
- Sees Job Execution page as a floor-wide view at their location
- All workstations with live job status and timers
- Can act on any job (Start / Pause / Resume / Close)
- Receives alert when any job at their location is paused longer than a configured threshold (e.g. paused for >30 minutes — potential issue)

**Manager:**
- Same as Supervisor view but includes summary metrics at top:
  - Jobs running right now: count
  - Jobs paused right now: count and top pause reason
  - Average active time per step today vs historical average
  - Operators with no active job (idle)
- Can act on any job at their location

**Admin:**
- Both locations visible. Can toggle between Faridabad / Dharmapuri / Both.
- All the above.

---

### Pause threshold alert

Admin configures a maximum acceptable pause duration per step (e.g. 30 minutes). If any job remains paused longer than this threshold:
- Alert sent to Supervisor on duty at that location
- Alert appears in topbar bell
- Workstation card on Production Floor shows red pulsing indicator
- Dashboard alerts panel shows: "E043 at MM22 paused >30 min — Machine issue"

---

### Access table update

| Page | Admin | Manager | Supervisor | Operator | Service | Shopfloor |
|---|---|---|---|---|---|---|
| Job Execution | ✓ both | ✓ own location | ✓ own location | ✓ own jobs | — | — |


---

## WORKSTATION QUEUE TRACKER — MINIMUM THRESHOLD AND AUTO-ASSIGN

### Concept

Every workstation has a configurable minimum queue threshold. The workstation will not start a new batch until the queued UID count reaches this minimum. Once the threshold is reached, the system auto-assigns the batch and marks the workstation as READY. The Supervisor confirms to start, or the system starts automatically depending on trigger mode configured for that step.

This is the mechanism that ensures furnaces are never run half-empty — HT90 waits for 80 bars before firing, HT70 and HT80 wait for 6 bars.

### Minimum thresholds per step

| Step | Operation | Workstation | Minimum queue |
|---|---|---|---|
| 6 | Hardening | HT70 | 6 bars |
| 7 | Quenching | HT80 | 6 bars |
| 9 | Tempering 1 | HT90 | 80 bars |
| 10 | Tempering 2 | HT90 | 80 bars |
| 14 | Tempering 3 | HT90 | 80 bars |
| 23 | Tempering 4 — Stress Relief | HT90 | 80 bars |
| All other steps | various | various | 1 (start immediately) |

Admin can change any minimum threshold from the Cycle Builder at any time. Change takes effect on the next batch.

### Queue states

A workstation queue passes through these states:

```
WAITING — queue building toward minimum threshold
  ↓ threshold reached
READY — minimum met, batch auto-assigned, awaiting start confirmation
  ↓ Supervisor confirms (or auto-starts if trigger = auto)
IN PROGRESS — batch running
  ↓ batch closed
WAITING — next queue begins building
```

### Supervisor override

If the minimum threshold has not been reached, Supervisor can manually override and start the batch with fewer UIDs than the minimum. Override requires:
- Confirmation prompt: "Queue has 65 / 80 bars. Start with partial batch?"
- Reason field (mandatory)
- Override is logged in the audit trail with Supervisor name, timestamp, actual queue count, and reason

---

## WORKSTATION QUEUE TRACKER — PAGE DETAIL

This tracker appears in two places: on the Production Floor page (per workstation card) and on the Job Execution page (full-width panel for the active workstation).

---

### On the Production Floor — workstation card queue panel

Each workstation card has a queue section below the active job:

**Example — HT90 waiting for minimum (Tempering 1):**

```
┌─────────────────────────────────────────────────────────────────┐
│  HT90 — Tempering 1 (Step 9)                   ○ WAITING       │
│                                                                  │
│  Queue progress                                                  │
│  [████████████████░░░░░░░░░░░░░░] 52 / 80 bars                 │
│  28 more needed before auto-assign                              │
│                                                                  │
│  Next in queue (by priority then FIFO):                         │
│  1.  E043  ·  EAT  ·  1500mm  ·  ● HIGH   ·  waiting 00:14:22  │
│  2.  E044  ·  EAT  ·  1500mm  ·  Normal   ·  waiting 00:12:05  │
│  3.  E046  ·  EAT  ·  1500mm  ·  Normal   ·  waiting 00:11:30  │
│  4.  E049  ·  EAT  ·  1500mm  ·  Normal   ·  waiting 00:09:17  │
│  5.  E051  ·  EAT  ·  1500mm  ·  Normal   ·  waiting 00:08:44  │
│  ··· 47 more UIDs in queue ···                                  │
│                                                                  │
│  [Override — start with 52 bars]                                │
└─────────────────────────────────────────────────────────────────┘
```

**Example — HT90 threshold reached (READY):**

```
┌─────────────────────────────────────────────────────────────────┐
│  HT90 — Tempering 1 (Step 9)                   ● READY         │
│                                                                  │
│  Queue progress                                                  │
│  [████████████████████████████████] 80 / 80 bars ✓             │
│  Minimum reached — batch auto-assigned                          │
│                                                                  │
│  Batch assigned: HT90-T1-2024-441                               │
│  80 bars ready to load                                          │
│  Assigned to: S. Kumar (Supervisor on duty)                     │
│                                                                  │
│  [START BATCH →]                                                │
└─────────────────────────────────────────────────────────────────┘
```

**Example — MM22 (OP10, minimum 1 — starts immediately):**

```
┌─────────────────────────────────────────────────────────────────┐
│  MM22 — OP10 Rough Mill (Step 5)               ● IN PROGRESS   │
│                                                                  │
│  Active: E043  ·  00:23:41 net  ·  Ravi K.                     │
│  [View job]  [Pause]  [Close]                                   │
│                                                                  │
│  Up next:                                                       │
│  1.  E044  ·  EAT  ·  1500mm  ·  ● HIGH   ·  waiting 00:08:12  │
│  2.  E046  ·  EAT  ·  1500mm  ·  Normal   ·  waiting 00:06:30  │
│  3.  E049  ·  EAT  ·  1500mm  ·  Normal   ·  waiting 00:05:11  │
│  ··· 2 more ···                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### On the Job Execution page — full queue panel

When an operator or Supervisor opens a workstation, the full queue panel is shown alongside the active job card.

**Layout (desktop — two columns):**

```
┌──────────────────────────────┐  ┌──────────────────────────────┐
│   ACTIVE JOB                 │  │   WORKSTATION QUEUE          │
│                              │  │   HT90 — Tempering 1         │
│   HT90 — Tempering 1         │  │                              │
│   ● IN PROGRESS              │  │   [████████████████] 80/80   │
│   Batch HT90-T1-2024-441     │  │   ✓ Minimum reached          │
│   80 bars                    │  │                              │
│                              │  │   STATUS: IN PROGRESS        │
│   ┌──────────────────────┐   │  │   Current batch: 80 bars     │
│   │  NET WORK TIME       │   │  │                              │
│   │  00:45:22            │   │  │   NEXT BATCH BUILDING:       │
│   │  ACTUAL TEMP         │   │  │   [████░░░░░░░░░░░░] 18/80   │
│   │  180°C (target 180°C)│   │  │   62 more needed             │
│   │  ACTUAL SOAK         │   │  │                              │
│   │  00:45:22 / 90 min   │   │  │   Next in line:              │
│   └──────────────────────┘   │  │   1. E087 ● HIGH  00:02:11   │
│                              │  │   2. E088 Normal  00:01:44   │
│   [⏸ PAUSE]  [✓ CLOSE]      │  │   3. E089 Normal  00:01:22   │
│                              │  │   ··· 15 more ···            │
└──────────────────────────────┘  └──────────────────────────────┘
```

**Layout (mobile / tablet — stacked):**
Active job card on top, queue panel below (collapsible — tap to expand).

---

### Queue tracker — job sequence detail

The queue shows the next jobs in the order they will be assigned. Ordered by:
1. Priority (High first, then Normal, then Low)
2. Within same priority: FIFO (longest waiting first)

Each queued item shows:
- UID code (or batch reference for multi-UID batches)
- Cycle type badge
- Bar size (mm)
- Priority badge
- Wait time (how long this UID has been waiting at this step)
- Estimated start time (calculated from current batch remaining time — shown as "Est. start: 00:32 from now")

---

### Auto-assign behaviour when threshold is reached

When the queue count reaches the configured minimum:

1. System automatically groups the next N UIDs into a batch (N = capacity for that step and bar size)
2. Batch reference number auto-generated (e.g. HT90-T1-2024-441)
3. Batch assigned to the Supervisor on duty at that location
4. Workstation status changes from WAITING → READY
5. READY alert appears in:
   - Supervisor's alert bell
   - Production Floor workstation card (green READY state)
   - Job Execution page for the Supervisor
   - Topbar status for the Supervisor
6. Supervisor sees START BATCH button — taps to confirm and begin
7. If trigger mode for this step is set to AUTO: batch starts automatically without Supervisor confirmation

---

### What happens if UIDs of different sizes are in the queue

When the queue builds up for a furnace step, UIDs of different sizes may be queued (1500mm, 1424mm, 2750mm). The capacity differs per size:
- 1500mm: 80 bars
- 1424mm: 80 bars
- 2750mm: 43 bars

The system checks the mix and calculates available capacity:
- If all 1500mm: wait for 80, run 80
- If mix of 1500mm and 1424mm: combined capacity still 80 (same physical weight/space)
- If any 2750mm bars in queue: calculate total capacity based on proportional length rule, show adjusted threshold

The queue progress bar shows the adjusted minimum for the current mix. When the threshold is met for the mix in queue, auto-assign fires.

---

### Next job tracking — full workstation journey

For every workstation, the queue panel shows the full forward journey of each queued UID — not just where it is now but where it is going next:

Clicking any UID in the queue opens a mini UID card showing:
```
E043 — EAT Cycle
Current: Step 5 — OP10 Rough Mill — MM22  [● IN PROGRESS]
───────────────────────────────────────────────────────
Next steps after this:
  Step 6  → Hardening      HT70    MC-D → HT-Q    Est. queue: 4 bars
  Step 7  → Quenching      HT80    HT-Q → HT-Q    Est. queue: 2 bars
  Step 8  → Straighten HYD STR-HYD HT-Q → HT-Q   Ready immediately
  Step 9  → Tempering 1    HT90    HT-Q → HT-Q    Queue: 52/80 bars
  ...
───────────────────────────────────────────────────────
[View full UID Detail →]
```

This gives the Supervisor full visibility of what is coming down the line at every workstation — not just the current bottleneck.

---

### Pause state on workstation queue tracker

When the active job is paused, the workstation card and queue panel both update to reflect the paused state:

```
┌─────────────────────────────────────────────────────────────────┐
│  MM22 — OP10 Rough Mill (Step 5)              ⏸ PAUSED         │
│                                                                  │
│  ⏸ E043 — Machine issue                                         │
│     Paused at 14:55:00  ·  duration: 00:08:17 and counting     │
│     Net work time preserved: 00:23:41                           │
│                                                                  │
│  [▶ RESUME JOB]                                                 │
│                                                                  │
│  Up next (waiting while job is paused):                         │
│  1.  E044  ·  ● HIGH   ·  waiting 00:16:29  (increasing)       │
│  2.  E046  ·  Normal   ·  waiting 00:14:47  (increasing)       │
│  3.  E049  ·  Normal   ·  waiting 00:13:34  (increasing)       │
│                                                                  │
│  ⚠ Pause threshold: 8 min 17 sec / 30 min limit                │
│  [Pause threshold alert will fire in 00:21:43]                  │
└─────────────────────────────────────────────────────────────────┘
```

Key details shown during pause:
- Pause timestamp recorded and displayed (14:55:00)
- Pause reason shown prominently (Machine issue)
- Pause duration counting up in amber
- Net work time preserved and frozen (00:23:41)
- Queue wait times increasing in real time — Supervisor can see impact
- Pause threshold countdown — how much time before the alert fires
- RESUME button prominent and always accessible

---

### Dashboard — queue status summary

Dashboard adds a queue status strip below the WIP storage bar:

```
WORKSTATION QUEUE STATUS

HT90  Tempering 1  [████████████░░░░] 52/80  WAITING  —  28 more needed
HT90  Tempering 2  [██░░░░░░░░░░░░░░]  8/80  WAITING  —  72 more needed
HT70  Hardening    [██████████████░░]  5/6   WAITING  —  1 more needed
HT80  Quenching    ✓ READY  6/6  [START BATCH →]
MM22  OP10         ● IN PROGRESS  E043  00:23:41
SG-DLT  Bunch Grind ● IN PROGRESS  10 bars  00:08:11
```

This gives Manager and Supervisor an instant read on where the bottlenecks are building and which furnaces are close to firing.


---

## REBUILT CONCEPT — JOB ASSIGNMENT, PRODUCTION FLOOR, AND MY WORKSTATION

This section replaces and clarifies the earlier job assignment and production floor descriptions. The core model is:

- **Jobs are assigned to workstations** — not to operators directly
- **Operators are assigned to workstations** — one operator can be responsible for multiple workstations simultaneously
- **Each job at each workstation has its own independent timer** — not the operator's timer, not a shift timer
- **Operator physically collects the job** from source storage, processes it at the workstation, delivers it to destination storage
- **12,000 UIDs in queue** — every list, queue, and table must support filtering, search, and pagination at this scale

---

## DRAG AND DROP — WHERE IT APPLIES ACROSS THE SYSTEM

Three places in the system use drag and drop:

### 1. Job Assignment page — assign operators to workstations

Supervisor drags a workstation from the available workstations list onto an operator card.
One operator card can have multiple workstations dropped onto it.
One workstation can only be assigned to one operator per shift.

```
Available Workstations          Operator Board
┌─────────────┐                 ┌─────────────────────────────────┐
│ AG-ALP      │ ──drag──►       │  Ravi K.                        │
│ AG-BTA      │ ──drag──►       │  ┌──────┐ ┌──────┐ ┌──────┐   │
│ AG-GMM      │ ──drag──►       │  │AG-ALP│ │AG-BTA│ │AG-GMM│   │
│ SG-DLT      │                 │  └──────┘ └──────┘ └──────┘   │
│ MM22        │                 └─────────────────────────────────┘
│ MM11        │                 ┌─────────────────────────────────┐
│ STR-MAN     │ ──drag──►       │  Priya S.                       │
│ STR-HYD     │ ──drag──►       │  ┌──────┐ ┌──────┐             │
│ ...         │                 │  │STR-MAN│ │STR-HYD│            │
└─────────────┘                 │  └──────┘ └──────┘             │
                                └─────────────────────────────────┘
```

Drag a workstation back off an operator card to unassign it.
Drag a workstation from one operator card to another to reassign mid-shift.
All assignment changes logged with timestamp.

### 2. Production Floor — reassign UIDs between workstation queues

Supervisor drags a UID card from one workstation queue to another workstation queue.
Used when: a machine goes down and queued UIDs need to move to another machine, or a high priority UID needs to jump ahead in a queue.

```
SG-DLT Queue          AG-GMM Queue
┌──────────────┐      ┌──────────────┐
│ E043 ● HIGH  │      │ E051 Normal  │
│ E044 Normal  │      │ E052 Normal  │
│ E046 Normal  │      │              │
│ E049 Normal  │      │              │
│              │      │              │
└──────────────┘      └──────────────┘
        │
        └── drag E043 to AG-GMM queue ──►
```

System validates the drag — blocks if the destination machine cannot accept the bar length.
Drop shows a preview of what the combined length would be before confirming.

### 3. Batch Management — build furnace and grinding batches

Supervisor drags UIDs from the waiting queue into the batch builder (furnace load or grinding set).
Already described in Batch Management page.

---

## PAGE 20 — JOB ASSIGNMENT (REBUILT)

### Purpose

Supervisor assigns workstations to operators for the current shift. Sets up who is responsible for what. This is done at shift start but can be changed any time during the shift.

### Layout

Three columns:

```
┌──────────────────┐  ┌──────────────────────────────┐  ┌──────────────┐
│ UNASSIGNED       │  │ OPERATOR BOARD               │  │ SHIFT SUMMARY│
│ WORKSTATIONS     │  │                              │  │              │
│                  │  │ (drag workstations here)     │  │              │
│ AG-ALP  [queue:4]│  │                              │  │              │
│ AG-BTA  [queue:2]│  │                              │  │              │
│ AG-GMM  [queue:6]│  │                              │  │              │
│ SG-DLT  [queue:8]│  │                              │  │              │
│ MM22    [queue:3]│  │                              │  │              │
│ MM11    [queue:5]│  │                              │  │              │
│ STR-MAN [queue:4]│  │                              │  │              │
│ ...              │  │                              │  │              │
└──────────────────┘  └──────────────────────────────┘  └──────────────┘
```

### Unassigned workstations panel (left)

Lists all workstations that are active for this shift but not yet assigned to an operator.
Each workstation shows:
- Workstation code and name
- Current queue depth (how many UIDs waiting)
- Queue status: WAITING / READY / IN PROGRESS
- Required badge for this workstation

Sorted by queue depth descending — busiest workstations at top so Supervisor assigns the most critical ones first.

Search and filter by: workstation category, queue status, badge requirement.

### Operator board (centre)

One card per operator on duty this shift.
Initially all cards are empty — Supervisor drags workstations from left panel onto operator cards.

Each operator card shows:
- Operator name and employee ID
- Role badge
- Skill badges held (icons — system auto-highlights if operator lacks the badge for a workstation dropped onto them)
- Assigned workstations (chips that can be dragged off to unassign)
- Total queue depth across all their assigned workstations

**Badge validation on drop:**
When Supervisor drops a workstation onto an operator card:
- If operator holds required badge: workstation chip appears on their card in green
- If operator does not hold the badge: warning shown — "Ravi K. does not hold AG-ALP certification. Assign anyway?" Supervisor can override with reason.
- Furnace workstations (HT70, HT80, HT90): only Supervisors can be assigned. Dropping onto an Operator card is blocked entirely.

**Multi-workstation assignment:**
Operator cards have no limit on how many workstations can be assigned. Supervisor decides based on operational knowledge.

Example after assignment:
```
┌─────────────────────────────────────────────────────────────────┐
│  Ravi K.  ·  EMP-042  ·  Operator                              │
│  Badges: ✅ AG-ALP  ✅ AG-BTA  ✅ AG-GMM  ✅ SG-DLT            │
│                                                                  │
│  Assigned workstations:                                         │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐         │
│  │ AG-ALP  [4]  ✕│ │ AG-BTA  [2]  ✕│ │ AG-GMM  [6]  ✕│        │
│  │ ✅ Badge OK   │ │ ✅ Badge OK   │ │ ✅ Badge OK   │         │
│  └───────────────┘ └───────────────┘ └───────────────┘         │
│                                                                  │
│  Total queue: 12 UIDs across 3 workstations                     │
└─────────────────────────────────────────────────────────────────┘
```

### Shift summary panel (right)

Live overview of the current shift assignment status:
- Workstations assigned: N / total
- Workstations unassigned: N (highlighted if any have queued UIDs)
- Operators idle (no workstations assigned): N
- Total UIDs queued across all workstations: N

Alert if any workstation with a queue has no operator assigned.

---

## PAGE 7 — PRODUCTION FLOOR (REBUILT)

### Purpose

Supervisor's live view of the entire floor at their location. Shows every workstation, its queue, and current job status. Supervisor can reassign UIDs between queues using drag and drop.

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  TOPBAR FILTER:  All workstations  ▼   All operators  ▼         │
│  Search UID...    Sort: Priority ▼    View: Grid / List          │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ AG-ALP           │ │ AG-BTA           │ │ AG-GMM           │
│ Bevel Grinding   │ │ Bevel Grinding   │ │ Bevel Grinding   │
│ Ravi K.          │ │ Ravi K.          │ │ Ravi K.          │
│ ● IN PROGRESS    │ │ ● IN PROGRESS    │ │ ○ IDLE           │
│                  │ │                  │ │                  │
│ E043 ● HIGH      │ │ E047 Normal      │ │ Queue: 6 UIDs    │
│ 00:23:41 ──────► │ │ 00:11:22 ──────► │ │ [drag UIDs here] │
│ 1500mm           │ │ 1424mm           │ │                  │
│                  │ │                  │ │ E051 Normal      │
│ Queue: 3 UIDs    │ │ Queue: 1 UID     │ │ E052 Normal      │
│ E044 ● HIGH      │ │ E049 Normal      │ │ E053 Normal      │
│ E046 Normal      │ │                  │ │ + 3 more         │
│ E049 Normal      │ │                  │ │                  │
└──────────────────┘ └──────────────────┘ └──────────────────┘

┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ HT90             │ │ MM22             │ │ STR-MAN          │
│ Tempering 1      │ │ OP10 Rough Mill  │ │ Straightening    │
│ S. Kumar (Sup)   │ │ Priya S.         │ │ Kumar V.         │
│ ○ WAITING        │ │ ● IN PROGRESS    │ │ ⏸ PAUSED         │
│                  │ │                  │ │                  │
│ [████░░░] 52/80  │ │ E055 Normal      │ │ E039 Normal      │
│ 28 more needed   │ │ 00:08:33         │ │ Machine issue    │
│                  │ │                  │ │ 00:04:17 paused  │
│ Next in queue:   │ │ Queue: 4 UIDs    │ │                  │
│ E060 ● HIGH      │ │ E056 ● HIGH      │ │ Queue: 2 UIDs    │
│ E061 Normal      │ │ E057 Normal      │ │ E040 Normal      │
│ + 50 more        │ │ E058 Normal      │ │ E041 Normal      │
│                  │ │ E059 Normal      │ │                  │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

### Workstation card — what it shows

- Workstation code and operation name
- Assigned operator name
- Current status: ● IN PROGRESS / ⏸ PAUSED / ○ WAITING / ✅ READY / ○ IDLE
- For IN PROGRESS: active UID code, elapsed timer, bar size
- For PAUSED: UID code, pause reason, pause duration counting up
- For WAITING: queue progress bar toward minimum threshold
- For READY: batch assigned, START button
- Queue list: next UIDs waiting (top 3 visible, expandable)

### Drag and drop on Production Floor

Supervisor drags a UID card from one workstation queue to another.
Valid drops: same step type, destination machine can accept bar length.
Invalid drops blocked with message showing why.

Used for:
- Moving a high priority UID to the front of a different machine queue
- Redistributing queue when one machine has too many UIDs and another is idle
- Reassigning to a different machine unit when original machine goes to maintenance

### Supervisor and Manager view switching

Default: shows all workstations.
Filter by operator: "Show Ravi K.'s workstations only" — collapses to show only AG-ALP, AG-BTA, AG-GMM.
This gives Supervisor the ability to check any individual operator's workload without leaving the production floor view.

Manager can view the same panel but cannot drag and drop — view only.

Admin can view and act on both locations.

---

## PAGE 22 — MY WORKSTATION (OPERATOR VIEW — REBUILT)

### Purpose

The operator's personal view. Shows only the workstations assigned to them this shift. Each workstation has its own job queue and independent job timers. Multiple jobs can be In Progress simultaneously across different workstations.

### Layout — mobile / tablet (primary)

Horizontal tab strip at top: one tab per assigned workstation.
Active workstation content fills the screen below.

```
┌─────────────────────────────────────────────────────────────────┐
│  [ AG-ALP ● ]  [ AG-BTA ● ]  [ AG-GMM ○ ]                     │
│   (IN PROGRESS)  (IN PROGRESS)  (IDLE)                          │
└─────────────────────────────────────────────────────────────────┘

Active tab: AG-ALP

┌─────────────────────────────────────────────────────────────────┐
│  AG-ALP — Bevel Grinding — Step 22                              │
│  ● IN PROGRESS                                                  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  E043  ·  EAT  ·  1500mm  ·  Plain  ·  ● HIGH            │  │
│  │  Collect from: MC-D    →    Deliver to: MC-D              │  │
│  │                                                           │  │
│  │  NET WORK TIME        STEP PROGRESS                       │  │
│  │  00:23:41             [●●●●●●●●●●●●●●●●●●●●●22●●●●●]    │  │
│  │                                                           │  │
│  │  ┌─────────────────┐    ┌─────────────────────────────┐  │  │
│  │  │  ⏸  PAUSE       │    │  ✓  CLOSE JOB              │  │  │
│  │  └─────────────────┘    └─────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  QUEUE — AG-ALP  (3 UIDs waiting)                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  1.  E044  ·  1500mm  ·  ● HIGH    ·  waiting 00:16:29   │  │
│  │  2.  E046  ·  1500mm  ·  Normal   ·  waiting 00:14:47   │  │
│  │  3.  E049  ·  1500mm  ·  Normal   ·  waiting 00:13:34   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Switching between assigned workstations

Operator taps a tab to switch to that workstation.
Tab shows a status dot:
- ● green = In Progress
- ⏸ amber = Paused
- ○ grey = Idle
- ✅ green check = Ready (threshold met, batch ready to start)

Switching tabs never pauses the active job on the previous tab. Each workstation runs independently. E043 on AG-ALP keeps its timer running while operator looks at AG-BTA.

### Starting a new job while another is running

Operator is on AG-ALP tab with E043 running.
Operator taps AG-BTA tab — sees queue of UIDs waiting there.
Operator taps START on E047 at AG-BTA.
E047 timer starts independently.
Both jobs now In Progress simultaneously.
Operator taps back to AG-ALP — E043 timer still running, shown at 00:24:15.

### What Supervisor and Manager see in this view

Supervisor or Manager can switch to any operator's view:

```
VIEWING: Ravi K.'s workstations    [◄ Back to full floor view]

[ AG-ALP ● ]  [ AG-BTA ● ]  [ AG-GMM ○ ]
```

Supervisor sees exactly what Ravi sees but with additional controls:
- Can pause or close any of Ravi's jobs
- Can see all three workstation tabs
- Can override queue order

Manager sees the same view in read-only mode — no Start/Pause/Close buttons.

### Storage collection and delivery — shown on every job card

Every job card shows:
- **Collect from:** source storage location (in IBM Plex Mono)
- **Deliver to:** destination storage location (in IBM Plex Mono)

This tells the operator exactly where to physically go to collect the bar before starting and where to take it when done.

Example: Step 22 Bevel Grinding — Collect from: MC-D → Deliver to: MC-D (same location, stays in MC-D after grinding)
Example: Step 5 OP10 Rough Mill — Collect from: MC-Q → Deliver to: MC-D (moves from queue to done rack)

### Desktop layout — all workstations side by side

On desktop or shared terminal, operator sees all their assigned workstations as columns:

```
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  AG-ALP          │ │  AG-BTA          │ │  AG-GMM          │
│  ● IN PROGRESS   │ │  ● IN PROGRESS   │ │  ○ IDLE          │
│                  │ │                  │ │                  │
│  E043 ● HIGH     │ │  E047 Normal     │ │  Queue: 6 UIDs   │
│  00:23:41        │ │  00:11:22        │ │                  │
│                  │ │                  │ │  [START NEXT →]  │
│  [PAUSE][CLOSE]  │ │  [PAUSE][CLOSE]  │ │                  │
│                  │ │                  │ │  E051 Normal     │
│  Queue: 3        │ │  Queue: 1        │ │  E052 Normal     │
│  E044 ● HIGH     │ │  E049 Normal     │ │  E053 Normal     │
│  E046 Normal     │ │                  │ │  + 3 more        │
│  E049 Normal     │ │                  │ │                  │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

START NEXT button on an idle workstation starts the highest priority queued job immediately.

---

## SUMMARY — THREE PAGES AND THEIR RELATIONSHIPS

```
JOB ASSIGNMENT PAGE (Supervisor)
  Supervisor drags workstations onto operator cards
  Sets up who is responsible for what this shift
  ↓ assignments flow to

PRODUCTION FLOOR PAGE (Supervisor / Manager)
  Live view of all workstations at the location
  Queue progress, live timers, pause states
  Supervisor drags UIDs between queues
  Supervisor can view any single operator's workstations
  ↓ operator opens their personal view

MY WORKSTATION PAGE (Operator)
  Shows only workstations assigned to this operator
  One tab per workstation
  Independent timers per job per workstation
  Start / Pause / Resume / Close on each job
  Collect from / Deliver to shown on every job card
  Supervisor and Manager can switch to any operator's view
```

