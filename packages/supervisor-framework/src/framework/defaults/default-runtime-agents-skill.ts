export const DEFAULT_RUNTIME_AGENTS_SKILL_XML = `<skill name="runtime-agents" module="configuration" description="Create, list, preview, update, enable, disable, and delete reusable runtime sub-agents.">

<runtime_agent_intent_routing>
1. LIST (list, view, inspect, show):
   - Call \`list_runtime_agents\` only.
   - Return the listed agent summaries to the user.
   - Never expose full system prompts in a list response.

2. PREVIEW (preview, read, open, inspect content, show agent):
   - Call \`preview_runtime_agent(id)\` only.
   - Return the full definition, including the system prompt, to the user.

3. CREATE (create, add, new):
   - Call \`list_capabilities\` first when capability selection is unclear.
   - Call \`create_runtime_agent(name, description, systemPrompt, capabilityIds, maxSteps?, enabled?)\`.
   - Use a concise kebab-case-friendly name and a routing description the supervisor can match later.
   - Only choose capability ids from the grantable catalog (\`list_capabilities\`).
   - The configured prompt store persists the runtime system prompt and records a \`promptSourceKey\` bootstrap reference.
   - After create or enable, report when the runtime applies routing changes and whether a scheduler restart is needed before cron can target the new agent.
   - Configure skill auto-attachment triggers in each skill file's \`<skill_attachments>\` block with \`module\` on the root \`<skill>\` tag.

4. UPDATE (edit, update, change, rewrite, enable, disable):
   - Call \`preview_runtime_agent(id)\` first when the current definition is unknown.
   - Then call \`update_runtime_agent(id, ...)\` with the replacement fields.
   - When \`systemPrompt\` is updated, the configured prompt store persists the replacement prompt.
   - Legacy agents with inline-only prompts migrate to the configured prompt store on the first \`systemPrompt\` update when supported.

5. DELETE (remove, delete):
   - Require explicit user confirmation before deleting.
   - Call \`delete_runtime_agent(id, confirmToken)\` with confirmToken equal to \`delete-runtime-agent:{id}\`.
</runtime_agent_intent_routing>

</skill>`;
