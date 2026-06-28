/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        es: {
          bg:        '#0f1b2d',
          surface:   '#152033',
          surface2:  '#1a2940',
          surface3:  '#1e3050',
          line:      '#243347',
          ink:       '#f0f4f8',
          ink2:      '#7a8fa6',
          ink3:      '#4a637d',
          accent:    '#3dd68c',
          'accent-h':'#2fc47d',
          success:   '#3dd68c',
          error:     '#f87171',
          warning:   '#fbbf24',
          info:      '#60a5fa',
        },
        brand: {
          500: '#3dd68c',
          600: '#2fc47d',
          700: '#22a06b',
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
