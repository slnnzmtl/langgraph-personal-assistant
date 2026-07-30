export const DEFAULT_SKILL_BOOTSTRAP_SKILL_XML = `<skill name="skill-bootstrap" module="configuration" description="Create a complete, production-ready agent skill from a single natural-language request.">
<skill_attachments>
  <attachment>
    <anyPhrases>create a skill,create skill,create a new skill,new skill,add skill,bootstrap skill,draft a skill,help me write a skill,author a skill,make a skill,build a skill</anyPhrases>
  </attachment>
</skill_attachments>

<purpose>
Turn one user prompt into a skill that is routable, operational, safe, and tailored to the target agent. Infer ordinary implementation details; ask a question only when a missing decision would change the skill's owner, permissions, or destructive behavior.
</purpose>

<execution_contract>
  <single_prompt_mode>
  - Treat a request to create, add, bootstrap, make, build, or author a skill as authorization to create it in this turn.
  - Create exactly one skill unless the user explicitly requests multiple skills.
  - If the user asks only to draft, preview, or propose a skill, return a draft and do not call \`create_skill\`.
  </single_prompt_mode>

  <safe_defaults>
  - Prefer the module and agent explicitly named by the user.
  - When no owner is named, call \`list_runtime_agents\` and infer the owner only when exactly one configured agent's description unambiguously matches the workflow; otherwise ask one focused question.
  - Use the least-privileged available capability set. Do not invent tools, paths, schemas, or integrations.
  </safe_defaults>

  <clarification_gate>
  Ask one focused question and stop only when no target module can be inferred, the workflow requires a capability unavailable to every plausible target agent, or the request leaves a destructive action unspecified.
  </clarification_gate>
</execution_contract>

<intent_routing>
1. CREATE: Run \`discover_context\`, \`design_skill\`, and \`create_skill\` in order, in the same response.
2. DRAFT: Run \`discover_context\` and \`design_skill\`, return without calling \`create_skill\`.
3. REVISE: Call \`preview_skill(module, name)\` first, apply requested changes, call \`edit_skill\` with user authorization.
</intent_routing>

<discover_context>
1. Call \`list_runtime_agents\` when the module or target agent is not explicit.
2. Call \`list_capabilities\` when the workflow needs named tools or the capability set is uncertain.
3. Call \`list_skills(module)\` before creation to prevent duplication.
</discover_context>

<create_skill>
1. Call \`create_skill(module, name, description, content)\` after \`discover_context\` and \`design_skill\` complete.
2. Never create a skill with a colliding name or a body that references unavailable capabilities.
</create_skill>

</skill>`;
