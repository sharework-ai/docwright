# AGENTS.md

hanzeep is a deepseek-harness (dsh) plugin: closed-loop document generation with domain rule packs and replayable receipts. Design truth source: `docs/designs/hanzeep-mvp.md` (44-decision audit trail; positioning = domain rule packs + receipts + loop glue).

## Layout

```
src/        plugin code (entry: index.ts; loop.ts is the core repair loop)
packs/      built-in packs (cosmic-plan; hybrid JSON rules + JS functions)
tests/      vitest; coverage gate 100% lines/functions/statements, 80% branches
docs/       design doc + test plan
```

## Commands

```sh
pnpm test               # vitest
pnpm test:coverage      # coverage gate
pnpm run build          # tsc -b + tsdown
npx tsc -b tsconfig.json  # typecheck only
```

## Conventions (inherited from deepseek-harness/AGENTS.md)

- ESM everywhere; relative imports use `.ts` extensions (`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`).
- Registrations are effects (`ctx.tools.register` disposes with the fiber).
- Misconfiguration fails loud at plugin apply (bad manifest/ruleset/language).
- No hardcoded tunables: everything deployment-varying is a Config field.
- `@deepseek-ai/*` are peerDependencies; devDependencies use local `link:` targets under `../deepseek-harness` (bare symlinks; a sibling dsh checkout must be installed and `build:lib:host`-built first) because the published npm line is incomplete (see README Development note).
- Errors follow problem + cause + fix, with available options where applicable (unknown pack lists packs; bad language lists supported ones).
- The repair loop is the product: every change to loop.ts needs a deterministic test (scripted LlmPort; no live model in unit tests).

## Testing policy

- Loop/tool tests mock the LLM seam (`LlmPort`) with scripted replies.
- Every rule family in every pack ships with mutation tests (corrupt the golden sample; assert the checker catches it).
- Receipts are verified by re-hashing (key-order independent canonical JSON).
