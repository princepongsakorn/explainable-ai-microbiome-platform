const flowbite = require("flowbite-react/tailwind");

module.exports = {
  mode: "jit",
  content: [
    // ...
    flowbite.content(),
  ],
  purge: ["./pages/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  darkMode: false, // or 'media' or 'class'
  theme: {
    extend: {},
  },
  variants: {
    extend: {},
  },
  plugins: [flowbite.plugin()],
};
