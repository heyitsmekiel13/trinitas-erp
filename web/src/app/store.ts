import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'
export type Density = 'comfortable' | 'compact'

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = resolveTheme(theme)
}

type UiState = {
  theme: Theme
  density: Density
  /** Desktop rail collapse. */
  sidebarCollapsed: boolean
  /** Mobile off-canvas drawer. */
  mobileNavOpen: boolean
  commandOpen: boolean
  /** Departments expanded in the sidebar tree. */
  expanded: string[]
  setTheme: (t: Theme) => void
  toggleTheme: () => void
  setDensity: (d: Density) => void
  toggleSidebar: () => void
  setMobileNav: (open: boolean) => void
  setCommandOpen: (open: boolean) => void
  toggleExpanded: (id: string) => void
  expand: (id: string) => void
  setExpanded: (ids: string[]) => void
}

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      density: 'comfortable',
      sidebarCollapsed: false,
      mobileNavOpen: false,
      commandOpen: false,
      // Nothing expanded by default — see useAuth's login/verifyCode, which
      // reset this on every fresh sign-in. Landing on a page should never
      // show an accordion left open from a department nobody is looking at.
      expanded: [],

      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
      toggleTheme: () => {
        const next = resolveTheme(get().theme) === 'dark' ? 'light' : 'dark'
        applyTheme(next)
        set({ theme: next })
      },
      setDensity: (density) => set({ density }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setMobileNav: (mobileNavOpen) => set({ mobileNavOpen }),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      toggleExpanded: (id) =>
        set((s) => ({
          expanded: s.expanded.includes(id) ? s.expanded.filter((x) => x !== id) : [...s.expanded, id],
        })),
      expand: (id) => set((s) => (s.expanded.includes(id) ? s : { expanded: [...s.expanded, id] })),
      /** Reset point for a fresh sign-in — see useAuth's login/verifyCode. */
      setExpanded: (expanded) => set({ expanded }),
    }),
    {
      name: 'trinitas.ui',
      partialize: (s) => ({
        theme: s.theme,
        density: s.density,
        sidebarCollapsed: s.sidebarCollapsed,
        expanded: s.expanded,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme)
      },
    },
  ),
)

// Keep 'system' honest when the OS preference changes mid-session.
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useUi.getState().theme === 'system') applyTheme('system')
  })
}

/** Mirrors the theme choice for chart code that needs a concrete mode. */
export function useResolvedTheme(): 'light' | 'dark' {
  const theme = useUi((s) => s.theme)
  return resolveTheme(theme)
}
