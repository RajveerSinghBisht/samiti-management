import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import pluginSecurity from 'eslint-plugin-security';

const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  pluginSecurity.configs.recommended,
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      '.data/**',
      'next-env.d.ts',
      'scripts/**/*.mjs',
    ],
  },
];

export default eslintConfig;

