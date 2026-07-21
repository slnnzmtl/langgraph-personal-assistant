# Execution Kernel

`src/core/` holds the LangGraph execution kernel for this personal assistant. Product-specific domains (Obsidian, finance, configuration) compose the kernel from `src/app/` and `src/runtime-agents/`; they do not live inside core.

## Layers

| Layer | Path | Responsibility |
|---|---|---|
| Core | `src/core/` | Agent definitions, graph execution, policies API, capability contracts, skill ports |
| Capabilities | `src/capabilities/` | Declarative capability descriptors and catalog validation |
| Composition | `src/app/composition/` | Bootstrap agents, register capabilities, build the supervisor system |
| Integrations | `src/integrations/` | Concrete adapters (filesystem skills, vault, Supabase, cron) |
| Product policies | `src/app/policies/` | Domain hooks and optional configuration feature |

## Core API (in-repo)

Import from `src/core/index.ts` when wiring within this monorepo:

- `createAssistant` — compile the supervisor graph (requires a `policyRegistry`)
- `createAgentPolicy`, `createPolicyRegistry` — register executors
- `createRuntimeAgentRepository` — persist agent definitions
- `createCapabilityCatalog` — validate and resolve tool bundles
- Types: `RuntimeAgentDefinition`, `RuntimeAgentPolicy`, `SkillCatalog`, `CapabilityDescriptor`

## Composition entry point

Use `createSupervisorSystem()` in `src/app/composition/create-supervisor-system.ts` to wire this deployment:

1. Bootstrap built-in agents (`configuration` only)
2. Build capability catalog + skill catalog
3. Register policies via `createAppExecutionKit()`
4. Compile the LangGraph workflow

## Adding a capability

1. Add a descriptor to `BUILTIN_CAPABILITY_DESCRIPTORS` in `src/runtime-agents/tool-bundles.ts` (or register a custom provider).
2. Implement `CapabilityProvider.resolveTools`.
3. Grant the capability ID on agent definitions (`capabilityIds`).
4. Domain and generic agents resolve tools through the same catalog via `resolveAgentCapabilityTools()`.

## Self-configuration (optional product feature)

The configuration executor can manage skills, cron jobs, and generic agents when granted `system-config`. Finer grants:

- `system-config-read` — list/preview only
- `system-config-write` — create/update/delete

Adding new executable integrations remains a deployment/code change; the configurator composes registered capabilities only.

## Graph composition walkthrough

See [examples/minimal-supervisor-system.md](../examples/minimal-supervisor-system.md) for how this assistant composes its graph (requires this monorepo's app layer).
