# Pack development guide

How to build a **client pack** on `@personal-assistant/supervisor-framework` inside this monorepo or from a sibling repo.

## What belongs where

| Belongs in framework package | Belongs in your app pack |
|---|---|
| Supervisor routing topology | Telegram / HTTP / CLI adapters |
| `bootstrapSupervisorSystem` | LLM connector (Gemini, OpenAI, …) |
| Agent repository **contracts** | Concrete cron + skill storage |
| Capability catalog **types** | Your capability providers + tools |
| `createAgentPolicy` / runtime execution kit | Default `runtimeAgentPolicy` + optional app-local capability behaviors |
| Message trimming / state | Prompts, skills content, env config |

## Framework default content (optional)

The framework exports domain-agnostic baseline content for a minimal supervisor + configuration agent setup. Use these when bootstrapping a new pack or seeding a fresh `data/` volume:

| Export | Purpose |
|---|---|
| `DEFAULT_SUPERVISOR_PROMPT` | Routes only to `FINISH` and `configuration` |
| `DEFAULT_CONFIGURATION_PROMPT` | Cron, runtime-agent, and skill CRUD instructions |
| `DEFAULT_CRON_SKILL_XML` | Cron job management skill |
| `DEFAULT_RUNTIME_AGENTS_SKILL_XML` | Runtime sub-agent CRUD skill |
| `DEFAULT_SKILL_MANAGEMENT_SKILL_XML` | Skill list/preview/edit/delete skill |
| `DEFAULT_SKILL_BOOTSTRAP_SKILL_XML` | Natural-language skill authoring skill |
| `createDefaultContentSeeder()` | Atomic seed-missing-only writer for the six default files |
| `initializeDefaults` pack hook | Optional early bootstrap hook invoked before repositories/catalogs load |

None of these constants hardcode domain modules (`finance`, `obsidian`, etc.). Opt in from your pack:

```typescript
import {
  bootstrapSupervisorSystem,
  createDefaultContentSeeder,
} from "@personal-assistant/supervisor-framework";

const defaultContentSeeder = createDefaultContentSeeder({
  promptsDir: "data/prompts",
  skillsDir: "data/skills",
});

await bootstrapSupervisorSystem({
  // ...
  initializeDefaults: () => {
    defaultContentSeeder.seedAll();
  },
});
```

The personal-assistant pack registers this hook in `buildPersonalSupervisorPack()`.

## Minimal bootstrap checklist

1. Add a workspace dependency on `@personal-assistant/supervisor-framework` (or a path/git ref pre-publish).
2. Define one or more `RuntimeAgentDefinition` records (JSON and/or seed function).
3. Register a `createCapabilityCatalog([...])` with at least a `none` provider.
4. Implement `buildRuntimeExecution(agents, skillCatalog, ctx)` — return one `runtimeAgentPolicy` via `createAgentPolicy` + `resolveAgentTools`. Use `ctx.capabilityCatalog` from bootstrap (already merged when `systemAgent` is enabled).
5. Provide `supervisorLlm`, `loadSupervisorPrompt`, `buildModels`, `buildCapabilityDeps`, and `seedAgents`.
6. Optionally override `createRuntimeAgentRepository`, `createCronJobRepository`, and `buildSkillCatalog` (defaults exist).
7. Invoke `context.graph` from your channel entrypoint.

## Workspace consumption (this repo)

```json
{
  "dependencies": {
    "@personal-assistant/supervisor-framework": "workspace:*"
  }
}
```

Build the framework before running the app:

```sh
pnpm --filter @personal-assistant/supervisor-framework build
pnpm --filter personal-assistant dev
```

## Sibling repo (pre-publish)

Until the framework is published to npm, depend via:

- **pnpm workspace path** — add the monorepo as a workspace member
- **git submodule + `file:` dependency** — `"@personal-assistant/supervisor-framework": "file:../personal-assistant/packages/supervisor-framework"`
- **pnpm `link:`** — local development against a built `dist/`

After publish, switch to semver on `@personal-assistant/supervisor-framework`.

## Minimal pack example

See [examples/minimal-supervisor-system.md](../examples/minimal-supervisor-system.md). With the new defaults, cron and skills can be omitted:

```typescript
import {
  bootstrapSupervisorSystem,
  createAgentPolicy,
  resolveAgentTools,
} from "@personal-assistant/supervisor-framework";

await bootstrapSupervisorSystem({
  config: {
    runtimeAgentsFilePath: "data/runtime-agents.json",
    cronJobsFilePath: "data/cron-jobs.json",
  },
  capabilityCatalog,
  supervisorLlm,
  loadSupervisorPrompt: () => "Route to specialists.",
  seedAgents: async (repo) => { /* ... */ return repo.listAgents(); },
  buildRuntimeExecution: (_agents, _skillCatalog, ctx) => ({
    loadPromptByKey: async () => "prompt",
    runtimeAgentPolicy: createAgentPolicy({
      resolveTools: (definition, deps) =>
        resolveAgentTools(definition, ctx.capabilityCatalog, deps, {}),
    }),
  }),
  buildModels: () => ({ generic: model }),
  buildCapabilityDeps: () => ({}),
});
```

## Personal pack reference

The Telegram assistant is the reference product pack: [`apps/personal-assistant/src/composition/create-supervisor-system.ts`](../apps/personal-assistant/src/composition/create-supervisor-system.ts).

Copy its **pattern** (bootstrap object + product adapters), not its finance/Obsidian/Telegram specifics.

## Testing

- Framework contract tests: `packages/supervisor-framework/tests/unit/`
- App boundary + integration tests: `apps/personal-assistant/tests/unit/`
- Run all unit tests from repo root: `pnpm test:unit`
