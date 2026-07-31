import type { Config } from "tailwindcss";

/** Ciao brand — design doc §3.3: Mediterranean palette, sunlight-readable. */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sea: {
          DEFAULT: "#1B4F72",
          dark: "#143C57",
          light: "#2E6D99",
        },
        sand: "#F5EFE3",
        amber: {
          DEFAULT: "#E8A33D",
          dark: "#C9871F",
        },
      },
      fontFamily: {
        almarai: ["var(--font-almarai)", "Tahoma", "Arial", "sans-serif"],
        baloo: ["var(--font-baloo)", "var(--font-almarai)", "sans-serif"],
        inter: ["var(--font-inter)", "sans-serif"],
      },
      borderRadius: {
        bubble: "1.25rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
