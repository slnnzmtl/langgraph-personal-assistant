import type { StructuredToolInterface } from "@langchain/core/tools";

import {
  createCapabilityCatalog,
  type CapabilityCatalog,
  type CapabilityDescriptor,
  type CapabilityProvider,
  type CronJobRepository,
  type RuntimeAgentRepository,
  type RuntimeCronService,
  type SkillCatalog,
} from "@personal-assistant/supervisor-framework";
import type { LoadPromptByKey } from "@personal-assistant/supervisor-framework";
import type { SupabaseMcpSession } from "../integrations/mcp/supabase.js";
import type { IFileSender } from "../ports/file-sender.js";

import { createFinanceDomainToolsFromSession } from "./finance/tools.js";
import { createObsidianVaultTools } from "./obsidian/tools.js";

export const OBSIDIAN_VAULT_CAPABILITY_ID = "obsidian-vault" as const;
export const FINANCE_DOMAIN_CAPABILITY_ID = "finance-domain" as const;
export const FINANCE_DOMAIN_READ_CAPABILITY_ID = "finance-domain-read" as const;

export const PERSONAL_CAPABILITY_DESCRIPTORS: CapabilityDescriptor[] = [
  {
    id: OBSIDIAN_VAULT_CAPABILITY_ID,
    description: "Read, write, search, and send files from the Obsidian vault.",
    grantable: true,
  },
  {
    id: FINANCE_DOMAIN_CAPABILITY_ID,
    description: "Execute SQL, fetch Wise transactions, and load expense categories.",
    grantable: false,
  },
  {
    id: FINANCE_DOMAIN_READ_CAPABILITY_ID,
    description: "Query the expense ledger with read-only SQL and category lookup.",
    grantable: true,
  },
];

export const PERSONAL_RESERVED_CAPABILITIES_BY_AGENT_ID: Record<string, readonly string[]> = {
  finance: [FINANCE_DOMAIN_CAPABILITY_ID],
};

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
  supabaseReadSession?: SupabaseMcpSession;
  supabaseWriteSession?: SupabaseMcpSession;
  /** @deprecated Use supabaseWriteSession. */
  supabaseSession?: SupabaseMcpSession;
};

export type PersonalSystemDeps = {
  cronTargetAgentIds?: readonly string[];
  cronJobRepository?: CronJobRepository;
  runtimeAgentRepository?: RuntimeAgentRepository;
  runtimeCron?: RuntimeCronService;
  capabilityCatalog?: CapabilityCatalog;
  skillCatalog?: SkillCatalog;
  loadPromptByKey?: LoadPromptByKey;
};

export type PersonalCapabilityDeps = PersonalDomainDeps & PersonalSystemDeps;

export const createCapabilityDeps = (
  obsidianVaultPath: string,
  options: {
    fileSender?: PersonalDomainDeps["fileSender"];
    supabaseReadSession?: PersonalDomainDeps["supabaseReadSession"];
    supabaseWriteSession?: PersonalDomainDeps["supabaseWriteSession"];
    supabaseSession?: PersonalDomainDeps["supabaseSession"];
    cronTargetAgentIds?: PersonalSystemDeps["cronTargetAgentIds"];
    cronJobRepository?: PersonalSystemDeps["cronJobRepository"];
    runtimeAgentRepository?: PersonalSystemDeps["runtimeAgentRepository"];
    runtimeCron?: PersonalSystemDeps["runtimeCron"];
    capabilityCatalog?: PersonalSystemDeps["capabilityCatalog"];
    skillCatalog?: PersonalSystemDeps["skillCatalog"];
    loadPromptByKey?: PersonalSystemDeps["loadPromptByKey"];
  } = {},
): PersonalCapabilityDeps => ({
  obsidianVaultPath,
  ...(options.fileSender ? { fileSender: options.fileSender } : {}),
  ...(options.supabaseReadSession ? { supabaseReadSession: options.supabaseReadSession } : {}),
  ...(options.supabaseWriteSession ? { supabaseWriteSession: options.supabaseWriteSession } : {}),
  ...(options.supabaseSession ? { supabaseSession: options.supabaseSession } : {}),
  ...(options.cronTargetAgentIds ? { cronTargetAgentIds: options.cronTargetAgentIds } : {}),
  ...(options.cronJobRepository ? { cronJobRepository: options.cronJobRepository } : {}),
  ...(options.runtimeAgentRepository
    ? { runtimeAgentRepository: options.runtimeAgentRepository }
    : {}),
  ...(options.runtimeCron ? { runtimeCron: options.runtimeCron } : {}),
  ...(options.capabilityCatalog ? { capabilityCatalog: options.capabilityCatalog } : {}),
  ...(options.skillCatalog ? { skillCatalog: options.skillCatalog } : {}),
  ...(options.loadPromptByKey ? { loadPromptByKey: options.loadPromptByKey } : {}),
});

export const createPersonalCapabilityProviders = (): CapabilityProvider<PersonalCapabilityDeps>[] => [
  {
    descriptor: getDescriptor("obsidian-vault"),
    isAvailable: (deps) => Boolean(deps.obsidianVaultPath),
    resolveTools: (deps) => createObsidianVaultTools(deps.obsidianVaultPath, deps.fileSender),
  },
  {
    descriptor: getDescriptor("finance-domain"),
    isAvailable: (deps) =>
      deps.supabaseWriteSession !== undefined || deps.supabaseSession !== undefined,
    resolveTools: (deps) => {
      const session = deps.supabaseWriteSession ?? deps.supabaseSession;
      if (!session) {
        throw new Error("finance-domain capability requires a configured Supabase write session.");
      }

      return createFinanceDomainToolsFromSession(session, { writeAccess: true });
    },
  },
  {
    descriptor: getDescriptor("finance-domain-read"),
    isAvailable: (deps) =>
      deps.supabaseReadSession !== undefined || deps.supabaseSession !== undefined,
    resolveTools: (deps) => {
      const session = deps.supabaseReadSession ?? deps.supabaseSession;
      if (!session) {
        throw new Error("finance-domain-read capability requires a configured Supabase read session.");
      }

      return createFinanceDomainToolsFromSession(session, { writeAccess: false });
    },
  },
];

/** Personal domain capabilities only (excludes framework system-config providers). */
export const createDomainCapabilityCatalog = (): CapabilityCatalog =>
  createCapabilityCatalog(createPersonalCapabilityProviders() as CapabilityProvider<Record<string, unknown>>[]);

export const getCapabilityCatalog = (deps: PersonalCapabilityDeps): CapabilityCatalog =>
  deps.capabilityCatalog ?? createDomainCapabilityCatalog();

export const listAvailableCapabilities = (
  deps: PersonalCapabilityDeps,
): CapabilityDescriptor[] =>
  getCapabilityCatalog(deps).listAvailable(deps);

export const validateCapabilityIds = (
  capabilityIds: readonly string[],
  deps: PersonalCapabilityDeps,
): void => {
  getCapabilityCatalog(deps).validateIds(capabilityIds, deps);
};

export const validateGrantableCapabilityIds = (
  capabilityIds: readonly string[],
  deps: PersonalCapabilityDeps,
): void => {
  getCapabilityCatalog(deps).validateGrantableIds(capabilityIds, deps);
};

export const resolveCapabilities = (
  capabilityIds: readonly string[],
  deps: PersonalCapabilityDeps,
): StructuredToolInterface[] =>
  getCapabilityCatalog(deps).resolveTools(capabilityIds, deps);

export const hasFinanceCapability = (capabilityIds: readonly string[]): boolean =>
  capabilityIds.includes(FINANCE_DOMAIN_CAPABILITY_ID)
  || capabilityIds.includes(FINANCE_DOMAIN_READ_CAPABILITY_ID);
