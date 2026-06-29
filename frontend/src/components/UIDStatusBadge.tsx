const MAP: Record<string, [string, string]> = {
  active:     ['badge-green',  'Active'],
  on_hold:    ['badge-yellow', 'On Hold'],
  converting: ['badge-orange', 'Converting'],
  converted:  ['badge-gray',   'Converted'],
  dispatched: ['badge-blue',   'Dispatched'],
  archived:   ['badge-gray',   'Archived'],
}

export default function UIDStatusBadge({ status }: { status: string }) {
  const [cls, label] = MAP[status] ?? ['badge-gray', status]
  return <span className={cls}>{label}</span>
}
