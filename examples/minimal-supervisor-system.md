# Graph composition walkthrough

This walkthrough shows how **this personal assistant** composes its supervisor graph. It requires this monorepo's app layer (`src/app/`) and domain runtime (`src/runtime-agents/`) — not a standalone package.

## 1. Define agents

Persist agents in JSON or seed them at bootstrap:

```typescript
import type { RuntimeAgentDefinition } from "../src/core/types/agent.js";

const researcher: RuntimeAgentDefinition = {
  id: "researcher",
  name: "Researcher",
  description: "Answer factual questions with web search.",
  systemPrompt: "You are a concise research assistant.",
  capabilityIds: ["none"],
  executor: "generic",
  builtin: false,
  maxSteps: 6,
  enabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
```

## 2. Register capabilities

```typescript
import { createCapabilityCatalog } from "../src/capabilities/index.js";

const catalog = createCapabilityCatalog([
  {
    descriptor: {
      id: "none",
      description: "Prompt-only agent.",
      configurable: true,
    },
    resolveTools: () => [],
  },
  // Add providers for vault, SQL, etc.
]);
```

## 3. Compose policies

```typescript
import { createAppExecutionKit } from "../src/app/register-defaults.js";
import { createFilesystemSkillCatalog } from "../src/integrations/skills/filesystem-skill-catalog.js";

const skillCatalog = createFilesystemSkillCatalog({ approvedModules: ["researcher"] });
const { loadPromptByKey, policyRegistry } = createAppExecutionKit(["generic"], { skillCatalog });
```

## 4. Build the graph

```typescript
import { createAssistant } from "../src/core/create-assistant.js";
import { createCapabilityDeps } from "../src/runtime-agents/builtin-capabilities.js";

const capabilityDeps = createCapabilityDeps("/path/to/vault", {
  capabilityCatalog: catalog,
  skillCatalog,
  cronJobRepository,
  runtimeAgentRepository,
});

const graph = createAssistant({
  supervisorLlm,
  models: { generic: model },
  runtimeAgents,
  runtimeAgentRepository,
  bundleDeps: capabilityDeps,
  loadPromptByKey,
  policyRegistry,
  loadSupervisorPrompt: () => "<supervisor prompt>",
});
```

## 5. Pack bootstrap (recommended)

For a full deployment, use `bootstrapSupervisorSystem()` with your capability catalog, seed agents, and adapters:

```typescript
import { bootstrapSupervisorSystem } from "../src/app/composition/bootstrap-supervisor-system.js";

const context = await bootstrapSupervisorSystem({
  config,
  capabilityCatalog: catalog,
  seedAgents: async (repo) => [...],
  buildSkillCatalog: (agents) => skillCatalog,
  buildPolicyRegistry: (agents, skillCatalog) => createAppExecutionKit(["generic"], { skillCatalog }),
  buildModels: (cfg, agents) => ({ generic: model }),
  buildCapabilityDeps: (ctx) => createCapabilityDeps("/path/to/vault", { ... }),
});
```

## 6. Optional configuration agent

Enable the built-in configuration executor and grant `system-config` so an operator agent can attach approved capabilities, edit skills, and schedule cron jobs—without modifying source code.

For this personal assistant, prefer `createSupervisorSystem()` in `src/app/composition/create-supervisor-system.ts`.
