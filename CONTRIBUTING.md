# Contributing

Thanks for your interest in improving Smart Dependency Updater!

## Development setup

```bash
git clone https://github.com/mrdil07/Smart-Dependency-Updater.git
cd Smart-Dependency-Updater
npm install
```

## Useful scripts

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `npm run typecheck` | Type-check with `tsc --noEmit`.               |
| `npm test`          | Run the Jest unit tests.                      |
| `npm run build`     | Bundle `src/` into `dist/` with `ncc`.        |
| `npm run all`       | Type-check, test, and build.                  |

## Before you open a PR

1. **Rebuild the bundle.** GitHub runs `dist/index.js` directly, so it must be
   committed and current. Always run:

   ```bash
   npm run build
   ```

   and commit the updated `dist/`. CI fails if `dist/` is out of date.

2. **Add or update tests** for any behavior you change. The pure modules
   (`src/parser`, `src/ai/prompt`, `src/ai/openai`, title parsing) are easy to
   unit-test without network access — prefer keeping logic testable that way.

3. **Keep `npm run all` green.**

## Project layout

```
src/
  main.ts                 entry point
  config.ts               input parsing
  logger.ts               logging wrapper
  types.ts                shared types
  parser/logParser.ts     log cleaning + error/file extraction (pure)
  github/                 octokit client, logs, PR detection, commits
  ai/                     prompt building + OpenAI call
  remediation/            orchestration + attempt budget
__tests__/                unit tests
dist/                     committed build output (do not hand-edit)
```

## Reporting bugs

Open an issue with the failing CI log excerpt (redact secrets), the dependency
that was bumped, and what you expected the bot to do.

By contributing you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
