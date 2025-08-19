const js = require('@eslint/js');
const prettier = require('eslint-plugin-prettier');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  {
    ignores: ['node_modules/**', 'dist/**', 'build/**', 'web-ext-artifacts/**', 'manifest.json'],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Browser extension globals
        chrome: 'readonly',
        browser: 'readonly',

        // Standard browser globals
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        FormData: 'readonly',
        AbortController: 'readonly',
        NodeFilter: 'readonly',
        TreeWalker: 'readonly',
        confirm: 'readonly',
        alert: 'readonly',
        getComputedStyle: 'readonly',
        eval: 'readonly',

        // Node.js globals (for config files)
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        global: 'readonly',
      },
    },
    plugins: {
      prettier,
    },
    rules: {
      // Use recommended rules as base but make them loose
      ...js.configs.recommended.rules,

      // Prettier integration
      'prettier/prettier': 'warn',

      // Relaxed rules for development
      'no-unused-vars': 'warn',
      'no-console': 'off',
      'no-debugger': 'warn',
      'no-undef': 'error',
      'no-unused-expressions': 'off',
      'prefer-const': 'warn',
      'no-var': 'warn',

      // Allow flexible coding patterns
      'no-inner-declarations': 'off',
      'no-prototype-builtins': 'off',
      'no-fallthrough': 'warn',
      'no-empty': 'warn',
      'no-constant-condition': 'warn',

      // Browser extension specific allowances
      'no-global-assign': 'off', // Extensions modify global objects
      'no-implicit-globals': 'off', // Extensions use global scope
    },
  },
  // Apply prettier config to disable conflicting rules
  prettierConfig,
];
