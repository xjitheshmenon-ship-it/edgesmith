import type { User } from '../types'
let _user: User | null = JSON.parse(localStorage.getItem('user') || 'null')
let _listeners: (() => void)[] = []

export const authStore = {
  getUser: () => _user,
  getToken: () => localStorage.getItem('token'),

  setAuth(token: string, user: User) {
    localStorage.setItem('token', token)
    localStorage.setItem('user', JSON.stringify(user))
    _user = user
    _listeners.forEach((fn) => fn())
  },

  clearAuth() {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    _user = null
    _listeners.forEach((fn) => fn())
  },

  subscribe(fn: () => void) {
    _listeners.push(fn)
    return () => { _listeners = _listeners.filter((l) => l !== fn) }
  },
}
