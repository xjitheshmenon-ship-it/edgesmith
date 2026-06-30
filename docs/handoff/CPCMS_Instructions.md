# CPCMS — Build Instructions
## Configurable Production Cycle Management System
## Edgesmith Tooling India Pvt Ltd

---

## WHAT TO BUILD

Choose one of two implementation approaches:

**Option A — Standalone Webapp**
Independent web application running alongside Odoo. Hosted on a local server or cloud. Connects to Odoo only for MO data when needed.

**Option B — Odoo Module**
Custom module installed into the existing Odoo instance. Appears as a dedicated app inside Odoo. Uses Odoo's database, user management, and framework.

Pick whichever fits the scale and requirements below. Justify the choice briefly at the top of the code.

---

## SCALE

- 12,000 active UIDs simultaneously at Dharmapuri
- Multiple concurrent users reading and writing
- Two locations — Faridabad and Dharmapuri — on the same system
- Real-time floor display at Dharmapuri refreshing frequently
- Full history retained for every UID, batch, furnace run, and material record permanently
- A proper database backend is required

---

## THE TWO LOCATIONS

### Faridabad — raw material intake and joining. No UIDs.

Faridabad receives raw steel from suppliers, joins two materials into composite billets, and dispatches to a third party rolling contractor. The rolling contractor sends finished billets directly to Dharmapuri. Faridabad never sees the material again after dispatch to the roller. Faridabad tracks at batch level only. No individual piece tracking. No UIDs.

### Dharmapuri — production floor. All UIDs born here.

Dharmapuri receives rolled composite billets from the rolling contractor. First operation (BSW-01) cuts each billet into 2 or 3 pieces. Each piece is immediately assigned a UID. From that point every piece is tracked individually through all remaining operations.

---

## MATERIAL FLOW — END TO END

```
FARIDABAD

  Two raw materials received separately:
  ├── Alloy Steel bars — Supplier A — with heat number and grade
  └── MS (Mild Steel) bars — Supplier B — with heat number and grade

  Same-size bars joined in-house at Faridabad (welding)
  → One composite billet per join: alloy steel + MS bonded together
  → Logged: operator, date, alloy heat number, MS heat number

  Joined billets dispatched to Third Party Rolling Contractor
  → Admin logs: contractor name, date dispatched

  Rolling contractor processes and sends directly to Dharmapuri
  → Faridabad does not receive material back
  → No confirmation required on Faridabad side

---

DHARMAPURI

  Receives rolled composite billets from rolling contractor
  → Receiving event: Faridabad batch reference, date received,
    billet count, condition, received by
  → One Faridabad batch can arrive in multiple receiving runs

  BSW-01 — each billet cut into 2 or 3 pieces
  → Each piece assigned a UID immediately
  → Each UID permanently carries:
       Faridabad batch reference
       Alloy steel: supplier, grade, heat number
       MS: supplier, grade, heat number
       Rolling contractor name
       Receiving event date

  From BSW-01 onward — 26-step individual UID tracking
```

---

## FARIDABAD — WHAT THE SYSTEM TRACKS

### Raw material intake

Two separate intake records per batch — one for alloy steel, one for MS.

Each intake record:
- Material type (Alloy Steel / MS)
- Supplier name
- Heat number (steel mill's melt/cast reference from material test certificate — identifies the exact furnace run the steel came from, critical for downstream traceability)
- Steel grade
- Weight received (kg)
- Date received
- Number of bars
- Bar dimensions (mm)

### Joining operation

Each joining event logged:
- Alloy steel intake reference
- MS intake reference
- Number of billets produced
- Operator
- Date
- Output billet dimensions (mm)
- Output billet count

One alloy steel bar + one MS bar of matching size = one composite billet.

### Dispatch to rolling contractor

Each dispatch logged:
- Internal batch reference number
- Rolling contractor name (from Admin-managed contractor list)
- Number of billets dispatched
- Date dispatched
- Billet dimensions

Faridabad tracking ends here.

---

## DHARMAPURI — RECEIVING EVENT

When billets arrive from rolling contractor:
- Faridabad batch reference
- Rolling contractor name
- Date received
- Number of billets in this run
- Condition on arrival
- Received by

One Faridabad batch can have multiple receiving events over time.

---

## BSW-01 — UID CREATION

When a billet is loaded onto BSW-01:
- Operator selects receiving event and specific billet
- Selects number of pieces to cut (2 or 3)
- Selects cycle type for each resulting piece
- System generates required UIDs in sequence
- Each UID linked to billet, receiving event, and Faridabad batch
- Both heat numbers carried on every UID permanently

Physical UID stamping happens at Step 2 (RCV-01) but system record is created at BSW-01.

---

## THE PRODUCTION CYCLE

### What a cycle is

A named sequence of manufacturing operations at Dharmapuri. EAT, SWAN, and OVEN exist today. More added by Admin without code changes. All cycles use the same workstations in different orders.

### Cycle versioning

Edits saved as a new version. UIDs in production follow the version active when they were created. New UIDs pick up the latest version. Full version history viewable.

### Cycle import and export

Admin exports any cycle definition to a file. Another Admin imports it — system validates, previews steps, imports as new or updates existing.

### The EAT cycle — 27 steps

| Step | Operation | Workstation | From Storage | To Storage |
|---|---|---|---|---|
| 1 | Band Saw Cutting | BSW-01 | RM | RM-Q |
| 2 | UID Tagging | RCV-01 | RM-Q | RM-D |
| 3 | Straightening | STR-MAN | RM-D | MC-Q |
| 4 | Bunch Grinding | SG-DLT | MC-Q | MC-Q |
| 5 | OP10 Rough Mill | MM22 | MC-Q | MC-D |
| 6 | Hardening | HT70 | MC-D | HT-Q |
| 7 | Quenching | HT80 | HT-Q | HT-Q |
| 8 | Straightening HYD | STR-HYD | HT-Q | HT-Q |
| 9 | Tempering 1 | HT90 | HT-Q | HT-Q |
| 10 | Tempering 2 | HT90 | HT-Q | HT-D |
| 11 | Straighten Post-HT | STR-HYD | HT-D | MC-Q |
| 12 | Surface Grind 1 | SG-DLT | MC-Q | MC-D |
| 13 | Anti-rust Coat | PRO | MC-D | MC-D |
| 14 | Tempering 3 | HT90 | MC-D | HT-Q |
| 15 | Straighten Manual | STR-MAN | HT-Q | QC-Q |
| 16 | Converting | BSW-02 | QC-Q | QC-Q |
| 16B | Child UID Marking | RCV-01 | QC-Q | QC-Q |
| 17 | OP20 Semi-finish Mill | MM11 | QC-Q | MC-Q |
| 18 | OP30 Finish Mill | MM11 | MC-Q | MC-D |
| 19 | Straighten Post-OP30 | STR-MAN | MC-D | QC-Q |
| 20 | Surface Grind 2 | SG-DLT | QC-Q | MC-D |
| 21 | Anti-rust Coat 2 | PRO | MC-D | MC-D |
| 22 | Bevel Grinding | AG-ALP | MC-D | MC-D |
| 23 | Tempering 4 — Stress Relief | HT90 | MC-D | HT-Q |
| 24 | Final Anti-rust | PRO | HT-Q | QC-Q |
| 25 | Final Straightening | STR-MAN | QC-Q | QC-D |
| 26 | QC Inspection | HRC-01 | QC-D | QC-D |
| 27 | Packing and Dispatch | PKG | QC-D | FG |

SWAN and OVEN steps configured by Admin.

---

## TEMPERING OPERATIONS — SPECIAL HANDLING

All four tempering steps run on the same furnace (HT90) at different temperatures and soak times. Each has its own Admin-configured process parameters.

### Four tempering steps

| Step | Name | Purpose |
|---|---|---|
| 9 | Tempering 1 | First tempering after hardening and quenching |
| 10 | Tempering 2 | Second tempering — same furnace, different parameters |
| 14 | Tempering 3 | Third tempering after first machining phase |
| 23 | Tempering 4 — Stress Relief | Stress relief after bevel grinding |

### Process parameters — Admin controlled

Each tempering step has its own parameters defined per cycle type. Only Admin can set or change these. Operators and Supervisors cannot modify them.

Parameters per tempering step per cycle type:
- Target temperature (°C)
- Target soaking time (minutes)

If Admin changes parameters, historical records of completed steps retain the parameters that were applied at that time. Changes only affect future runs.

### Furnace batch

When Supervisor triggers a tempering run:
- System auto-generates a furnace batch number (e.g. HT90-2024-441)
- Multiple UIDs are grouped into this furnace batch
- One furnace batch has one start time, one end time, one set of actual parameters recorded
- Every UID in the batch carries the furnace batch number on its step log entry
- Looking up a furnace batch number shows all UIDs that were in that run
- Looking up any UID shows which furnace batch it went through at each tempering step

### What is recorded per furnace batch

- Furnace batch number (auto-generated)
- Tempering step (Tempering 1 / 2 / 3 / 4)
- Cycle type of UIDs in this batch
- Target temperature (from Admin config)
- Target soaking time (from Admin config)
- Actual temperature achieved (entered by operator)
- Actual soaking time held (entered by operator)
- Start time and end time
- Operator who ran the furnace
- All UIDs included in this batch
- Any deviation flag (system auto-flags if actual vs target exceeds tolerance)

If operator marks the batch done without entering actuals, system records target values as applied and marks actuals as not recorded.

### Deviation tolerance

Admin sets acceptable deviation tolerance per tempering step:
- Temperature tolerance: ± N°C
- Soaking time tolerance: ± N minutes

If actual values fall outside tolerance, system flags the furnace batch and all UIDs in it for Supervisor review.

---

## CRITICAL EVENTS IN THE CYCLE

### Converting — Step 16

BSW-02 cuts a UID piece into 2, 3, or 4 child pieces.

1. Design must be confirmed before Converting proceeds
2. System suggests matching conversion pattern for the UID's size
3. Supervisor accepts, selects a different pattern, or enters fully custom dimensions
4. Each child assigned its own length and cycle type (can differ from parent)
5. Scrap = input length minus sum of child lengths minus (cuts × 3mm kerf). Blocked if negative.
6. On confirm: parent UID frozen, child UIDs created (E042-A, E042-B, E042-C), split event saved, children start at Step 17
7. All material traceability (both heat numbers, Faridabad batch) inherited by every child

### Child UID Marking — Step 16B

After Converting, operator stamps each child UID onto the piece at Work Table (RCV-01) and confirms in system. All children must be confirmed before any proceed to Step 17.

### Design lock

Design must be confirmed before Step 16. System alerts Manager at Step 15 if missing. Hold placed at Step 16 if still missing. Manager confirms design, hold releases automatically. Design locked after Step 17 begins.

---

## CONFIGURATION — WHAT ADMIN CAN CHANGE

### Cycle types
- Add, edit steps, reorder, insert between steps, remove (blocked if UIDs at that step), archive
- Export and import as files
- Full version history per cycle

### Tempering parameters
Per tempering step per cycle type:
- Target temperature (°C)
- Target soaking time (minutes)
- Acceptable deviation tolerance for temperature (±°C)
- Acceptable deviation tolerance for soaking time (±minutes)

Only Admin can set or change these.

### Workstations
- Add: code, name, category, location assignment (Faridabad / Dharmapuri)
- Edit or archive (blocked if UIDs currently assigned)
- Categories: Cutting, Heat Treatment, Machining, Grinding, Coating, QC, Packing, Other
- Current workstations: BSW-01, BSW-02, RCV-01, HT70, HT80, HT90, STR-HYD, STR-MAN, SG-DLT, MM22, MM11, AG-ALP, AG-BTA, AG-GMM, PRO, HRC-01, VCL-200, ISP, PKG

### Rolling contractors
- Add, edit, archive contractor records
- Used in Faridabad dispatch records

### Products
- Add: name, code, valid cycle types, default cycle type

### Sizes
- Add, edit, archive sizes in mm
- Current: 1500, 1424, 2750

### Designs
Design is the unified concept for all product specifications — drawing number, profile, bevel angle, surface finish, and any other product-defining attributes. No separate attribute concept exists.

Each design record:
- Drawing number or design code (Plain, 9/8534, 9/5032)
- Description and specification notes
- Which sizes are valid for this design

Current valid size-design combinations:
- 1500mm: Plain, 9/8534
- 1424mm: Plain, 9/5032
- 2750mm: Plain, 9/8534, 9/5032

System validates and blocks invalid combinations.

### Conversion patterns for Step 16
- Add, edit, archive standard patterns
- Each pattern: name, input length (mm), child lengths (mm list), cuts (auto), scrap (auto)
- Kerf fixed at 3mm per cut
- Current: Pattern A (4500→1500+1500+1424, 67mm scrap), Pattern B (3000→1500+1424, 70mm scrap)

### Storage locations
- Add per location, edit, archive
- Current Dharmapuri: RM, RM-Q, RM-D, HT-Q, HT-D, MC-Q, MC-D, QC-Q, QC-D, FG

### Batch rules
Per step per cycle: capacity type and value, minimum batch size, selection rule (priority-FIFO / strict FIFO / dimension-match with tolerance mm), cycle type mixing, trigger mode (auto / manual). Admin sets defaults. Manager and Supervisor can override per instance.

---

## THE UID

Format: 1 letter + 3 digits. Example: E043.
- EAT starts on E, SWAN on S, OVEN on O
- Counter 001 to 999 then advances to next available letter not used by another active cycle
- System auto-assigns. Operator inputs cycle type and quantity only.
- Physically stamped onto each piece at Step 2 (RCV-01)

### What a UID permanently carries

**Material origin:**
- Faridabad batch reference
- Alloy steel: supplier, grade, heat number
- MS: supplier, grade, heat number
- Rolling contractor name
- Receiving event date at Dharmapuri

**Production record:**
- Cycle type and version followed
- Every step: operation, workstation, operator, date, QC result
- For every tempering step: furnace batch number, target parameters, actual parameters, deviation flag if any
- Current step and storage location (if still in production)
- Product type, size, design
- Priority and linked MO
- Parent UID if split, with full lineage
- All sibling UIDs from the same billet

### Bulk UID creation
- Manager selects quantity, cycle type, and optionally: product type, size, design, priority, MO
- System generates next available UIDs in sequence
- Full list shown for confirmation before committing
- Printable and exportable list for tagging station
- Cycle type changeable in bulk before any steps begin

---

## MANUFACTURING ORDERS

MO = confirmed customer sales order: MO number, customer, quantity, size, design. Fully independent of production. Linked at any time. One MO to many UIDs. One UID to at most one MO. Manager action only. System optionally copies size and design from MO to UID when linked.

---

## SERVICE CALL LOOKUP

Any UID stamped on a product in the field returns the complete lifetime record:

**Material origin:**
- Faridabad batch reference
- Alloy steel: supplier, grade, heat number
- MS: supplier, grade, heat number
- Rolling contractor name and dispatch date
- Date received at Dharmapuri

**Production history:**
- Every step: operation, workstation, operator, date, QC result
- For every tempering step: furnace batch number, target temperature and soak time, actual temperature and soak time achieved, any deviation flags
- QC inspection results from Step 26
- Date of dispatch and MO it shipped against
- If split from parent: parent UID and full lineage, all sibling UIDs

Read-only. UID alone retrieves everything — no need to know factory, cycle type, or product type. Record is permanent and cannot be deleted or modified.

---

## USER ROLES

**Admin** — full access across both locations. All configuration including tempering parameters, contractors, workstations, cycle types, products, sizes, designs, deviation tolerances.

**Manager** — bulk UID creation, priority, design confirmation, MO linking and creation, all reports. Faridabad batch entry and dispatch logging.

**Supervisor** — floor monitoring, furnace batch creation and triggering, actual parameter entry for furnace runs, Converting, batch approval, QC sign-off. Receives deviation alerts.

**Operator** — step completion and QC logging. Marks furnace batch done and enters actual temperature and soak time achieved.

**Service** — read-only UID lookup for dispatched products. Field service use only.

**Shopfloor View** — read-only wall display at Dharmapuri. No login required.

---

## WHAT THE SYSTEM MUST DO

1. Track Faridabad batches — both raw material intakes with heat numbers, joining operation, rolling contractor dispatch

2. Receive billets at Dharmapuri — link to Faridabad batch, support multiple receiving runs per batch

3. Create UIDs at BSW-01 — each billet cut into 2 or 3 pieces, each UID carrying both heat numbers and full material origin

4. Track 12,000 UIDs simultaneously through configurable 27-step cycle with full permanent history

5. Manage four tempering steps on HT90 with Admin-configured target parameters per step per cycle type, furnace batch grouping, actual parameter logging, and automatic deviation flagging

6. Auto-generate furnace batch numbers when Supervisor triggers a tempering run, group UIDs into that batch, and carry the batch reference on every UID's step log

7. Let Admin configure everything — cycles, steps, sequence, workstations, tempering parameters and tolerances, products, sizes, designs, conversion patterns, batch rules, contractors — without code changes

8. Export and import cycle definitions as files

9. Generate UIDs in bulk with confirmation list and printable output

10. Allow cycle type change in bulk before any steps begin

11. Support Converting — split one UID into 2-4 children each on their own cycle type, scrap auto-calculated from configurable patterns or custom input, all material traceability inherited by children

12. Hold UIDs when design is missing at Step 16, release when Manager confirms

13. Link MOs to UIDs at any time

14. Provide service call lookup — UID returns full manufacturing and material history including both heat numbers, all furnace batches, target vs actual tempering parameters

15. Show real-time Dharmapuri floor status — UIDs at each workstation, counts per storage location

16. Cross-location reports — Faridabad batch status linked to Dharmapuri UID production

17. Shopfloor display for Dharmapuri wall screens

---

## WHAT THE SYSTEM MUST NOT DO

- Replace Odoo for accounting, purchasing, inventory quantities, or HR
- Delete or modify any UID, batch, furnace batch, step history, or material record at any time
- Send customer communications

---

## ODOO RELATIONSHIP

MO numbers originate in Odoo. Entered manually for now. Design the data layer so Odoo sync can be added later without restructuring the core.

---

## KEY CONSTRAINTS

Cycle edits never affect UIDs already in production. In-progress UIDs follow the cycle version they started on. New UIDs get the latest version. Version history always viewable.

Tempering parameter changes never alter historical furnace batch records. Completed runs retain the parameters that were active at the time they ran.


---

## WORKSTATION UNITS AND STEP CAPACITY

### Physical machine units

Every workstation type can have multiple physical units. Each unit is registered separately in Master Lists by Admin.

A workstation unit record contains:
- Unit code (e.g. MM22-1, MM22-2, HT90-1)
- Parent workstation code (MM22, HT90 etc.)
- Unit name or description
- Location (Faridabad / Dharmapuri)
- Status (active / under maintenance / archived)

The workstation code (MM22) is used in cycle step definitions. The individual units are managed separately and pooled under that code.

### Capacity per step per workstation

When Admin configures a step in the Cycle Builder, they set the capacity for that step against the workstation assigned to it. Capacity is defined as the number of UIDs (pieces) that can be processed simultaneously at that workstation for that specific step.

Capacity is set per step — not globally per workstation. The same workstation can have different capacities at different steps because fixture changes, setup differences, or operation type affect how many pieces can run at once.

Examples from EAT cycle:
- Step 4 (Bunch Grinding, SG-DLT): 10 pieces per run (magnetic chuck capacity)
- Step 5 (OP10 Rough Mill, MM22): 1 piece per unit at a time
- Step 6 (Hardening, HT70): 40 pieces per furnace run (weight-based)
- Step 12 (Surface Grind 1, SG-DLT): 6 pieces per run (different fixture)

### How total capacity is calculated

Total simultaneous capacity for a step = capacity per unit × number of active units of that workstation at that location.

Example: MM22 has 2 units at Dharmapuri. Step 5 capacity = 1 per unit. Total = 2 UIDs can be processed simultaneously at Step 5 — one on each MM22 unit.

Job is assigned to the workstation code (MM22). System automatically selects whichever unit is currently available. Operator is told to go to MM22 — system tracks which unit they are on based on which unit is free when they start.

### What this drives

Step capacity directly controls:
- Maximum batch size for that step
- How many jobs can be assigned and running simultaneously at that workstation
- Queue depth display (how many UIDs waiting vs how many slots available)
- Auto-assignment logic (system will not assign more jobs than available capacity)


---

## GRINDING MACHINE BATCH RULES

Four grinding machines are used across surface grinding and angle grinding steps. Each machine has a maximum bar length it can accommodate. Batch grouping at grinding steps is determined by bar length against machine capacity.

### Machine length limits

| Machine Code | Name | Maximum bar length |
|---|---|---|
| SG-DLT | Surface Grinder Delta | 3000mm |
| AG-GMM | Angle Grinder Gamma | 3000mm |
| AG-BTA | Angle Grinder Beta | 1500mm |
| AG-ALP | Angle Grinder Alpha | 1500mm |

### Batching rule

The rule for grouping bars into a batch at any grinding step is: **total combined length of all bars in the batch must not exceed the machine's maximum length**.

No same-length requirement. Bars of different lengths can be paired together as long as their combined length fits within the machine capacity.

Examples for Delta and Gamma (3000mm capacity):
- 1500 + 1500 = 3000mm ✓ valid batch
- 1500 + 1424 = 2924mm ✓ valid batch
- 1424 + 1424 = 2848mm ✓ valid batch
- 2750 alone = 2750mm ✓ valid (no room to add another bar)
- 2750 + any bar = exceeds 3000mm ✗ blocked

Beta and Alpha (1500mm capacity): only bars of 1500mm or 1424mm, one bar at a time.

### Machine assignment by bar length

A bar is only assignable to a machine if its length does not exceed the machine's maximum:
- 2750mm bars: Delta or Gamma only
- 1500mm bars: any machine (Delta, Gamma, Beta, Alpha)
- 1424mm bars: any machine (Delta, Gamma, Beta, Alpha)

System enforces this at job assignment — a 2750mm bar cannot be assigned to Beta or Alpha.

### Batch decision timing

Grinding batches are decided dynamically just before the operation runs, not pre-configured. The Supervisor reviews what bars are queued for the grinding step and groups them into batches based on the length rule above. System shows available pairings — which bars can be combined on which machine — and Supervisor confirms the grouping.

This applies to:
- Step 4 — Bunch Grinding (SG-DLT)
- Step 12 — Surface Grind 1 (SG-DLT)
- Step 20 — Surface Grind 2 (SG-DLT)
- Step 22 — Bevel Grinding (AG-ALP, AG-BTA, AG-GMM)


---

## BUNCH GRINDING BATCH RULES (Step 4 — SG-DLT)

Bunch grinding is physically different from surface and angle grinding. Bars are placed **side by side** (bunched) on the magnetic chuck, not end to end. Sets of bars are then placed end to end along the 3000mm machine bed.

### Definitions

- **Set:** a group of bars placed side by side on the chuck. All bars in one set must be the same length. Admin configures how many bars make one set. Default: **5 bars per set**.
- **Machine bed length:** 3000mm — total length available along the bed axis.
- **Run:** one complete bunch grinding operation. A run can contain one or two sets depending on bar length.

### How sets fit on the machine

Sets are placed end to end along the 3000mm bed:

| Bar length | Sets per run | Total bars per run |
|---|---|---|
| 1500mm | 2 sets (1500 + 1500 = 3000mm) | 10 bars |
| 1424mm | 2 sets (1424 + 1424 = 2848mm ≤ 3000mm) | 10 bars |
| 2750mm | 1 set (2750mm ≤ 3000mm, no room for second) | 5 bars |

### Set size is configurable

Admin can change the number of bars per set at any time from the Master Lists or Cycle Builder configuration. The default is 5. Changing this takes effect on the next batch — in-progress batches are not affected.

### Batch decision timing

Same as other grinding steps — decided dynamically by Supervisor just before the operation based on which bars are queued and their lengths. System auto-suggests groupings based on bar length and set size configuration.

### All bars in a set must be the same length

Sets are same-length. The two sets in a run can be different lengths if both fit within 3000mm — but each individual set is bars of identical length bunched together.


---

## STEP CAPACITY — COMPLETE RULES

Capacity is the number of UIDs (bars) that can be processed simultaneously at each step. Set per step in the Cycle Builder. Admin can change any capacity value at any time without code changes. Changes take effect on the next batch — in-progress batches are not affected.

### Capacity by step

| Step | Operation | Workstation | 1500mm | 1424mm | 2750mm |
|---|---|---|---|---|---|
| 1 | Band Saw Cutting | BSW-01 | 1 | 1 | 1 |
| 2 | UID Tagging | RCV-01 | 1 | 1 | 1 |
| 3 | Straightening | STR-MAN | 1 | 1 | 1 |
| 4 | Bunch Grinding | SG-DLT | length-based batch | length-based batch | length-based batch |
| 5 | OP10 Rough Mill | MM22 | 1 | 1 | 1 |
| 6 | Hardening | HT70 | 6 | 6 | 3 |
| 7 | Quenching | HT80 | 6 | 6 | 3 |
| 8 | Straightening HYD | STR-HYD | 1 | 1 | 1 |
| 9 | Tempering 1 | HT90 | 80 | 80 | 43 |
| 10 | Tempering 2 | HT90 | 80 | 80 | 43 |
| 11 | Straighten Post-HT | STR-HYD | 1 | 1 | 1 |
| 12 | Surface Grind 1 | SG-DLT | length-based batch | length-based batch | length-based batch |
| 13 | Anti-rust Coat | PRO | 1 | 1 | 1 |
| 14 | Tempering 3 | HT90 | 80 | 80 | 43 |
| 15 | Straighten Manual | STR-MAN | 1 | 1 | 1 |
| 16 | Converting | BSW-02 | 1 | 1 | 1 |
| 16B | Child UID Marking | RCV-01 | 1 | 1 | 1 |
| 17 | OP20 Semi-finish Mill | MM11 | 1 | 1 | 1 |
| 18 | OP30 Finish Mill | MM11 | 1 | 1 | 1 |
| 19 | Straighten Post-OP30 | STR-MAN | 1 | 1 | 1 |
| 20 | Surface Grind 2 | SG-DLT | length-based batch | length-based batch | length-based batch |
| 21 | Anti-rust Coat 2 | PRO | 1 | 1 | 1 |
| 22 | Bevel Grinding | AG-ALP/BTA/GMM | length-based batch | length-based batch | length-based batch |
| 23 | Tempering 4 — Stress Relief | HT90 | 80 | 80 | 43 |
| 24 | Final Anti-rust | PRO | 1 | 1 | 1 |
| 25 | Final Straightening | STR-MAN | 1 | 1 | 1 |
| 26 | QC Inspection | HRC-01 | 1 | 1 | 1 |
| 27 | Packing and Dispatch | PKG | 1 | 1 | 1 |

### Capacity scaling rule for furnace steps

Furnace capacity (HT70, HT80, HT90) scales proportionally by bar length:

**Formula:** capacity for size X = floor(base_capacity × (base_length / X))

Where base is 1500mm:
- HT70 / HT80: base 6 bars at 1500mm → 2750mm = floor(6 × 1500/2750) = **3 bars**
- HT90: base 80 bars at 1500mm → 2750mm = floor(80 × 1500/2750) = **43 bars**
- 1424mm bars: floor(6 × 1500/1424) = floor(6.33) = **6 bars** (same as 1500mm)
- 1424mm tempering: floor(80 × 1500/1424) = floor(84.3) = **80 bars** (same as 1500mm)

The system calculates this automatically when a batch is being formed — Admin sets the base capacity at 1500mm, system derives the other sizes.

### Admin control in Cycle Builder

In the Cycle Builder, each step shows its capacity configuration:
- For fixed capacity steps (1 at a time): simple number input, defaults to 1
- For furnace steps (HT70, HT80, HT90): base capacity input at 1500mm, system shows calculated values for 1424mm and 2750mm automatically
- For grinding steps (SG-DLT, AG-ALP, AG-BTA, AG-GMM): capacity governed by grinding machine length rules — no fixed number, shows "length-based" with link to grinding configuration
- For bunch grinding (SG-DLT Step 4): shows set size configuration (default 5 bars per set)

Admin can change any capacity value at any time. Change is versioned with the cycle — in-progress UIDs follow the capacity rules that were active when their batch was formed.

