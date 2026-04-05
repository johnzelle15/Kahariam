/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dark: {
          900: 'rgb(var(--bg-primary) / <alpha-value>)',
          800: 'rgb(var(--bg-secondary) / <alpha-value>)',
          700: 'rgb(var(--bg-tertiary) / <alpha-value>)',
          600: 'rgb(var(--bg-elevated) / <alpha-value>)',
        },
        glass: {
          DEFAULT: 'var(--glass-bg)',
          border: 'var(--glass-border)',
          hover: 'var(--glass-bg-hover)',
        },
        accent: {
          purple: 'var(--accent-purple)',
          blue: 'var(--accent-blue)',
          cyan: 'var(--accent-cyan)',
          green: 'var(--accent-green)',
          red: 'var(--accent-red)',
          amber: 'var(--accent-amber)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.5s ease-out forwards',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
      },
      keyframes: {
        fadeInUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 12px rgba(167, 139, 250, 0.1)' },
          '50%': { boxShadow: '0 0 20px rgba(167, 139, 250, 0.18)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-4px)' },
        },
      },
    },
  },
  plugins: [],
}
