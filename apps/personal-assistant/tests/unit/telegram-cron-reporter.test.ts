import { AIMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTelegramCronReporter } from "../../src/telegram/telegram-cron-reporter.js";
import { buildCronTriggerForJob } from "@personal-assistant/supervisor-framework";

const financeSyncTrigger = buildCronTriggerForJob("finance", "finance-sync");

describe("createTelegramCronReporter", () => {
  const sendMessageMock = vi.fn();

  beforeEach(() => {
    sendMessageMock.mockReset();
  });

  it("sends lifecycle updates to telegram", async () => {
    const reporter = createTelegramCronReporter({
      telegram: { sendMessage: sendMessageMock } as never,
      chatId: "42",
    });

    await reporter.onStart?.({ jobName: "finance-sync", trigger: financeSyncTrigger });
    await reporter.onProgress?.({ jobName: "finance-sync", trigger: financeSyncTrigger }, "Dispatching scheduled workflow.");
    await reporter.onSuccess?.({
      jobName: "finance-sync",
      trigger: financeSyncTrigger,
      messages: [new AIMessage("All done")],
      summary: "The finance sync completed successfully.",
    });
    await reporter.onError?.(new Error("boom"), { jobName: "finance-sync", trigger: financeSyncTrigger });

    expect(sendMessageMock).toHaveBeenCalledTimes(4);
    expect(sendMessageMock).toHaveBeenNthCalledWith(
      1,
      "42",
      "Cron job: finance-sync - Started",
    );
    expect(sendMessageMock).toHaveBeenNthCalledWith(
      2,
      "42",
      "Cron job: finance-sync - In Progress\nDispatching scheduled workflow.",
    );
    expect(sendMessageMock).toHaveBeenNthCalledWith(
      3,
      "42",
      "Cron job: finance-sync - Completed\nThe finance sync completed successfully.",
    );
    expect(sendMessageMock).toHaveBeenNthCalledWith(
      4,
      "42",
      "Cron job: finance-sync - Failed\nError: boom",
    );
  });
});
