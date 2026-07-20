# Minimal supervisor system

This walkthrough shows how to stand up a new supervisor system using the framework boundaries in this repo.

## 1. Define agents

Persist agents in JSON or seed them at bootstrap:

```typescript
import type { RuntimeAgentDefinition } from "../src/core/types/agent.js";

const researcher: RuntimeAgentDefinition = {
  id: "researcher",
  name: "Researcher",
  description: "Answer factual questions with web search.",
  systemPrompt: "You are a concise research assistant.",
  toolBundleIds: ["none"],
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
const { promptResolver, policyRegistry } = createAppExecutionKit(["generic"], { skillCatalog });
```

## 4. Build the graph

```typescript
import { createAssistant } from "../src/core/create-assistant.js";
import { createRuntimeToolBundleDeps } from "../src/runtime-agents/tool-bundles.js";

const bundleDeps = createRuntimeToolBundleDeps("/path/to/vault", {
  capabilityCatalog: catalog,
  skillCatalog,
});

const graph = createAssistant({
  supervisorLlm,
  models: { generic: model },
  runtimeAgentRepository,
  cronJobRepository,
  bundleDeps,
  promptResolver,
  policyRegistry,
  loadSupervisorPrompt: () => "<supervisor prompt>",
});
```

## 5. Optional configuration agent

Enable the built-in configuration executor and grant `system-config` so an operator agent can attach approved capabilities, edit skills, and schedule cron jobs—without modifying source code.

For a production deployment, copy `createSupervisorSystem()` and replace integrations (Telegram, Supabase, Obsidian) with your own adapters under `src/integrations/`.
