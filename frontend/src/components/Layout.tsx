import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { authStore } from '../store/auth'
import {
  LayoutDashboard, Package, Wrench, Settings, Search,
  Factory, ClipboardList, Monitor, Users, ChevronRight,
  LogOut, Hammer, Layers
} from 'lucide-react'
import clsx from 'clsx'

interface NavItem {
  label: string
  to: string
  icon: React.ReactNode
  roles?: string[]
}

const NAV: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: <LayoutDashboard size={18} /> },
  { label: 'Shopfloor', to: '/shopfloor', icon: <Monitor size={18} /> },
  { label: 'UID Lookup', to: '/uid-lookup', icon: <Search size={18} /> },
  { label: 'My Queue', to: '/queue', icon: <ClipboardList size={18} />, roles: ['operator', 'supervisor'] },
  { label: 'UIDs', to: '/uids', icon: <Package size={18} />, roles: ['admin', 'manager', 'supervisor'] },
  { label: 'Mfg Orders', to: '/manufacturing', icon: <Hammer size={18} />, roles: ['admin', 'manager'] },
  { label: 'Cycles', to: '/cycles', icon: <Layers size={18} />, roles: ['admin', 'manager'] },
  { label: 'Config', to: '/config', icon: <Settings size={18} />, roles: ['admin'] },
  { label: 'Users', to: '/users', icon: <Users size={18} />, roles: ['admin'] },
]

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-800',
  manager: 'bg-blue-100 text-blue-800',
  supervisor: 'bg-green-100 text-green-800',
  operator: 'bg-yellow-100 text-yellow-800',
  service: 'bg-gray-100 text-gray-700',
  shopfloor: 'bg-orange-100 text-orange-800',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const visibleNav = NAV.filter((item) => !item.roles || (user && item.roles.includes(user.role)))

  const handleLogout = () => {
    authStore.clearAuth()
    navigate('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Factory size={24} className="text-brand-500" />
            <div>
              <div className="font-bold text-gray-900 leading-tight">CPCMS</div>
              <div className="text-xs text-gray-500">Edgesmith Tooling</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {visibleNav.map((item) => {
            const active = location.pathname === item.to || (item.to !== '/' && location.pathname.startsWith(item.to))
            return (
              <Link
                key={item.to}
                to={item.to}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  active
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                )}
              >
                {item.icon}
                {item.label}
                {active && <ChevronRight size={14} className="ml-auto" />}
              </Link>
            )
          })}
        </nav>

        {/* User */}
        {user && (
          <div className="px-4 py-4 border-t border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm">
                {user.full_name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{user.full_name}</div>
                <span className={clsx('text-xs px-1.5 py-0.5 rounded font-medium', ROLE_COLORS[user.role])}>
                  {user.role}
                </span>
              </div>
              <button onClick={handleLogout} className="text-gray-400 hover:text-gray-600" title="Logout">
                <LogOut size={16} />
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
