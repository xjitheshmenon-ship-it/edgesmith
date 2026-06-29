import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Render free dynos cold-start; retry with backoff (~2,4,8,16,20s) so the
      // first load waits out the wake-up instead of erroring immediately.
      retry: 5,
      retryDelay: (attempt) => Math.min(2000 * 2 ** attempt, 20_000),
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
)
