import { createContext, useContext, type ReactNode } from 'react'
import useSWR from 'swr'
import { fetchAuthConfig, type AuthConfig } from '../api/config'

type AuthContextValue = {
  config: AuthConfig | null
  isLoading: boolean
}

const AuthContext = createContext<AuthContextValue>({ config: null, isLoading: true })

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useSWR('authConfig', fetchAuthConfig, { revalidateOnFocus: false })

  return (
    <AuthContext.Provider value={{ config: data ?? null, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
