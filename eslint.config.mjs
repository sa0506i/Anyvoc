import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactNative from "eslint-plugin-react-native";
import prettier from "eslint-config-prettier";

// Node-only modules that must never appear in lib/, app/, components/, hooks/, constants/
const BANNED_NODE_IMPORTS = [
  "fs", "node:fs", "path", "node:path", "node:https", "node:http",
  "better-sqlite3", "axios", "tar",
];

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "node_modules/",
      "android/",
      "ios/",
      ".expo/",
      "tmp/",
      "scripts/",
      "backend/",
      "lib/data/",
      "babel.config.js",
      "metro.config.js",
      "jest.config.js",
      "jest.setup.js",
      "**/*.test.ts",
      "**/*.test.tsx",
    ],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript recommended (type-aware disabled — too slow for hooks)
  ...tseslint.configs.recommended,

  // React Native plugin
  {
    plugins: { "react-native": reactNative },
    rules: {
      // Disabled: false positives with createStyles(colors) pattern used throughout
      "react-native/no-unused-styles": "off",
      "react-native/no-inline-styles": "warn",
    },
  },

  // Prettier compat (turns off conflicting formatting rules)
  prettier,

  // -----------------------------------------------------------
  // Custom rules: "Computational feedforward" harness
  // -----------------------------------------------------------

  // Ban Node-only imports in client-side code
  // (Turns the CLAUDE.md "Hard rule" into a deterministic sensor)
  {
    files: ["lib/**/*.ts", "lib/**/*.tsx", "app/**/*.ts", "app/**/*.tsx",
            "components/**/*.ts", "components/**/*.tsx",
            "hooks/**/*.ts", "hooks/**/*.tsx",
            "constants/**/*.ts", "constants/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: BANNED_NODE_IMPORTS.map(name => ({
          name,
          message: `Node-only import '${name}' is banned in client code. ` +
            `Move this code to scripts/ or use a React Native compatible alternative. ` +
            `See CLAUDE.md "Hard rule" section.`,
        })),
      }],
    },
  },

  // Catch common issues
  {
    rules: {
      // Not useful for this project's error handling patterns
      "preserve-caught-error": "off",
      // TypeScript handles these better
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
      // Allow require() for Metro static requires (freq/aoa JSON loading)
      "@typescript-eslint/no-require-imports": "off",
      // Allow explicit any sparingly (warn, not error)
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
