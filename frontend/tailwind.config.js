/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#09090b', 50: '#f7f7f8', 800: '#121216', 900: '#0b0b0e', 950: '#070709' },
        surface: '#101014',
        panel: '#15151a',
        raised: '#1b1b21',
        line: '#26262e',
        lineSoft: '#1e1e25',
        muted: '#8d8d99',
        faint: '#61616d',
        accent: { DEFAULT: '#8b5cf6', soft: '#a78bfa', dim: '#6d4bd6' },
        electric: '#5b8cff',
        success: '#3ecf8e',
        warn: '#f2b84b',
        danger: '#f26d78',
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro Text', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 0 rgba(255,255,255,0.03) inset, 0 18px 50px -30px rgba(0,0,0,0.9)',
        glow: '0 0 0 1px rgba(139,92,246,0.25), 0 10px 40px -18px rgba(139,92,246,0.5)',
      },
      borderRadius: { xl: '0.85rem', '2xl': '1.1rem' },
      keyframes: {
        fadeUp: { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        pulseSoft: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.45' } },
        caret: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
      },
      animation: {
        fadeUp: 'fadeUp 180ms ease-out',
        pulseSoft: 'pulseSoft 1.6s ease-in-out infinite',
        caret: 'caret 1s steps(2) infinite',
      },
    },
  },
  plugins: [],
};
