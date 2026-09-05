import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/api'
import { ToastProvider } from '@/components/ui/feedback'
import { ExportPreview } from '@/components/data/ExportPreview'
import { router } from '@/app/routes'
import { loadCompany } from '@/lib/company'
import '@/styles/theme.css'

// Company name and logo, fetched before first paint where possible so the
// sign-in screen does not flash the default branding.
void loadCompany()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
        {/* Every export in the app surfaces here before it prints or downloads. */}
        <ExportPreview />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
