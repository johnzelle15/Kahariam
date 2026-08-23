import { create } from 'zustand'

const THEMES = {
  dark: {
    id: 'dark',
    label: 'Dark',
    class: 'theme-dark',
  },
  light: {
    id: 'light',
    label: 'Light',
    class: 'theme-light',
  },
  aqua: {
    id: 'aqua',
    label: 'Aqua',
    class: 'theme-aqua',
  },
}

function getInitialTheme() {
  try {
    const stored = localStorage.getItem('fc_theme')
    if (stored && THEMES[stored]) return stored
  } catch {}
  return 'light'
}

const useThemeStore = create((set, get) => ({
  theme: getInitialTheme(),
  themes: THEMES,

  setTheme: (themeId) => {
    if (!THEMES[themeId]) return
    localStorage.setItem('fc_theme', themeId)

    // Remove all theme classes, add the new one
    const root = document.documentElement
    Object.values(THEMES).forEach(t => root.classList.remove(t.class))
    root.classList.add(THEMES[themeId].class)

    // Toggle Tailwind dark mode
    if (themeId === 'light') {
      root.classList.remove('dark')
    } else {
      root.classList.add('dark')
    }

    set({ theme: themeId })
  },

  initTheme: () => {
    const { theme, setTheme } = get()
    setTheme(theme)
  },
}))

export { THEMES }
export default useThemeStore
