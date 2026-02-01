import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["dist/**", "build/**", "node_modules/**"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // minimal, on purpose
      "@typescript-eslint/no-unused-vars": ["warn"],
      "no-unused-vars": "off",
    },
  },
];
