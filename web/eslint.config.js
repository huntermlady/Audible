import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

// Color literals (hex / rgb() / hsl() / oklch()) are banned where theming must come from tokens.
const COLOR_LITERAL = String.raw`/(#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch|oklab)\()/`

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'src/types/generated', 'playwright-report', 'test-results'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/components/charts/**/*.{ts,tsx}', 'src/components/field/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: `Literal[value=${COLOR_LITERAL}]`, message: 'No hard-coded colors in charts/field: use theme tokens (var(--…)).' },
        { selector: `TemplateElement[value.raw=${COLOR_LITERAL}]`, message: 'No hard-coded colors in charts/field: use theme tokens (var(--…)).' },
      ],
    },
  },
)
