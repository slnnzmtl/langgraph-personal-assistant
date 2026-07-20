# Supervisor Agent Framework

This repository exposes a small framework for building supervisor → sub-agent systems. Product-specific domains (Obsidian, finance, configuration) compose the framework; they do not live inside it.

## Layers

| Layer | Path | Responsibility |
|---|---|---|
| Core | `src/core/` | Agent definitions, graph execution, policies, capability contracts, skill ports |
| Capabilities | `src/capabilities/` | Declarative capability descriptors and catalog validation |
| Composition | `src/app/composition/` | Bootstrap agents, register capabilities, build the supervisor system |
| Integrations | `src/integrations/` | Concrete adapters (filesystem skills, vault, Supabase, cron) |
| Product policies | `src/app/policies/` | Domain hooks and optional configuration feature |

## Public core API

Import from `src/core/index.ts`:

- `createAssistant` — compile the supervisor graph
- `createGenericPolicy`, `createPolicyRegistry` — register executors
- `createRuntimeAgentRepository` — persist agent definitions
- `createCapabilityCatalog` — validate and resolve tool bundles
- `createRuntimeShellHooks` — shared metadata + skill attachment shell
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
3. Grant the capability ID on agent definitions (`toolBundleIds`).
4. Domain and generic agents resolve tools through the same catalog via `resolveAgentCapabilityTools()`.

## Self-configuration (optional product feature)

The configuration executor can manage skills, cron jobs, and generic agents when granted `system-config`. Finer grants:

- `system-config-read` — list/preview only
- `system-config-write` — create/update/delete

Adding new executable integrations remains a deployment/code change; the configurator composes registered capabilities only.

## Minimal new supervisor system

See [examples/minimal-supervisor-system.md](../examples/minimal-supervisor-system.md).
