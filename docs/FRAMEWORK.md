# Execution Kernel & Framework

The reusable supervisor bootstrap ships as the workspace package **`@personal-assistant/supervisor-framework`** (`packages/supervisor-framework/`). It contains the LangGraph execution kernel (`src/core/`), pack bootstrap (`src/framework/`), and capability catalog (`src/capabilities/`).

Product-specific domains (Obsidian, finance) live in `apps/personal-assistant/`. **System admin** (cron jobs, skill catalog, runtime agent CRUD) is an opt-in framework kit under `packages/supervisor-framework/src/framework/system-agent/` — not a product domain. Product wording (prompts, skill XML) stays in the app.

## Monorepo layers

| Layer | Path | Responsibility |
|---|---|---|
| Framework package | `packages/supervisor-framework/` | Agent definitions, graph execution, policies API, `bootstrapSupervisorSystem`, `resolveAgentTools` |
| Personal app | `apps/personal-assistant/src/app/` | Composition, `createSupervisorSystem`, domain hooks |
| Domain runtime | `apps/personal-assistant/src/runtime-agents/` | Capability providers and domain tool factories |
| Agent prompts | `apps/personal-assistant/src/prompts/` + content `agents/` | System prompt loading and metadata helpers |
| Skills runtime | `apps/personal-assistant/src/runtime-agents/skills/` | Skill filesystem I/O, `SkillCatalog`, prompt enrichment |

## Intentional boundaries

- `packages/supervisor-framework/src/core/` — execution kernel only. Must not import app or product integrations.
- `packages/supervisor-framework/src/framework/` — orchestration only. May import `core` and `capabilities`.
- `apps/personal-assistant/src/app/` — composition and policies. Imports `@personal-assistant/supervisor-framework` and `runtime-agents/`.
- `apps/personal-assistant/src/runtime-agents/` — domain tools. Must **not** import `src/app/`.

Boundary tests:

- Framework: `packages/supervisor-framework/tests/unit/framework-boundary.test.ts`
- App: `apps/personal-assistant/tests/unit/app-boundary.test.ts`

## Framework API (client and personal packs)

Import from `@personal-assistant/supervisor-framework`:

- `bootstrapSupervisorSystem` — generic pack bootstrap
- `resolveAgentTools` — catalog-based tool resolution
- `createAssistant`, `createAgentPolicy` — graph and policy helpers
- Defaults: `createNoopCronJobRepository`, `createEmptySkillCatalog`
- Types: `SupervisorPackBootstrap`, `CompiledSupervisorGraph`, `RuntimeAgentDefinition`, `CapabilityCatalog`
- System admin (opt-in): `systemAgent` pack option, `wrapRepositoryWithSystemAgent`, `createSystemConfigCapabilityProviders`, `hasSystemConfigWriteCapability` / `resolveSystemConfigDeps`, `SYSTEM_AGENT_ID` (`"configuration"`)

Optional bootstrap hooks (omit for minimal packs):

- `createRuntimeAgentRepository(config)` — defaults to file-backed JSON repo
- `createCronJobRepository(...)` — defaults to in-memory no-op
- `buildSkillCatalog(agents)` — defaults to empty catalog
- `systemAgent?: SystemAgentOptions | false` — when set, bootstrap wires virtual admin agent repo wrap, legacy purge, and merged `system-config` capabilities
- `capabilityProviders` — domain capability providers; merged with system-config when `systemAgent` is enabled
- `buildRuntimeExecution(agents, skillCatalog, ctx)` — pack hook that returns `loadPromptByKey`, `runtimeAgentPolicy`, and optional shell formatters; use `ctx.capabilityCatalog` (personal pack uses `buildAppRuntimeExecution()`)

Personal deployment adds product wiring via `createSupervisorSystem()` in [`apps/personal-assistant/src/app/composition/create-supervisor-system.ts`](../apps/personal-assistant/src/app/composition/create-supervisor-system.ts).

## Composition entry points

**Personal deployment:** `createSupervisorSystem()` in the personal app composition layer.

**Pack bootstrap:** `bootstrapSupervisorSystem()` — pass capability catalog, seed agents, `buildRuntimeExecution` (returns `runtimeAgentPolicy` via `createAgentPolicy`), and optional cron/skills/repo hooks. For tests or advanced compile-only wiring, `createAssistant()` is the lower-level entry (bootstrap wraps it).

## Adding a capability (personal app)

1. Add a descriptor to `PERSONAL_CAPABILITY_DESCRIPTORS` in `apps/personal-assistant/src/runtime-agents/builtin-capabilities.ts`.
2. Implement `CapabilityProvider.resolveTools`.
3. Grant the capability ID on agent definitions (`capabilityIds`).
4. Resolve tools through `resolveAgentTools()` (framework) or `createPersonalResolveTools()` (personal pack with `read_skill`).

## Graph composition walkthrough

See [examples/minimal-supervisor-system.md](../examples/minimal-supervisor-system.md) and [docs/PACK_DEVELOPMENT.md](./PACK_DEVELOPMENT.md).
