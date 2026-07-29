# Reusing the framework in another project

This repo splits **kernel + pack SDK** from **this personal assistant**. Another project should depend on `@personal-assistant/supervisor-framework`, not on the personal app's Telegram, Gemini, finance, or Obsidian wiring.


| Layer | Path | Reuse in another project? |
|---|---|---|
| Framework package | `packages/supervisor-framework/` | **Yes — import `@personal-assistant/supervisor-framework`** |
| Personal app | `apps/personal-assistant/src/composition/` + `src/policies/` | No — copy the pattern, not the code |
| Domain tools | `apps/personal-assistant/src/runtime-agents/` | No — write your own providers |
| Telegram / cron / services | `apps/personal-assistant/src/...` | No — your I/O stack |

Architecture note: the framework is a **workspace package** in this monorepo (not yet published to npm). Sibling repos can depend via `workspace:*`, `file:`, or git path until publish.

---



## What you implement vs what the framework owns

**Framework owns:** agent repository, runtime execution kit API, supervisor routing, flat prepare / llm ⇄ tools / finalize loops, `bootstrapSupervisorSystem()`, `resolveAgentTools()`.

**Your pack owns:**

1. Agent definitions (JSON and/or seed)
2. Capability catalog + tool factories
3. LLM connector via `@personal-assistant/llm-gemini` (`GeminiConnector`) and chat models
4. Default runtime policy via `buildDefaultRuntimeExecution` (or custom `buildRuntimeExecution`)
5. Cron repository factory (or a stub)
6. Skill catalog (or an empty stub)
7. Entrypoint that invokes `graph` (CLI, HTTP, Slack, …)

---



## Example: research bot pack (another project)

Imagine a sibling repo (or package) that only needs a supervisor + one researcher agent with web search.

### 1. Define agents

```typescript
import type { CreateRuntimeAgentInput } from "@personal-assistant/supervisor-framework";

const researcherInput: CreateRuntimeAgentInput = {
  name: "Researcher",
  description: "Answer factual questions with web search.",
  systemPrompt: "You are a concise research assistant. Prefer short answers.",
  capabilityIds: ["web-search"],
  modelKey: "generic",
  maxSteps: 6,
  enabled: true,
};
```



### 2. Register capabilities (your tools)

```typescript
import { createCapabilityCatalog } from "@personal-assistant/supervisor-framework";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const webSearch = tool(
  async ({ query }) => {
    // your search implementation
    return `Results for: ${query}`;
  },
  {
    name: "web_search",
    description: "Search the public web.",
    schema: z.object({ query: z.string() }),
  },
);

// `none` is included automatically by createCapabilityCatalog.
const catalog = createCapabilityCatalog([
  {
    descriptor: {
      id: "web-search",
      description: "Search the public web.",
      grantable: true,
    },
    isAvailable: () => true,
    resolveTools: () => [webSearch],
  },
]);
```



### 3. Bootstrap with the framework only

```typescript
import {
  bootstrapSupervisorSystem,
  buildDefaultRuntimeExecution,
  seedAgentsIfMissing,
} from "@personal-assistant/supervisor-framework";
import { GeminiConnector } from "@personal-assistant/llm-gemini";

const context = await bootstrapSupervisorSystem({
  config: {
    runtimeAgentsFilePath: "data/runtime-agents.json",
    cronJobsFilePath: "data/cron-jobs.json",
    messageHistoryMaxTokens: 6000,
  },
  capabilityCatalog: catalog,
  supervisorLlm: new GeminiConnector(process.env.GOOGLE_API_KEY!, process.env.SUPERVISOR_MODEL),
  loadSupervisorPrompt: () =>
    "Route factual questions to researcher. Reply directly for greetings.",
  seedAgents: seedAgentsIfMissing([researcherInput]),
  buildRuntimeExecution: (_agents, _skillCatalog, ctx) =>
    buildDefaultRuntimeExecution(ctx.capabilityCatalog),
  buildModels: () => ({
    generic: new GeminiConnector(process.env.GOOGLE_API_KEY!, process.env.RESEARCHER_MODEL).getModel(),
  }),
  buildCapabilityDeps: () => ({}),
});

const graph = context.graph;
```

Cron, skills, and the file-backed agent repository use framework defaults when omitted.

No Telegram, Gemini, Supabase, Wise, Obsidian, or personal `CapabilityDeps` required.

### 4. Optional: wire your own I/O

```typescript
// cli.ts — example entrypoint for the other project
import { HumanMessage } from "@langchain/core/messages";

const result = await graph.invoke(
  { messages: [new HumanMessage(process.argv.slice(2).join(" ") || "hello")] },
  { configurable: { thread_id: "local" } },
);

const last = result.messages.at(-1);
console.log(typeof last?.content === "string" ? last.content : last?.content);
```

---



## Personal pack (this monorepo only)

This assistant wraps framework bootstrap with product wiring. **Do not copy this into another project** unless you want the same Telegram / Gemini / finance stack.

```typescript
import { createSupervisorSystem } from "../apps/personal-assistant/src/composition/create-supervisor-system.js";

const system = await createSupervisorSystem(config, { fileSender });
const graph = system.getGraph();
const cronJobRepository = system.getCronJobRepository();
```

The pack wires capabilities and optional app-local behaviors via `buildAppRuntimeExecution()` and `createPersonalResolveTools(catalog)` for catalog + `read_skill`.

---



## Advanced: call `createAssistant` directly

Skip bootstrap when you already own repositories and want full control:

```typescript
import { createAssistant } from "@personal-assistant/supervisor-framework";

const graph = createAssistant({
  supervisorLlm,
  models: { generic: model },
  runtimeAgents,
  runtimeAgentRepository,
  capabilityDeps: {},
  loadPromptByKey,
  runtimeAgentPolicy,
  loadSupervisorPrompt: () => "<supervisor prompt>",
});
```

Prefer `bootstrapSupervisorSystem()` for a second deployment — it standardizes seeding, cron targets, and policy wiring.

---



## Checklist for a second project

1. Import from `@personal-assistant/supervisor-framework` (workspace package in this monorepo).
2. Provide at least one enabled agent. Product agents use the pack's default `runtimeAgentPolicy` (usually `generic`); only the virtual system agent uses `configuration`.
3. Put tools behind capability IDs; grant them via `capabilityIds` on agent definitions.
4. Supply your own LLM connector / models; do not import `src/models/` unless you want Gemini.
5. Keep product policies and domain tools in your app pack — mirror `apps/personal-assistant/src/composition/` + `src/policies/` + `runtime-agents/`.
6. After adding agents, wait for soft graph recompile (file watcher, ~seconds) or restart the process — routing nodes are fixed until the next compile.

For layer boundaries and the personal pack entrypoint, see [docs/FRAMEWORK.md](../docs/FRAMEWORK.md), [docs/PACK_DEVELOPMENT.md](../docs/PACK_DEVELOPMENT.md), and [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).