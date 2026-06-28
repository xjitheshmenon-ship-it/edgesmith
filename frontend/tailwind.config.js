/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Edgesmith design tokens
        es: {
          bg:        '#f3efe6',
          surface:   '#fbf9f4',
          surface2:  '#efe9dc',
          line:      '#ddd5c6',
          ink:       '#1c1a17',
          ink2:      '#6b6358',
          accent:    '#d2491f',
          'accent-h':'#b83d18',
          success:   '#22a06b',
          error:     '#e5484d',
          warning:   '#f59e0b',
          navy:      '#11305f',
        },
        // keep brand alias pointing to accent for backwards compat
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
        es: '10px',
        'es-sm': '9px',
      },
      boxShadow: {
        es:   '0 6px 18px rgba(0,0,0,.08)',
        'es-sm': '0 1px 4px rgba(0,0,0,.08)',
      },
    },
  },
  plugins: [],
}
