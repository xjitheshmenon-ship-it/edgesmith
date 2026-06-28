import { useState, useEffect } from 'react'
import { authStore } from '../store/auth'
import type { User } from '../types'

export function useAuth() {
  const [user, setUser] = useState<User | null>(authStore.getUser())

  useEffect(() => {
    return authStore.subscribe(() => setUser(authStore.getUser()))
  }, [])

  return { user, isAuthenticated: !!user }
}
