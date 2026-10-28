import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'
import type { ConnectionLike, WebServerLike } from '../src/http.ts'
import { mountParamsRoutes } from '../src/http.ts'
import { loadPacks } from '../src/pack-loader.ts'
import type { Pack } from '../src/pack.ts'
import { buildConfigCatalog, buildParamsCatalog, buildParamsPayload, paramRoles, type SchemaNode, type UiParamDeclaration } from '../src/params-rpc.ts'

const packsRoot = fileURLToPath(new URL('../packs', import.meta.url))

/** Manifest-only pack stand-in: the catalog functions read manifest fields only. */
function packOf(manifest: Record<string, unknown>): Pack {
  return { manifest } as never as Pack
}

function chainPacks(): Map<string, Pack> {
  const num = (def: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ type: 'number', default: def, description: 'd', ...extra })
  return new Map([
    ['chain-a', packOf({ name: 'chain-a', version: '1', description: 'da', scope: 'topic', consumes: [], params: { shared: num(1), onlyA: { type: 'string', default: 'a', description: 'd' } } })],
    ['chain-b', packOf({ name: 'chain-b', version: '1', description: 'db', scope: 'topic', consumes: ['chain-a'], params: { shared: num(2), ownB: num(3) } })],
    ['chain-c', packOf({ name: 'chain-c', version: '1', description: 'dc', scope: 'topic', consumes: ['chain-b'], params: { shared: num(4), noDefault: { type: 'number', required: true, description: 'd' }, bounded: num(5, { enum: [5, 6, 7], min: 1, max: 10 }) } })],
    ['chain-sync', packOf({ name: 'chain-sync', version: '1', description: 'ds', scope: 'workspace', consumes: ['chain-a', 'chain-b'], paramDriftPolicy: 'revalidate', params: { shared: num(9) } })],
  ])
}

describe('paramRoles', () => {
  it('resolves the transitive origin: every downstream shadow traces to the chain head', () => {
    const roles = paramRoles(chainPacks())
    expect(roles.get('chain-a')!.get('shared')).toEqual({ role: 'source' })
    expect(roles.get('chain-b')!.get('shared')).toEqual({ role: 'shadowed', shadowedBy: 'chain-a' })
    // chain-c's nearest declarer is chain-b, but chain-b is itself shadowed —
    // the origin (chain-a's default) is what reaches c's receipts.
    expect(roles.get('chain-c')!.get('shared')).toEqual({ role: 'shadowed', shadowedBy: 'chain-a' })
  })

  it('skips upstreams that do not declare the param and unknown consumed names', () => {
    const packs = new Map([
      ['up-none', packOf({ name: 'up-none', version: '1', description: 'd', scope: 'topic', consumes: [], params: { other: { type: 'number', default: 1, description: 'd' } } })],
      ['down', packOf({ name: 'down', version: '1', description: 'd', scope: 'topic', consumes: ['up-none', 'ghost-pack'], params: { mine: { type: 'number', default: 2, description: 'd' } } })],
    ])
    const roles = paramRoles(packs)
    expect(roles.get('down')!.get('mine')).toEqual({ role: 'source' })
  })

  it('resolves multi-upstream ambiguity by consumes order and terminates on cycles', () => {
    const roles = paramRoles(chainPacks())
    expect(roles.get('chain-sync')!.get('shared')).toEqual({ role: 'shadowed', shadowedBy: 'chain-a' })
    const cycle = new Map([
      ['x', packOf({ name: 'x', version: '1', description: 'd', scope: 'topic', consumes: ['y'], params: { p: { type: 'number', default: 1, description: 'd' } } })],
      ['y', packOf({ name: 'y', version: '1', description: 'd', scope: 'topic', consumes: ['x'], params: { p: { type: 'number', default: 2, description: 'd' } } })],
    ])
    expect(paramRoles(cycle).get('x')!.get('p')!.role).toBe('shadowed')
  })
})

describe('buildParamsCatalog', () => {
  it('shows only default-carrying params with full metadata and roles', () => {
    const catalog = buildParamsCatalog(chainPacks())
    expect(catalog.packs.map(p => p.name)).toEqual(['chain-a', 'chain-b', 'chain-c', 'chain-sync'])
    const c = catalog.packs.find(p => p.name === 'chain-c')!
    // noDefault (required, no default) is excluded by the inclusion criterion.
    expect(c.params.map(p => p.name)).toEqual(['bounded', 'shared'])
    const bounded = c.params.find(p => p.name === 'bounded')!
    expect(bounded).toMatchObject({ default: 5, enumValues: [5, 6, 7], min: 1, max: 10, role: 'source', required: false, confirm: false, overridable: false, extractable: false })
    expect(c.consumes).toEqual(['chain-b'])
    const sync = catalog.packs.find(p => p.name === 'chain-sync')!
    expect(sync.scope).toBe('workspace')
    expect(sync.paramDriftPolicy).toBe('revalidate')
  })

  it('aggregates same-name declarations with sources and per-pack roles', () => {
    const catalog = buildParamsCatalog(chainPacks())
    const shared = catalog.groups.find(g => g.name === 'shared')!
    expect(shared.sources).toEqual(['chain-a'])
    expect(shared.declarations.map((d: UiParamDeclaration) => [d.pack, d.role, d.shadowedBy])).toEqual([
      ['chain-a', 'source', undefined],
      ['chain-b', 'shadowed', 'chain-a'],
      ['chain-c', 'shadowed', 'chain-a'],
      ['chain-sync', 'shadowed', 'chain-a'],
    ])
    expect(catalog.groups.map(g => g.name)).toEqual(['bounded', 'onlyA', 'ownB', 'shared'])
  })

  it('anchors against the real builtin packs: cfp* governed by the plan head, topicNoPattern by context', async () => {
    const packs = await loadPacks(packsRoot, {})
    const catalog = buildParamsCatalog(packs)
    const cfpPerFunc = catalog.groups.find(g => g.name === 'cfpPerFunc')!
    expect(cfpPerFunc.sources).toEqual(['cosmic-plan'])
    expect(cfpPerFunc.declarations.map(d => d.pack)).toEqual(['cosmic-func', 'cosmic-plan', 'cosmic-req', 'cosmic-tech'])
    const pattern = catalog.groups.find(g => g.name === 'topicNoPattern')!
    expect(pattern.sources).toEqual(['cosmic-context'])
    // cfpTotal (required, no default) and topicNo (derived, no default) never appear.
    expect(catalog.groups.map(g => g.name)).not.toContain('cfpTotal')
    expect(catalog.groups.map(g => g.name)).not.toContain('topicNo')
    const plan = catalog.packs.find(p => p.name === 'cosmic-plan')!
    expect(plan.version).toBe('0.6.0')
    // cfpTotal (required, no default) is excluded from the plan's own list too.
    expect(plan.params.map(p => p.name)).not.toContain('cfpTotal')
    expect(plan.params.map(p => p.name)).toContain('cfpPerFunc')
  })
})

describe('buildConfigCatalog', () => {
  it('derives entries from the real Config schema: descriptions, defaults, origin, union choices, dotted keys', () => {
    const entries = buildConfigCatalog(Config as unknown as SchemaNode, { workspaceRoot: '/w', maxIterations: 2, provider: 'p', model: 'm', confirmPolicy: 'strict' })
    const maxIterations = entries.find(e => e.key === 'maxIterations')!
    expect(maxIterations).toMatchObject({ type: 'number', value: 2, default: 5, origin: 'configured' })
    expect(maxIterations.description).toContain('Repair-loop round cap')
    const confirmPolicy = entries.find(e => e.key === 'confirmPolicy')!
    expect(confirmPolicy.choices).toEqual(['none', 'standard', 'strict'])
    expect(confirmPolicy).toMatchObject({ value: 'strict', default: 'standard', origin: 'configured' })
    const provider = entries.find(e => e.key === 'provider')!
    expect(provider.value).toBe('p')
    expect(provider.default).toBeUndefined()
    // Set with no schema default: configured (nothing default accounts for it).
    expect(provider.origin).toBe('configured')
    const packsDir = entries.find(e => e.key === 'packsDir')!
    expect(packsDir.value).toBeUndefined()
    const mode = entries.find(e => e.key === 'oscillation.mode')!
    expect(mode.default).toBe('auto')
    expect(mode.origin).toBe('default')
    const header = entries.find(e => e.key === 'oscillation')!
    expect(header.type).toBe('object')
    expect(header.description).toContain('convergence tuning')
    expect(entries.some(e => e.key === 'oscillation.defaultScore.error')).toBe(true)
  })

  it('treats explicitly-set-to-default values as default origin and empty-dict object nodes as leaves', () => {
    const node: SchemaNode = {
      type: 'object',
      meta: {},
      dict: {
        plain: { type: 'string', meta: { description: 'p', default: 'x' } },
        defaulted: { type: 'number', meta: { default: 7 } },
        emptyObj: { type: 'object', meta: { description: 'e' }, dict: {} },
        noDesc: { type: 'boolean', meta: {} },
        odd: { type: 'union', meta: {}, list: [{ type: 'schema', value: undefined }] },
      },
    }
    const entries = buildConfigCatalog(node, { plain: 'x', emptyObj: {}, noDesc: true } as never)
    expect(entries.find(e => e.key === 'plain')!.origin).toBe('default')
    // Unset with a schema default: the default state governs (no value key).
    const defaulted = entries.find(e => e.key === 'defaulted')!
    expect('value' in defaulted).toBe(false)
    expect(defaulted).toMatchObject({ default: 7, origin: 'default' })
    // An explicitly present value (even {}) is configured — nothing default accounts for it.
    expect(entries.find(e => e.key === 'emptyObj')).toMatchObject({ type: 'object', origin: 'configured' })
    const noDesc = entries.find(e => e.key === 'noDesc')!
    expect(noDesc.description).toBeUndefined()
    expect(noDesc).toMatchObject({ value: true, type: 'boolean', origin: 'configured' })
    expect(entries.find(e => e.key === 'odd')!.choices).toBeUndefined()
  })
})

describe('buildParamsPayload', () => {
  it('combines the pack views with the config provenance', async () => {
    const packs = await loadPacks(packsRoot, {})
    const payload = buildParamsPayload(packs, Config, { workspaceRoot: '/w', confirmPolicy: 'none' } as never)
    expect(payload.groups.length).toBeGreaterThan(3)
    expect(payload.config.find(e => e.key === 'confirmPolicy')).toMatchObject({ value: 'none', origin: 'configured' })
  })
})

describe('mountParamsRoutes', () => {
  function fakeServer() {
    const routes: Array<{ path: string; handler: (req: unknown, res: unknown) => Promise<void> | void }> = []
    const disposers: Array<() => void> = []
    const webServer: WebServerLike = {
      register: route => {
        routes.push(route as never)
        const dispose = () => disposers.splice(disposers.indexOf(dispose), 1)
        disposers.push(dispose)
        return dispose
      },
    }
    return { webServer, routes, disposers }
  }
  const fakeRes = () => {
    const res = { statusCode: 0, headers: {} as Record<string, string>, body: '' }
    const typed = res as unknown as { writeHead: (s: number, h: Record<string, string>) => void; end: (b: string) => void }
    typed.writeHead = (status, headers) => {
      res.statusCode = status
      res.headers = headers
    }
    typed.end = body => {
      res.body = body
    }
    return { res, typed }
  }

  it('registers the exact params route and answers the lazily built payload', async () => {
    const { webServer, routes, disposers } = fakeServer()
    let builds = 0
    const dispose = mountParamsRoutes(webServer, { payload: () => ({ n: ++builds }) })
    expect(routes).toHaveLength(1)
    expect(routes[0]!.path).toBe('/api/docwright/params')
    const { res, typed } = fakeRes()
    await routes[0]!.handler({}, typed as never)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ n: 1 })
    await routes[0]!.handler({}, typed as never)
    expect(JSON.parse(res.body)).toEqual({ n: 2 })
    expect(disposers).toHaveLength(1)
    dispose()
    expect(disposers).toHaveLength(0)
  })

  it('applies the host request gate when the connection service exposes one', async () => {
    const { webServer, routes } = fakeServer()
    const connection: ConnectionLike = { requestRejection: () => 401 }
    mountParamsRoutes(webServer, { payload: () => ({}), connection: () => connection })
    const { res, typed } = fakeRes()
    await routes[0]!.handler({}, typed as never)
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body).error).toContain('host gate')
    // A per-request accessor returning undefined (service not up yet) lets the read through.
    const { webServer: ws2, routes: r2 } = fakeServer()
    mountParamsRoutes(ws2, { payload: () => ({ ok: true }), connection: () => undefined })
    const res2 = fakeRes()
    await r2[0]!.handler({}, res2.typed as never)
    expect(res2.res.statusCode).toBe(200)
    expect(JSON.parse(res2.res.body)).toEqual({ ok: true })
  })
})

describe('registerTools wiring', () => {
  it('mounts the params routes on a host that provides a webServer and serves the real payload', async () => {
    const { registerTools } = await import('../src/index.ts')
    const registered: string[] = []
    const handlers: Array<(req: unknown, res: unknown) => Promise<void> | void> = []
    const hostCtx = {
      effect(fn: () => () => void) { fn() },
      webServer: { register: (r: { path: string; handler: (req: unknown, res: unknown) => Promise<void> | void }) => { handlers.push(r.handler); return () => {} } },
    }
    const ctx = {
      tools: { register: (t: { name: string }) => { registered.push(t.name) } },
      inject(deps: string[], cb: (hostCtx: unknown) => void) { if (deps.includes('webServer')) cb(hostCtx) },
      get() { return undefined },
    }
    await registerTools(ctx as never, { workspaceRoot: '/w' } as never, packsRoot)
    expect(registered).toHaveLength(5)
    expect(handlers).toHaveLength(1)
    const res = { statusCode: 0, body: '', writeHead(s: number) { res.statusCode = s }, end(b: string) { res.body = b } }
    await handlers[0]!({}, res)
    const payload = JSON.parse(res.body) as { packs: { name: string }[]; config: { key: string }[] }
    expect(res.statusCode).toBe(200)
    expect(payload.packs.map(p => p.name)).toContain('cosmic-plan')
    expect(payload.config.find(e => e.key === 'confirmPolicy')).toBeDefined()
  })
})
