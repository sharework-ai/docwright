# hanzeep

Closed-loop AI document generation for [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness): **domain rule packs + replayable validation receipts + a repair loop that refuses to ship red documents**.

JSON is the single source of truth. Every generated document is validated against its pack's JSON Schema and rule set; failures are fed back to the model for repair until all rules pass (or the loop exhausts and keeps a red-marked draft). Every document ships with a machine-readable receipt anyone can re-verify.

## Quickstart (deterministic, ~2 minutes, no API key)

```sh
dsh plugin add dsh-plugin-hanzeep   # 1. install the bundle into your profile
dsh                                 # 2. start a session with the profile
```

Copy the bundled sample into your workspace, then in the session:

```
> doc_validate(artifactPath: "sample.json", pack: "cosmic-plan")
# sample.json = the pack's bundled golden sample copied into your workspace
```

You get an all-green receipt in seconds — zero LLM calls. This is the deterministic first-run moment; `doc_generate` (the closed loop) is step two.

## Tools

### `doc_packs`

Zero-arg discovery tool: lists installed packs as `[{ name, version, description, languages, consumes, params }]` (params = the pack's declared tunables with type and description). The model-facing descriptions of `doc_generate`/`doc_validate` carry a static invitation to call `doc_packs` first; unknown-pack errors also point there. Descriptions never change with the pack set (pull-based progressive disclosure).

### `doc_generate`

| Parameter | Type | Notes |
|---|---|---|
| `pack` | string | e.g. `cosmic-plan`; unknown names list available packs |
| `materials` | string[] | paths relative to the materials root (default `<workspace>/references/`), or inline text starting with `#!inline` |
| `language` | string? | default: config `defaultLanguage`, else the pack's first language |
| `upstream` | string[]? | workspace-relative paths to upstream artifacts; each must carry a green sidecar receipt (hash-verified, pack type matched against `consumes`, and recording the installed pack version — see `upstreamVersionPolicy`) |
| `artifactName` | string? | output base name (default `<pack>-<timestamp>`) |
| `maxRounds` | number? | round cap for this call (user intent via the model); clamped to config `maxRoundsCeiling` |
| `params` | object? | overrides for pack-declared tunables (see `doc_packs`); unknown names or out-of-range values fail loud |

Returns `{ artifactPath, markdownPath, receipt }`. Artifacts, receipts, and markdown land in the output root (default `<workspace>/output/`). Exhausted loops throw AND keep the draft + red receipt on disk.

### `doc_validate`

Re-runs the ruleset over an existing artifact — deterministic, no LLM. `artifactPath` is workspace-relative (e.g. `output/plan-123.json`). Returns a fresh receipt; a hash mismatch means the artifact changed after generation.

Also returns `packVersionStale`: `true` when the sidecar receipt was written by a different pack version — the artifact predates the installed pack and its green receipt certifies the OLD rules, so regenerate; `false` when versions match; `null` when no receipt exists.

Validation replays by the receipt-recorded as-run pack params (original standards); pass `params` explicitly for what-if checks.

## Configuration (cordis.yml)

```yaml
- id: hanzeep
  config:
    packsDir: ""            # extra pack dirs; same-name packs override built-ins
    workspaceRoot: ""       # fallback root when no session workspace (default: cwd)
    materialsRoot: ""       # material reference root (default: <workspace>/references)
    outputRoot: ""          # artifact output root (default: <workspace>/output)
    defaultLanguage: "zh-CN"
    maxIterations: 5        # repair-loop global default rounds
    maxRoundsCeiling: 10    # absolute round cap no override can pierce (host-operator owned)
    promptTokenBudget: 60000
    upstreamVersionPolicy: "strict"  # chained upstream pack-version mismatch: "strict" rejects, "warn" proceeds with upstreamWarnings
    oscillation:            # repair-loop early-exit policy (docs/designs/convergence-detection.md)
      mode: auto            # auto | score | fingerprint
      stagnantRounds: 3     # consecutive rounds without beating the best score
      decliningRounds: 3    # consecutive strictly-decreasing rounds
      maxRepeats: 3         # fingerprint fallback: consecutive identical fingerprints
      epsilon: 0
      defaultScore: { error: 10, warning: 3, info: 1 }
    provider: "deepseek-official"  # an LLM route registered in the host (required)
    model: "deepseek-chat"
```

**Workspace & roots**: the per-call workspace root is the session's workspace directory (the conversation's cwd — e.g. the folder picked in the dsh web UI), falling back to `workspaceRoot`, then the process cwd. `materialsRoot`/`outputRoot` may be relative (joined to the workspace root) or absolute, but must resolve INSIDE the workspace root — anything else fails loud. Material references resolve against `materialsRoot`; artifact writes (and returned `artifactPath` values) live under `outputRoot`. Containment, tamper-evident receipts, and upstream chain verification all hold against the workspace root regardless of root customization. On Linux hosts, Windows drive-letter paths (`D:\x\y` / `d:/x/y`) passed to any path parameter are normalized to their WSL mounts via the `wslpath` binary when available (respecting custom mount roots), with a default-mount regex (`/mnt/<drive>/`) as fallback.

**Provider route names**: `provider` must name a route registered in the host's LLM composition. The bundled `dsh-llm-deepseek` adapter registers as `deepseek-official` (not `deepseek`); `dsh-llm-pi-ai` registers one route per configured provider profile. An unknown route surfaces as an empty stream (`NO_ADAPTER`), not a loud error — if `doc_generate` reports an llm-error on round 1, check the adapter's registered route name first.

## Packs

Hybrid packs: declarative JSON rules for simple families, JS functions for cross-field rules.

```
packs/cosmic-plan/
├── manifest.json     # name, version, description (one line, shown to models by doc_packs), consumes, languages, maxRounds?, params?
├── schema.json       # draft-07 JSON Schema
├── rules/zh-CN.json  # declarative: minLength / maxLength / forbiddenKeywords / pattern
├── rules/functions.js# export const rules = [{ id, severity, suggestion, check(artifact) }]; optional export function score(artifact, issues) => 0-100 (convergence scoring)
├── prompts/zh-CN.md  # generator prompt with {{materials}} / {{upstream}} slots
├── templates/zh-CN.hbs
└── samples/golden.json  # must pass all-green; feeds mutation tests
```

**Pack contract:** `manifest.description` is a required one-liner naming the document this pack generates (load-time enforced; `doc_packs` returns it verbatim to the model); `manifest.params` declares the pack's tunables (declaration IS the allowlist — `{ type, default, description, enum?, min?, max? }` per param; declarative-rule numeric bounds may reference number params via `{ "param": "name" }`); `manifest.maxRounds` optionally sets the pack's default loop rounds; every ERROR rule carries a `suggestion`; every language in `manifest.languages` provides rules + prompt + template; golden sample + per-rule-family mutations are mandatory (a checker that cannot catch a deliberately broken sample is decoration).

## Docs

- [Functional spec](docs/designs/hanzeep-mvp.md) — current-state behavior: tool semantics, loop and receipt details, and the plugin-vs-pack responsibility boundary (what the engine does vs. what a pack author writes).
- [Design proposals](docs/designs/) — D1 pack discovery, D2 convergence detection, D3 parameter bridge (PROPOSED, not yet implemented).

## Development

Requires a sibling checkout of [deepseek-harness](https://github.com/sharework-ai/deepseek-harness) at `../deepseek-harness`:

```sh
# one-time, inside ../deepseek-harness: install deps and build the lib/ outputs
corepack pnpm install && corepack pnpm run build:lib:host

# then, in this repo
corepack pnpm install
corepack pnpm test            # 130 tests, coverage gate 100% lines/functions/statements
corepack pnpm run build       # tsc + tsdown
```

**Note on devDependencies:** `@deepseek-ai/dsh-*` packages link to the local `deepseek-harness` checkout via `link:` (a bare symlink: `file:` would try to resolve dsh's `workspace:*` internals, which only resolve inside the dsh workspace). The linked packages' `exports` point at their `lib/` build outputs, hence the one-time dsh build above. `pnpm-workspace.yaml` overrides also align `cordis`/`cosmokit`/`schemastery` with dsh's vendored copies so a single instance of each loads per process. Runtime consumers never install these — they are `peerDependencies` resolved from the host dsh installation. Switch the `link:` entries back to registry versions once dsh publishes a complete release.

## Limitations

- Receipts are tamper-evident, not tamper-proof (no signature): accidental edits go red; a determined attacker can forge both artifact and receipt.
- Repair-loop observability lives in the receipt (per-round issue counts); dedicated session events are future work.
- Materials are trusted input: malicious material content can steer generation (documented trust model; accepted at review, nonce delimiters deferred).
