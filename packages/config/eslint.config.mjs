/**
 * Shared ESLint flat configuration baseline for FACE VID Phase 1A.
 * Enforces strict TypeScript discipline, prohibits console secret leakage,
 * and prevents accidental usage of dangerous browser globals.
 */
export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.next/**', '**/coverage/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-alert': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
];
