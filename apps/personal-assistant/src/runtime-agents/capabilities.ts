import type { StructuredToolInterface } from "@langchain/core/tools";

import {
  configurationReposAvailable,
  createCapabilityCatalog,
  type CapabilityAvailabilityContext,
  type CapabilityCatalog,
  type CapabilityDescriptor,
  type CapabilityProvider,
  type RuntimeAgentRepository,
  type SkillCatalog,
} from "@personal-assistant/supervisor-framework";
import type { CronJobRepository, RuntimeCronService } from "@personal-assistant/supervisor-framework";
import type { SupabaseMcpSession } from "../integrations/mcp/supabase.js";
import type { IFileSender } from "../ports/file-sender.js";

import { createFinanceDomainToolsFromSession } from "./finance/tools.js";
import { createObsidianVaultTools } from "./obsidian/tools.js";

export const NONE_CAPABILITY_ID = "none" as const;
export const OBSIDIAN_VAULT_CAPABILITY_ID = "obsidian-vault" as const;
export const FINANCE_DOMAIN_CAPABILITY_ID = "finance-domain" as const;

export const PERSONAL_CAPABILITY_DESCRIPTORS: CapabilityDescriptor[] = [
  {
    id: NONE_CAPABILITY_ID,
    description: "Prompt-only agent with no tools.",
    configurable: true,
  },
  {
    id: OBSIDIAN_VAULT_CAPABILITY_ID,
    description: "Read, write, search, and send files from the Obsidian vault.",
    requiresVault: true,
    configurable: true,
  },
  {
    id: FINANCE_DOMAIN_CAPABILITY_ID,
    description: "Execute SQL, fetch Wise transactions, and load expense categories.",
    requiresSupabase: true,
    configurable: true,
  },
];

export type BuiltinCapabilityId = (typeof PERSONAL_CAPABILITY_DESCRIPTORS)[number]["id"];

const DESCRIPTOR_BY_ID = new Map<string, CapabilityDescriptor>(
  PERSONAL_CAPABILITY_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]),
);

const getDescriptor = (id: BuiltinCapabilityId): CapabilityDescriptor => {
  const descriptor = DESCRIPTOR_BY_ID.get(id);
  if (!descriptor) {
    throw new Error(`Missing builtin capability descriptor: ${id}`);
  }

  return descriptor;
};

export type PersonalDomainDeps = {
  obsidianVaultPath: string;
  fileSender?: IFileSender;
  supabaseSession?: SupabaseMcpSession;
};

export type PersonalSystemDeps = {
  cronTargetAgentIds?: readonly string[];
  cronJobRepository?: CronJobRepository;
  runtimeAgentRepository?: RuntimeAgentRepository;
  runtimeCron?: RuntimeCronService;
  capabilityCatalog?: CapabilityCatalog;
  skillCatalog?: SkillCatalog;
};

export type PersonalCapabilityDeps = PersonalDomainDeps & PersonalSystemDeps;

export const createCapabilityDeps = (
  obsidianVaultPath: string,
  options: {
    fileSender?: PersonalDomainDeps["fileSender"];
    supabaseSession?: PersonalDomainDeps["supabaseSession"];
    cronTargetAgentIds?: PersonalSystemDeps["cronTargetAgentIds"];
    cronJobRepository?: PersonalSystemDeps["cronJobRepository"];
    runtimeAgentRepository?: PersonalSystemDeps["runtimeAgentRepository"];
    runtimeCron?: PersonalSystemDeps["runtimeCron"];
    capabilityCatalog?: PersonalSystemDeps["capabilityCatalog"];
    skillCatalog?: PersonalSystemDeps["skillCatalog"];
  } = {},
): PersonalCapabilityDeps => ({
  obsidianVaultPath,
  ...(options.fileSender ? { fileSender: options.fileSender } : {}),
  ...(options.supabaseSession ? { supabaseSession: options.supabaseSession } : {}),
  ...(options.cronTargetAgentIds ? { cronTargetAgentIds: options.cronTargetAgentIds } : {}),
  ...(options.cronJobRepository ? { cronJobRepository: options.cronJobRepository } : {}),
  ...(options.runtimeAgentRepository ? { runtimeAgentRepository: options.runtimeAgentRepository } : {}),
  ...(options.runtimeCron ? { runtimeCron: options.runtimeCron } : {}),
  ...(options.capabilityCatalog ? { capabilityCatalog: options.capabilityCatalog } : {}),
  ...(options.skillCatalog ? { skillCatalog: options.skillCatalog } : {}),
});


export const createPersonalCapabilityProviders = (): CapabilityProvider<PersonalCapabilityDeps>[] => [
  {
    descriptor: getDescriptor("none"),
    resolveTools: () => [],
  },
  {
    descriptor: getDescriptor("obsidian-vault"),
    resolveTools: (deps) => createObsidianVaultTools(deps.obsidianVaultPath, deps.fileSender),
  },
  {
    descriptor: getDescriptor("finance-domain"),
    resolveTools: (deps) => {
      if (!deps.supabaseSession) {
        throw new Error("finance-domain capability requires a configured Supabase session.");
      }

      return createFinanceDomainToolsFromSession(deps.supabaseSession);
    },
  },
];

/** Personal domain capabilities only (excludes framework system-config providers). */
export const createDomainCapabilityCatalog = (): CapabilityCatalog =>
  createCapabilityCatalog(createPersonalCapabilityProviders() as CapabilityProvider<Record<string, unknown>>[]);

export const toCapabilityAvailabilityContext = (
  deps: PersonalCapabilityDeps,
): CapabilityAvailabilityContext => ({
  obsidianVaultPath: deps.obsidianVaultPath,
  supabaseAvailable: deps.supabaseSession !== undefined,
  configurationReposAvailable: configurationReposAvailable(deps),
});

export const getCapabilityCatalog = (deps: PersonalCapabilityDeps): CapabilityCatalog =>
  deps.capabilityCatalog ?? createDomainCapabilityCatalog();

export const listAvailableCapabilities = (
  deps: PersonalCapabilityDeps,
): CapabilityDescriptor[] =>
  getCapabilityCatalog(deps).listAvailable(toCapabilityAvailabilityContext(deps));

export const validateCapabilityIds = (
  capabilityIds: readonly string[],
  deps: PersonalCapabilityDeps,
): void => {
  getCapabilityCatalog(deps).validateIds(capabilityIds, toCapabilityAvailabilityContext(deps));
};

export const validateGrantableCapabilityIds = (
  capabilityIds: readonly string[],
  deps: PersonalCapabilityDeps,
): void => {
  getCapabilityCatalog(deps).validateGrantableIds(capabilityIds, toCapabilityAvailabilityContext(deps));
};

export const resolveCapabilities = (
  capabilityIds: readonly string[],
  deps: PersonalCapabilityDeps,
): StructuredToolInterface[] =>
  getCapabilityCatalog(deps).resolveTools(
    capabilityIds,
    deps,
    toCapabilityAvailabilityContext(deps),
  );
