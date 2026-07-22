# Execution Kernel

`src/core/` holds the LangGraph execution kernel for this personal assistant. Product-specific domains (Obsidian, finance, configuration) compose the kernel from `src/app/` and `src/runtime-agents/`; they do not live inside core.

## Layers


| Layer            | Path                   | Responsibility                                                                      |
| ---------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| Core             | `src/core/`            | Agent definitions, graph execution, policies API, capability contracts, skill ports |
| Capabilities     | `src/capabilities/`    | Declarative capability descriptors and catalog validation                           |
| Composition      | `src/app/composition/` | Bootstrap agents, register capabilities, build the supervisor system                |
| Integrations     | `src/integrations/`    | Concrete adapters (filesystem skills, vault, Supabase)                              |
| Domain runtime   | `src/runtime-agents/`  | Capability providers and domain tool factories                                      |
| Product policies | `src/app/policies/`    | Domain hooks and optional configuration feature                                     |




## Intentional boundaries

- `src/app/` — composition, policies, hooks. Imports `src/runtime-agents/` for tools.
- `src/runtime-agents/` — domain tools and capability catalog. Must **not** import `src/app/`.
- `src/cron/` — scheduler infrastructure; separate process from Telegram (`src/app.ts`).
- `src/agent.ts` — deployment graph wiring between core and supervisor bootstrap.
- `src/core/index.ts` — documented kernel barrel; in-repo code may import modules directly.

Boundary tests live in `tests/unit/framework-boundary.test.ts`.

## Core API (in-repo)

Import from `src/core/index.ts` when wiring within this monorepo:

- `createAssistant` — compile the supervisor graph (requires a `policyRegistry`)
- `createAgentPolicy`, `createPolicyRegistry` — register executors (hook profiles)
- `createRuntimeAgentRepository` — persist agent definitions
- `createCapabilityCatalog` — validate and resolve capabilities
- Types: `RuntimeAgentDefinition`, `RuntimeAgentPolicy`, `SkillCatalog`, `CapabilityDescriptor`



## Composition entry points

**Personal deployment:** `createSupervisorSystem()` in [`src/app/composition/create-supervisor-system.ts`](src/app/composition/create-supervisor-system.ts)

**Pack bootstrap:** `bootstrapSupervisorSystem()` in [`src/app/composition/bootstrap-supervisor-system.ts`](src/app/composition/bootstrap-supervisor-system.ts) — pass capability catalog, seed agents, policy registry, and adapter wiring. Client packs reuse the same bootstrap with different providers.

Personal pack wiring:

1. Bootstrap built-in agents (`configuration` only)
2. Build capability catalog + skill catalog
3. Register policies via `createAppExecutionKit()`
4. Compile the LangGraph workflow



## Adding a capability

1. Add a descriptor to `BUILTIN_CAPABILITY_DESCRIPTORS` in `src/runtime-agents/builtin-capabilities.ts` (or register a custom provider).
2. Implement `CapabilityProvider.resolveTools`.
3. Grant the capability ID on agent definitions (`capabilityIds`).
4. All agents resolve tools through the same catalog via `resolveAgentTools()`. The `executor` field selects optional LLM hooks only — not tools.



## Self-configuration (optional product feature)

The configuration executor can manage skills, cron jobs, and generic agents when granted `system-config`. Finer grants:

- `system-config-read` — list/preview only (grantable to other agents)
- `system-config-write` — create/update/delete (reserved; not grantable via config API)

Adding new executable integrations remains a deployment/code change; the configurator composes registered capabilities only.

## Graph composition walkthrough

See [examples/minimal-supervisor-system.md](../examples/minimal-supervisor-system.md) for how this assistant composes its graph (requires this monorepo's app layer).
