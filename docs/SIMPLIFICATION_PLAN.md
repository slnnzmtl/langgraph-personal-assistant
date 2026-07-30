# Personal Assistant Simplification Plan

## Problem

The current refactor replaces earlier abstractions with a domain binder and
capability-behavior framework. This increases the number of files and
registration steps without simplifying how tools are added.

The target is fewer layers, one composition root, and no product-specific
configuration in generic runtime execution.

## Target architecture

```text
runtime-agents/<feature>/
  tools.ts                    tool factories and capability IDs
  hooks.ts                    optional feature hooks; Obsidian already owns this
  types.ts                    feature contracts only when needed
integrations/                 external implementations and connection lifecycle
telegram/                     concrete Telegram sender and chat-ID state
composition/
  personal-pack.ts            sole provider registration and product close-overs
  runtime-execution.ts        shell, cache, and generic runtime assembly
  personal-adapters.ts        Supabase sessions and close lifecycle
  runtime-agent-defaults.ts   seeding and capability-dependent defaults
policies/                     system configuration and default runtime policy
```

Delete:

- `apps/personal-assistant/src/composition/domains/`
- `apps/personal-assistant/src/ports/`

`personal-pack.ts` becomes the single composition root.

## Simplification points

### 1. Delete the domain abstraction

- Remove all files under `composition/domains/`.
- Register `CapabilityProvider` values directly in `personal-pack.ts`.
- Keep capability IDs beside their runtime agents.
- Do not retain a binder, domain registry, domain context, or domain barrel.

### 2. Remove Obsidian from generic runtime execution

- Delete `obsidianVaultPath` from `AppRuntimeExecutionOptions`.
- Close over the vault path in `personal-pack.ts` when constructing the
  Obsidian provider and hook selection.
- Keep `runtime-execution.ts` free of vault paths and capability-behavior maps.
- Attach the one Obsidian hook case directly while composing runtime policy;
  do not replace the behavior map with a differently named plugin registry.

### 3. Delete the capability-behavior plugin system

- Keep the existing Obsidian hook implementation in
  `runtime-agents/obsidian/hooks.ts`.
- Inline only the composition wiring currently in `domains/behaviors.ts`.
- Delete behavior maps, priorities, factories, and composition-owned policy
  types.
- Remove `capabilityBehaviors`, `capabilityHookPriority`, and their resolver
  from `runtime-agent-policy.ts`.
- Keep system-configuration and default behavior in policy. Handle the one
  product hook case in composition.
- Do not introduce a generic product-hooks registry, priority list, or
  resolver until there are at least two independent product hook cases.
- Preserve the current Obsidian/context-cache interaction:
  - include the vault tree in cache extras;
  - prefer cache prompt/model hooks where required;
  - disable mid-session `selectToolsForTurn` while context caching is active.

### 4. Eliminate `ports/`

- Replace `IFileSender` with the operation tools actually need:
  `sendFile?: (path: string) => Promise<void>`.
- Keep the concrete `TelegramFileSender`, including mutable chat-ID state,
  inside Telegram. Pass a `sendFile` function bound to that same instance into
  composition.
- Replace only the finance tool's `SqlSession` dependency with an `executeSql`
  callback.
- Move the full `{ executeSql, close }` session type into the Supabase/MCP
  integration area. `personal-adapters.ts` and self-healing sessions retain
  ownership of connection and close lifecycle.
- Move `ObsidianVault`, `RelativePathSchema`, and Wise contracts beside their
  consuming runtime agents. Integrations implement/import those contracts.
- Do not create a replacement `contracts/` directory.

### 5. Restore dependency direction immediately

- Reinstate the hard prohibition against policies importing composition.
- Remove dependency-cruiser and boundary-test exceptions added for domains.
- Keep personal domains, vault paths, and behavior wiring out of the supervisor
  framework.
- Restore these boundaries in the same phase that removes the behavior plugin,
  not after the rest of the refactor.

## Implementation plan

Each phase must leave its focused tests passing.

### Phase A: Remove the behavior plugin, vault leak, and boundary exception

This phase is one atomic architectural change. Splitting it would either break
compilation or preserve the same plugin system under another name.

1. Close over the vault path in `personal-pack.ts`.
2. Inline the Obsidian hook composition currently performed by
   `domains/behaviors.ts`.
3. Preserve the Obsidian/context-cache prompt, model, cache-extra, and
   tool-selection semantics.
4. Remove `obsidianVaultPath`, `capabilityBehaviors`, and
   `capabilityHookPriority` from runtime execution options.
5. Slim `runtime-agent-policy.ts` to system-configuration and default policy;
   remove its imports from `composition/domains/`.
6. Delete `domains/behaviors.ts` and `domains/capability-behavior.ts`.
7. Restore the strict `policies`-to-`composition` dependency-cruiser rule and
   app-boundary assertion immediately.

Verify runtime-agent-policy, policy-node helper, Obsidian hooks/nodes,
personal-pack, dependency-cruiser, and app-boundary tests.

Phase A is complete when policies import no composition code,
`AppRuntimeExecutionOptions` has no product fields or behavior registries, and
Obsidian behaves identically with and without context caching.

### Phase B: Delete the rest of `composition/domains/`

1. Move capability IDs beside runtime-agent tools.
2. Move `hasFinanceCapability` with the finance capability IDs and update
   `runtime-agent-defaults.ts`.
3. Put the Obsidian, finance-write, and finance-read provider objects directly
   in `buildCapabilityProviders` inside `personal-pack.ts`.
4. Update test catalog helpers to use the pack's provider builder rather than
   preserving a separate registry.
5. Remove binder types, the domain registry, exports, fixtures, and helpers.
6. Delete the directory.

Verify capability-catalog, personal-pack, and configuration-tool tests.

Phase B is complete when `composition/domains/` is absent and a tools-only
capability is registered by one provider object in `personal-pack.ts`.

### Phase C: Delete `ports/` without losing lifecycle ownership

1. Move Obsidian vault contracts beside `runtime-agents/obsidian/`; integrations
   import and implement them.
2. Move Wise contracts beside `runtime-agents/finance/`.
3. Change finance tools to receive `executeSql`, while retaining `SqlSession`
   with `executeSql` and `close` inside integrations.
4. Delete `IFileSender`; pass a bound `sendFile` function to tools while the
   shared concrete Telegram sender continues to own `setCurrentChatId`.
5. Update imports, dependency-rule comments, and test fixtures.
6. Delete all four port files and the directory.

Verify finance tools, Obsidian `send_file`, Telegram chat-ID handling,
self-healing SQL session, and adapter-close tests.

Phase C is complete when `ports/` is absent, Telegram still updates the sender
before workflow execution, and Supabase sessions still close through adapters.

### Phase D: Update documentation and generated graphs

1. Rewrite architecture and runtime-agent documentation around the shorter
   authoring path.
2. Remove instructions to add binders, behaviors, or ports.
3. Regenerate dependency graphs only after Phases A-C are green.

## Canonical tool-addition flow

Adding a normal tool requires:

1. Add its factory under `runtime-agents/<feature>/`.
2. Add one provider entry in `personal-pack.ts`.
3. Add an integration only when an external service is required.

It must not require a domain file, port file, registry, binder, or behavior
factory.

A capability with runtime hooks may additionally require one adjacent,
capability-specific hook branch in `personal-pack.ts`. It must still require
only one composition file and must not introduce a generic registry.

## Guardrails

- No `composition/domains/` directory.
- No `ports/` directory.
- No product-specific fields in `AppRuntimeExecutionOptions`.
- No `capabilityBehaviors`, hook priority list, or product-hook registry.
- No domain clients in the system capability dependency bag.
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

## Preserve from the current work

- Dynamic `buildCapabilityProviders` during bootstrap.
- Direct use of `CapabilityDescriptor` fields.
- Removal of personal domain clients from system capability dependencies.

The new domain binder and behavior framework should not be preserved.

## Completion criteria

- `apps/personal-assistant/src/composition/domains/` does not exist.
- `apps/personal-assistant/src/ports/` does not exist.
- `AppRuntimeExecutionOptions` contains no `obsidianVaultPath`, product-specific
  fields, behavior map, or hook-priority list.
- `runtime-agent-policy.ts` contains no composition imports, capability
  behavior map, or capability hook priority.
- Dependency-cruiser has no `policies`-to-`composition` exception, and the
  app-boundary test prohibits every such import.
- `PersonalCapabilityDeps` remains limited to system capabilities.
- `buildCapabilityProviders` remains dynamic after adapter setup.
- Obsidian with context caching includes vault cache extras and preserves its
  prompt/model/tool-selection behavior.
- Telegram sets the current chat on the concrete sender before workflow
  execution; runtime-agent tools only receive `sendFile`.
- Supabase sessions retain `close()` and are closed through personal adapters;
  finance tools do not own lifecycle.
- A tools-only capability requires one provider entry in `personal-pack.ts`.
- No replacement abstraction recreates the removed layers.
- Focused unit tests and dependency-boundary checks pass after every phase.
