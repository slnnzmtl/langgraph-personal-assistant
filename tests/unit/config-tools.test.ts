import { describe, expect, it, vi } from "vitest";

import { createCronConfigTools } from "../../src/nodes/configurator/config-tools.js";
import type { CronJobRepository } from "../../src/cron/cron-job-repository.js";

const createRepository = (jobs: Array<Record<string, unknown>> = []): CronJobRepository => {
  let storedJobs = [...jobs] as any[];

  return {
    loadJobs: vi.fn(async () => storedJobs),
    saveJobs: vi.fn(async (nextJobs) => {
      storedJobs = [...nextJobs];
    }),
  };
};

describe("createCronConfigTools", () => {
  it("includes skill CRUD tools", () => {
    const repository = createRepository();
    const tools = createCronConfigTools(repository);
    const toolNames = tools.map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "list_skills",
        "preview_skill",
        "read_skill",
        "create_skill",
        "edit_skill",
        "delete_skill",
      ]),
    );
  });

  it("lists saved cron jobs from the repository", async () => {
    const repository = createRepository([
      {
        jobName: "finance-sync",
        schedule: "59 23 * * *",
        targetRoute: "Finance_SG",
      },
    ]);
    const tools = createCronConfigTools(repository);

    const listTool = tools.find((tool) => tool.name === "list_cron_jobs");
    expect(listTool).toBeDefined();

    const result = await listTool!.invoke({});

    expect(result).toContain("Job name: finance-sync");
    expect(result).toContain("Schedule: 59 23 * * *");
    expect(result).toContain("Target route: Finance_SG");
  });

  it("creates and persists a new cron job", async () => {
    const repository = createRepository();
    const tools = createCronConfigTools(repository);

    const createTool = tools.find((tool) => tool.name === "create_cron_job");
    expect(createTool).toBeDefined();

    const result = await createTool!.invoke({
      jobName: "morning-note",
      schedule: "0 6 * * *",
      targetRoute: "Obsidian_SG",
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
        targetRoute: "Obsidian_SG",
        timezone: "America/New_York",
        payload: "Create my morning planning note",
      },
    ]);
  });

  it("rejects duplicate cron job names", async () => {
    const repository = createRepository([
      {
        jobName: "finance-sync",
        schedule: "59 23 * * *",
        targetRoute: "Finance_SG",
      },
    ]);
    const tools = createCronConfigTools(repository);

    const createTool = tools.find((tool) => tool.name === "create_cron_job");
    expect(createTool).toBeDefined();

    const result = await createTool!.invoke({
      jobName: "finance-sync",
      schedule: "0 6 * * *",
      targetRoute: "Obsidian_SG",
    });

    expect(result).toContain("Error:");
    expect(result).toContain("already exists");
  });

  it("deletes a cron job and removes it from persistence", async () => {
    const repository = createRepository([
      {
        jobName: "finance-sync",
        schedule: "59 23 * * *",
        targetRoute: "Finance_SG",
      },
      {
        jobName: "daily-note",
        schedule: "0 6 * * *",
        targetRoute: "Obsidian_SG",
      },
    ]);
    const tools = createCronConfigTools(repository);

    const deleteTool = tools.find((tool) => tool.name === "delete_cron_job");
    expect(deleteTool).toBeDefined();

    const result = await deleteTool!.invoke({ jobName: "finance-sync" });

    expect(result).toContain("Deleted cron job finance-sync");
    expect(repository.saveJobs).toHaveBeenCalledWith([
      {
        jobName: "daily-note",
        schedule: "0 6 * * *",
        targetRoute: "Obsidian_SG",
      },
    ]);
  });

  it("returns not-found error when deleting a non-existent cron job", async () => {
    const repository = createRepository([
      {
        jobName: "finance-sync",
        schedule: "59 23 * * *",
        targetRoute: "Finance_SG",
      },
    ]);
    const tools = createCronConfigTools(repository);

    const deleteTool = tools.find((tool) => tool.name === "delete_cron_job");
    expect(deleteTool).toBeDefined();

    const result = await deleteTool!.invoke({ jobName: "non-existent" });

    expect(result).toContain("Error:");
    expect(result).toContain("not found");
    expect(repository.saveJobs).not.toHaveBeenCalled();
  });
});