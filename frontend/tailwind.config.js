/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        es: {
          bg:        '#0a1e47',
          surface:   '#11305f',
          surface2:  '#162d72',
          surface3:  '#1e3d8a',
          line:      '#1e4080',
          ink:       '#eaf4e4',
          ink2:      '#9bb4d4',
          ink3:      '#5a7aaa',
          accent:    '#d4eecb',
          'accent-h':'#bde0b0',
          success:   '#5dd68c',
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
        es: '10px',
        'es-sm': '8px',
      },
      boxShadow: {
        es:   '0 4px 16px rgba(0,0,0,.24)',
        'es-sm': '0 1px 4px rgba(0,0,0,.16)',
      },
    },
  },
  plugins: [],
}
