// --- Pack bootstrap ---
export { bootstrapSupervisorSystem } from "./framework/bootstrap-supervisor-system.js";
export {
  deriveModelKeys,
  deriveSkillModules,
  deriveCronTargetAgentIds,
  deriveRuntimeAgentGraphFingerprint,
} from "./framework/derive-agents.js";
export { resolveAgentTools } from "./framework/resolve-agent-tools.js";
export { createEmptySkillCatalog } from "./framework/defaults/empty-skill-catalog.js";
export { createNoopCronJobRepository } from "./framework/defaults/noop-cron-job-repository.js";
export type {
  SupervisorPaths,
  SupervisorGraphHooks,
  SupervisorBootstrapContext,
  SupervisorPackBootstrap,
  SupervisorSystemContext,
  CompiledSupervisorGraph,
  CronJobRepository,
  RuntimeExecutionKit,
} from "./framework/types.js";

// --- System agent (opt-in admin kit) ---
export {
  SYSTEM_AGENT_ID,
  SYSTEM_CONFIG_READ_CAPABILITY_ID,
  createSystemAgentDefinition,
  wrapRepositoryWithSystemAgent,
  createSystemConfigCapabilityProviders,
  createSystemConfigTools,
  createSkillCrudTools,
  hasSystemConfigWriteCapability,
  resolveSystemConfigDeps,
  SYSTEM_CONFIG_UNAVAILABLE_MESSAGE,
  createSystemAgentNodeHooks,
  CONFIGURATION_COMPLETION_FALLBACK,
  buildConfigurationCompletionSummary,
  mapConfigurationSubAgentResult,
} from "./framework/system-agent/index.js";
export type {
  SystemAgentOptions,
  SystemAgentRepository,
  SystemConfigDeps,
  SystemConfigToolsOptions,
} from "./framework/system-agent/index.js";

// --- Framework: cron kit ---
export {
  SUPERVISE_CRON_ROUTE,
  createCronTriggerResolver,
  buildCronTriggerForJob,
  resolveCronTriggerRoute,
  isCronTargetRoute,
  createCronJobRepository,
  createCronJobRepositoryForConfig,
  validateCronJobs,
  setupCron,
  createRuntimeCronService,
  createLazyCronService,
  reconcileRuntimeCron,
  watchCronJobDefinitions,
  startCronBootstrap,
  createCronRunner,
  MAX_GRAPH_CONTINUATIONS,
} from "./framework/cron/index.js";
export type {
  CronJobDefinition,
  CronTargetRoute,
  CronTriggerResolver,
  SetupCronOptions,
  RuntimeCronService,
  CronJobWatcher,
  CronJobRun,
  CronJobResult,
  CronRunner,
  CronExecutionReporter,
} from "./framework/cron/index.js";

// --- Kernel: graph compile (advanced / tests; bootstrap wraps this) ---
export { createAssistant, type AssistantConfig } from "./core/create-assistant.js";

// --- Kernel: policies & agent repository ---
export {
  createAgentPolicy,
  type AgentPolicyCapabilityDeps,
  type AgentPolicyToolkitOptions,
  type CreateAgentPolicyConfig,
} from "./core/policies/create-agent-policy.js";
export {
  createRuntimeAgentRepository,
  type RuntimeAgentRepository,
} from "./core/agents/repository.js";
export {
  withResolvedAgentSystemPrompt,
  type LoadPromptByKey,
} from "./core/agents/resolve-system-prompt.js";
export type { RuntimeAgentPolicy } from "./core/types/policy.js";
export type { PolicyContext } from "./core/types/policy-context.js";
export {
  RUNTIME_AGENT_CONTEXT_KEY,
  DEFAULT_MODEL_KEY,
  RuntimeAgentDefinitionSchema,
  RuntimeAgentsDocumentSchema,
  resolveAgentModelKey,
  resolveAgentSkillModule,
  resolveAgentCapabilityIds,
  normalizeRuntimeAgentDefinition,
  isRuntimeAgentBuiltin,
  type RuntimeAgentDefinition,
  type CreateRuntimeAgentInput,
  type UpdateRuntimeAgentInput,
} from "./core/types/agent.js";

// --- Capabilities catalog contract ---
export {
  createCapabilityCatalog,
  configurationReposAvailable,
  isCapabilityAvailable,
  type CapabilityCatalog,
  type CapabilityDescriptor,
  type CapabilityProvider,
  type CapabilityAvailabilityContext,
} from "./capabilities/index.js";

// --- Kernel: skills ---
export { buildSkillModuleOwnerPattern } from "./core/skills/skill-patterns.js";
export {
  createSkillCatalog,
  type SkillCatalogOptions,
} from "./core/skills/skill-catalog.js";
export {
  SKILLS_ROOT,
  listSkills,
  listSkillModules,
  readSkillContent,
  readFullSkill,
  loadSkillAttachmentRules,
  parseFrontmatter,
  parseXmlSkill,
  parseSkillFile,
  parseSkillAttachmentsFromXmlBody,
  stripSkillAttachmentsBlock,
  parseCommaSeparatedPhrases,
  formatSkillsForPrompt,
  formatSkillsForDisplay,
  createSkillFile,
  updateSkillFile,
  deleteSkillFile,
  formatXmlSkillFile,
  serializeSkillFile,
} from "./core/skills/skills-loader.js";
export {
  createReadSkillTool,
  ReadSkillToolSchema,
  type ReadSkillToolOptions,
} from "./core/skills/skill-management.js";
export {
  createSkillActionRegistry,
  registerSkillActions,
  getSkillActions,
  runSkillActions,
  formatSkillContextBlock,
  enrichSkillWithActions,
  SKILL_CONTEXT_MAX_CHARS,
  type SkillActionDefinition,
  type SkillActionResult,
  type SkillActionError,
  type SkillActionRegistry,
} from "./core/skills/skill-actions.js";
export {
  enrichRuntimeAgentPrompt,
  appendAvailableSkills,
  appendRuntimeExecutionModel,
  RUNTIME_EXECUTION_MODEL,
} from "./core/skills/prompt-enrichment.js";
export {
  appendConfiguredSkillAttachments,
  extractTriggerUserText,
  extractRecentHumanTexts,
  formatAttachedSkillBlock,
  formatAttachedSkillsPrompt,
  matchesCronJobTrigger,
  matchesSkillAttachmentRule,
  resolveSkillAttachmentRulesForModule,
  resolveSkillAttachments,
  getAttachedSkillNames,
  type ResolvedSkillAttachment,
  type ResolveSkillAttachmentsOptions,
} from "./core/skills/skill-attachments.js";
export { resolveActiveSkillFromHistory, type ActiveSkillSelection } from "./core/skills/skill-history.js";
export { truncateToolOutput, TOOL_OUTPUT_MAX_CHARS } from "./core/skills/truncate-output.js";
export type {
  SkillCatalog,
  SkillMeta,
  SkillFull,
  SkillDisplayStatus,
  SkillAttachmentRule,
  SkillAttachmentMatch,
  ListSkillsOptions,
  SkillAttachmentCatalog,
} from "./core/skills/catalog.js";

// --- Kernel: runtime agent execution loop ---
export type { ILLMConnector, RoutingChain } from "./core/ports/llm-connector.js";
export type { ReplyUxConfig } from "./core/supervisor/reply-ux.js";
export {
  createRuntimeAgentNode,
  type RuntimeAgentNodeConfig,
  type RuntimeAgentNodeHooks,
  type RuntimeAgentTurnContext,
  type SubAgentToolSource,
} from "./core/execution/runtime-node.js";
export {
  createSubAgentGraphBundle,
  createSubAgentToolsNode,
  type SubAgentLlmNode,
} from "./core/execution/create-sub-agent.js";
export {
  createSubAgentStateAnnotation,
  SubAgentStateAnnotation,
} from "./core/execution/sub-agent-state.js";
export type { SubAgentState, SubAgentStateUpdate } from "./core/execution/sub-agent-state.js";
export {
  hasPendingToolCalls,
  lastMessageRequestsTools,
} from "./core/execution/tool-routing.js";
export type { RuntimeAgentHandoff } from "./core/execution/runtime-agent-handoff.js";
export {
  createRuntimeAgentExecutionContext,
  type RuntimeAgentExecutionContext,
} from "./core/execution/context.js";
export { createRuntimeShellHooks } from "./core/execution/runtime-shell.js";
export type { RuntimeShellFormatters } from "./core/system-context.js";
export {
  buildLatestToolCompletionSummary,
  hasCompletedAgentReply,
  processBlankToolLoopResponse,
  type ToolBodyPredicate,
} from "./core/execution/tool-completion-summary.js";
export { SUB_AGENT_CONTEXT_HUMAN_TURNS } from "./core/execution/sub-agent-messages.js";

// --- Kernel: runtime agent graph nodes ---
export {
  buildRuntimeAgentGraphNodeSets,
  createRuntimeAgentFinalizeNode,
  createRuntimeAgentPrepareNode,
  routeAfterRuntimeAgentLlm,
  routeAfterRuntimeAgentTools,
} from "./core/agents/build-runtime-agent-nodes.js";

// --- Kernel: supervisor routing ---
export { createSupervisorNode } from "./core/supervisor/supervisor-node.js";
export {
  buildSupervisorRoutingSchema,
  filterRoutableRuntimeAgents,
  normalizeDelegationPrompt,
  normalizeSupervisorReply,
} from "./core/supervisor/routing-schema.js";
export {
  createEmptyReplyNode,
  createFailureReplyNode,
  createPostHandoffFinishNode,
  type FailureReplyNodeOptions,
} from "./core/supervisor/reply-nodes.js";

// --- Kernel: state & message history ---
export type { AgentState, AgentStateUpdate } from "./core/state.js";
export { createAgentStateAnnotation } from "./core/state.js";
export {
  EMPTY_REPLY_ROUTE,
  FAILURE_REPLY_ROUTE,
  FINISH_ROUTE,
  POST_HANDOFF_FINISH_ROUTE,
} from "./core/state.js";
export { trimMessagesToTokenBudgetSync, DEFAULT_MESSAGE_HISTORY_MAX_TOKENS, getMessageHistoryMaxTokens } from "./core/message-trimming.js";
export { extractMessageTextContent } from "./core/message-content.js";

// --- Persistence helpers (exported for pack tool implementations) ---
export {
  buildDirectoryTree,
  fileExists,
  listDirectoryContents,
  readTextFile,
  resolveSafePath,
  searchFilesByContent,
  writeTextFile,
} from "./core/persistence/file-system.js";
export { withSerializedFileWrite } from "./core/persistence/json-store.js";
