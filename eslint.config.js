import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores(['dist', 'out', 'node_modules']),
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The swallowed-catch convention (#186, ADR 0031), made lint-able: a
    // `catch` that binds nothing is a failure nobody can ever learn about,
    // so every catch in the app binds its error and reports it through
    // `reportFault`. The rule reads the binding, not the call — a catch
    // that handles the error meaningfully (rethrows, returns it, wraps it)
    // already binds one and passes.
    //
    // Scoped to the two trees #186 swept; the renderer's own catches join
    // when its signals land (#187), and a test's catch reports to a sink
    // that is never installed, so neither is in scope here. The handful of
    // genuinely exempt catches — the sink, the reporter, each trace
    // writer's own guard — carry a disable comment at the site saying why,
    // rather than an ignored file, so a new bare catch added anywhere in
    // those same files is still caught.
    files: ['src/main/**/*.ts', 'src/core/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CatchClause[param=null]',
          message:
            'A swallowed failure must still be recorded: write `catch (error) { reportFault(\'area.module.fn\', error) }` (#186, ADR 0031).',
        },
      ],
    },
  },
)
