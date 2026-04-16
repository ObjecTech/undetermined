import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        graphite: {
          950: "#111315",
          900: "#1a1d1f",
          800: "#232729",
          700: "#394043",
        },
        mist: {
          50: "#f5f6f2",
          100: "#eeefe9",
          200: "#dde1d5",
        },
        sage: {
          100: "#d8e0d4",
          200: "#b3c0a8",
          300: "#88997f",
          400: "#65765e",
        },
      },
      boxShadow: {
        panel: "0 22px 80px rgba(17, 19, 21, 0.18)",
        launcher: "0 12px 34px rgba(17, 19, 21, 0.22)",
      },
      backdropBlur: {
        panel: "20px",
      },
      keyframes: {
        "panel-in": {
          "0%": { opacity: "0", transform: "translateX(28px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateX(0) scale(1)" },
        },
        "ball-float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-3px)" },
        },
      },
      animation: {
        "panel-in": "panel-in 240ms cubic-bezier(0.16, 1, 0.3, 1)",
        "ball-float": "ball-float 3.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
