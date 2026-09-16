/* A colour held in a CSS variable takes no opacity modifier by itself:
   Tailwind cannot split var(--negative) into channels, so `bg-negative/10`
   generated nothing and every tinted band and badge in the app rendered with
   no ground at all. color-mix gives the modifier something to act on; with no
   modifier the colour is the plain variable, exactly as before. */
const mixable = v => ({ opacityValue }) =>
  opacityValue === undefined || String(opacityValue).startsWith('var(')
    ? `var(${v})`
    : `color-mix(in srgb, var(${v}) ${opacityValue * 100}%, transparent)`

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
          green: mixable('--accent-green'),
          blue: mixable('--accent-blue'),
          amber: mixable('--accent-amber'),
          red: mixable('--accent-red'),
          purple: mixable('--accent-purple'),
        },
        text: {
          primary: mixable('--text-primary'),
          secondary: mixable('--text-secondary'),
          muted: mixable('--text-muted'),
        },
        /* Meaning, not hue. `text-positive` survives a palette change;
           `text-accent-green` quietly becomes a lie. */
        positive: mixable('--positive'),
        negative: mixable('--negative'),
        attention: mixable('--attention'),
        info: mixable('--info'),
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
