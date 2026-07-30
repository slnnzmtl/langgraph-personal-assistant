# Personal Assistant Simplification Plan

## Status

**Phases A–D and E1–E3 are complete.**

| Phase | Goal | Status |
|---|---|---|
| A | Remove behavior plugin, vault leak, boundary exception | Done |
| B | Delete `composition/domains/` | Done |
| C | Delete app `ports/` without losing lifecycle ownership | Done |
| D | Rewrite docs / graphs for the shorter authoring path | Done |
| E1 | Collapse dual policy stack; thin personal Obsidian hook seat | Done |
| E2 | Naming hygiene (helpers, comments, test paths) | Done |
| E3 | Close this plan loop; align active docs | Done |

What was removed (no longer in tree):

- `apps/personal-assistant/src/composition/domains/`
- `apps/personal-assistant/src/ports/`
- Personal resolver triad / dual parallel policy factories
- `capabilityBehaviors`, hook-priority lists, and product-hook registries

Capability **string IDs** such as `finance-domain` and `obsidian-vault` are intentionally unchanged (persisted grants).

## Current architecture (post-simplification)

```text
runtime-agents/<feature>/
  tools.ts                    tool factories and capability IDs
  hooks.ts                    optional feature hooks; Obsidian already owns this
  types.ts                    feature contracts only when needed
integrations/                 external implementations and connection lifecycle
telegram/                     concrete Telegram sender and chat-ID state
composition/
  personal-pack.ts            sole provider registration and product close-overs
  personal-runtime-policy.ts  thin Obsidian hook branch (pack injects this policy)
  runtime-execution.ts        shell, cache, and generic runtime assembly
  personal-adapters.ts        Supabase sessions and close lifecycle
  runtime-agent-defaults.ts   seeding and capability-dependent defaults
policies/                     system configuration and default runtime policy
```

`personal-pack.ts` is the single composition root. It injects
`createPersonalRuntimeAgentPolicy` into runtime execution. That factory is a
**thin product seat** for the Obsidian capability branch on top of
`policies/runtime-agent-policy.ts` (system-configuration + default behavior) —
not a second parallel policy API.

## Historical problem (Phases A–C solved)

Earlier work had replaced simpler wiring with a domain binder and
capability-behavior framework. That added files and registration steps without
simplifying how tools are added. The target was fewer layers, one composition
root, and no product-specific configuration in generic runtime execution.

### What we deleted

1. **Domain abstraction** — no binder, domain registry, domain context, or
   `composition/domains/` barrel. Providers register directly in
   `personal-pack.ts`.
2. **Capability-behavior plugin system** — no `capabilityBehaviors`, hook
   priority list, or product-hook registry. Obsidian hooks stay in
   `runtime-agents/obsidian/hooks.ts`; composition wires one adjacent branch.
3. **App `ports/`** — tools receive bound operations (`executeSql`, `sendFile`);
   Telegram and Supabase retain connection/chat-ID/`close` lifecycle.
4. **Vault leak into generic runtime** — vault path closes over in the pack /
   personal policy seat; `AppRuntimeExecutionOptions` stays product-free.

## Canonical tool-addition flow

Adding a normal tool requires:

1. Add its factory under `runtime-agents/<feature>/`.
2. Add one provider entry in `personal-pack.ts`.
3. Add an integration only when an external service is required.

It must not require a domain file, port file, registry, binder, or behavior
factory.

A capability with runtime hooks may additionally require one adjacent,
capability-specific hook branch (today: `personal-runtime-policy.ts`, injected
by the pack). It must still require only one composition path and must not
introduce a generic registry.

## Guardrails (still in force)

- No `composition/domains/` directory.
- No app `ports/` directory.
- No product-specific fields in `AppRuntimeExecutionOptions`.
- No `capabilityBehaviors`, hook priority list, or product-hook registry.
- No product clients in the system capability dependency bag.
- No policies importing composition.
- No personal-domain concepts in the supervisor framework.
- No replacement `DomainModule`, binder, access-policy DSL, or behavior
  registry.
- No replacement `contracts/` directory.
- Obsidian/context-cache semantics must remain covered by tests.
- Telegram owns chat-ID state; tools only receive a bound send operation.
- SQL connection and close lifecycle remain in adapters/integrations; finance
  tools only execute SQL.
- Do not weaken architectural boundaries to make new wiring compile.
- Documentation must describe a tools-only addition as one provider entry in
  one composition file.
- Do not rename persisted capability ID string values (`finance-domain`, etc.).

## Completed phase notes

### Phase A (done)

Closed over the vault path; inlined Obsidian hook composition; removed
`obsidianVaultPath` / behavior registries from runtime execution options;
restored `policies`→`composition` boundary.

### Phase B (done)

Moved capability IDs beside runtime-agent tools; providers live in
`personal-pack.ts`; `composition/domains/` deleted.

### Phase C (done)

Feature contracts beside runtime agents; `executeSql` / bound `sendFile`; app
`ports/` deleted; adapter/Telegram lifecycle preserved.

### Phase D (done)

Architecture / runtime-agent docs describe the shorter authoring path; no
instructions to add binders, behaviors, or app ports as current practice.

### Phase E1 (done)

Dual policy stack collapsed. Pack injects `createPersonalRuntimeAgentPolicy`;
`personal-runtime-policy.ts` is the Obsidian branch seat over default/system
policy — not a second parallel policy API. Personal resolver triad removed.

### Phase E2 (done)

- Test helper `createDomainCapabilityCatalog` → `createProductCapabilityCatalog`
  (`CreateTestCapabilityCatalogOptions`).
- `createFinanceDomainTools` → `createFinanceTools` (capability ID strings kept).
- Stale “domain binder” comments fixed (e.g. `system-capability-deps.ts`).
- `tests/unit/domains/` → `tests/unit/runtime-agents/` (+ top-level
  `capabilities.test.ts`).

### Phase E3 (done)

This plan reframed as historical + status. Active docs
(ARCHITECTURE / RUNTIME_AGENT_SETUP / FRAMEWORK / README) spot-checked for
stale binder / domains / ports / dual-policy language.

## Completion criteria (met)

- `apps/personal-assistant/src/composition/domains/` does not exist.
- `apps/personal-assistant/src/ports/` does not exist.
- `AppRuntimeExecutionOptions` contains no product fields or behavior registries.
- Default/system policy has no composition imports or capability-behavior maps.
- Dependency-cruiser and app-boundary tests prohibit `policies`→`composition`.
- `PersonalCapabilityDeps` remains limited to system capabilities.
- Pack injects personal runtime policy; Obsidian hook seat is thin and singular.
- A tools-only capability requires one provider entry in `personal-pack.ts`.
- No replacement abstraction recreates the removed layers.
- Focused unit tests and dependency-boundary checks pass.
