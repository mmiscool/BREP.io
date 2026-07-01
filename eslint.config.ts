import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "dist/**",
      "dist-kernel/**",
      "node_modules/**",
      "public/**",
      "__BREP_DATA__/**",
      "manifold-plus/**",
      "vendor/**",
      "src/generated/**"
    ]
  },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
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
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2024
      }
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin
    },
    linterOptions: {
      reportUnusedDisableDirectives: "warn"
    },
    rules: {
      "no-unused-vars": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
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
      "scripts/**/*.ts",
      "bin/**/*.ts",
      "tests/**/*.ts",
      "src/tests/**/*.ts",
      "generateLicenses.ts",
      "eslint.config.ts",
      "vite.config.ts",
      "vite.config.kernel.ts"
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2024
      }
    }
  }
];
