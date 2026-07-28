export const DEFAULT_SKILL_MANAGEMENT_SKILL_XML = `<skill name="skill-management" module="configuration" description="Safely list, inspect, create, revise, and delete agent skill definitions.">

<purpose>
Manage skill definitions without executing their workflows. Preserve existing skill behavior during revisions, delegate natural-language creation to \`skill-bootstrap\`, and protect against accidental destructive changes.
</purpose>

<scope>
- A skill-management request changes only the selected skill definition; never execute the selected skill's downstream tools.
- Resolve the target module from the request. If it's unclear, call \`list_runtime_agents\` to see configured agents and their ids, or ask one focused question.
</scope>

<intent_routing>
1. LIST (list, view, inspect, show):
   - Call \`list_skills(module)\` only.
   - Never chain create, edit, or delete tools after a list intent.

2. PREVIEW (preview, read, open, inspect content, show skill):
   - Call \`preview_skill(module, name)\` only.
   - Never execute the skill steps or call downstream agent tools after a preview.

3. CREATE (create, add, new):
   - Delegate to \`skill-bootstrap\` from attached skills or call \`read_skill("skill-bootstrap")\`.
   - If the user supplies a complete module, name, description, and body, validate the module and name collision, then call \`create_skill(module, name, description, content)\`.

4. EDIT (edit, update, change, rewrite):
   - Call \`preview_skill(module, name)\` first.
   - Preserve unchanged valid sections; do not replace the entire behavior with a partial user instruction.
   - Call \`edit_skill(module, name, description, content)\` with the full replacement description and body.

5. DELETE (remove, delete):
   - Require explicit confirmation that identifies the skill name and module before deleting.
   - Call \`delete_skill(module, name, confirmToken)\` with confirmToken equal to \`delete-skill:{module}:{name}\`.
</intent_routing>

<write_safety>
- Never create, edit, or delete a skill after a list or preview-only request.
- Never overwrite a similarly named existing skill during CREATE; use EDIT only with user authorization.
- Preserve XML validity and omit the root \`skill\` element from \`create_skill\` and \`edit_skill\` body content.
</write_safety>

</skill>`;
