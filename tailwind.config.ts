import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'sans-serif'],
        display: ['var(--font-fraunces)', 'serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      colors: {
        navy: {
          950: '#0a1428',
          900: '#0d1a35',
          800: '#111f3e',
          700: '#1a3060',
          600: '#1e3a72',
        },
        gold: {
          300: '#f0d49a',
          400: '#e0bd7c',
          500: '#c9a35c',
          600: '#b8923f',
          700: '#9a7a2e',
        },
      },
    },
  },
  plugins: [],
}

export default config
