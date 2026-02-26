import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "dist/**",
      "dist-kernel/**",
      "node_modules/**",
      "public/**",
      "__BREP_DATA__/**",
      "src/generated/**"
    ]
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2024
      }
    },
    linterOptions: {
      reportUnusedDisableDirectives: "warn"
    },
    rules: {
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-constant-binary-expression": "warn",
      "no-undef": "warn",
      "no-unused-private-class-members": "warn",
      "no-useless-catch": "warn",
      "no-unsafe-finally": "warn",
      "no-useless-escape": "warn",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ]
    }
  },
  {
    files: [
      "scripts/**/*.js",
      "bin/**/*.js",
      "tests/**/*.js",
      "src/tests/**/*.js",
      "generateLicenses.js",
      "vite.config.js",
      "vite.config.kernel.js"
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2024
      }
    }
  }
];
