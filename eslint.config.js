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
    // #186 swept main and core; the renderer joins here (#187), now that
    // it has a channel of its own to report down — `reportRendererFault`
    // is the page's `reportFault`, and with no diagnostics installed it
    // does nothing in exactly the same way. A test's catch reports to a
    // sink that is never installed, so tests stay out of scope. The
    // handful of genuinely exempt catches — the sink, the reporter, each
    // trace writer's own guard — carry a disable comment at the site
    // saying why, rather than an ignored file, so a new bare catch added
    // anywhere in those same files is still caught.
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
  {
    // The same rule for the renderer (#187), with the call it actually
    // has. `reportFault`'s sink is installed in main and is absent in a
    // renderer process, so a page that reported through it would report
    // into nothing — and the message, not the selector, is what a
    // developer reads when the rule fires.
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CatchClause[param=null]',
          message:
            'A swallowed failure must still be recorded: write `catch (error) { reportRendererFault(\'module.fn\', error) }` — the page\'s reporter, not main\'s `reportFault` (#187, ADR 0031).',
        },
      ],
    },
  },
)
