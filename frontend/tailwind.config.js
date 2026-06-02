/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff6fc",
          100: "#d8e9f8",
          200: "#b3d2f0",
          300: "#82b4e6",
          400: "#4f91d8",
          500: "#2773c4",
          600: "#0b5cab",
          700: "#094d8f",
          800: "#08406f",
          900: "#0c2f4f",
          950: "#0a1726",
        },
        ink: {
          DEFAULT: "#1a2230",
          muted: "#64748b",
        },
      },
      fontFamily: {
        sans: [
          '"Segoe UI"',
          "system-ui",
          "-apple-system",
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: {
        xl: "14px",
        "2xl": "18px",
      },
      boxShadow: {
        card: "0 1px 3px rgba(16,24,40,.06), 0 1px 2px rgba(16,24,40,.04)",
        soft: "0 6px 24px rgba(16,24,40,.08)",
        pop: "0 12px 40px rgba(16,24,40,.16)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "100% 0" },
          "100%": { backgroundPosition: "0 0" },
        },
      },
      animation: {
        "fade-in": "fade-in .2s ease",
        shimmer: "shimmer 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
