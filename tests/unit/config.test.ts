import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getDefaultVaultPath, loadConfig } from "../../src/config.js";

const REQUIRED_ENV = {
  TELEGRAM_BOT_TOKEN: "123:abc",
  ALLOWED_TELEGRAM_USER_ID: "42",
  GOOGLE_API_KEY: "test-key",
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("config", () => {
  it("uses the default vault path when OBSIDIAN_VAULT_PATH is unset", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", REQUIRED_ENV.TELEGRAM_BOT_TOKEN);
    vi.stubEnv("ALLOWED_TELEGRAM_USER_ID", REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
    vi.stubEnv("GOOGLE_API_KEY", REQUIRED_ENV.GOOGLE_API_KEY);
    vi.stubEnv("OBSIDIAN_VAULT_PATH", undefined);

    const config = loadConfig();

    expect(config.obsidianVaultPath).toBe(getDefaultVaultPath());
  });

  it("prefers an explicit OBSIDIAN_VAULT_PATH", () => {
    const customPath = path.resolve("/tmp/personal-assistant-vault");

    vi.stubEnv("TELEGRAM_BOT_TOKEN", REQUIRED_ENV.TELEGRAM_BOT_TOKEN);
    vi.stubEnv("ALLOWED_TELEGRAM_USER_ID", REQUIRED_ENV.ALLOWED_TELEGRAM_USER_ID);
    vi.stubEnv("GOOGLE_API_KEY", REQUIRED_ENV.GOOGLE_API_KEY);
    vi.stubEnv("OBSIDIAN_VAULT_PATH", customPath);

    const config = loadConfig();

    expect(config.obsidianVaultPath).toBe(customPath);
  });
});