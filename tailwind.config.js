/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,js}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"Segoe UI"',
          'Inter',
          'system-ui',
          'sans-serif',
        ],
      },
      colors: {
        'ios-blue':   '#007AFF',
        'ios-green':  '#34C759',
        'ios-red':    '#FF3B30',
        'ios-orange': '#FF9500',
        'ios-yellow': '#FFCC00',
        'ios-purple': '#AF52DE',
        'ios-teal':   '#30B0C7',
      },
      borderRadius: {
        'xs': '6px',
      },
      boxShadow: {
        'ios-xs': '0 2px 8px rgba(0,0,0,0.06)',
        'ios-sm': '0 4px 16px rgba(0,0,0,0.10)',
        'ios-md': '0 8px 28px rgba(0,0,0,0.14)',
        'ios-lg': '0 16px 40px rgba(0,0,0,0.18)',
        'ios-xl': '0 24px 56px rgba(0,0,0,0.22)',
        'ios-blue': '0 8px 24px rgba(0,122,255,0.30)',
        'ios-green': '0 8px 24px rgba(52,199,89,0.30)',
        'ios-red':  '0 8px 24px rgba(255,59,48,0.30)',
      },
    },
  },
  plugins: [],
};
