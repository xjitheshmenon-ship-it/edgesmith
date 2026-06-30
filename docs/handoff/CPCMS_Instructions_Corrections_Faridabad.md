# CPCMS — Faridabad Model Corrections
## To be merged into CPCMS_Instructions.md and CPCMS_Page_Instructions.md
## Edgesmith Tooling India Pvt Ltd

---

## SUMMARY OF WHAT CHANGED

This document corrects and extends the Faridabad operating model. Five corrections:

1. Terminology: **block** (Faridabad output) and **plate** (Dharmapuri BSW-01 output) — not "billet" / "piece"
2. Cycle type (EAT / SWAN / OVEN) is determined by the **alloy steel grade at intake**, not chosen later by a Supervisor at BSW-01
3. All plates cut from one block share the same cycle type — no per-plate cycle type choice at BSW-01
4. Faridabad operations are performed **individually** (one block at a time) — batching happens only at dispatch
5. The **batch record is created at Contractor Dispatch**, sized to one truck load — Admin configures truck capacity. Blocks waiting between operations are tracked individually with full heat number traceability, not yet grouped into a batch.
6. Faridabad has its **own workstations and its own cycle**, separate from Dharmapuri's, to be defined later through the same Cycle Builder and Master Lists tools. Both locations must support adding new workstations and operations at any time — this is not a one-time setup restricted to initial build.

---

## CORRECTION 1 — TERMINOLOGY

Replace throughout:

| Old term | Correct term |
|---|---|
| Billet (Faridabad output, pre-Dharmapuri) | **Block** |
| Piece (Dharmapuri BSW-01 output) | **Plate** |

The flow is now: Alloy steel + MS → joined → **block** → rolled by contractor → received at Dharmapuri → cut at BSW-01 into 2–3 **plates** → each plate becomes one UID.

---

## CORRECTION 2 — CYCLE TYPE DETERMINED BY ALLOY STEEL AT INTAKE

### Rule

The cycle type (EAT, SWAN, or OVEN) is determined by the **alloy steel grade/specification** received at Faridabad Raw Material Intake. It is not a free choice made later.

When alloy steel arrives, its grade identifies which cycle type it belongs to. This is fixed from the point of intake and carries through every subsequent step:

```
Alloy steel intake (grade determines cycle type: EAT / SWAN / OVEN)
  ↓ cycle type fixed
Joining (MS joined to this alloy steel — block inherits cycle type)
  ↓
Dispatch (batch inherits cycle type)
  ↓
Rolling contractor
  ↓
Dharmapuri Receiving (cycle type already known from batch)
  ↓
BSW-01 — block cut into 2–3 plates — ALL PLATES SAME CYCLE TYPE
  ↓
Each plate becomes one UID in that cycle type
```

### What this changes from earlier instructions

Earlier instructions stated the Supervisor selects cycle type per resulting plate at BSW-01, allowing different plates from the same block to be assigned different cycle types. **This is no longer correct.**

**Corrected rule:** All plates cut from one block share the same cycle type — inherited from the block, which inherited it from the alloy steel grade at Faridabad intake. There is no per-plate cycle type selection at BSW-01.

### Admin configuration needed

Admin must maintain a mapping of alloy steel grade → cycle type in Master Lists, e.g.:

| Alloy Steel Grade | Cycle Type |
|---|---|
| Grade A1 | EAT |
| Grade B2 | SWAN |
| Grade C3 | OVEN |

When Manager logs a Raw Material Intake for alloy steel, selecting the grade automatically determines and displays the cycle type — read-only, not separately selectable.

### Note — this does not affect Converting (Step 16)

At Step 16 (Converting) at Dharmapuri, child UIDs created from a split **can still be assigned different cycle types from the parent**. That rule is unchanged — it applies after a UID already exists and is being further subdivided. The correction above only affects the very first cycle type assignment that happens when plates are created at BSW-01 from a Faridabad block.

---

## CORRECTION 3 — FARIDABAD OPERATIONS ARE INDIVIDUAL, BATCHING HAPPENS AT DISPATCH

### Rule

Operations at Faridabad (Joining, and any future Faridabad steps) are performed **individually — one block at a time**. There is no batching at the operation level.

Blocks accumulate in a holding area after processing. They remain individually tracked — each with its own alloy heat number, MS heat number, dimensions, and processing history — but are **not yet grouped into a batch**.

### Batch is created at Contractor Dispatch — not at Joining

The batch record (previously referred to as a "Joining Batch," e.g. FAR-JOIN-2024-041) is corrected to be a **Dispatch Batch**, created at the point a truck is loaded and dispatched to the rolling contractor.

```
Block 1 (joined individually) ──┐
Block 2 (joined individually) ──┤
Block 3 (joined individually) ──┼── accumulate in holding area, tracked individually
...                              │
Block N (joined individually) ──┘
                                  │
                  Truck capacity reached (Admin-configured)
                                  ↓
                  TRUCK LOADED → BATCH CREATED AT THIS POINT
                  (batch reference generated, e.g. FAR-DISP-2024-061)
                  All blocks on this truck become one batch
                                  ↓
                  Dispatched to rolling contractor
```

### Truck capacity — Admin configured

Admin sets the truck capacity (maximum block count or weight per truck) in Master Lists. This determines when a dispatch batch is "full" and ready to send.

Manager/Supervisor at Faridabad can also dispatch a partial truck (fewer blocks than full capacity) if needed — this is a normal dispatch, just with a smaller batch size, not a threshold override requiring special permission (unlike the Dharmapuri furnace minimum, which is a hard production constraint).

### What this changes from earlier instructions

Earlier instructions described the "Joining Operation" page as creating a joining batch reference at the point of joining, with multiple blocks joined "in this run" forming one batch. **This is no longer correct.**

**Corrected model:**
- Joining Operation page logs each block individually as it is joined (one alloy steel intake + one MS intake → one block, with its own block reference, not a batch reference)
- Blocks sit in a holding inventory after joining, individually tracked
- Contractor Dispatch page is where Manager selects blocks from the holding inventory to load onto a truck, and this is where the batch record is actually created
- The batch reference number (FAR-DISP-2024-NNN) is generated at dispatch, not at joining

---

## CORRECTION 4 — FARIDABAD HAS ITS OWN WORKSTATIONS AND CYCLE

### Rule

Faridabad has its own set of workstations and its own operation sequence (a "cycle" in the same structural sense as EAT/SWAN/OVEN at Dharmapuri) — but this is a **separate set from Dharmapuri's workstations and cycles**. The specific workstations and steps for Faridabad are not yet defined and will be entered later through the same configuration tools.

### Structure of the Faridabad cycle

The Faridabad cycle behaves the same way as a Dharmapuri cycle structurally:
- Versioned — editing creates a new version, in-progress work follows the version active when it started
- Has steps in sequence
- Each step has a workstation
- Each step has source/destination storage — **not yet named, must be configurable** (Faridabad's storage locations are not the same RM/RM-Q/HT-Q/MC-Q/QC-Q/FG codes used at Dharmapuri; Admin defines Faridabad's own storage location codes, e.g. could be "Intake Bay," "Weld Bay," "Holding Yard," "Dispatch Yard" — names to be decided when Faridabad's cycle is actually configured)

### Key difference from Dharmapuri's cycle

No UID moves through the Faridabad cycle. Instead, **individual blocks** move through Faridabad's steps one at a time (per Correction 3), and only become a **batch** at the Dispatch step. The Faridabad cycle therefore tracks block-level progress per step, not UID-level progress.

### Admin configuration needed (when ready)

When Faridabad's actual operations are defined, Admin will:
1. Add Faridabad's workstations in Master Lists (location: Faridabad)
2. Add Faridabad's storage locations in Master Lists (location: Faridabad)
3. Build the Faridabad cycle in Cycle Builder — same tool used for EAT/SWAN/OVEN, with a new cycle type scoped to Faridabad
4. Set capacity per step if relevant (e.g. if a Faridabad workstation processes more than one block at a time)

### Dharmapuri also remains fully extensible

This correction also confirms — not as something new, but as an explicit requirement — that **Dharmapuri's workstations and cycle steps must also remain fully extensible at any time**, not fixed after initial setup. Admin can add new workstations or new operations to the EAT/SWAN/OVEN cycles (or define entirely new cycle types) whenever needed, using the same Cycle Builder and Master Lists tools already specified. This was implicit in the original instructions but is now stated explicitly to avoid any assumption that the current 27-step EAT cycle or current 19 workstations are a fixed, final list.

---

## PAGE INSTRUCTION CHANGES REQUIRED

### Page 2 — Raw Material Intake (Faridabad)

Add: when logging an alloy steel intake, Manager selects the alloy steel **grade**, and the system automatically displays the resulting **cycle type** (EAT/SWAN/OVEN) as a read-only field, derived from the Admin-configured grade-to-cycle-type mapping in Master Lists.

### Page 3 — Joining Operation (Faridabad)

Correct the page to reflect individual, not batch, processing:
- Each joining event creates **one block record** (not a batch of multiple blocks)
- Block record carries: alloy steel intake reference, MS intake reference, cycle type (inherited from alloy steel grade), operator, date, output block dimensions
- Remove "number of blocks to be joined in this run" as a batch quantity field — replace with single-block logging, repeated as each weld is performed
- Add a "Block Holding Inventory" view showing all individually joined blocks not yet dispatched, filterable by cycle type, with running count toward truck capacity

### Page 4 — Contractor Dispatch (Faridabad)

This is now where the batch is actually created:
- Manager/Supervisor selects blocks from the Block Holding Inventory to load onto a truck
- System shows progress toward configured truck capacity (e.g. "38 / 50 blocks — truck capacity")
- Manager can dispatch at full capacity or dispatch a partial load
- On confirm: **batch reference generated here** (e.g. FAR-DISP-2024-061), all selected blocks become part of this batch, dispatch record created
- This batch reference is what flows to Dharmapuri Receiving — not a joining batch reference

### Page 6 — UID Creation (BSW-01 — Dharmapuri)

Remove "cycle type" as a per-plate selectable field. Cycle type is now inherited automatically from the block (which inherited it from the Faridabad batch, which inherited it from the alloy steel grade). All plates cut from one block show the same cycle type, displayed read-only.

### New pages needed for Faridabad (once Faridabad's cycle is defined)

When Faridabad's own workstations and cycle are configured, Faridabad will need its own versions of:
- **Faridabad Production Floor** — Supervisor's live view of Faridabad workstations, blocks in progress, queues (block-level, not UID-level)
- **Faridabad My Workstation** — Operator's view of their assigned Faridabad workstations
- **Faridabad Job Assignment** — Supervisor assigns Faridabad workstations to Faridabad operators
- **Faridabad Shift Management** — same structure as Dharmapuri, scoped to Faridabad

These follow the same page patterns already specified for Dharmapuri's equivalents, adjusted for block-level rather than UID-level tracking. Full detail to be written once Faridabad's workstations and cycle steps are provided.

### Master Lists — additions needed

- **Alloy steel grade → cycle type mapping** (new sub-section)
- **Truck capacity configuration** (new sub-section — max blocks or weight per truck)
- **Faridabad workstations** (extends existing workstation management, location-scoped)
- **Faridabad storage locations** (extends existing storage location management, location-scoped, names not yet defined)

### Cycle Builder — confirm location scoping

Cycle Builder must allow creating a cycle scoped to Faridabad, structurally identical to how EAT/SWAN/OVEN are built for Dharmapuri, but tracking blocks rather than UIDs through its steps.

