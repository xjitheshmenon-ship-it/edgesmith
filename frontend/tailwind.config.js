/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        es: {
          bg:        '#11305f',
          surface:   '#173a70',
          surface2:  '#21498a',
          surface3:  '#2a5aa0',
          line:      '#2c5191',
          ink:       '#eaf4e4',
          ink2:      '#9bb4d4',
          ink3:      '#5a7aaa',
          accent:    '#d4eecb',
          'accent-h':'#bde0b0',
          success:   '#22a06b',
          error:     '#f87171',
          warning:   '#fbbf24',
          info:      '#60a5fa',
        },
        brand: {
          500: '#d4eecb',
          600: '#bde0b0',
          700: '#a0c890',
        },
      },
      fontFamily: {
        archivo:  ['Archivo', 'system-ui', 'sans-serif'],
        mono:     ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        sans:     ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        es: '12px',
        'es-sm': '9px',
      },
      boxShadow: {
        es:   '0 2px 8px rgba(0,0,0,.06)',
        'es-sm': '0 1px 4px rgba(0,0,0,.06)',
      },
    },
  },
  plugins: [],
}
