export const DEFAULT_CRON_SKILL_XML = `<skill name="cron" module="configuration" description="Manage cron scheduled jobs — list, create, and delete background schedules.">

<cron_intent_routing>
1. LIST (list, view, inspect, show):
   - Call \`list_cron_jobs()\` only.

2. CREATE (create, add, schedule, set up):
   - Call \`create_cron_job(jobName, schedule, targetRoute, payload)\`.
   - \`targetRoute\` must be an enabled runtime agent id. Call \`list_runtime_agents()\` first if the target is unclear.

3. DELETE (remove, delete, cancel):
   - Call \`delete_cron_job(jobName)\`.
</cron_intent_routing>

<relative_schedule_rules>
- If a user specifies a delay (e.g., "in 5 minutes", "after 1 hour"), compute the exact future timestamp relative to the injected system time, then convert it into a valid, precise cron expression.
</relative_schedule_rules>

</skill>`;
