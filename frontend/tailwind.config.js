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
          green: 'var(--accent-green)',
          blue: 'var(--accent-blue)',
          amber: 'var(--accent-amber)',
          red: 'var(--accent-red)',
          purple: 'var(--accent-purple)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        /* Meaning, not hue. `text-positive` survives a palette change;
           `text-accent-green` quietly becomes a lie. */
        positive: 'var(--positive)',
        negative: 'var(--negative)',
        attention: 'var(--attention)',
        info: 'var(--info)',
        rule: 'var(--rule)',
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      /* Two card radii and one control radius, matching --r-md / --r-lg. The
         xl/2xl/3xl steps are pulled down onto the same scale rather than left
         at 0.75/1/1.5rem: a 16px round on a 90px-tall panel is what made these
         cards read as pill-shaped tiles instead of an instrument panel. */
      borderRadius: {
        lg: 'var(--r-md)',
        xl: 'var(--r-lg)',
        '2xl': 'var(--r-lg)',
        '3xl': 'var(--r-lg)',
      },
      spacing: {
        card: 'var(--pad-card)',
        section: 'var(--gap-section)',
        grid: 'var(--gap-grid)',
      },
    },
  },
  plugins: [],
}
