import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
  globalIgnores([
    "node_modules/**",
    "dist/**",
    "coverage/**",
    "provenance/**",
    ".venv*/**",
    "public/models/**",
    "public/wasm/**"
  ]),

  {
    files: ["**/*.js"],
    extends: [js.configs.recommended],

    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",

      globals: {
        ...globals.nodeBuiltin,
        ...globals.browser,
        chrome: "readonly"
      }
    }
  },

  {
    files: [
      "src/**/*.ts",
      "tests/**/*.ts"
    ],

    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked
    ],

    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      },

      globals: {
        ...globals.browser
      }
    },

    rules: {
      "no-undef": "off",

      "eqeqeq": [
        "error",
        "always"
      ],

      "no-console": "warn",

      "@typescript-eslint/no-explicit-any": "error",

      "@typescript-eslint/no-floating-promises": "error",

      "@typescript-eslint/no-misused-promises": "error",

      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          "prefer": "type-imports",
          "fixStyle": "inline-type-imports"
        }
      ],

      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_",
          "caughtErrorsIgnorePattern": "^_"
        }
      ]
    }
  }
);