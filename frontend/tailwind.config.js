/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#050505',
        surface: '#0a0a0a',
        'surface-light': '#171717',
        border: 'rgba(255, 255, 255, 0.08)',
      },
    },
  },
  plugins: [],
}
