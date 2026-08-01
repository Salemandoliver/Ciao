import type { Config } from "tailwindcss";

/** Ciao brand — design doc §3.3: Mediterranean palette, sunlight-readable. */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  // Theme is a user preference stored on their account and echoed to a class
  // on <html> before first paint, not a guess from the OS alone.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Every brand colour resolves through a CSS variable, so switching
        // theme re-points the tokens and every component follows — including
        // ones written a year from now that never heard of dark mode.
        sea: {
          DEFAULT: "rgb(var(--sea) / <alpha-value>)",
          dark: "rgb(var(--sea-dark) / <alpha-value>)",
          light: "rgb(var(--sea-light) / <alpha-value>)",
        },
        sand: "rgb(var(--sand) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        // Secondary/tertiary ink and the link colour. Deliberately NOT alpha
        // shades of `sea`: see the note in globals.css.
        muted: "rgb(var(--muted) / <alpha-value>)",
        faint: "rgb(var(--faint) / <alpha-value>)",
        link: "rgb(var(--link) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        amber: {
          DEFAULT: "rgb(var(--amber) / <alpha-value>)",
          dark: "rgb(var(--amber-dark) / <alpha-value>)",
        },
      },
      fontFamily: {
        almarai: ["var(--font-almarai)", "Tahoma", "Arial", "sans-serif"],
        baloo: ["var(--font-baloo)", "var(--font-almarai)", "sans-serif"],
        // Almarai stays in the English stack: untranslated listing titles are
        // Arabic, and Inter's Arabic fallback is whatever the phone has.
        inter: ["var(--font-inter)", "var(--font-almarai)", "Tahoma", "sans-serif"],
      },
      borderRadius: {
        bubble: "1.25rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
