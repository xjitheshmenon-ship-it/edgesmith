const MAP: Record<string, [string, string]> = {
  urgent: ['badge-red',    'Urgent'],
  high:   ['badge-yellow', 'High'],
  normal: ['badge-gray',   'Normal'],
}

export default function PriorityBadge({ priority }: { priority: string }) {
  const [cls, label] = MAP[priority] ?? ['badge-gray', priority]
  return <span className={cls}>{label}</span>
}
