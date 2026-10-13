/**
 * Real-LLM end-to-end: boots a REAL dsh host in-process (llm-pi-ai adapter,
 * zai route) and drives the docwright tools against the live model.
 *
 * Covers the shipped-contract moments that deterministic tests cannot:
 *   1. confirmation gate returns pendingConfirmation before any model call
 *   2. cosmic-plan generates green under a user budget (cfpTotal band)
 *   3. cosmic-req chains with targetIndex + no materials, auto-named
 *      `<pack>-<funcId>`, and reports fan-out coverage
 *   4. an externally edited artifact revalidates green and reseals (seal)
 *   5. doc_chain_status accounts the whole chain
 *
 * Prerequisites: sibling dsh checkout installed + build:lib:host-built.
 * Env: ZAI_CODING_CN_API_KEY (required — the script is a no-op without it),
 *      DOCWRIGHT_DSH_REPO (default ../deepseek-harness), E2E_MODEL (default
 *      glm-5.3-flash). The key is read from the environment only — never
 *      written to disk.
 *
 * Usage: ZAI_CODING_CN_API_KEY=... node --import tsx/esm scripts/e2e-real-llm.ts [--keep]
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PROFILE = 'docwright-e2e'
const MODEL = process.env['E2E_MODEL'] ?? 'glm-5.3-flash'

function fail(message: string): never {
  console.error(`e2e-real-llm: FAIL: ${message}`)
  process.exit(1)
}

if (process.env['ZAI_CODING_CN_API_KEY'] === undefined || process.env['ZAI_CODING_CN_API_KEY'] === '') {
  console.error('e2e-real-llm: SKIP: ZAI_CODING_CN_API_KEY not set (real-model run only)')
  process.exit(0)
}

const repoRoot = resolve(import.meta.dirname, '..')
const dshRepo = resolve(repoRoot, process.env['DOCWRIGHT_DSH_REPO'] ?? '../deepseek-harness')
const keep = process.argv.includes('--keep')

// Same respawn discipline as host-smoke: the dsh checkout resolves
// @deepseek-ai/* onto vendored TS sources via its tsconfig paths.
if (process.env['DOCWRIGHT_E2E_RESPAWNED'] !== '1') {
  const { status } = spawnSync(process.execPath, ['--import', 'tsx/esm', import.meta.filename, ...process.argv.slice(2)], {
    cwd: repoRoot,
    env: { ...process.env, DOCWRIGHT_E2E_RESPAWNED: '1', TSX_TSCONFIG_PATH: join(dshRepo, 'tsconfig.base.json') },
    stdio: 'inherit',
  })
  process.exit(status ?? 1)
}

const root = mkdtempSync(join(tmpdir(), 'docwright-e2e-'))
const home = join(root, 'home')
const workspace = join(root, 'workspace')
const { mkdirSync } = await import('node:fs')
mkdirSync(workspace, { recursive: true })
console.log(`e2e-real-llm: sandbox ${root}`)

execFileSync('corepack', ['pnpm', 'pack', '--pack-destination', root], { cwd: repoRoot, stdio: 'pipe' })
const tarball = readdirSync(root).find(file => file.endsWith('.tgz'))
if (tarball === undefined) fail('pnpm pack produced no tarball')
const env = { ...process.env, DSH_HOME: home }
execFileSync('corepack', ['pnpm', '--pm-on-fail=ignore', '--dir', dshRepo, 'dsh', 'plugin', '--profile', PROFILE, 'add', join(root, tarball!)], { env, stdio: 'pipe' })
writeFileSync(join(home, 'profiles', PROFILE, 'cordis.patch.yml'), `
- id: llm-pi-ai
  config:
    providers:
      zai-coding-cn:
        apiKeyEnv: ZAI_CODING_CN_API_KEY
- id: agent-default-model
  config:
    provider: zai-coding-cn
    model: ${MODEL}
`)

process.env['DSH_HOME'] = home
const { runProfile } = await import(pathToFileURL(join(dshRepo, 'apps/cli/src/profile-boot.ts')).href)
const { loadLayeredEnv } = await import(pathToFileURL(join(dshRepo, 'packages/boot/app-boot/src/index.ts')).href)
const booted = await runProfile({ environment: loadLayeredEnv('dsh'), profile: PROFILE, patchFiles: [], args: [] })
const hostCtx = booted.ctx as unknown as { llm?: unknown; fiber?: { dispose(): Promise<void> } }
if (hostCtx.llm === undefined) fail('booted host exposes no ctx.llm')
console.log(`e2e-real-llm: host booted (model ${MODEL})`)

const { loadPacks } = await import(pathToFileURL(join(repoRoot, 'src/pack-loader.ts')).href)
const { defineDocGenerateTool, defineDocValidateTool, defineDocChainStatusTool } = await import(pathToFileURL(join(repoRoot, 'src/tools.ts')).href)
const packs = await loadPacks(join(repoRoot, 'packs'), {})
const config = { provider: 'zai-coding-cn', model: MODEL, workspaceRoot: workspace, maxIterations: 5, promptTokenBudget: 60_000 }
const deps = { packs, config, ctx: hostCtx }
const gen = defineDocGenerateTool(deps as never)
const validate = defineDocValidateTool(deps as never)
const chainStatus = defineDocChainStatusTool(deps as never)
const exec = { signal: new AbortController().signal }

try {
  // 1. Confirmation gate fires before any model spend (no confirm flag).
  const gated = await gen.execute({ pack: 'cosmic-plan', materials: ['#!inline\n需求：为电商系统新增收藏夹功能'] } as never, exec as never) as { pendingConfirmation?: boolean; missingRequired: string[] }
  if (gated.pendingConfirmation !== true || !gated.missingRequired.includes('cfpTotal')) {
    fail(`gate did not fire as designed: ${JSON.stringify(gated).slice(0, 200)}`)
  }
  console.log('e2e-real-llm: 1. gate OK (pendingConfirmation, cfpTotal missing)')

  // 2. Real plan generation under a user budget.
  const BUDGET = { value: 60, downFactor: 0.9, upFactor: 1.2 }
  const plan = await gen.execute({
    pack: 'cosmic-plan', materials: ['#!inline\n需求：为电商系统新增收藏夹功能。用户可收藏商品、浏览收藏列表（含最新价格与降价标记）、将收藏移入购物车、取消收藏。请分解为 4 个左右叶子功能。'], language: 'zh-CN', params: { cfpTotal: BUDGET }, confirm: true, artifactName: 'plan',
  } as never, exec as never) as { receipt: { isValid: boolean; iterations: number; rounds: Array<{ errorCount: number }>; params?: Record<string, unknown> }; summary: { functions?: number; totalCfps?: number } }
  if (plan.receipt.isValid !== true) fail(`plan not green: ${JSON.stringify(plan.receipt.rules)}`)
  console.log(`e2e-real-llm: 2. plan green in ${plan.receipt.iterations} round(s); ${plan.summary.functions} functions, totalCfps ${plan.summary.totalCfps} in [${BUDGET.value * BUDGET.downFactor}, ${BUDGET.value * BUDGET.upFactor}]`)

  // 3. Chained req: targetIndex picks function 1, NO materials, auto-named.
  const planArtifact = JSON.parse(await (await import('node:fs/promises')).readFile(join(workspace, 'output', 'plan.json'), 'utf8')) as { functions: Array<{ funcId: string }> }
  const firstFuncId = planArtifact.functions[0]!.funcId as string
  const req = await gen.execute({
    pack: 'cosmic-req', language: 'zh-CN', upstream: ['output/plan.json'], params: { targetIndex: 1 }, confirm: true,
  } as never, exec as never) as { artifactPath: string; receipt: { isValid: boolean }; coverage?: { covered: number; total: number; missing: string[] } }
  if (req.receipt.isValid !== true) fail('req not green')
  if (!req.artifactPath.endsWith(`cosmic-req-${firstFuncId}.json`)) fail(`req artifact not auto-named: ${req.artifactPath}`)
  if (req.coverage === undefined || req.coverage.total !== planArtifact.functions.length) fail(`coverage missing or wrong: ${JSON.stringify(req.coverage)}`)
  console.log(`e2e-real-llm: 3. req green (auto-named ${req.artifactPath.split('/').pop()}, coverage ${req.coverage.covered}/${req.coverage.total})`)

  // 4. Seal: external edit that stays green re-issues the sidecar.
  const { readFile: readFileAsync, writeFile: writeFileAsync } = await import('node:fs/promises')
  const reqPath = join(workspace, 'output', `cosmic-req-${firstFuncId}.json`)
  const edited = JSON.parse(await readFileAsync(reqPath, 'utf8')) as { businessRules: Array<{ description: string }> }
  edited.businessRules[0]!.description = edited.businessRules[0]!.description + '（人工复核确认。）'
  await writeFileAsync(reqPath, JSON.stringify(edited, null, 2), 'utf8')
  const sealed = await validate.execute({ artifactPath: `output/cosmic-req-${firstFuncId}.json`, pack: 'cosmic-req', language: 'zh-CN', upstream: ['output/plan.json'] } as never, exec as never) as { sealed?: boolean; receipt: { isValid: boolean }; hashMatches: boolean | null }
  if (sealed.receipt.isValid !== true || sealed.sealed !== true) fail(`seal failed: isValid=${String(sealed.receipt.isValid)} sealed=${String(sealed.sealed)}`)
  console.log(`e2e-real-llm: 4. seal OK (edited artifact revalidated green; hashMatches pre-seal = ${String(sealed.hashMatches)})`)

  // 5. Whole-chain accounting.
  const status = await chainStatus.execute({ plan: 'output/plan.json' } as never, exec as never) as { coverage: Record<string, { covered: number; total: number }>; stages: string[] }
  if (status.coverage['cosmic-req']?.covered !== 1) fail(`chain status wrong: ${JSON.stringify(status.coverage)}`)
  console.log(`e2e-real-llm: 5. chain status OK (stages ${status.stages.join(' → ')})`)

  console.log('e2e-real-llm: PASS')
} finally {
  await (booted.shutdown as { shutdown(code: number): Promise<void> }).shutdown(0).catch(() => {})
}
if (!keep) rmSync(root, { recursive: true, force: true })
