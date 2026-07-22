# Runtime Agent Setup Guide

Runtime agents are persisted specialist definitions in `data/runtime-agents.json`. Creating one via chat only writes that definition. The agent becomes routable only after the bot and scheduler processes restart and recompile the LangGraph with the new node set.

## Create via Telegram chat

Creation goes through the **Configuration** agent — there is no separate UI or slash command.

### Steps

1. Message Telegram with intent such as:
   - “Create a runtime agent named Daily Summary that summarizes my notes”
   - “Add a new agent for coding help with no tools”
2. The supervisor routes to `configuration`.
3. Configuration follows the `runtime-agents` skill (`skills/runtime-agents.xml`):
   - Calls `list_capabilities` when capability choice is unclear
   - Calls `create_runtime_agent(name, description, systemPrompt, capabilityIds, maxSteps?, enabled?)`
4. The tool persists the agent and reminds you to restart before routing works.
5. You get a field-per-line summary (`Agent ID`, `Name`, `Description`, `Capabilities`, `Max Steps`, `Enabled`, `Status`).

### What chat create stores

| Field | Source |
|---|---|
| `id` | Slug from `name` (e.g. `Daily Summary` → `daily-summary`) |
| `name`, `description`, `systemPrompt` | Tool args |
| `capabilityIds` | Allowlisted catalog only |
| `executor` | Always `"generic"` for chat-created agents |
| `builtin` | Always `false` |
| `maxSteps` | Optional, default `8` (1–20) |
| `enabled` | Optional, default `true` |

Persistence path: `data/runtime-agents.json` (document version `1`).

### Related chat tools

| Tool | Purpose |
|---|---|
| `list_capabilities` | Show grantable capabilities |
| `create_runtime_agent` | Persist a new generic agent |
| `list_runtime_agents` | Summaries (no full prompts) |
| `preview_runtime_agent` | Full definition including prompt |
| `update_runtime_agent` | Edit / enable / disable |
| `delete_runtime_agent` | Delete (requires explicit confirmation) |

### Example request

> Create a runtime agent named “Coder” that helps with writing and debugging code. Use capability `none`. Description: coding agent.

That produces a definition like the existing `coder` agent: `executor: "generic"`, `capabilityIds: ["none"]`.

---

## Additional job: start the agent (required)

Chat create does **not** add LangGraph nodes or make the agent routable.

### Always required

1. Ensure the agent is **`enabled: true`** (default on create).
2. **Restart both processes** so they remount `./data` and recompile the graph:
   - Telegram bot: `pnpm dev` / `personal-assistant`
   - Scheduler: `pnpm dev:scheduler` / `personal-assistant-scheduler`
3. Send a message that matches the agent’s **description** so the supervisor can route to the new id.

Until restart, the agent appears in `list_runtime_agents` / disk but cannot receive routed requests. Supervisor routing is filtered by `wiredAgentIds` captured at graph compile time.

### Capability prerequisites

Pick capabilities from the allowlisted catalog. Some need deployment deps:

| Capability | Configurable for custom agents | Needs |
|---|---|---|
| `none` | yes | — (prompt-only) |
| `obsidian-vault` | yes | Obsidian vault path configured |
| `finance-domain` | yes | Supabase; agents using it are auto-disabled if Supabase is missing |
| `system-config-read` | yes | Cron + agent repositories |
| `system-config` | no | Reserved for the configurator (read + write) |

### Optional follow-ups (after restart)

- **Skills** — Add playbooks under `skills/` with `module="<agent-id>"` (or matching `promptSourceKey`) so `read_skill` and auto-attachments work. Configure triggers in each skill’s `<skill_attachments>` block.
- **Cron** — Schedule jobs targeting the new agent id via Configuration (`create_cron_job`). Cron targets are derived from enabled agent ids at startup.

---

## Create vs start

| Step | What happens | When it takes effect |
|---|---|---|
| **Create** | JSON row in `data/runtime-agents.json` | Immediately |
| **Start / wire** | Graph builds `{id}__prepare` / `__llm` / `__tools` / `__finalize`; supervisor can route to that id | On **bot + scheduler restart** |

Definitions are hot on disk; **execution topology is compile-time**.

---

## Beyond chat: custom domain agents

Chat create cannot register a new executor, policy hooks, or tool implementations. For a new domain specialist:

1. Persist or seed a `RuntimeAgentDefinition`.
2. Implement tools under `src/runtime-agents/tools/<domain>.ts`.
3. Add a capability descriptor + provider in `src/runtime-agents/builtin-capabilities.ts`.
4. Add policy + hooks under `src/app/policies/`; register in `DOMAIN_POLICY_FACTORIES` in `src/app/register-defaults.ts`.
5. Add a prompt under `prompts/` (optional `promptSourceKey`).
6. Restart so `createAssistant()` wires the nodes.

See also [ARCHITECTURE.md](./ARCHITECTURE.md) and the README “Extending the assistant” section.

---

## Quick checklist

- [ ] Ask Configuration in Telegram to create the agent (name, description, prompt, capabilities)
- [ ] Confirm create response shows `Enabled: true` and a kebab-case `Agent ID`
- [ ] Satisfy capability deps (`none` / vault / Supabase as needed)
- [ ] Restart bot **and** scheduler
- [ ] Message the bot with intent matching the agent description
- [ ] (Optional) Add skills / cron jobs for that agent id
