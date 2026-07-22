# Personal Assistant

A Telegram-based personal assistant built with [LangGraph](https://langchain-ai.github.io/langgraph/). A root **Supervisor** routes each message to specialized sub-agents for finance, Obsidian notes, or system configuration. The bot runs locally (or in Docker), polls Telegram for updates, and keeps conversation state in a bounded message window.

## Architecture

The codebase is split into an **execution kernel** (`src/core/`), an **app layer** (`src/app/`) for this assistant's policies and wiring, and **domain runtime** code (`src/runtime-agents/`) for tools, bundles, and defaults. The graph entry point is `createAssistant()` in `src/core/create-assistant.ts`; the Telegram app calls it via `createWorkflowGraph()` in `src/agent.ts`.

```mermaid
graph TD
    User((User)) <-->|Telegram| Adapter[Telegram Adapter]
    Cron[node-cron Scheduler] -->|SYSTEM_CRON_TRIGGER:agentId:jobName| Graph

    subgraph AppLayer [App layer]
        AppTS[app.ts bootstrap]
        AgentTS[agent.ts createWorkflowGraph]
        AppKit[createAppExecutionKit]
        AppPolicies[finance / obsidian / configuration policies]
    end

    subgraph CoreKernel [Execution kernel]
        CreateAssistant[createAssistant]
        Supervisor{Supervisor}
        Prepare["agent__prepare"]
        Llm["agent__llm"]
        Tools["agent__tools"]
        Finalize["agent__finalize"]
    end

    subgraph RootGraph [Root LangGraph]
        Adapter --> AppTS --> AgentTS --> CreateAssistant
        CreateAssistant --> Supervisor
        Supervisor -->|agent id| Prepare
        Prepare --> Llm
        Llm --> Tools
        Tools --> Llm
        Llm --> Finalize
        Finalize --> Supervisor
        Supervisor -->|FINISH| Adapter
        Cron --> Graph
    end

    AppKit --> CreateAssistant
    AppPolicies --> AppKit

    subgraph RuntimePolicies [Policy executors]
        Llm --> FinancePolicy[finance]
        Llm --> ObsidianPolicy[obsidian]
        Llm --> ConfigurationPolicy[configuration]
        Llm --> GenericPolicy[generic agents]
    end

    FinancePolicy <-->|MCP| Supabase[(Supabase)]
    FinancePolicy <-->|REST| Wise[Wise API]
    ObsidianPolicy <-->|Read / Write| Vault[(Obsidian Vault)]
```

### Layer responsibilities

| Layer | Path | Responsibility |
|---|---|---|
| **Execution kernel** | `src/core/` | LangGraph topology, supervisor routing, flat runtime-agent loops, policy registry API, agent repository, shared state |
| **App layer** | `src/app/` | Built-in policies, per-domain LLM hooks, prompt wiring, `createAppExecutionKit()` |
| **Domain runtime** | `src/runtime-agents/` | Tool bundles, domain tools (finance / obsidian / configuration), skill attachments |
| **Infrastructure** | `src/cron/`, `src/telegram/`, `src/tools/`, `src/services/` | Scheduler, Telegram I/O, shared tool plumbing, external integrations |

Each `createAssistant()` call builds an isolated **execution context** with its own `PolicyRegistry` and `loadPromptByKey`, so multiple assistant instances do not share global policy or prompt state.

### Runtime flow

1. **Supervisor** reads the latest user message (or cron trigger) and routes to `FINISH` or a runtime agent id.
2. **Prepare** scopes recent parent messages into `agentMessages`; **llm ⇄ tools** runs the specialist loop; **finalize** merges the final reply back into parent `messages`.
3. Domain behavior is injected through **hooks** in `src/app/policies/*-hooks.ts`. System prompts use static domain rules first; dynamic context (timestamps, vault trees, attached skills) is appended at the bottom for cache efficiency.
4. Control returns to the supervisor until it chooses `FINISH`.

Routing uses **agent ids** (`finance`, `obsidian`, `configuration`, or custom ids from the runtime-agent repository). Only agents wired at graph compile time are routable; creating a new agent via the configuration agent requires a **process restart** before routing works.

| Component | Role |
|---|---|
| **Supervisor** | Intent routing via structured JSON output (`FINISH` or a wired runtime agent id) |
| **Runtime agent loop** | Flat prepare / llm ⇄ tools / finalize nodes per enabled agent |
| **Finance policy** | Expense tracking, Wise transaction sync, SQL via Supabase MCP |
| **Obsidian policy** | Markdown vault read/write with multi-step tool loops |
| **Configuration policy** | Cron job management, runtime-agent CRUD, and skill CRUD |
| **Generic policy** | User-created runtime agents with allowlisted tool bundles |
| **Skills** | Reusable step-by-step playbooks in flat `skills/` with a `module` attribute, injected into agent prompts |
| **Scheduler** | Optional `node-cron` daemon that injects `SYSTEM_CRON_TRIGGER:<agentId>:<jobName>` messages into the graph |

Message history is trimmed to a configurable token budget (default ~6,000 estimated tokens via `MESSAGE_HISTORY_MAX_TOKENS`), while preserving in-flight tool-call sequences as atomic units.

## Prerequisites

- Node.js **20+**
- [pnpm](https://pnpm.io/) (see `packageManager` in `package.json`)
- A Telegram bot token and your Telegram user ID

## Local Development

```sh
pnpm install
cp .env.example .env   # fill in required values
pnpm dev
```

### Required environment variables

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from [@BotFather](https://t.me/BotFather) |
| `ALLOWED_TELEGRAM_USER_ID` | Only this Telegram user can interact with the bot |
| `GOOGLE_API_KEY` | Google AI API key for Gemini models |

### Optional environment variables

| Variable | Default | Description |
|---|---|---|
| `GEMINI_MODEL` | `gemini-2.5-flash-lite` | Fallback model for all agents |
| `SUPERVISOR_MODEL` | `GEMINI_MODEL` | Model for the root supervisor |
| `OBSIDIAN_MODEL` | `GEMINI_MODEL` | Model for the Obsidian sub-graph |
| `FINANCE_MODEL` | `GEMINI_MODEL` | Model for the Finance sub-graph |
| `APP_TIMEZONE` | `UTC` | IANA timezone for date hints and cron scheduling |
| `OBSIDIAN_VAULT_PATH` | `src/obsidian-vault` | Local path to the markdown vault |
| `ENABLE_SCHEDULER` | unset (disabled) | Enables the dedicated scheduler process (`pnpm dev:scheduler` / `personal-assistant-scheduler`). When disabled, that process stays idle until shutdown instead of scheduling jobs. The Telegram bot never runs in-process cron. |
| `CRON_JOBS_FILE_PATH` | `data/cron-jobs.json` | Persisted cron job definitions |
| `ENABLE_PROMPT_LOGS` | `true` | Log assembled system prompts to the console (`false` in test scripts) |

### LangSmith tracing (optional)

LangGraph automatically sends traces to [LangSmith](https://smith.langchain.com) when these variables are set — no graph or code changes required. You get a visual debugger for the supervisor, flat runtime-agent nodes (prepare / llm / tools / finalize), and every LLM prompt.

| Variable | Default | Description |
|---|---|---|
| `LANGCHAIN_TRACING_V2` | unset (disabled) | Set to `true` to enable tracing |
| `LANGCHAIN_API_KEY` | — | API key from LangSmith → Settings → API Keys |
| `LANGCHAIN_PROJECT` | `default` | Project name in the LangSmith UI (e.g. `personal-assistant`) |

### Finance sync (optional)

Finance features require Supabase MCP credentials and Wise API access:

| Variable | Description |
|---|---|
| `SUPABASE_PROJECT_REF` | Supabase project reference |
| `SUPABASE_ACCESS_TOKEN` | Supabase personal access token |
| `SUPABASE_MCP_URL` | Hosted MCP endpoint (default: `https://mcp.supabase.com/mcp`) |
| `MCP_MAX_RECONNECT_ATTEMPTS` | Reconnect retries after transport failure (default: `1`) |
| `MCP_RECONNECT_BASE_DELAY_MS` | Initial backoff before first reconnect (default: `0` — immediate retry) |
| `MCP_RECONNECT_MAX_DELAY_MS` | Cap on exponential backoff delay (default: `5000`) |
| `WISE_API_TOKEN` | Wise API bearer token |
| `WISE_PROFILE_ID` | Wise profile ID for activity fetches |

Database setup:

1. Install the `exec_sql` RPC — see [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) and [sql/INSTRUCTIONS.md](sql/INSTRUCTIONS.md)
2. Ensure the `expense` table and dedup constraint exist (see `sql/add_expense_unique_constraint.sql`)

Without Supabase credentials the finance agent returns a configuration error instead of crashing the app.

### Scheduler (optional)

Production Docker runs scheduling in the separate `personal-assistant-scheduler` service. When `ENABLE_SCHEDULER` is truthy, that process loads jobs from `data/cron-jobs.json` and executes them via synthetic `SYSTEM_CRON_TRIGGER:` messages. When disabled, the scheduler process stays idle (no jobs run) until it receives SIGINT/SIGTERM. Jobs target runtime agent ids such as `finance`, `obsidian`, or `configuration` using the format `SYSTEM_CRON_TRIGGER:<agentId>:<jobName>`. Create and manage jobs through the configuration agent in Telegram (e.g. "list cron jobs", "schedule a daily finance sync").

## Skills

Skills are XML playbooks stored in a flat `skills/` directory. Each file requires `name`, `module`, and `description` on the root `<skill>` element:

```
skills/
  sync-expenses.xml
  daily-routine-note-creation.xml
  cron.xml
  runtime-agents.xml
  skill-management.xml
```

The `module` attribute (`finance`, `obsidian`, or `configuration`) controls which runtime agent lists and auto-attaches the skill. Optional `<skill_attachments>` blocks define phrase/cron triggers for auto-attachment. Agent prompts list available skills for their module and expose `read_skill` (execution agents) or full CRUD tools (configuration). The finance `sync-expenses` skill drives the Wise → categorize → dedup-insert pipeline.

## System prompts

Prompt sources of truth live under `prompts/`:

| Agent | File |
|---|---|
| Supervisor | `prompts/supervisor.xml` |
| Obsidian | `prompts/obsidian.xml` |
| Finance | `prompts/finance.xml` |
| Configuration | `prompts/configuration.md` |

Prompts are read from disk on each invocation, so edits take effect without restarting the process during local development.

## Docker Compose

The Compose setup supports production-style and development containers.

### Production-style container

Create a `.env` file, then run:

```sh
docker compose up --build
```

| Mount | Host default | Container path |
|---|---|---|
| Obsidian vault | `./src/obsidian-vault` | `/data/obsidian-vault` |
| Persisted JSON (`runtime-agents`, cron jobs) | `./data` | `/app/data` |

Override host paths with `OBSIDIAN_VAULT_HOST_PATH` and `DATA_HOST_PATH` in your shell or `.env`. Inside the container, `OBSIDIAN_VAULT_PATH` is set to `/data/obsidian-vault`.

Both `personal-assistant` and `personal-assistant-scheduler` mount the same `data/` volume so runtime-agent and cron definitions changed through Telegram are visible to both processes. JSON writes are serialized within each process; concurrent writes from bot and scheduler can still race across processes.

The production image copies `prompts/` and `skills/` into the container. To override skill playbooks from the host, add a bind mount in a Compose override file, for example `./skills:/app/skills`.

### Development container

Bind-mounted source with `pnpm dev` inside the container:

```sh
docker compose --profile dev up --build personal-assistant-dev
```

The dev service mounts the workspace into `/app`, keeps `node_modules` in a named Docker volume, and mounts the vault separately so note files persist outside the container.

## Testing

```sh
pnpm test:unit          # Vitest unit tests
pnpm test:e2e           # Playwright end-to-end tests
pnpm test               # Both suites
pnpm check              # TypeScript type check
```

## Project layout

```
src/
  core/                     # Execution kernel (LangGraph, supervisor, policies API)
    create-assistant.ts     # createAssistant() — main graph API
    state.ts                # AgentState, message trimming
    supervisor/             # Supervisor node, routing schema, message sanitization
    agents/                 # Dispatch, repository, prompt resolver
    execution/              # Runtime LLM node, sub-agent graphs, execution context
    policies/               # Policy registry, generic policy
    types/                  # RuntimeAgentDefinition, policy types

  app/                      # This assistant's configuration
    register-defaults.ts    # createAppExecutionKit() — policies + prompt resolver
    policies/               # Domain policies, hooks, shared LLM node factories

  config.ts                 # Environment config (models, vault path, API keys)
  agent.ts                  # createWorkflowGraph() → createAssistant()
  app.ts                    # Telegram + cron bootstrap

  app/composition/          # Bootstrap agents, supervisor system wiring
    bootstrap-agents.ts     # CONFIGURATOR_SPEC — code-seeded configurator only
  runtime-agents/           # Domain tools and capability catalog (no app imports)
    tool-bundles.ts         # Capability providers and bundle deps
    skill-attachments.ts    # Skill auto-attachment rules
    policies/               # finance / obsidian / configuration tool implementations

  cron/                     # Scheduler process (separate from Telegram bot)
  telegram/                 # Telegram adapter and file sender
  tools/                    # Shared tools (skills, routing, guarded tool nodes)
  prompts/                  # Prompt and skill loading (load-system-prompt.ts)
  services/                 # Obsidian vault, Wise, Supabase helpers

prompts/                    # System prompt files (.xml / .md)
skills/                     # Agent skill playbooks
data/                       # Persisted cron jobs and runtime agents
docs/                       # Architecture and design documentation (see docs/ARCHITECTURE.md)
tests/                      # Unit and e2e tests
```

### Extending the assistant

- **New built-in domain agent:** add persisted agent spec + tools under `src/runtime-agents/policies/`, a policy + hooks under `src/app/policies/`, and register the policy factory in `DOMAIN_POLICY_FACTORIES` inside `src/app/register-defaults.ts`. Restart required.
- **New custom runtime agent:** create via the configuration agent with `capabilityIds`; restart required before routing works. Step-by-step: [docs/RUNTIME_AGENT_SETUP.md](docs/RUNTIME_AGENT_SETUP.md).
