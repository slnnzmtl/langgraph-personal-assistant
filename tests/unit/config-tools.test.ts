import { describe, expect, it } from "vitest";

import {
  createConfigurationTools,
  createCronRepositoryFake,
} from "../helpers/configuration-tools.js";

describe("createConfigurationTools", () => {
  it("includes skill CRUD tools and cron tools on the agent", () => {
    const repository = createCronRepositoryFake();
    const tools = createConfigurationTools(repository);
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "read_skill",
        "list_skills",
        "preview_skill",
        "read_skill_for_edit",
        "create_skill",
        "edit_skill",
        "delete_skill",
        "list_cron_jobs",
        "create_cron_job",
        "delete_cron_job",
      ]),
    );
  });

  it("exposes all configuration tools without requiring read_skill first", () => {
    const repository = createCronRepositoryFake();
    const tools = createConfigurationTools(repository);

    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "read_skill",
        "list_cron_jobs",
        "create_cron_job",
        "delete_cron_job",
        "list_skills",
        "preview_skill",
      ]),
    );
  });

  it("loads cron skill instructions without appending a tools preview", async () => {
    const repository = createCronRepositoryFake();
    const tools = createConfigurationTools(repository);
    const readSkillTool = tools.find((tool) => tool.name === "read_skill");
    expect(readSkillTool).toBeDefined();

    const result = String(await readSkillTool!.invoke({ name: "cron" }));

    expect(result).toContain("<cron_intent_routing>");
    expect(result).toContain("list_cron_jobs");
    expect(result).not.toContain("<available_tools>");
  });

  it("lists saved cron jobs from the repository", async () => {
    const repository = createCronRepositoryFake([
      {
        jobName: "finance-sync",
        schedule: "59 23 * * *",
        targetRoute: "finance",
      },
    ]);
    const tools = createConfigurationTools(repository);

    const listTool = tools.find((tool) => tool.name === "list_cron_jobs");
    expect(listTool).toBeDefined();

    const result = await listTool!.invoke({});

    expect(result).toContain("Job name: finance-sync");
    expect(result).toContain("Schedule: 59 23 * * *");
    expect(result).toContain("Target route: finance");
  });

  it("creates and persists a new cron job", async () => {
    const repository = createCronRepositoryFake();
    const tools = createConfigurationTools(repository);

    const createTool = tools.find((tool) => tool.name === "create_cron_job");
    expect(createTool).toBeDefined();

    const result = await createTool!.invoke({
      jobName: "morning-note",
      schedule: "0 6 * * *",
      targetRoute: "obsidian",
      timezone: "America/New_York",
      payload: "Create my morning planning note",
    });

    expect(result).toContain("morning-note");
    expect(result).toContain("Job name: morning-note");
    expect(result).toContain("Payload: Create my morning planning note");
    expect(repository.saveJobs).toHaveBeenCalledWith([
      {
        jobName: "morning-note",
        schedule: "0 6 * * *",
        targetRoute: "obsidian",
        timezone: "America/New_York",
        payload: "Create my morning planning note",
      },
    ]);
  });

  it("rejects duplicate cron job names", async () => {
    const repository = createCronRepositoryFake([
      {
        jobName: "finance-sync",
        schedule: "59 23 * * *",
        targetRoute: "finance",
      },
    ]);
    const tools = createConfigurationTools(repository);

    const createTool = tools.find((tool) => tool.name === "create_cron_job");
    expect(createTool).toBeDefined();

    const result = await createTool!.invoke({
      jobName: "finance-sync",
      schedule: "0 6 * * *",
      targetRoute: "obsidian",
    });

    expect(result).toContain("Error:");
    expect(result).toContain("already exists");
  });

  it("deletes a cron job and removes it from persistence", async () => {
    const repository = createCronRepositoryFake([
      {
        jobName: "finance-sync",
        schedule: "59 23 * * *",
        targetRoute: "finance",
      },
      {
        jobName: "daily-note",
        schedule: "0 6 * * *",
        targetRoute: "obsidian",
      },
    ]);
    const tools = createConfigurationTools(repository);

    const deleteTool = tools.find((tool) => tool.name === "delete_cron_job");
    expect(deleteTool).toBeDefined();

    const result = await deleteTool!.invoke({ jobName: "finance-sync" });

    expect(result).toContain("Deleted cron job finance-sync");
    expect(repository.saveJobs).toHaveBeenCalledWith([
      {
        jobName: "daily-note",
        schedule: "0 6 * * *",
        targetRoute: "obsidian",
      },
    ]);
  });

  it("returns not-found error when deleting a non-existent cron job", async () => {
    const repository = createCronRepositoryFake([
      {
        jobName: "finance-sync",
        schedule: "59 23 * * *",
        targetRoute: "finance",
      },
    ]);
    const tools = createConfigurationTools(repository);

    const deleteTool = tools.find((tool) => tool.name === "delete_cron_job");
    expect(deleteTool).toBeDefined();

    const result = await deleteTool!.invoke({ jobName: "non-existent" });

    expect(result).toContain("Error:");
    expect(result).toContain("not found");
    expect(repository.saveJobs).not.toHaveBeenCalled();
  });

  it("includes runtime agent tools on the agent", () => {
    const repository = createCronRepositoryFake();
    const tools = createConfigurationTools(repository);
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "list_runtime_agents",
        "preview_runtime_agent",
        "create_runtime_agent",
        "update_runtime_agent",
        "delete_runtime_agent",
        "list_runtime_tool_bundles",
      ]),
    );
  });

  it("creates and lists a runtime agent without exposing the full prompt in list output", async () => {
    const repository = createCronRepositoryFake();
    const tools = createConfigurationTools(repository);
    const createTool = tools.find((tool) => tool.name === "create_runtime_agent");
    const listTool = tools.find((tool) => tool.name === "list_runtime_agents");

    expect(createTool).toBeDefined();
    expect(listTool).toBeDefined();

    const created = await createTool!.invoke({
      name: "Daily Summary",
      description: "Summarize the user's day.",
      systemPrompt: "You are a daily summary specialist.",
      toolBundleIds: ["none"],
    });

    expect(created).toContain("daily-summary");

    const listed = await listTool!.invoke({});
    expect(listed).toContain("Agent ID: daily-summary");
    expect(listed).not.toContain("daily summary specialist");
  });
});
