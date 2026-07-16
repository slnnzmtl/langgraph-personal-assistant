# Personal Assistant

A Telegram-based personal assistant built with [LangGraph](https://langchain-ai.github.io/langgraph/). A root **Supervisor** routes each message to specialized sub-agents for finance, Obsidian notes, or system configuration. The bot runs locally (or in Docker), polls Telegram for updates, and keeps conversation state in a bounded message window.

## Architecture

The codebase is split into a **reusable framework** (`src/core/`), an **app layer** (`src/app/`) for this assistant's policies and wiring, and **domain runtime** code (`src/runtime-agents/`) for tools, bundles, and defaults. The graph entry point is `createAssistant()` in `src/core/create-assistant.ts`; the Telegram app calls it via `createWorkflowGraph()` in `src/agent.ts`.

```mermaid
graph TD
    User((User)) <-->|Telegram| Adapter[Telegram Adapter]
    Cron[node-cron Scheduler] -->|SYSTEM_CRON_TRIGGER:agentId:jobName| Adapter

    subgraph AppLayer [App layer]
        AppTS[app.ts bootstrap]
        AgentTS[agent.ts createWorkflowGraph]
        AppKit[createAppExecutionKit]
        AppPolicies[finance / obsidian / configuration policies]
    end

    subgraph CoreFramework [Core framework]
        CreateAssistant[createAssistant]
        Supervisor{Supervisor}
        Dispatcher[Runtime_SG dispatcher]
        PolicyRegistry[PolicyRegistry per instance]
        PromptResolver[PromptResolver per instance]
    end

    subgraph RootGraph [Root LangGraph]
        Adapter --> AppTS --> AgentTS --> CreateAssistant
        CreateAssistant --> Supervisor
        Supervisor --> Dispatcher
        Dispatcher --> Supervisor
        Supervisor --> Adapter
    end

    AppKit --> CreateAssistant
    AppPolicies --> AppKit
    PolicyRegistry --> Dispatcher
    PromptResolver --> Dispatcher

    subgraph RuntimePolicies [Policy executors]
        Dispatcher --> FinancePolicy[finance]
        Dispatcher --> ObsidianPolicy[obsidian]
        Dispatcher --> ConfigurationPolicy[configuration]
        Dispatcher --> GenericPolicy[generic agents]
    end

    FinancePolicy <-->|MCP| Supabase[(Supabase)]
    FinancePolicy <-->|REST| Wise[Wise API]
    ObsidianPolicy <-->|Read / Write| Vault[(Obsidian Vault)]
```

### Layer responsibilities

| Layer | Path | Responsibility |
|---|---|---|
| **Core framework** | `src/core/` | LangGraph topology, supervisor routing, runtime dispatch, sub-agent loops, policy registry API, agent repository, shared state |
| **App layer** | `src/app/` | Built-in policies, per-domain LLM hooks, prompt wiring, `createAppExecutionKit()` |
| **Domain runtime** | `src/runtime-agents/` | Tool bundles, domain tools (finance / obsidian / configuration), built-in agent defaults, bootstrap |
| **Infrastructure** | `src/cron/`, `src/telegram/`, `src/tools/`, `src/services/` | Scheduler, Telegram I/O, shared tool plumbing, external integrations |

Each `createAssistant()` call builds an isolated **execution context** with its own `PolicyRegistry` and `PromptResolver`, so multiple assistant instances do not share global policy or prompt state.

### Runtime flow

1. **Supervisor** reads the latest user message (or cron trigger) and routes to `FINISH` or `Runtime_SG`.
2. **Dispatcher** loads the selected runtime agent from the repository, resolves its system prompt, and picks a policy by `executor` (`finance`, `obsidian`, `configuration`, or `generic`).
3. **Policy handler** runs a nested sub-graph: LLM node ⇄ tools loop (via `createSubAgent()`), with domain behavior injected through **hooks** in `src/app/policies/*-hooks.ts`.
4. The sub-agent reply returns to the supervisor; the loop continues until the supervisor chooses `FINISH`.

Routing uses **agent ids** (`finance`, `obsidian`, `configuration`, or custom ids from the runtime-agent repository). Legacy graph node aliases such as `Finance_SG` / `Obsidian_SG` are no longer used.

| Component | Role |
|---|---|
| **Supervisor** | Intent routing via structured JSON output (`FINISH` or a runtime agent id) |
| **Runtime dispatcher** | Selects a policy by the agent's `executor` and runs the matching sub-graph loop |
| **Finance policy** | Expense tracking, Wise transaction sync, SQL via Supabase MCP |
| **Obsidian policy** | Markdown vault read/write with multi-step tool loops (up to 8 steps per request) |
| **Configuration policy** | Cron job management, runtime-agent CRUD, and skill CRUD |
| **Generic policy** | User-created runtime agents with allowlisted tool bundles |
| **Skills** | Reusable step-by-step playbooks in `skills/{owner}/` injected into agent prompts |
| **Scheduler** | Optional `node-cron` daemon that injects `SYSTEM_CRON_TRIGGER:<agentId>:<jobName>` messages into the graph |

The assistant keeps only the last **10 messages** per thread. Older turns are trimmed once the window is exceeded, while preserving in-flight tool-call sequences as atomic units.

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
| `ENABLE_SCHEDULER` | unset (disabled) | Set to `1` or `true` to activate in-process cron |
| `CRON_JOBS_FILE_PATH` | `data/cron-jobs.json` | Persisted cron job definitions |

### Finance sync (optional)

Finance features require Supabase MCP credentials and Wise API access:

| Variable | Description |
|---|---|
| `SUPABASE_PROJECT_REF` | Supabase project reference |
| `SUPABASE_ACCESS_TOKEN` | Supabase personal access token |
| `SUPABASE_MCP_URL` | Hosted MCP endpoint (default: `https://mcp.supabase.com/mcp`) |
| `WISE_API_TOKEN` | Wise API bearer token |
| `WISE_PROFILE_ID` | Wise profile ID for activity fetches |

Database setup:

1. Install the `exec_sql` RPC — see [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) and [sql/INSTRUCTIONS.md](sql/INSTRUCTIONS.md)
2. Ensure the `expense` table and dedup constraint exist (see `sql/add_expense_unique_constraint.sql`)

Without Supabase credentials the Finance sub-graph returns a configuration error instead of crashing the app.

### Scheduler (optional)

When `ENABLE_SCHEDULER` is truthy, cron jobs from `data/cron-jobs.json` are loaded at startup and executed via synthetic `SYSTEM_CRON_TRIGGER:` messages. Jobs target runtime agent ids such as `finance`, `obsidian`, or `configuration` using the format `SYSTEM_CRON_TRIGGER:<agentId>:<jobName>`. Create and manage jobs through the configuration agent in Telegram (e.g. "list cron jobs", "schedule a daily finance sync").

## Skills

Skills are markdown playbooks with YAML frontmatter, organized by owner:

```
skills/
  finance/
    sync-expenses.md
  obsidian/
  configuration/
```

Each skill file requires `name` and `description` in frontmatter. Agent prompts automatically list available skills for their domain and expose `read_skill` (execution agents) or full CRUD tools (configuration). The finance `sync-expenses` skill drives the Wise → categorize → dedup-insert pipeline.

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

Override the vault host path with `OBSIDIAN_VAULT_HOST_PATH` in your shell or `.env`. Inside the container, `OBSIDIAN_VAULT_PATH` is set to `/data/obsidian-vault`.

The production image copies `prompts/` but not `skills/` or vault data. To use custom skill playbooks in the production container, mount `./skills:/app/skills` (the app reads from `skills/` relative to its working directory).

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
  core/                     # Reusable assistant framework
    create-assistant.ts     # createAssistant() — main graph API
    state.ts                # AgentState, message trimming
    supervisor/             # Supervisor node, routing schema, message sanitization
    agents/                 # Dispatch, repository, prompt resolver
    execution/              # Runtime LLM node, sub-agent graphs, execution context
    policies/               # Policy registry, generic policy
    types/                  # RuntimeAgentDefinition, policy types

  app/                      # This assistant's configuration
    config.ts               # Built-in agent ids, repository factory
    register-defaults.ts    # createAppExecutionKit() — policies + prompt resolver
    policies/               # Domain policies, hooks, shared LLM node factories

  agent.ts                  # createWorkflowGraph() → createAssistant()
  app.ts                    # Telegram + cron bootstrap

  runtime-agents/           # Domain tools and defaults
    defaults.ts             # Built-in finance / obsidian / configuration agents
    bootstrap.ts            # Merge persisted agents with defaults
    tool-bundles.ts         # Tool bundle catalog
    policies/               # finance / obsidian / configuration tool implementations

  cron/                     # Scheduler bootstrap, runner, job repository
  telegram/                 # Telegram adapter and file sender
  tools/                    # Shared tools (skills, routing, guarded tool nodes)
  prompts/                  # Prompt and skill loading (load-system-prompt.ts)
  services/                 # Obsidian vault, Wise, Supabase helpers

prompts/                    # System prompt files (.xml / .md)
skills/                     # Agent skill playbooks
data/                       # Persisted cron jobs and runtime agents
specs/                      # Design documents
tests/                      # Unit and e2e tests
```

### Extending the assistant

- **New built-in domain agent:** add tools under `src/runtime-agents/policies/`, a policy + hooks under `src/app/policies/`, register it in `createAppPolicies()`, and add a default agent in `defaults.ts`.
- **New custom runtime agent:** create via the configuration agent; the generic policy compiles a sub-graph from `toolBundleIds` in the repository.
- **Reusing the framework:** import `createAssistant` from `src/core/create-assistant.ts` with your own `policies`, `promptLoaders`, and `genericPolicyDeps` (or pass a pre-built `policyRegistry` + `promptResolver`).
