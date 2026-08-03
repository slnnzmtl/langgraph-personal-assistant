# Runtime Agent Setup Guide

Runtime agents are persisted specialist definitions in `data/runtime-agents.json`. Creating one via chat writes that definition immediately. The bot and scheduler watch this file and **recompile the LangGraph automatically** when enabled agents, capabilities, or step limits change—usually within a few seconds. No manual restart is required for routing new agents.

## Create via Telegram chat

Creation goes through the **Configuration** agent — there is no separate UI or slash command.

### Steps

1. Message Telegram with intent such as:
   - “Create a runtime agent named Daily Summary that summarizes my notes”
   - “Add a new agent for coding help with no tools”
2. The supervisor routes to `configuration`.
3. Configuration follows the `runtime-agents` skill (`data/skills/runtime-agents.xml`):
   - Calls `list_capabilities` when capability choice is unclear
   - Calls `create_runtime_agent(name, description, systemPrompt, capabilityIds, maxSteps?, enabled?)`
4. The tool persists the agent and notes that routing picks up automatically within a few seconds.
5. You get a field-per-line summary (`Agent ID`, `Name`, `Description`, optional `Model`, `Capabilities`, `Max Steps`, `Enabled`, `Status`). Chat-created agents use the default model unless you seed a custom `modelKey`.

### What chat create stores

| Field | Source |
|---|---|
| `id` | Slug from `name` (e.g. `Daily Summary` → `daily-summary`) |
| `name`, `description` | Tool args |
| `systemPrompt` | Bootstrap snapshot in JSON; full prompt in `data/prompts/{id}.xml` |
| `promptSourceKey` | Set to `{id}`; runtime loads the XML file on each invocation |
| `capabilityIds` | Allowlisted catalog only |
| `modelKey` | Optional; selects which registered chat model to use (built-in specialists use domain keys like `finance` / `obsidian`) |
| `maxSteps` | Optional, default `8` (1–20) |
| `enabled` | Optional, default `true` |

Persistence paths:

- Agent metadata: `data/runtime-agents.json` (document version `1`)
- Runtime prompt file: `data/prompts/{id}.xml` (writable data volume; survives Docker restarts)

All agents (shipped and chat-created) use `data/prompts/{id}.xml`. Default shipped prompts are tracked in git under `data/prompts/`.

### Related chat tools

| Tool | Purpose |
|---|---|
| `list_capabilities` | Show grantable capabilities |
| `create_runtime_agent` | Persist a new generic agent |
| `list_runtime_agents` | Summaries (no full prompts) |
| `preview_runtime_agent` | Full definition including prompt (configuration write access only) |
| `update_runtime_agent` | Edit / enable / disable |
| `delete_runtime_agent` | Delete (requires explicit confirmation) |

Agents granted only `system-config-read` can list summaries but cannot preview full prompts or mutate agents.

### Example request

> Create a runtime agent named “Coder” that helps with writing and debugging code. Use capability `none`. Description: coding agent.

That produces a definition with `capabilityIds: ["none"]` and the default model unless you set `modelKey`.

---

## Wire the agent (automatic)

Chat create **does** add LangGraph nodes once the file watcher recompiles the graph.

### Always required

1. Ensure the agent is **`enabled: true`** (default on create).
2. Wait a few seconds for the bot and scheduler to recompile their graphs from `./data/runtime-agents.json`.
3. Send a message that matches the agent’s **description** so the supervisor can route to the new id.

Until recompile completes, the agent appears in `list_runtime_agents` / disk but cannot receive routed requests. Supervisor routing is filtered by `wiredAgentIds` captured at graph compile time.

### Capability prerequisites

Pick capabilities from the allowlisted catalog. Some need deployment deps:

| Capability | Configurable for custom agents | Needs |
|---|---|---|
| `none` | yes | — (prompt-only) |
| `obsidian-vault` | yes | Obsidian vault path configured |
| `finance-domain` | no | Reserved for the persisted Finance agent (write SQL + Wise sync) |
| `finance-domain-read` | yes | Supabase read MCP session; `exec_sql` + `get_categories` only |
| `system-config-read` | yes | Cron + agent repositories |
| `system-config` | no | Reserved for the configurator (read + write) |

### Destructive delete confirmation

Delete tools require a resource-bound `confirmToken` after explicit user confirmation:

| Tool | confirmToken |
|---|---|
| `delete_skill` | `delete-skill:{module}:{name}` |
| `delete_runtime_agent` | `delete-runtime-agent:{id}` |
| `delete_cron_job` | `delete-cron-job:{jobName}` |

### Optional follow-ups (after recompile)

- **Skills** — Add playbooks under `data/skills/` with `module="<agent-id>"` (or matching `promptSourceKey`) so `read_skill` and auto-attachments work. Configure triggers in each skill’s `<skill_attachments>` block.
- **Cron** — Schedule jobs targeting the new agent id via Configuration (`create_cron_job`). **Known gap:** soft recompile refreshes graph routing, but the scheduler’s cron-target allowlist is captured at startup. If a cron job targeting a brand-new agent id fails validation, restart the scheduler process once so it picks up the new id.

---

## Create vs start

| Step | What happens | When it takes effect |
|---|---|---|
| **Create** | JSON row in `data/runtime-agents.json` | Immediately |
| **Start / wire** | Graph builds `{id}__prepare` / `__llm` / `__tools` / `__finalize`; supervisor can route to that id | Automatically on **file change** (bot + scheduler watchers, ~250ms debounce) |

Definitions are hot on disk; **execution topology recompiles when the graph fingerprint changes**.

---

## Beyond chat: new tool domains (rare)

Most specialists are created via chat (`generic` + grantable capabilities). Use this path only when you need **new tools** (or optional LLM-turn hooks) that are not already in the catalog.

This is the **canonical** add-tool-domain checklist. Other docs point here.

### Tools-only (~3 steps)

1. **Tools factory** — Implement tools under `src/runtime-agents/<feature>/tools.ts` (export the capability ID beside the factory). Put feature contracts in an adjacent `types.ts` only when needed; integrations import those types (runtime-agents must not import integrations).
2. **Integration (optional)** — Add `src/integrations/` clients only when an external service is required. Connection/`close` lifecycle stays in adapters/integrations; tools receive only the operations they need (e.g. `executeSql`, bound `sendFile`).
3. **One provider entry** — Register a `CapabilityProvider` in [`buildPersonalCapabilityProviders`](../apps/personal-assistant/src/composition/personal-pack.ts) inside `personal-pack.ts`, closing over adapters/config.

Then grant via Configuration chat, **or** set `reservedForAgentIds` on the descriptor for built-in agents (e.g. write finance).

Optional: seed/persist a `RuntimeAgentDefinition` + prompt under `data/prompts/`. Restart the scheduler once if cron will target a brand-new agent id.

Do **not** edit `buildPersonalCapabilityDeps` for product clients — those close over in the provider. System-only deps (repos, catalogs) stay in the pack. Do **not** add a domain binder, ports folder, or behavior registry.

### Tools + hooks (Obsidian pattern)

Same as tools-only, plus:

1. Add `src/runtime-agents/<feature>/hooks.ts` for LLM turn behavior (prompt enrichment, `processResponse`, and optional `resultMapping` for finalize salvage).
2. Wire one adjacent, capability-specific hook branch in composition ([`personal-runtime-policy.ts`](../apps/personal-assistant/src/composition/personal-runtime-policy.ts), injected by `personal-pack.ts` over default/system policy — not a second parallel policy API). Do not introduce a generic product-hooks registry until there are multiple independent cases.

Do **not** put vault/client paths on `PersonalCapabilityDeps` or `AppRuntimeExecutionOptions` — close over them in composition. Leave `policies/runtime-agent-policy.ts` for system-configuration and default policy only.

See also [ARCHITECTURE.md](./ARCHITECTURE.md) (adapters vs capability deps) and the README “Extending the assistant” section.

---

## Quick checklist

- [ ] Ask Configuration in Telegram to create the agent (name, description, prompt, capabilities)
- [ ] Confirm create response shows `Enabled: true`, a kebab-case `Agent ID`, and `Prompt file: data/prompts/{id}.xml`
- [ ] Confirm `data/prompts/{id}.xml` exists on disk (or in the `./data` Compose volume)
- [ ] Satisfy capability deps (`none` / vault / Supabase as needed)
- [ ] Wait a few seconds for bot and scheduler graph recompile
- [ ] Message the bot with intent matching the agent description
- [ ] (Optional) Add skills / cron jobs for that agent id; restart scheduler if cron targeting rejects the new id
