# Frontend instructions

Root AGENTS.md also applies.

## Structure and conventions

- Add capabilities in src/features/<capability> with colocated UI, API/client types and tests. Use index.ts only as a public export surface, with no executable behavior.
- src/app composes features. Features may consume another feature's public index, never its internal files; features cannot import app. Shared code cannot depend on features or app. The local ESLint rule enforces these constraints on relative imports and exports. Do not add aliases that bypass it.
- Use functional React components, hooks with complete dependencies, semantic accessible HTML and observable loading/error states.
- TypeScript is strict, including noUncheckedIndexedAccess and exactOptionalPropertyTypes. Parse external data from unknown; do not silence validation with assertions or any.
- Avoid premature state management, routing and generic API layers. Keep effects safe under React StrictMode cleanup and repeated setup.
- Run Prettier and type-aware ESLint; use type-only imports. Keep runtime React prop validation disabled because TypeScript owns component types.

## Commands and tests

```sh
make check-frontend
make test-frontend
make coverage-frontend
make mutation-frontend
make audit-frontend
docker compose -p ici-tools -f compose.tools.yaml run --build --rm node npm test -- src/features/identity/Identity.test.tsx
```

Vitest/Testing Library test visible behavior; MSW mocks the HTTP boundary and rejects unhandled requests. Test loading, success, server/network errors, invalid payloads and obsolete effects. Use Playwright for production-stack functional tests (`make e2e`). Prefer accessible role queries over CSS selectors and snapshots.

Coverage includes unimported source files, with 90% lines/statements/functions/branches. Only test infrastructure, pure export barrels and the DOM mount entry point are excluded from coverage. The entry point is exercised by E2E tests. Styles, UI components, API clients and app composition must not be excluded. Stryker mutates each slice's model.ts and api.ts and requires 100%; keep non-visual logic in those files.

Run `npm run test:architecture` when changing ESLint boundaries. The npm scripts can also run natively with the pinned Node toolchain after npm ci; containers are the reference environment.
