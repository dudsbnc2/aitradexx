/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#020b14',
          surface: '#071524',
          elevated: '#0c1f35',
          card: '#0f2540',
          border: '#1a3a5c',
          hover: '#162d4a',
        },
        brand: {
          DEFAULT: '#00d4ff',
          dim: '#0099bb',
          glow: 'rgba(0,212,255,0.15)',
        },
        accent: {
          green: '#00ff88',
          red: '#ff4466',
          yellow: '#ffcc00',
          purple: '#b366ff',
          orange: '#ff8833',
        },
        text: {
          primary: '#e8f4ff',
          secondary: '#8ba3be',
          muted: '#3d5a73',
          inverse: '#020b14',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
        sans: ['Syne', 'sans-serif'],
        display: ['Syne', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'brand-gradient': 'linear-gradient(135deg, #00d4ff, #0099bb)',
        'glow-gradient': 'radial-gradient(ellipse at center, rgba(0,212,255,0.15) 0%, transparent 70%)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'float': 'float 6s ease-in-out infinite',
        'slide-in': 'slideIn 0.3s ease-out',
        'fade-in': 'fadeIn 0.4s ease-out',
        'blink': 'blink 1.5s ease-in-out infinite',
        'counter': 'counter 0.6s ease-out',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(0,212,255,0.2)' },
          '100%': { boxShadow: '0 0 20px rgba(0,212,255,0.5)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        slideIn: {
          '0%': { opacity: 0, transform: 'translateY(10px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
        blink: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.3 },
        },
      },
      boxShadow: {
        'brand': '0 0 20px rgba(0,212,255,0.3)',
        'brand-sm': '0 0 10px rgba(0,212,255,0.15)',
        'card': '0 4px 24px rgba(0,0,0,0.4)',
        'green': '0 0 20px rgba(0,255,136,0.25)',
        'red': '0 0 20px rgba(255,68,102,0.25)',
      },
    },
  },
  plugins: [],
}
