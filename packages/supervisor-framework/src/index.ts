// --- Pack bootstrap ---
export { bootstrapSupervisorSystem, type BootstrapSupervisorSystemOptions } from "./framework/bootstrap-supervisor-system.js";
export {
  createSupervisorRuntime,
  type SupervisorRuntime,
  type SupervisorRuntimeOptions,
} from "./framework/create-supervisor-runtime.js";
export {
  deriveModelKeys,
  deriveSkillModules,
  deriveCronTargetAgentIds,
  deriveRuntimeAgentGraphFingerprint,
} from "./framework/derive-agents.js";
export { resolveAgentTools } from "./framework/resolve-agent-tools.js";
export {
  buildDefaultRuntimeExecution,
  type BuildDefaultRuntimeExecutionOptions,
} from "./framework/build-default-runtime-execution.js";
export { seedAgentsIfMissing } from "./framework/seed-agents-if-missing.js";
export {
  createEmptySkillCatalog,
  createNoopCronJobRepository,
  createDefaultContentSeeder,
  type DefaultContentSeeder,
  type DefaultContentSeederOptions
} from "./framework/defaults/utilities/index.js";
export {
  DEFAULT_SUPERVISOR_PROMPT,
  DEFAULT_CONFIGURATION_PROMPT,
  DEFAULT_CRON_SKILL_XML,
  DEFAULT_RUNTIME_AGENTS_SKILL_XML,
  DEFAULT_SKILL_MANAGEMENT_SKILL_XML,
  DEFAULT_SKILL_BOOTSTRAP_SKILL_XML,
} from "./framework/defaults/content/index.js";
export type {
  SupervisorPaths,
  SupervisorGraphHooks,
  SupervisorBootstrapContext,
  CapabilityProvidersBootstrapContext,
  InitializeDefaultsContext,
  SupervisorPackBootstrap,
  SupervisorSystemContext,
  CompiledSupervisorGraph,
  CronJobRepository,
  RuntimeExecutionKit,
} from "./framework/types.js";

// --- System agent (opt-in admin kit) ---
export {
  SYSTEM_AGENT_ID,
  SYSTEM_CONFIG_CAPABILITY_ID,
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
  CONFIGURATION_RESULT_MAPPING,
  buildConfigurationCompletionSummary,
  buildConfigurationSalvageSummary,
  buildDeleteSkillConfirmToken,
  buildDeleteRuntimeAgentConfirmToken,
  buildDeleteCronJobConfirmToken,
  requireDestructiveConfirmToken,
} from "./framework/system-agent/index.js";
export type {
  SystemAgentOptions,
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
  createReadOnlyCronJobRepository,
  type CronTargetAgentIdsSource,
  createRuntimeCronService,
  createLazyCronService,
  watchCronJobDefinitions,
  startCronBootstrap,
  createCronRunner,
} from "./framework/cron/index.js";
export type {
  CronJobDefinition,
  RuntimeCronService,
  CronJobWatcher,
  CronJobRun,
  CronJobResult,
  CronExecutionReporter,
  CronRunLedger,
  CronRunRecord,
} from "./framework/cron/index.js";

export type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

// --- Framework: runtime agent watcher ---
export { watchRuntimeAgentDefinitions } from "./framework/runtime-agent-watcher.js";
export type {
  RuntimeAgentGraphRecompiler,
  RuntimeAgentWatcher,
} from "./framework/runtime-agent-watcher.js";

// --- Framework: optional prompt logging ---
export { createFilePromptLogger } from "./framework/logging/file-prompt-logger.js";
export {
  createCompositeLogger,
  createConsoleLogger,
  createFileLogger,
  getLogger,
  setLogger,
  type Logger,
} from "./framework/logging/app-logger.js";
export { noopPromptLogging } from "./core/ports/prompt-logging.js";
export type { FilePromptLoggerOptions } from "./framework/logging/file-prompt-logger.js";
export type { PromptLoggingHook } from "./core/ports/prompt-logging.js";

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
  createReadOnlyRuntimeAgentRepository,
  DATA_WRITES_DISABLED_MESSAGE,
} from "./core/persistence/read-only-repositories.js";
export type { RuntimeAgentPromptStore } from "./core/ports/runtime-agent-prompt-store.js";
export { formatDataAgentPromptBootstrap } from "./core/agents/agent-prompt-bootstrap.js";
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
  toRuntimeAgentId,
  isRuntimeAgentBuiltin,
  type RuntimeAgentDefinition,
  type CreateRuntimeAgentInput,
  type UpdateRuntimeAgentInput,
} from "./core/types/agent.js";

// --- Capabilities catalog contract ---
export {
  createCapabilityCatalog,
  configurationReposAvailable,
  isCapabilityGrantable,
  validatePersistedAgentCapabilities,
  NONE_CAPABILITY_ID,
  NONE_CAPABILITY_PROVIDER,
  type CapabilityCatalog,
  type CapabilityDescriptor,
  type CapabilityProvider,
} from "./capabilities/index.js";

// --- Kernel: skills ---
export {
  createSkillCatalog,
  type SkillCatalogOptions,
} from "./core/skills/skill-catalog.js";
export {
  SKILLS_ROOT,
  describeWritableSkillLocation,
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
export type {
  BindRoutingToolsOptions,
  ILLMConnector,
  RoutingChain,
} from "./core/ports/llm-connector.js";
export type { ReplyUxConfig } from "./core/supervisor/reply-ux.js";
export {
  createRuntimeAgentNode,
  type ModelForTurn,
  type RuntimeAgentNodeConfig,
  type RuntimeAgentNodeHooks,
  type RuntimeAgentTurnContext,
  type SubAgentToolSource,
} from "./core/execution/runtime-node.js";
export {
  createSubAgentGraphBundle,
  createSubAgentToolsNode,
  createMaxStepsExceededUpdate,
  mapSubAgentResult,
  type MapSubAgentResultOptions,
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
export {
  SUB_AGENT_CONTEXT_HUMAN_TURNS,
  buildRuntimeAgentPromptMessages,
  getRuntimeAgentIdFromMessage,
  tagRuntimeAgentMessage,
} from "./core/execution/sub-agent-messages.js";
export type {
  ContextCacheHandle,
  ContextCacheKit,
  ContextCacheManager,
  ContextCacheSpec,
  CreateCachedModel,
} from "./core/llm/context-cache-types.js";
export { isCachedContentNotFoundError } from "./core/llm/context-cache-types.js";
export {
  buildCachedRuntimePromptMessages,
  buildRuntimePromptParts,
  buildStaticRuntimePrompt,
  buildTurnContextMessage,
  type RuntimePromptParts,
} from "./framework/system-agent/cache-prompt.js";

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
export {
  acquireProcessLock,
  ProcessLockError,
  type AcquireProcessLockOptions,
  type ProcessLock,
  type ProcessLockMetadata,
} from "./core/persistence/process-lock.js";
