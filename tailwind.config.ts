import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#171717",
        paper: "#f7f4ef",
        moss: "#536b55",
        rust: "#9b4f36",
        cloud: "#ece8df"
      }
    }
  },
  plugins: []
};

export default config;
