/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        es: {
          bg:        '#f3efe6',
          surface:   '#fbf9f4',
          surface2:  '#efe9dc',
          surface3:  '#e5ddd0',
          line:      '#ddd5c6',
          ink:       '#1c1a17',
          ink2:      '#6b6358',
          ink3:      '#9c9080',
          accent:    '#d2491f',
          'accent-h':'#b83d18',
          success:   '#22a06b',
          error:     '#e5484d',
          warning:   '#f59e0b',
          info:      '#1d4ed8',
        },
        brand: {
          50:  '#fdf2ef',
          100: '#fbe0d8',
          500: '#d2491f',
          600: '#d2491f',
          700: '#b83d18',
          900: '#8a2e12',
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
