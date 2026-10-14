// tailwind.config.cjs
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        army: {
          DEFAULT: "#2e3d2f",
          light: "#cde0c9",
          dark: "#162217"
        }
      }
    }
  },
  plugins: [],
};
