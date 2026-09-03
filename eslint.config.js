// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'archive/*', '.expo/*'],
  },
  {
    // App code only (server code in firebase/functions intentionally logs -
    // its output goes to Google Cloud Logging and is how we debug the backend).
    files: ['App.tsx', 'index.ts', 'src/**/*.{ts,tsx}'],
    rules: {
      // Keep console.warn/error (production bug reports depend on them).
      // Bare console.log in app code should be gated behind __DEV__.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // React Compiler rules: downgraded to warnings for adoption. They flag
    // idiomatic React Native patterns (e.g. useRef(new Animated.Value()).current)
    // that are correct in this codebase. Fix gradually, then promote to errors.
    files: ['App.tsx', 'index.ts', 'src/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/unsupported-syntax': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/incompatible-library': 'warn',
    },
  },
]);
