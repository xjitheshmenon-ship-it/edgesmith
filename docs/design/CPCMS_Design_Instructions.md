# CPCMS — Design Instructions
## For Claude Design
## Edgesmith Tooling India Pvt Ltd
## cpcms.edgesmith.in

---

## WHAT YOU ARE DESIGNING

A production floor management web application called CPCMS (Configurable Production Cycle Management System) for Edgesmith Tooling India. The system tracks individual steel bars through a 27-step manufacturing cycle across two locations — Faridabad and Dharmapuri.

This is an industrial operations tool used daily by factory managers, supervisors, and shop floor operators on desktops, tablets, and mobile phones. The design must be functional, data-dense, and readable under factory conditions.

---

## BRAND

**Company:** Edgesmith Tooling India Pvt Ltd
**System name:** CPCMS
**Domain:** cpcms.edgesmith.in
**Tagline used in topbar:** INNOVATE · ENGINEER · EXCEL

The brand feel is precision engineering — sharp, structured, industrial. Not a consumer app. Not playful. Think of a control room dashboard combined with a modern SaaS interface.

---

## COLOUR PALETTE

Use this palette exactly. Do not introduce new colours.

| Token | Value | Usage |
|---|---|---|
| Navy deep | #11305F | Topbar background, status bar background, primary dark surface |
| Navy mid | #15366A | Primary text, card headers, strong labels |
| Navy light | #2D6FB5 | Links, interactive elements, info badges |
| Green pale | #EEF2EC | Page background |
| Green light | #D4EECB | Brand accent dot, success highlights |
| Green card | #E3EBDE | Card borders |
| Green muted | #EEF2EA | Dividers within cards |
| White | #FFFFFF | Card backgrounds |
| Text secondary | #5D7188 | Labels, secondary text |
| Text muted | #9BB4D4 | Monospace labels, tertiary text |
| Sidebar muted | #5D7FAE | Sidebar secondary text |
| Blue sky | #CFE0EE | Topbar secondary text |
| Alert red | #E5484D | Hold status, critical alerts, fail states |
| Alert red bg | rgba(229,72,77,.13) | Hold badge backgrounds |
| Orange accent | #D97A2B | Faridabad location colour, pending states, warnings |
| Amber | #F0C674 | In-furnace indicator, amber warnings |
| Green success | #22A06B | Pass states, active/running, connection indicator |
| Green success bg | rgba(34,160,107,.14) | Pass badge backgrounds |

---

## TYPOGRAPHY

Two font families only. Both from Google Fonts.

**Archivo** — headings, brand name, large display numbers, page titles
- Weights used: 700, 800, 900
- Used for: the "edgesmith." wordmark, page section headings, UID codes in detail views, large metric numbers

**IBM Plex Mono** — all data, codes, labels, badges, timestamps, measurements
- Weights used: 400, 500, 600
- Used for: workstation codes (BSW-01, HT90), UID codes (E043), storage locations (MC-Q), step numbers, shift labels, heat numbers, measurements, badge text, section labels in uppercase, any field that shows a code or number

**IBM Plex Sans** — body text, form labels, button text, table content, descriptions
- Weights used: 400, 500, 600, 700
- Used for: everything that is not a heading or a data field

**Rule:** if it is a code, number, identifier, or label in UPPERCASE — IBM Plex Mono. If it is a heading or display number — Archivo. Everything else — IBM Plex Sans.

---

## SHELL LAYOUT

The app has four persistent zones that are always visible:

```
┌─────────────────────────────────────────────────────────────────┐
│  TOPBAR  58px  background: #11305F                              │
├──────────────┬──────────────────────────────────────────────────┤
│              │                                                   │
│   SIDEBAR    │   MAIN CONTENT AREA                              │
│   background │   background: #EEF2EC                            │
│   #11305F    │   scrollable                                      │
│   collapsible│                                                   │
│              │                                                   │
├──────────────┴──────────────────────────────────────────────────┤
│  STATUS BAR  30px  background: #11305F                          │
└─────────────────────────────────────────────────────────────────┘
```

Exception: Shopfloor Display page removes sidebar and topbar. Full screen dark display only.

---

## TOPBAR — 58px height, background #11305F

### Left side (left to right)
1. **Brand block:**
   - "edgesmith." in Archivo 800 20px color #EAF4E4, with the period in #D4EECB
   - Below it: "INNOVATE · ENGINEER · EXCEL" in IBM Plex Mono 8px letter-spacing .16em color #7D96BB
2. **Vertical divider:** 1px wide, 30px tall, color #2C5191
3. **Page context block:**
   - "CPCMS · EDGESMITH TOOLING INDIA" in IBM Plex Mono 8.5px letter-spacing .16em color #5D7FAE
   - Below: current page title in IBM Plex Sans 14px 600 color #CFE0EE

### Centre
Location toggle — three pills: Dharmapuri (blue #3B82F6), Faridabad (orange #D97A2B), Both (muted).
Container: background #0C2750, border-radius 9px, padding 3px.
Active pill: filled background of its colour, white text, border-radius 7px.
Inactive pill: no background, muted text.

### Right side (left to right)
1. **Shift button:** clock icon + "Shift N · HH:MM remaining"
   - Background #0C2750, border-radius 9px
   - Colour changes: green if >2 hours, amber if <2 hours, red if <30 minutes
   - Clicking navigates to Shift Management page
2. **Alert bell button:** 36×36px, background #0C2750, border-radius 9px
   - Bell icon, color #CFE0EE
   - Alert count badge: background #E5484D, white text, IBM Plex Mono 9.5px, positioned top-right of button, border 2px solid #11305F
3. **User block:**
   - Avatar: 32px circle, background #D4EECB, text #11305F, Archivo 700 12.5px — shows user initials
   - Name: IBM Plex Sans 12.5px 600 color #EAF4E4
   - Role: IBM Plex Mono 9px letter-spacing .08em color #9BB4D4
   - Dropdown chevron: color #9BB4D4
4. **Live clock:** IBM Plex Mono 13px 500 color #9BB4D4, fixed width 74px right-aligned

---

## SIDEBAR

Background: #11305F
Width: 220px expanded, 52px collapsed (icon only)
Collapse toggle at top.
No visible scrollbar inside sidebar.

### Top of sidebar
Company logo area — small square icon (background matching nav items) with CPCMS text beside it.

### Role pill
Below brand: a pill showing the current user's role.
Background: slightly lighter than sidebar, border with more opacity.
Left dot in #D4EECB. Role text in IBM Plex Mono uppercase.
"switch" text on right in muted colour — clicking returns to login/role selection.

### Navigation structure

Six sections, each with a section label and items below.

**Section labels:** IBM Plex Mono 9px 700 uppercase letter-spacing .1em color #475569 (dimmed)

**Nav items:**
- Icon (16px) + label (IBM Plex Sans 13px 500)
- Default state: color muted (#64748B equivalent in this palette)
- Hover: background slightly lighter than sidebar, text #EAF4E4
- Active: background slightly lighter, text #EAF4E4, left border 2px solid #D4EECB (the green accent)
- Badge (when items have pending counts): background #D97A2B (orange), white text, IBM Plex Mono 9px, border-radius 4px

**The six nav sections and their items:**

```
OVERVIEW
  Dashboard              [badge: alert count]

FARIDABAD
  Raw Material Intake
  Joining Operation
  Contractor Dispatch    [badge: pending dispatch count]

DHARMAPURI
  Receiving              [badge: expected arrivals]
  UID Creation
  Production Floor       [badge: on-hold UID count]
  Batch Management       [badge: active batches]
  QC                     [badge: pending sign-offs]

MANAGEMENT
  MO Linking             [badge: open MOs]
  Shift Management
  Job Assignment         [badge: unassigned jobs]
  Reports
  Service Lookup

CONFIGURATION
  Cycle Builder
  Master Lists
  Tempering Parameters
  Employee Profiles & Badges  [badge: expiring badges]
  Users & Roles

DISPLAY
  Shopfloor Display      (opens full screen)
```

### Bottom of sidebar
- Shift summary strip: "Shift N · Location · Supervisor name · HH:MM remaining" in IBM Plex Mono 10px
- Skill badge strip for operators and supervisors: small icon badges showing their certifications

---

## STATUS BAR — 30px height, background #11305F

Always visible at the very bottom of every page.
IBM Plex Mono 10.5px, color #9BB4D4.

**Left side (with gaps between each item):**
- Active UIDs: count in #CFE0EE bold
- On hold: count in #FF9B9B bold
- In furnace: count in #F0C674 bold

**Centre:**
- "Shift N · Location · Supervisor Name · HH:MM remaining" in #5D7FAE

**Right side:**
- "Updated Ns ago" — refresh timestamp
- Connection dot: 7px circle, green #22A06B when live, red when offline

---

## CARDS AND SURFACES

All cards: background #FFFFFF, border 1px solid #E3EBDE, border-radius 14px.
Card padding: 18–22px.
Card section headers inside cards: IBM Plex Mono 10px 600 letter-spacing .1em color #9BB4D4 uppercase.
Dividers inside cards: 1px solid #EEF2EA.

**No heavy shadows.** Cards use subtle shadow: `0 1px 3px rgba(21,54,106,.06)`.

**Elevated modals and dropdowns:** `0 18px 40px rgba(21,54,106,.20)`.

---

## TYPOGRAPHY SCALE

| Use | Font | Size | Weight | Color |
|---|---|---|---|---|
| Page section heading | Archivo | 18–20px | 700–800 | #15366A |
| Card title | Archivo | 16px | 700 | #15366A |
| Body / table content | IBM Plex Sans | 13px | 400–500 | #15366A |
| Secondary text | IBM Plex Sans | 12px | 400 | #5D7188 |
| Section labels (caps) | IBM Plex Mono | 9–10px | 600–700 | #9BB4D4 |
| Codes / IDs / badges | IBM Plex Mono | 10–13px | 500–600 | varies |
| Large metric numbers | Archivo | 28–36px | 700–800 | #15366A |
| UID in detail view | Archivo | 34px | 800 | #15366A |
| Form labels | IBM Plex Mono | 9px | 600 | #5D7188 |
| Button text | IBM Plex Sans | 12.5–13px | 600 | varies |

---

## FORM ELEMENTS

**Input fields:**
- Height 44px
- Border: 1.5px solid #D6E0D2
- Border-radius: 11px
- Font: IBM Plex Sans 13px
- Color: #15366A
- Focus state: border-color #2D6FB5, box-shadow 0 0 0 3px rgba(45,111,181,.14)
- Placeholder: color #9BB4D4

**Select dropdowns:** same style as inputs.

**Buttons:**
- Primary action: background #15366A, color #EAF4E4, border-radius 9px, height 36–40px, font IBM Plex Sans 12.5px 600
- Secondary: background #FFFFFF, color #15366A, border 1px solid #D6E0D2, border-radius 9px
- Destructive: background rgba(229,72,77,.13), color #C0392B, border-radius 9px
- Success: background rgba(34,160,107,.14), color #1C7A52, border-radius 9px
- Hover states: darken by 8% or add .08 opacity overlay

---

## BADGES AND STATUS INDICATORS

All badges: IBM Plex Mono, uppercase, font-weight 600, border-radius 20px (pill shape), padding 3px 9px.

| Badge type | Background | Text color |
|---|---|---|
| Active / Running | rgba(34,160,107,.14) | #1C7A52 |
| On Hold | rgba(229,72,77,.13) | #C0392B |
| High priority | rgba(229,72,77,.13) | #E5484D |
| Normal priority | rgba(45,111,181,.14) | #2D6FB5 |
| Low priority | #F4F7F2 | #5D7188 |
| EAT cycle | rgba(45,111,181,.14) | #2D6FB5 |
| SWAN cycle | rgba(34,160,107,.14) | #1C7A52 |
| OVEN cycle | rgba(217,122,43,.14) | #D97A2B |
| Pending | rgba(217,122,43,.12) | #D97A2B |
| Dispatched / Done | rgba(34,160,107,.14) | #1C7A52 |
| Dharmapuri location | rgba(59,130,246,.14) | #2D6FB5 |
| Faridabad location | rgba(217,122,43,.14) | #D97A2B |

**Status dots:** 6–8px circles used inline with text. Same colours as badge types.

---

## TABLES

Table headers: IBM Plex Mono 9–10px 700 uppercase letter-spacing .1em color #9BB4D4
Row height: 44–48px minimum
Row hover: background #F4F7F2
Row borders: 1px solid #EEF2EA between rows, no outer border on table itself
Cell text: IBM Plex Sans 13px color #15366A
Data/code cells: IBM Plex Mono 12–13px color #15366A

Clickable rows (that open a detail view): cursor pointer, show subtle right arrow or highlight on hover.

---

## THE UID STEP TRACKER — most important UI element

This element appears on: UID Detail page, Production Floor UID cards, Service Call Lookup.

It shows all 27 steps of the EAT cycle as a horizontal track of nodes with connecting lines. It must be scrollable horizontally with no visible scrollbar.

**Node states:**
- Completed step: filled square, background #2D6FB5, white step number
- Current step (active): filled square, background #15366A, white step number, subtle pulsing glow animation in blue
- Split steps (16 and 16B): amber/orange fill (#D97A2B) when completed or active
- Next step: outlined square, background #F4F7F2, muted text, dashed border
- Future steps: outlined square, background #F4F7F2, very muted text

**Connector lines between nodes:**
- Completed: solid, color #2D6FB5
- Upcoming: solid, color #E3EBDE

**Labels below each node:** workstation code in IBM Plex Mono 8px color #9BB4D4, truncated.

**Node size:** approximately 24×24px squares with border-radius 5–6px.

**The 27 steps with correct names and workstation codes:**

| Step | Name | Workstation |
|---|---|---|
| 1 | Band Saw Cutting | BSW-01 |
| 2 | UID Tagging | RCV-01 |
| 3 | Straightening | STR-MAN |
| 4 | Bunch Grinding | SG-DLT |
| 5 | OP10 Rough Mill | MM22 |
| 6 | Hardening | HT70 |
| 7 | Quenching | HT80 |
| 8 | Straightening HYD | STR-HYD |
| 9 | Tempering 1 | HT90 |
| 10 | Tempering 2 | HT90 |
| 11 | Straighten Post-HT | STR-HYD |
| 12 | Surface Grind 1 | SG-DLT |
| 13 | Anti-rust Coat | PRO |
| 14 | Tempering 3 | HT90 |
| 15 | Straighten Manual | STR-MAN |
| 16 | Converting | BSW-02 |
| 16B | Child UID Marking | RCV-01 |
| 17 | OP20 Semi-finish Mill | MM11 |
| 18 | OP30 Finish Mill | MM11 |
| 19 | Straighten Post-OP30 | STR-MAN |
| 20 | Surface Grind 2 | SG-DLT |
| 21 | Anti-rust Coat 2 | PRO |
| 22 | Bevel Grinding | AG-ALP |
| 23 | Tempering 4 — Stress Relief | HT90 |
| 24 | Final Anti-rust | PRO |
| 25 | Final Straightening | STR-MAN |
| 26 | QC Inspection | HRC-01 |
| 27 | Packing and Dispatch | PKG |

Steps 16 and 16B are the Converting / Split steps — mark them visually distinct (amber/orange colour).
Steps 9, 10, 14, 23 are Tempering steps — can have a subtle furnace icon or indicator.

---

## STORAGE LOCATIONS

These are used throughout the app as location badges and in step detail views. Always shown in IBM Plex Mono.

RM · RM-Q · RM-D · HT-Q · HT-D · MC-Q · MC-D · QC-Q · QC-D · FG

Flow direction: RM → RM-Q → RM-D → HT-Q → HT-D → MC-Q → MC-D → QC-Q → QC-D → FG

---

## WORKSTATION CODES

Only these workstation codes exist in the system. No others. Always shown in IBM Plex Mono uppercase.

BSW-01 · BSW-02 · RCV-01 · HT70 · HT80 · HT90 · STR-HYD · STR-MAN · SG-DLT · MM22 · MM11 · AG-ALP · AG-BTA · AG-GMM · PRO · HRC-01 · VCL-200 · ISP · PKG

---

## ALERT DROPDOWN (from bell icon in topbar)

Overlay panel below the bell icon.
Width: 340px. Background white. Border-radius 13px. Shadow: `0 18px 40px rgba(21,54,106,.20)`.

Header: "Alerts" in Archivo 700 16px + dismiss-all link.

Each alert item:
- Left: severity dot (red for critical, orange for warning, yellow for info)
- Alert text in IBM Plex Sans 13px
- Subtext in IBM Plex Mono 10px color #9BB4D4 (which page it links to)
- Right arrow to navigate

Alert severity colours:
- 🔴 Critical (holds, furnace deviations, overdue handover): #E5484D
- 🟠 Warning (missing design, expiring badges): #D97A2B
- 🟡 Info (borderline QC, expected consignments): #F0C674

---

## USER MENU DROPDOWN

Appears below the user avatar in the topbar.
Width: 236px. Background white. Border-radius 13px. Shadow same as alert dropdown.

Top section: user avatar (38px circle), name and role — separated by a border.
Menu items below: icon + label, 44px height each, hover background #F4F7F2.

Items: View profile · Change password · divider · Logout (in red)

---

## SHOPFLOOR DISPLAY PAGE

This page is full screen only. Sidebar hidden. Topbar hidden. Status bar hidden.

Background: #11305F (deep navy — same as topbar).
Text: #EAF4E4 and #9BB4D4.

**Header bar:**
- Left: "EDGESMITH TOOLING" large text + "DHARMAPURI — LIVE SHOPFLOOR" below in IBM Plex Mono
- Right: counts (X Running, X Hold, X Active UIDs) + last refresh time
- Separator line below header: 1px solid rgba(255,255,255,.1)

**Workstation grid:** large tiles in 4 columns.
Each tile:
- Background: slightly lighter than page (#1A3D6E or similar)
- Left border: 3px solid — green if running, red if hold, muted if idle
- Workstation code: IBM Plex Mono 11px uppercase
- UID list: IBM Plex Mono 12px 600 white

**Storage location bar at bottom:**
Row of 10 tiles, one per storage location.
Each: location code (IBM Plex Mono 9px), count (Archivo 26px 700 color #D4EECB if >0).

**Exit button:** small, bottom corner, muted style.

---

## RESPONSIVE BEHAVIOUR

**Desktop (≥ 1200px):** Full sidebar 220px + full content area. All table columns visible.

**Tablet (768–1199px):** Sidebar collapses to 52px (icons only, expands on hover). Tables scroll horizontally. Touch targets minimum 44px.

**Mobile (< 768px):** Sidebar hidden, opens as overlay on hamburger tap. Single column layout. Cards stack vertically. Large tap targets for operator use (operators may wear gloves). My Jobs page is the primary mobile view — optimised for one-handed use.

---

## WHAT NOT TO DO

- Do not use any colours outside the palette defined above
- Do not use any font other than Archivo, IBM Plex Mono, and IBM Plex Sans
- Do not use step names or workstation codes other than those listed above
- Do not use rounded pill shapes on cards — cards use border-radius 14px, not pill
- Do not use dark mode anywhere except the Shopfloor Display page
- Do not use heavy drop shadows on cards — only the subtle shadow defined above
- Do not add decorative illustrations or abstract graphics
- Do not use emoji in the UI (icons only — SVG line icons)
- Do not invent new storage location codes or workstation codes

---

## ICONS

Use SVG line icons throughout (stroke-based, not filled). Stroke-width 2px.
Icon size: 14–18px in most contexts, 20–24px in prominent positions.
Icon colour inherits from surrounding text colour.

Suggested icon associations (Claude Design picks the exact SVG):
- Dashboard → grid
- Raw Material Intake → inbox / download tray
- Joining Operation → link / chain
- Contractor Dispatch → truck
- Receiving → download arrow
- UID Creation → tag / label
- Production Floor → factory / building
- Batch Management → layers / stack
- QC → checkmark circle
- MO Linking → document
- Shift Management → calendar
- Job Assignment → person + arrow
- Reports → bar chart
- Service Lookup → search
- Cycle Builder → flow / nodes
- Master Lists → list
- Tempering Parameters → thermometer
- Employee Profiles → people / group
- Users & Roles → lock
- Shopfloor Display → monitor

---

## SAMPLE DATA TO USE IN THE DESIGN

Use these exact values wherever sample data is needed. Do not invent other codes or names.

**UIDs:** E018, E019, E020, E022, E023, E028, E041, E041-A, E041-B, E042, E043
**Cycle types:** EAT, SWAN, OVEN
**Workstations:** use codes from the list above only
**Storage locations:** use codes from the list above only
**Suppliers:** Jindal Steel, Mukand Ltd, Tata Steel, Vizag Steel
**Heat numbers:** H-44120, H-44098, M-88017, M-87994
**Supervisors:** S. Kumar, S. Murugan, R. Mohan, R. Velu
**Operators:** Ravi K., Priya S., Arjun T., Kumar V.
**MO numbers:** MO-2024-085, MO-2024-089, MO-2024-090, MO-2291
**Faridabad batch refs:** FAR-JOIN-2024-041, FAR-DISP-2024-061
**Dharmapuri receiving refs:** DHR-RCV-2024-086, DHR-RCV-2024-087, DHR-RCV-2024-088
**Furnace batch numbers:** HT90-2024-441, HT90-2024-442
**Designs:** Plain, 9/8534, 9/5032
**Sizes:** 1500mm, 1424mm, 2750mm

