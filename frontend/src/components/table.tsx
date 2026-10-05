import type { CSSProperties, ReactNode } from 'react'

// Shared table cell helpers.
// `Th` / `Td` are the compact monospace header/data cells used by the
// Tempering and Faridabad tables. `cellStyle` is the roomier style object
// used by the Config, Users, UIDs and Cycles tables (applied as `style={cellStyle}`).

export const Th = ({ children }: { children: ReactNode }) => (
  <th style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.1em', color: 'var(--ink-3)', textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--line)', fontWeight: 500 }}>{children}</th>
)

export const Td = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <td style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--ink)', padding: '9px 12px', borderBottom: '1px solid var(--line)', ...style }}>{children}</td>
)

export const cellStyle: CSSProperties = { padding: '11px 16px', fontSize: 13, color: 'var(--ink)', borderBottom: '1px solid var(--line)' }
