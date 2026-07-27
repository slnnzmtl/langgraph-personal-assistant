import { HumanMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mkdir, appendFile } = vi.hoisted(() => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  appendFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:fs/promises", () => ({
  mkdir,
  appendFile,
}));

import { createFilePromptLogger } from "../../../src/framework/logging/file-prompt-logger.js";

describe("createFilePromptLogger", () => {
  beforeEach(() => {
    mkdir.mockClear();
    appendFile.mockClear();
  });

  it("is a no-op when disabled", async () => {
    const logger = createFilePromptLogger({ enabled: false });
    await logger("supervisor-system-prompt", [new HumanMessage("hello")]);

    expect(mkdir).not.toHaveBeenCalled();
    expect(appendFile).not.toHaveBeenCalled();
  });

  it("appends formatted input and string output when enabled", async () => {
    const logger = createFilePromptLogger({ logsDir: "/tmp/test-logs" });
    await logger("supervisor-system-prompt", [new HumanMessage("hello")], "done");

    expect(mkdir).toHaveBeenCalledWith("/tmp/test-logs", { recursive: true });
    expect(appendFile).toHaveBeenCalledTimes(1);
    expect(appendFile.mock.calls[0]?.[0]).toBe("/tmp/test-logs/supervisor-system-prompt.txt");

    const written = String(appendFile.mock.calls[0]?.[1]);
    expect(written).toContain("[Input]");
    expect(written).toContain("hello");
    expect(written).toContain("[Model Output]");
    expect(written).toContain("done");
  });

  it("respects a custom logs directory", async () => {
    const logger = createFilePromptLogger({ logsDir: "/custom/logs", enabled: true });
    await logger("finance", [new HumanMessage("prompt")]);

    expect(appendFile.mock.calls[0]?.[0]).toBe("/custom/logs/finance.txt");
  });
});
