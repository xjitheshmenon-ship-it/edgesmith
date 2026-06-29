import { useMemo, useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { cycleApi, uidApi } from '../api/client'
import type { CycleType, CycleVersion, CycleStep, UID } from '../types'
import {
  Layers,
  Flame,
  Scissors,
  Download,
  Upload,
  History,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Ruler,
  Lock,
  X,
  Plus,
  Loader2,
} from 'lucide-react'
import { format } from 'date-fns'

const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"
const ARCHIVO = "'Archivo', sans-serif"

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 14,
  boxShadow: 'var(--shadow-e1)',
}

// ── Cycle-type accent badge ──────────────────────────────────────────────────
const CYCLE_BADGE: Record<string, string> = {
  EAT: 'badge-blue',
  SWAN: 'badge-green',
  OVEN: 'badge-orange',
}
function cycleBadgeClass(name?: string | null) {
  return CYCLE_BADGE[(name ?? '').toUpperCase()] ?? 'badge-blue'
}

// ── Step classification (per spec) ───────────────────────────────────────────
const FURNACE_BASE_CAP: Record<string, number> = { HT70: 6, HT80: 6, HT90: 80 }
const isFurnaceWs = (code: string) => /^HT(70|80|90)/i.test(code)
const isGrindingWs = (code: string) =>
  /^(SG-DLT|AG-ALP|AG-BTA|AG-GMM)/i.test(code)
const BUNCH_GRIND_STEP = '4' // SG-DLT bunch grinding
const isSplitStep = (s: CycleStep) =>
  s.is_converting_step ||
  s.is_child_marking_step ||
  s.step_number === '16' ||
  s.step_number === '16B'

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      fontFamily: MONO,
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: 'var(--ink-3)',
    }}
  >
    {children}
  </div>
)

const miniHr: React.CSSProperties = {
  height: 1,
  background: 'var(--line)',
  margin: '8px 0',
}

function CapRow({
  k,
  v,
  editable,
  muted,
}: {
  k: string
  v: string
  editable?: boolean
  muted?: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '3px 0' }}>
      <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-3)' }}>{k}</span>
      <span
        style={{
          fontFamily: SANS,
          fontSize: 12,
          fontWeight: editable ? 600 : 500,
          color: muted ? 'var(--ink-3)' : 'var(--ink)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {v}
        {editable && <span className="badge-gray" style={{ fontSize: 9 }}>EDIT</span>}
        {muted && <Lock size={10} style={{ color: 'var(--ink-3)' }} />}
      </span>
    </div>
  )
}

function CapPopover({
  label,
  icon,
  open,
  setOpen,
  children,
}: {
  label: string
  icon?: React.ReactNode
  open: boolean
  setOpen: (b: boolean) => void
  children: React.ReactNode
}) {
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          background: open ? 'var(--accent-dim)' : 'var(--surface-2)',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--line)'}`,
          borderRadius: 7,
          padding: '4px 9px',
          cursor: 'pointer',
          fontFamily: MONO,
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--ink)',
          whiteSpace: 'nowrap',
        }}
      >
        {icon}
        {label}
      </button>
      {open && (
        <div
          className="animate-es"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 30,
            width: 280,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 12,
            boxShadow: 'var(--shadow-e3)',
            padding: 14,
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

// ── CAP cell — display rules differ by workstation type (spec lines 1044-1082)
function CapCell({ step }: { step: CycleStep }) {
  const [open, setOpen] = useState(false)
  const ws = step.workstation_code ?? ''
  const furnace = isFurnaceWs(ws)
  const grinding = isGrindingWs(ws)
  const bunch = step.step_number === BUNCH_GRIND_STEP && /^SG-DLT/i.test(ws)

  // Bunch grinding (Step 4) — bars/set + length-based.
  if (bunch) {
    const barsPerSet = 5
    return (
      <CapPopover label="5 bars / set · Length-based" open={open} setOpen={setOpen}>
        <CapRow k="Bars per set" v={`${barsPerSet}`} editable />
        <CapRow k="Machine bed" v="3000 mm (fixed)" />
        <div style={miniHr} />
        <CapRow k="1500 mm" v={`2 sets × ${barsPerSet} = ${2 * barsPerSet} bars / run`} />
        <CapRow k="1424 mm" v={`2 sets × ${barsPerSet} = ${2 * barsPerSet} bars / run`} />
        <CapRow k="2750 mm" v={`1 set × ${barsPerSet} = ${barsPerSet} bars / run`} />
      </CapPopover>
    )
  }

  // Grinding (length-based) — governed by machine limits, no number to edit.
  if (grinding) {
    return (
      <CapPopover label="Length-based" icon={<Ruler size={11} />} open={open} setOpen={setOpen}>
        <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          Capacity governed by machine physical limits (max length &amp; pairing
          rules). No fixed slot count.
        </div>
        <div style={miniHr} />
        <CapRow k="Machine" v={ws} />
        <CapRow k="Rule" v="Length-based — see grinding rules" />
      </CapPopover>
    )
  }

  // Furnace — base capacity at 1500mm, auto-derived for other sizes.
  if (furnace) {
    const key = (ws.match(/^HT(70|80|90)/i)?.[0] ?? '').toUpperCase()
    const base = FURNACE_BASE_CAP[key] ?? 6
    const c1424 = Math.floor((base * 1500) / 1424)
    const c2750 = Math.floor((base * 1500) / 2750)
    return (
      <CapPopover
        label={`${base}`}
        icon={<Flame size={11} style={{ color: 'var(--warning)' }} />}
        open={open}
        setOpen={setOpen}
      >
        <CapRow k="Base capacity (1500 mm)" v={`${base} bars`} editable />
        <div style={miniHr} />
        <CapRow k="1424 mm" v={`${c1424} bars (auto)`} muted />
        <CapRow k="2750 mm" v={`${c2750} bars (auto)`} muted />
        <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-3)', marginTop: 8 }}>
          Other sizes auto-calculated from the 1500 mm base — read-only.
        </div>
      </CapPopover>
    )
  }

  // Fixed-capacity (most steps) — single number.
  return (
    <CapPopover label="1" open={open} setOpen={setOpen}>
      <CapRow k="Capacity" v="1 at a time" editable />
      <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-3)', marginTop: 8 }}>
        Fixed-capacity step. Set the number of bars processed simultaneously.
      </div>
    </CapPopover>
  )
}

// ── Step type tag(s) ─────────────────────────────────────────────────────────
function StepTags({ step }: { step: CycleStep }) {
  const ws = step.workstation_code ?? ''
  const tags: React.ReactNode[] = []
  if (isFurnaceWs(ws))
    tags.push(
      <span key="t" className="badge-orange" style={{ fontSize: 9.5 }}>
        <Flame size={10} /> Tempering
      </span>
    )
  if (isSplitStep(step))
    tags.push(
      <span key="s" className="badge-yellow" style={{ fontSize: 9.5 }}>
        <Scissors size={10} /> Split
      </span>
    )
  if (step.is_qc_step)
    tags.push(
      <span key="q" className="badge-blue" style={{ fontSize: 9.5 }}>
        QC
      </span>
    )
  if (tags.length === 0) return null
  return <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>{tags}</div>
}

export default function Config() {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showVersions, setShowVersions] = useState(false)
  const [importPreview, setImportPreview] = useState<{ name: string; steps: number; raw: unknown } | null>(null)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Cycle list ─────────────────────────────────────────────────────────────
  const {
    data: cycles = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<CycleType[]>({
    queryKey: ['config-cycles'],
    queryFn: () => cycleApi.list().then((r) => r.data),
  })

  // Auto-select the first cycle once loaded.
  const selected = useMemo<CycleType | null>(() => {
    if (cycles.length === 0) return null
    return cycles.find((c) => c.id === selectedId) ?? cycles[0]
  }, [cycles, selectedId])

  // ── Versions of the selected cycle ───────────────────────────────────────────
  const { data: versions = [] } = useQuery<CycleVersion[]>({
    queryKey: ['config-cycle-versions', selected?.id],
    queryFn: () => cycleApi.versions(selected!.id).then((r) => r.data),
    enabled: !!selected,
  })

  // ── Active UIDs — used to compute "UIDs currently at step" (delete-block) ────
  const { data: activeUids = [] } = useQuery<UID[]>({
    queryKey: ['config-active-uids'],
    queryFn: () => uidApi.list({ status: 'active' }).then((r) => r.data.items ?? []),
  })

  const uidAtStep = useMemo(() => {
    const m = new Map<number, number>()
    for (const u of activeUids) {
      if (u.current_step_id != null) m.set(u.current_step_id, (m.get(u.current_step_id) ?? 0) + 1)
    }
    return m
  }, [activeUids])

  const steps = useMemo<CycleStep[]>(() => {
    const s = selected?.current_version?.steps ?? []
    return [...s].sort((a, b) => a.step_order - b.step_order)
  }, [selected])

  // ── Mutations (degrade gracefully if endpoints are limited) ──────────────────
  const exportMut = useMutation({
    mutationFn: (id: number) => cycleApi.export(id).then((r) => r.data),
    onSuccess: (data, id) => {
      const name = cycles.find((c) => c.id === id)?.name ?? 'cycle'
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name.toLowerCase()}-cycle.json`
      a.click()
      URL.revokeObjectURL(url)
      setBanner({ kind: 'ok', msg: `Exported ${name} cycle definition.` })
    },
    onError: () => setBanner({ kind: 'err', msg: 'Export failed. Please try again.' }),
  })

  const importMut = useMutation({
    mutationFn: (raw: unknown) => cycleApi.import(raw as Record<string, unknown>).then((r) => r.data),
    onSuccess: () => {
      setImportPreview(null)
      setBanner({ kind: 'ok', msg: 'Import complete — cycle definition created.' })
      qc.invalidateQueries({ queryKey: ['config-cycles'] })
    },
    onError: () =>
      setBanner({ kind: 'err', msg: 'Import failed — definition was not accepted by the server.' }),
  })

  const rollbackMut = useMutation({
    mutationFn: ({ cycleId, version }: { cycleId: number; version: CycleVersion }) =>
      cycleApi
        .createVersion(cycleId, {
          steps: version.steps,
          change_notes: `Rollback to v${version.version_number}`,
        })
        .then((r) => r.data),
    onSuccess: () => {
      setBanner({ kind: 'ok', msg: 'Rolled back — a new version was created from the selected one.' })
      qc.invalidateQueries({ queryKey: ['config-cycles'] })
      qc.invalidateQueries({ queryKey: ['config-cycle-versions'] })
    },
    onError: () =>
      setBanner({ kind: 'err', msg: 'Rollback unavailable — version endpoint declined the request.' }),
  })

  // ── Import file handling ─────────────────────────────────────────────────────
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as any
        const stepCount =
          parsed?.current_version?.steps?.length ?? parsed?.steps?.length ?? 0
        setImportPreview({
          name: parsed?.name ?? 'Unknown',
          steps: stepCount,
          raw: parsed,
        })
        setBanner(null)
      } catch {
        setBanner({ kind: 'err', msg: 'Invalid JSON file — could not parse.' })
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // ── States ───────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
        <Header />
        <div
          style={{
            ...cardStyle,
            padding: 40,
            textAlign: 'center',
            fontFamily: SANS,
            fontSize: 14,
            color: 'var(--ink-2)',
          }}
        >
          Loading cycle definitions…
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
        <Header />
        <div
          style={{
            ...cardStyle,
            padding: 32,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            color: 'var(--error)',
            fontFamily: SANS,
            fontSize: 14,
          }}
        >
          <AlertTriangle size={17} /> Failed to load cycles.
          <button className="btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => refetch()}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-es" style={{ padding: '28px 28px 60px', maxWidth: 1280 }}>
      <Header />

      {banner && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderRadius: 10,
            marginBottom: 16,
            fontFamily: SANS,
            fontSize: 13,
            background: banner.kind === 'ok' ? 'rgba(34,160,107,.10)' : 'rgba(229,72,77,.10)',
            border: `1px solid ${banner.kind === 'ok' ? 'rgba(34,160,107,.25)' : 'rgba(229,72,77,.25)'}`,
            color: banner.kind === 'ok' ? '#1c7a52' : '#c0392b',
          }}
        >
          {banner.kind === 'ok' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          {banner.msg}
          <button
            onClick={() => setBanner(null)}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex' }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20, alignItems: 'start' }}>
        {/* ── LEFT: cycle list ──────────────────────────────────────────────── */}
        <div style={{ ...cardStyle, padding: 14, position: 'sticky', top: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <SectionLabel>Cycle Types ({cycles.length})</SectionLabel>
            <button
              className="btn-secondary"
              style={{ height: 28, padding: '0 10px', fontSize: 12 }}
              title="Adding cycles uses the create endpoint; configure steps after creation."
              onClick={() =>
                setBanner({
                  kind: 'err',
                  msg: 'New-cycle creation is not wired in this view — use Import to add a cycle from a definition file.',
                })
              }
            >
              <Plus size={14} /> Add
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {cycles.map((c) => {
              const on = selected?.id === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelectedId(c.id)
                    setShowVersions(false)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    textAlign: 'left',
                    padding: '10px 12px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`,
                    background: on ? 'var(--accent-dim)' : 'var(--surface-2)',
                    width: '100%',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className={cycleBadgeClass(c.name)}>{c.name}</span>
                      {c.is_archived && <span className="badge-gray" style={{ fontSize: 9.5 }}>Archived</span>}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        fontFamily: MONO,
                        fontSize: 10.5,
                        color: 'var(--ink-3)',
                        marginTop: 6,
                      }}
                    >
                      {c.current_version?.steps?.length ?? 0} steps · v
                      {c.current_version?.version_number ?? '—'}
                      {c.version_count > 1 ? ` · ${c.version_count} versions` : ''}
                    </span>
                  </span>
                  <ChevronRight size={15} style={{ color: on ? 'var(--accent)' : 'var(--ink-3)', flexShrink: 0 }} />
                </button>
              )
            })}
            {cycles.length === 0 && (
              <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-3)', padding: 8 }}>
                No cycle types defined.
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: step editor ────────────────────────────────────────────── */}
        {selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Toolbar */}
            <div style={{ ...cardStyle, padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 26, letterSpacing: '-0.03em', color: 'var(--ink)', lineHeight: 1 }}>
                      {selected.name}
                    </div>
                    <span className={cycleBadgeClass(selected.name)}>{selected.letter_prefix}</span>
                    {selected.is_active ? (
                      <span className="badge-green" style={{ fontSize: 9.5 }}>Active</span>
                    ) : (
                      <span className="badge-gray" style={{ fontSize: 9.5 }}>Inactive</span>
                    )}
                  </div>
                  <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-2)', marginTop: 6 }}>
                    {selected.description ?? 'Production cycle definition.'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-3)', flexWrap: 'wrap' }}>
                    <span>{steps.length} STEPS</span>
                    <span>
                      CURRENT VERSION v{selected.current_version?.version_number ?? '—'}
                    </span>
                    {selected.current_version?.created_at && (
                      <span>
                        {format(new Date(selected.current_version.created_at), 'dd MMM yyyy')}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="btn-secondary"
                    onClick={() => setShowVersions((v) => !v)}
                  >
                    <History size={15} /> Versions
                    {selected.version_count > 0 && (
                      <span style={{ fontFamily: MONO, fontSize: 11 }}>({selected.version_count})</span>
                    )}
                  </button>
                  <button className="btn-secondary" onClick={() => fileRef.current?.click()}>
                    <Upload size={15} /> Import
                  </button>
                  <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} />
                  <button
                    className="btn-primary"
                    disabled={exportMut.isPending}
                    onClick={() => exportMut.mutate(selected.id)}
                  >
                    {exportMut.isPending ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
                    Export
                  </button>
                </div>
              </div>

              <div
                style={{
                  marginTop: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '9px 12px',
                  borderRadius: 9,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--line)',
                  fontFamily: SANS,
                  fontSize: 12,
                  color: 'var(--ink-2)',
                }}
              >
                <AlertTriangle size={14} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                Saving step changes creates a new version automatically. In-progress
                UIDs keep the version they were created under; new UIDs adopt the
                latest. Inline step edits and drag-reorder are read-only in this build.
              </div>
            </div>

            {/* Version history (collapsible) */}
            {showVersions && (
              <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px 12px' }}>
                  <SectionLabel>Version History ({versions.length || selected.version_count})</SectionLabel>
                </div>
                {versions.length === 0 ? (
                  <div style={{ padding: '0 20px 20px', fontFamily: SANS, fontSize: 13, color: 'var(--ink-3)' }}>
                    No version history available.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="es-table">
                      <thead>
                        <tr>
                          <th>Version</th>
                          <th>Date</th>
                          <th>Steps</th>
                          <th>Changes</th>
                          <th style={{ textAlign: 'right' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...versions]
                          .sort((a, b) => b.version_number - a.version_number)
                          .map((v) => (
                            <tr key={v.id}>
                              <td style={{ fontFamily: MONO, fontWeight: 600 }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                  v{v.version_number}
                                  {v.is_current && <span className="badge-green" style={{ fontSize: 9 }}>Current</span>}
                                </span>
                              </td>
                              <td style={{ fontFamily: MONO, fontSize: 12, whiteSpace: 'nowrap' }}>
                                {format(new Date(v.created_at), 'dd MMM yyyy, HH:mm')}
                              </td>
                              <td style={{ fontFamily: MONO }}>{v.steps?.length ?? 0}</td>
                              <td style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2)' }}>
                                {v.change_notes ?? '—'}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {v.is_current ? (
                                  <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-3)' }}>—</span>
                                ) : (
                                  <button
                                    className="btn-secondary"
                                    style={{ height: 28, padding: '0 10px', fontSize: 12 }}
                                    disabled={rollbackMut.isPending}
                                    onClick={() => rollbackMut.mutate({ cycleId: selected.id, version: v })}
                                  >
                                    <RotateCcw size={13} /> Rollback
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Step editor table */}
            <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <SectionLabel>Step Sequence</SectionLabel>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-3)' }}>
                  {steps.length} steps in order
                </span>
              </div>
              {steps.length === 0 ? (
                <div style={{ padding: '0 20px 24px', fontFamily: SANS, fontSize: 13, color: 'var(--ink-3)' }}>
                  This cycle version has no defined steps.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="es-table">
                    <thead>
                      <tr>
                        <th>Step</th>
                        <th>Operation</th>
                        <th>Workstation</th>
                        <th>Source</th>
                        <th>Destination</th>
                        <th>Cap</th>
                        <th>At Step</th>
                      </tr>
                    </thead>
                    <tbody>
                      {steps.map((s) => {
                        const atStep = uidAtStep.get(s.id) ?? 0
                        const furnace = isFurnaceWs(s.workstation_code ?? '')
                        const split = isSplitStep(s)
                        return (
                          <tr key={s.id}>
                            <td style={{ fontFamily: MONO, fontWeight: 700 }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                {furnace && <Flame size={12} style={{ color: 'var(--warning)' }} />}
                                {split && !furnace && <Scissors size={12} style={{ color: '#d97a2b' }} />}
                                {s.step_number}
                              </span>
                            </td>
                            <td>
                              <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
                                {s.operation_name}
                              </div>
                              <div style={{ marginTop: 5 }}>
                                <StepTags step={s} />
                              </div>
                            </td>
                            <td>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  fontFamily: MONO,
                                  fontSize: 12,
                                  color: 'var(--ink)',
                                  background: 'var(--surface-2)',
                                  border: '1px solid var(--line)',
                                  borderRadius: 7,
                                  padding: '4px 9px',
                                }}
                                title={s.workstation_name}
                              >
                                {s.workstation_code}
                              </span>
                            </td>
                            <td style={{ fontFamily: MONO, fontSize: 12, color: s.from_storage_code ? 'var(--ink)' : 'var(--ink-3)' }}>
                              {s.from_storage_code ?? '—'}
                            </td>
                            <td style={{ fontFamily: MONO, fontSize: 12, color: s.to_storage_code ? 'var(--ink)' : 'var(--ink-3)' }}>
                              {s.to_storage_code ?? '—'}
                            </td>
                            <td>
                              <CapCell step={s} />
                            </td>
                            <td>
                              {atStep > 0 ? (
                                <span
                                  className="badge-yellow"
                                  style={{ fontSize: 10 }}
                                  title={`${atStep} UID${atStep === 1 ? '' : 's'} currently here — delete blocked`}
                                >
                                  {atStep} UID{atStep === 1 ? '' : 's'}
                                </span>
                              ) : (
                                <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-3)' }}>0</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div
                style={{
                  padding: '12px 20px',
                  borderTop: '1px solid var(--line)',
                  fontFamily: MONO,
                  fontSize: 10.5,
                  color: 'var(--ink-3)',
                  display: 'flex',
                  gap: 18,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Flame size={12} style={{ color: 'var(--warning)' }} /> Tempering (furnace)
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Scissors size={12} style={{ color: '#d97a2b' }} /> Split / converting
                </span>
                <span>Cap field shows per-workstation capacity rules — click to inspect.</span>
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              ...cardStyle,
              padding: 48,
              textAlign: 'center',
              fontFamily: SANS,
              fontSize: 14,
              color: 'var(--ink-3)',
            }}
          >
            <Layers size={28} style={{ color: 'var(--ink-3)', marginBottom: 10 }} />
            <div>Select a cycle to view and edit its step sequence.</div>
          </div>
        )}
      </div>

      {/* ── Import preview modal ─────────────────────────────────────────────── */}
      {importPreview && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(21,54,106,.32)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 20,
          }}
          onClick={() => setImportPreview(null)}
        >
          <div
            className="animate-es"
            style={{ ...cardStyle, width: 440, maxWidth: '100%', padding: 24, boxShadow: 'var(--shadow-e4)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
                Import Cycle
              </div>
              <button
                onClick={() => setImportPreview(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ ...cardStyle, background: 'var(--surface-2)', padding: 16, marginBottom: 16 }}>
              <CapRow k="Cycle name" v={importPreview.name} />
              <CapRow k="Steps in file" v={`${importPreview.steps}`} />
            </div>

            <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2)', marginBottom: 18, lineHeight: 1.5 }}>
              This creates a new cycle or a new version of an existing cycle. Existing
              history is never overwritten. Confirm to proceed.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn-secondary" onClick={() => setImportPreview(null)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={importMut.isPending || importPreview.steps === 0}
                onClick={() => importMut.mutate(importPreview.raw)}
              >
                {importMut.isPending ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
                Confirm Import
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`.spin{animation:spin 0.8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ── Page header ──────────────────────────────────────────────────────────────
function Header() {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 24, letterSpacing: '-0.03em', color: 'var(--ink)' }}>
          Cycle Builder
        </div>
        <span className="badge-gray" style={{ fontSize: 9.5 }}>Admin</span>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-2)', marginTop: 3 }}>
        Define and manage production cycle types — step sequences, capacities, and versions.
      </div>
    </div>
  )
}
