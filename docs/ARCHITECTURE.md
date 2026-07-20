# Personal Assistant — Structure & Architecture Review

*Fresh review as of July 2026, based on the current codebase (~79 source files, 44 unit test files).*

---

## Executive Summary

This is a **Telegram-hosted personal assistant** built on **LangGraph** with a **Supervisor → Runtime Agent dispatcher → nested sub-agent tool loops** topology. The codebase is deliberately split into three layers:

| Layer | Role |
|---|---|
| **`src/core/`** | Reusable assistant framework (graph, state, policies API, sub-agent factory) |
| **`src/app/`** | This deployment's wiring (domain policies, LLM hooks, model registry) |
| **`src/runtime-agents/`** | Domain tools, tool bundles, built-in agent specs |

The design goal is clear: **extract a reusable LangGraph framework** while keeping domain-specific behavior (finance, Obsidian, configuration) in app/runtime layers. Multiple assistant instances can coexist with isolated `PolicyRegistry` and `PromptResolver` per `createAssistant()` call.

---

## System Topology

```mermaid
flowchart TB
    subgraph Entry["Entry & I/O"]
        TG[Telegram Adapter]
        CRON[Cron Scheduler Process]
        IDX[index.ts → app.ts]
        CRIDX[cron/index.ts]
    end

    subgraph AppLayer["App Layer (src/app/, agent.ts)"]
        WFC[createWorkflowContext]
        WFG[createWorkflowGraph]
        KIT[createAppExecutionKit]
        POL[Domain Policies + Hooks]
        MR[Model Registry]
    end

    subgraph Core["Core Framework (src/core/)"]
        CA[createAssistant]
        SUP[Supervisor Node]
        DISP[Runtime_SG Dispatcher]
        SA[createSubAgent]
        STATE[AgentState + Reducers]
    end

    subgraph Runtime["Domain Runtime (src/runtime-agents/)"]
        FIN[Finance Tools]
        OBS[Obsidian Tools]
        CFG[Configuration Tools]
        BUND[Tool Bundles]
    end

    subgraph External["External Services"]
        GEMINI[Google Gemini]
        VAULT[(Obsidian Vault)]
        SB[(Supabase via MCP)]
        WISE[Wise API]
    end

    TG --> IDX --> WFC --> WFG --> CA
    CRIDX --> CRON
    CRON --> WFC
    CRON -->|graph.invoke| CA
    CRON -->|summary report| TG
    WFG --> KIT --> CA
    KIT --> POL
    CA --> SUP
    SUP -->|Runtime_SG| DISP
    DISP --> SUP
    SUP -->|FINISH| TG
    DISP --> SA
    SA --> FIN & OBS & CFG
    FIN --> SB & WISE
    OBS --> VAULT
    SUP & SA --> GEMINI
```

---

## Boot Sequence

The assistant runs as **two processes** that share the same workflow graph wiring via `createWorkflowContext()`:

### Telegram bot (`src/index.ts`)

```
index.ts
  └─ loadConfig()
  └─ createApp()
       └─ createWorkflowContext()
            ├─ GeminiConnector (supervisor model)
            ├─ setupSupabaseSession() — optional, wrapped in self-healing MCP session
            ├─ Runtime agent repository (data/runtime-agents.json)
            ├─ ensureBuiltinRuntimeAgents() — merge persisted + built-ins
            ├─ createWorkflowGraph() → createAssistant()
       ├─ TelegramAdapter (Telegraf long-polling)
       └─ launchApp()
```

### Cron scheduler (`src/cron/index.ts`)

```
cron/index.ts
  └─ loadConfig()
  └─ createSchedulerApp()
       └─ createWorkflowContext({ runtimeCron: lazyCron })
       └─ startCron() — node-cron + cron job bootstrap
       └─ watchCronJobDefinitions() — hot-reload data/cron-jobs.json
       └─ launchScheduler() — blocks until SIGINT/SIGTERM
```

Cron jobs invoke the **same compiled graph** directly (`cron-runner.ts`) with synthetic `SYSTEM_CRON_TRIGGER:<agentId>:<jobName>` messages, then post a user-facing summary back to Telegram via `telegram-cron-reporter.ts`. Docker Compose runs the scheduler as a separate service (`personal-assistant-scheduler`).

Each process compiles its own graph instance at startup. Invocations use a thread-scoped checkpointer (`MemorySaver`).

Local dev: `pnpm dev` (Telegram bot), `pnpm dev:scheduler` (cron). Production Docker: `personal-assistant` + `personal-assistant-scheduler` services.

---

## Root LangGraph

Defined in `create-assistant.ts`:

```typescript
const graph = new StateGraph(AgentStateAnnotation)
  .addNode("supervisor", supervisorNode)
  .addNode("Runtime_SG", runtimeAgentDispatcher);

graph
  .addEdge(START, "supervisor")
  .addConditionalEdges(
    "supervisor",
    (state: AgentState) => state.next ?? "FINISH",
    {
      Runtime_SG: "Runtime_SG",
      FINISH: END,
    },
  );

graph.addEdge("Runtime_SG", "supervisor");
```

Only **two graph nodes** at the root level. All domain complexity lives in nested sub-graphs compiled inside policy handlers.

---

## Request Lifecycle

```mermaid
sequenceDiagram
    participant U as User
    participant T as Telegram Adapter
    participant S as Supervisor
    participant D as Runtime Dispatcher
    participant P as Policy Handler
    participant SG as Sub-Agent Graph

    U->>T: Message
    T->>S: invoke(state)
    alt Cron trigger
        S->>D: route directly (skip LLM)
    else Empty sub-agent reply
        S->>S: build fallback summary
        S->>T: FINISH
    else Sub-agent just completed
        S->>T: FINISH (no re-route)
    else Normal routing
        S->>S: structured JSON routing
        alt FINISH
            S->>T: direct reply
        else Route to agent
            S->>D: context.runtimeAgentId
            D->>P: policy by executor
            P->>SG: llm ⇄ tools loop
            SG->>D: AIMessage result
            D->>S: append to messages
        end
    end
```

### Supervisor responsibilities

1. **Cron bypass** — `SYSTEM_CRON_TRIGGER:<agentId>:<jobName>` routes straight to the target agent.
2. **Empty sub-agent handoff** — when a runtime agent finishes with no user-facing text, the supervisor synthesizes a reply from bounded tool context (up to 2k chars, last 3 tool results).
3. **Completion detection** — a non-tool AI reply from a sub-agent short-circuits routing and goes to `FINISH`.
4. **Structured routing** — dynamic Zod schema built from enabled runtime agents; `FINISH` requires a `reply`, delegation omits it.

### Dispatcher responsibilities

- Reads `context.runtimeAgentId`
- Loads agent definition from repository
- Resolves system prompt via `PromptResolver`
- Selects policy by `executor` (`finance`, `obsidian`, `configuration`, `generic`)
- Caches policy handlers per executor (or per generic agent revision)

---

## Sub-Agent Pattern

Every runtime agent runs the same nested topology via `createSubAgent()`:

```
START → llm → [tools ⇄ llm]* → END
         ↑         ↑
    maxSteps    ToolNode
    guard       (LangGraph prebuilt)
```

Key abstractions:

| Component | File | Purpose |
|---|---|---|
| `createSubAgent` | `execution/create-sub-agent.ts` | Compiles nested graph, wraps as root node |
| `createRuntimeAgentNode` | `execution/runtime-node.ts` | LLM turn with hooks (prompt assembly, tool binding, sanitization) |
| `createSubgraphNodeWrapper` | `execution/subgraph-wrapper.ts` | Maps sub-state → parent `AgentStateUpdate` |
| `scopeSubAgentMessages` | `execution/sub-agent-messages.ts` | Scopes parent history for sub-agent context |
| Domain hooks | `app/policies/*-hooks.ts` | Per-domain prompt enrichment, tool restrictions, result mapping |

**Generic agents** (user-created via configuration) use `createGenericPolicy()` and compose tools from allowlisted **tool bundles** rather than hard-coded domain tools.

---

## State Management

### Root state shape (`AgentState`)

```typescript
export const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: reduceAgentMessages,
    default: () => [],
  }),
  next: Annotation<RouteName | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  context: Annotation<Record<string, unknown>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
});
```

### Message reducer pipeline

Implemented across `state.ts`, `message-compaction.ts`, and `message-trimming.ts`:

```
messagesStateReducer → compactIntermediateToolHistory → trimMessagesToTokenBudgetSync(maxTokens≈6000)
```

Two compaction strategies:

1. **Consumed tool markers** — after a completed tool round (AI tool-call → tool results → final non-tool AI reply), raw tool bodies are replaced with `[consumed: toolName]` while preserving LangChain message shape and tool-call IDs.
2. **Empty handoff cleanup** — after the supervisor resolves an empty sub-agent handoff, raw `toolContext` in `additional_kwargs` is replaced with a structural marker.

### Trimming rules

- Hard cap of **~6,000 tokens** (configurable via `MESSAGE_HISTORY_MAX_TOKENS`)
- Active in-flight tool sequences are kept as atomic units (may exceed the limit)
- Latest human message is never dropped
- Orphaned leading `ToolMessage`s are stripped

This is a thoughtful balance between **context window cost** and **LangGraph conversation validity**.

---

## Runtime Agent Model

Agents are first-class persisted entities (`data/runtime-agents.json`):

```typescript
RuntimeAgentDefinitionSchema = z.object({
  id, name, description, systemPrompt,
  promptSourceKey?, toolBundleIds, executor, modelKey?,
  builtin, maxSteps, enabled, createdAt, updatedAt,
});
```

### Built-in domains

| ID | Executor | Max Steps | Tool Bundle | Requires |
|---|---|---|---|---|
| `finance` | `finance` | 10 | `finance-domain` | Supabase MCP |
| `obsidian` | `obsidian` | 12 | `obsidian-vault` | Vault path |
| `configuration` | `configuration` | 10 | `system-config` | Cron + runtime agent repos |

Custom agents use `executor: "generic"` and select from the tool bundle catalog (`none`, `obsidian-vault`, `finance-domain`, `system-config`).

---

## Policy Registry Pattern

Policies are registered at app bootstrap in `src/app/register-defaults.ts`:

```typescript
DOMAIN_POLICY_FACTORIES = {
  finance: createFinancePolicy,
  obsidian: createObsidianPolicy,
  configuration: createConfigurationPolicy,
};
```

Each policy implements:

```typescript
type RuntimeAgentPolicy = {
  readonly executor: string;
  createHandler: (context, definition) => RuntimeAgentPolicyHandler;
};
```

Domain policies differ mainly in **deps**, **tool factories**, and **LLM node hooks** — the graph topology is shared.

---

## Skills System

Flat `skills/` directory with XML playbooks (and optional `.md`):

- Each skill has `name`, `module`, `description`
- `module` controls which runtime agent can attach/use the skill
- Optional `<skill_attachments>` for phrase/cron auto-attachment
- Configuration agent has full CRUD; execution agents get `read_skill`
- Skills are injected into system prompts dynamically (appended at bottom for LLM cache efficiency)

Current skills: `sync-expenses`, `daily-routine-note-creation`, `cron`, `runtime-agents`, `skill-management`.

---

## Prompt Architecture

| Agent | Source | Format |
|---|---|---|
| Supervisor | `prompts/supervisor.xml` | XML |
| Finance | `prompts/finance.xml` | XML |
| Obsidian | `prompts/obsidian.xml` | XML |
| Configuration | `prompts/configuration.xml` | XML |

Prompts are **read from disk on each invocation** (hot-reload in dev). Static domain rules come first; dynamic context (timestamps, vault tree, attached skills) is appended via hooks.

---

## External Integrations

| Service | Access Pattern | Location |
|---|---|---|
| **Google Gemini** | `GeminiConnector` + per-agent model registry | `connectors/`, `app/model-registry.ts` |
| **Telegram** | Telegraf long-polling, MarkdownV2 formatting, file send | `telegram/` |
| **Obsidian vault** | Local filesystem read/write | `services/obsidian.ts`, vault tools |
| **Supabase** | Hosted MCP session with transport-error reconnect | `mcp/supabase.ts`, `mcp/self-healing-session.ts`, `services/supabase.ts` |
| **Wise** | REST API for transaction sync | `mcp/wise.ts`, `services/wise/` |
| **Cron** | Separate scheduler process (`node-cron`), JSON persistence, Telegram reporting | `cron/`, `cron-triggers.ts`, `data/cron-jobs.json` |

Finance gracefully degrades: if Supabase is unconfigured, the finance agent is disabled at bootstrap and the policy returns a stub message rather than crashing.

### Supabase MCP self-healing

When credentials are present, `setupSupabaseSession()` wraps the raw MCP client in `createSelfHealingMcpSession()`. Transport failures classified by `isMcpTransportError()` (connection resets, socket hang-ups, etc.) trigger a single reconnect attempt before surfacing the error to finance tools.

---

## Directory Map

```
personal-assistant/
├── src/
│   ├── index.ts, app.ts, agent.ts, config.ts, cron-triggers.ts  # Bootstrap & wiring
│   ├── core/                                       # Framework (reusable)
│   │   ├── create-assistant.ts                     # Main graph API
│   │   ├── state.ts, message-compaction.ts, message-trimming.ts  # State + trimming
│   │   ├── supervisor/                             # Routing, history sanitization
│   │   ├── agents/                                 # Dispatch, repository, prompts
│   │   ├── execution/                              # Sub-agent factory, runtime node
│   │   ├── policies/                               # Registry, generic policy
│   │   └── types/                                  # Agent & policy schemas
│   ├── app/                                        # This assistant's config
│   │   ├── register-defaults.ts, workflow-context.ts
│   │   ├── policies/                               # Domain policies + hooks
│   │   ├── model-registry.ts
│   │   └── runtime-agent-catalog.ts
│   ├── runtime-agents/                             # Domain tools & specs
│   │   ├── builtin-domains.ts
│   │   ├── tool-bundles.ts, tool-bundle-catalog.ts
│   │   ├── policies/{finance,obsidian,configuration}/
│   │   └── bootstrap.ts
│   ├── cron/                                       # Scheduler subsystem (+ cron/index.ts entry)
│   ├── telegram/                                   # I/O adapter + cron reporter
│   ├── tools/                                      # Shared tools (skills, routing)
│   ├── prompts/                                    # Prompt & skill loading
│   ├── services/                                   # Obsidian, Supabase, Wise
│   ├── mcp/                                        # MCP client wrappers + self-healing
│   ├── connectors/                                 # LLM connector abstraction
│   └── utils/                                      # Message content, FS, SQL, datetime
├── prompts/          # System prompt files
├── skills/           # Agent playbooks
├── data/             # Persisted cron jobs + runtime agents
├── specs/            # Design documents (may lag code)
├── tests/unit/       # 44 Vitest suites
├── tests/e2e/        # Playwright workflow tests
└── sql/              # Supabase setup scripts
```

---

## Testing Posture

- **44 unit test files** covering graph topology, state reducers, compaction, token-budget trimming, supervisor routing, sub-agent behavior, cron, skills, MCP self-healing, and domain tools
- **E2E** via Playwright (`tests/e2e/workflow.spec.ts`)
- Test helpers mirror production wiring (`tests/helpers/workflow-graph.ts`, `runtime-execution-context.ts`)
- `pnpm check` for TypeScript; `pnpm test:unit` / `pnpm test:e2e`

The core framework (`state`, `message-trimming`, `supervisor`, `create-sub-agent`, `empty-subagent-handoff`) has dedicated test coverage, which is appropriate given its complexity.

---

## Architectural Strengths

1. **Clean separation of concerns** — framework vs. app vs. domain runtime is consistently enforced and documented in the README.
2. **Single sub-agent factory** — all domains share one graph pattern; customization happens through hooks and deps, not copy-paste graphs.
3. **Runtime agents as data** — built-ins and custom agents share one schema; the supervisor routing schema is generated dynamically from enabled agents.
4. **Graceful degradation** — finance disabled without Supabase; routing failures produce user-facing fallback replies; empty sub-agent replies get supervisor summaries.
5. **Context budget management** — ~6k token budget trimming + consumed-tool compaction + handoff marker cleanup shows deliberate token economics.
6. **Hot-reload prompts/skills** — disk reads on each invocation aid local iteration without restarts.
7. **Extensibility path is clear** — new built-in domain = spec + tools + policy + factory registration; new custom agent = configuration CRUD + generic policy.

---

## Areas to Watch

| Area | Observation |
|---|---|
| **In-memory checkpointer** | `MemorySaver` means conversation state is lost on restart. Fine for a single-user Telegram bot; would need persistence for multi-instance or production durability. |
| **Dual-process deployment** | Telegram bot and cron scheduler compile separate graph instances. Cron state and chat threads do not share a checkpointer across processes. |
| **Single Telegram user** | `ALLOWED_TELEGRAM_USER_ID` enforces one user. Thread IDs exist but the security model is personal-assistant-scoped. |
| **Specs drift** | `specs/` still references legacy node names (`Finance_SG`, `Obsidian_SG`). Code has moved to unified `Runtime_SG` + agent ids. |
| **Graph name** | Still `"personal-assistant-phase-1"` in `agent.ts` — likely a leftover from MVP naming (`createAssistant` defaults to `"personal-assistant"`). |
| **No persistent message store** | History trimming + compaction is in-graph only; no external conversation log beyond Telegram. |
| **MCP reconnect scope** | `createSelfHealingMcpSession` retries once on transport errors; persistent MCP outages still disable finance until restart. |
| **Docker skills mount** | Production `Dockerfile` copies `prompts/` but not `skills/`. Compose mounts skills for the scheduler service only — the main bot container needs an explicit skills volume mount too. |
| **`ENABLE_SCHEDULER` config** | Env flag exists but the Telegram entrypoint does not start cron; scheduling requires the separate `cron/index.ts` process (or Docker scheduler service). |

---

## Extension Guide (Quick Reference)

**Add a built-in domain agent:**

1. Add spec to `BUILTIN_DOMAIN_SPECS` in `runtime-agents/builtin-domains.ts`
2. Implement tools under `runtime-agents/policies/<domain>/`
3. Add policy + hooks under `app/policies/`
4. Register factory in `DOMAIN_POLICY_FACTORIES` in `register-defaults.ts`
5. Add prompt file under `prompts/`

**Reuse the framework elsewhere:**

```typescript
import { createAssistant } from "./core/create-assistant.js";
// Provide your own policies, promptResolver, models, repository
```

**Add a custom runtime agent at runtime:**

Use the configuration agent in Telegram — creates a `generic` executor agent with selected tool bundles, persisted to `data/runtime-agents.json`.

---

## Summary

The architecture is a **well-factored LangGraph supervisor pattern** with a thin root graph, rich nested sub-agent loops, and a policy registry that cleanly separates framework from domain. State management is sophisticated for a personal bot — bounded history, tool-result compaction, and empty-reply handoff handling show mature attention to token cost and conversation validity.

The main evolutionary pressure points are **persistence** (checkpointer, conversation history), **multi-process coordination** (bot vs scheduler), **multi-user scaling**, and keeping **design docs (`specs/`) aligned** with the unified `Runtime_SG` dispatch model. The codebase itself is in good shape for continued domain expansion without restructuring the core graph.
