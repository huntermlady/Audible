import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import { AIStatusProvider } from '@/ai/status'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SeasonProvider } from '@/data/season'
import { ThemeProvider } from '@/design/theme'
import { ChatProvider } from './chat-context'
import { AppRoutes } from './routes'

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // Data files are static for the life of the page.
      queries: { staleTime: Infinity, gcTime: 30 * 60_000, retry: 1, refetchOnWindowFocus: false },
    },
  })
}

const queryClient = createQueryClient()

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AIStatusProvider>
          <TooltipProvider delayDuration={200}>
            <SeasonProvider>
              <ChatProvider>
                <BrowserRouter basename="/Audible">
                  <AppRoutes />
                </BrowserRouter>
                <Toaster />
              </ChatProvider>
            </SeasonProvider>
          </TooltipProvider>
        </AIStatusProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
