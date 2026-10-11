# E2E: real-LLM closed loop (zai coding plan)

Validated 2026-10-11 against `zai-coding-cn` / `glm-4.7`: doc_generate went green in
1 round (score 100), `doc_validate` replayed with `hashMatches: true`,
`packVersionStale: false`. This runbook reproduces it. No dsh upgrade needed —
`zai-coding-cn` is already in the pi-ai 0.85.1 provider catalog (`ZAI_CODING_CN_API_KEY`,
baseURL `open.bigmodel.cn/api/coding/paas/v4`).

## 1. Build and pack the plugin

```sh
cd ~/projects/lab/hanzeep && corepack pnpm build && corepack pnpm pack --pack-destination /tmp/hanzeep-zai
```

## 2. Sandbox a dsh home + profile

```sh
export DSH_HOME=/tmp/hanzeep-zai/home   # throwaway home; keeps ~/.dsh clean
cd ~/projects/lab/deepseek-harness      # dsh from source (pnpm dsh script)
corepack pnpm dsh --profile e2e --template headless plugin add /tmp/hanzeep-zai/dsh-plugin-hanzeep-*.tgz
```

Gotchas (each cost us time once):

- Launcher flags go BEFORE the subcommand: `dsh --profile e2e --template headless plugin add …`.
  `--template` after `plugin` is forwarded to pnpm and dies.
- A failed init still creates the profile with DEFAULT bundles (base only). If the headless
  app bundle is missing, fix `profiles/e2e/package.json` →
  `dsh.profile.bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"]`.
- `dsh plugin add` does more than pnpm: it appends bundles declaring `dsh.bundle` to
  `dsh.profile.bundles`. A manual `pnpm add <tgz>` must append `dsh-plugin-hanzeep` to that
  list by hand, or the plugin's patch layer never loads (`patch: entry "hanzeep" not found`).
- `pnpm --dir <dsh> dsh …` switches cwd to the dsh repo — pin the workspace with the
  hanzeep `workspaceRoot` config instead of relying on cwd.

## 3. Profile patch (`$DSH_HOME/profiles/e2e/cordis.patch.yml`)

```yaml
- id: llm-pi-ai
  config:
    providers:
      zai-coding-cn:
        apiKeyEnv: ZAI_CODING_CN_API_KEY

- id: agent-default-model        # base row pins deepseek-official; headless boots need it routed too
  config:
    provider: zai-coding-cn
    model: glm-4.7

- id: hanzeep
  config:
    provider: "zai-coding-cn"
    model: "glm-4.7"
    defaultLanguage: "zh-CN"
    workspaceRoot: "/tmp/hanzeep-zai/ws"
```

## 4. Run

```sh
export ZAI_CODING_CN_API_KEY=<key>   # env only; never commit
export DSH_PERMISSION_MODE=danger-full-access DSH_TELEMETRY_DISABLED=1
mkdir -p /tmp/hanzeep-zai/ws/references   # put req.md there
cd /tmp/hanzeep-zai/ws
corepack pnpm --pm-on-fail=ignore --dir ~/projects/lab/deepseek-harness dsh --profile e2e \
  '请调用 doc_generate 工具：pack 用 cosmic-plan，materials 传 ["req.md"]，artifactName 用 e2e-1。报告 receipt 的 isValid/iterations。'
```

`--pm-on-fail=ignore` bypasses the repo's pinned-pnpm version check. Artifacts land in
`/tmp/hanzeep-zai/ws/output/` (`<name>.json` + `.receipt.json` + `.md`). Follow with a
`doc_validate` task for the deterministic replay (`hashMatches` must be `true`).

## Calibration notes (D2 open questions 1/4)

The 2026-10-11 run needed 1 round (score 100 immediately), so it exercises the happy path
only. Weight/threshold calibration still needs multi-round runs: prompt for documents that
violate rules (e.g. omit required fields, short descriptions) and compare `rounds[].score`
trajectories and `terminationReason` against the default weights (10/3/1) and K=D=3.
