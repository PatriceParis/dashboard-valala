import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Valala brand accent (purple/blue)
        brand: {
          50: "#f3f4ff",
          100: "#e6e8ff",
          200: "#c9cdff",
          300: "#a4abff",
          400: "#8b92ff",
          500: "#6f7bff",
          600: "#5a64e6",
          700: "#454fbf",
          800: "#333a91",
          900: "#1f2363",
        },
      },
    },
  },
  plugins: [],
};

export default config;
