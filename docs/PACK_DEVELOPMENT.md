# Pack development guide

How to build a **client pack** on `@personal-assistant/supervisor-framework` inside this monorepo or from a sibling repo.

## What belongs where

| Belongs in framework package | Belongs in your app pack |
|---|---|
| Supervisor routing topology | Telegram / HTTP / CLI adapters |
| `bootstrapSupervisorSystem` | LLM connector (Gemini, OpenAI, …) |
| Agent repository **contracts** | Concrete cron + skill storage |
| Capability catalog **types** | Your capability providers + tools |
| Policy registry API | Default runtime execution kit (`runtimeAgentPolicy`) + optional app-local capability behaviors |
| Message trimming / state | Prompts, skills content, env config |

## Minimal bootstrap checklist

1. Add a workspace dependency on `@personal-assistant/supervisor-framework` (or a path/git ref pre-publish).
2. Define one or more `RuntimeAgentDefinition` records (JSON and/or seed function).
3. Register a `createCapabilityCatalog([...])` with at least a `none` provider.
4. Implement `buildRuntimeExecution()` — return one `runtimeAgentPolicy` (usually `executor: "generic"`) via `createAgentPolicy` + `resolveAgentTools`.
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
  buildRuntimeExecution: () => ({
    loadPromptByKey: async () => "prompt",
    runtimeAgentPolicy: createAgentPolicy({
      executor: "generic",
      resolveTools: (definition, deps) =>
        resolveAgentTools(definition, catalog, deps, {}),
    }),
  }),
  buildModels: () => ({ generic: model }),
  buildCapabilityDeps: () => ({}),
});
```

## Personal pack reference

The Telegram assistant is the reference product pack: [`apps/personal-assistant/src/app/composition/create-supervisor-system.ts`](../apps/personal-assistant/src/app/composition/create-supervisor-system.ts).

Copy its **pattern** (bootstrap object + product adapters), not its finance/Obsidian/Telegram specifics.

## Testing

- Framework contract tests: `packages/supervisor-framework/tests/unit/`
- App boundary + integration tests: `apps/personal-assistant/tests/unit/`
- Run all unit tests from repo root: `pnpm test:unit`
