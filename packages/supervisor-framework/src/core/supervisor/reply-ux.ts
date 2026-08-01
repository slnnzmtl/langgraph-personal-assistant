export type EmptyReplyContext = {
  agentName: string;
  toolContext: string;
  latestUserRequest: string;
};

export type PostHandoffFinishContext = EmptyReplyContext & {
  latestUserRequest: string;
};

export type ReplyUxConfig = {
  buildEmptyReplySystemPrompt: (ctx: EmptyReplyContext) => string;
  buildEmptyReplySafeFallback: (ctx: EmptyReplyContext) => string;
  buildPostHandoffFinishSystemPrompt: (ctx: PostHandoffFinishContext) => string;
  buildPostHandoffFinishSafeFallback: (ctx: PostHandoffFinishContext) => string;
  buildFailureReplyInstruction: (failureContext: string) => string;
  /** User-facing text when the failure finalizer is empty or returns routing JSON. */
  buildFailureReplySafeFallback: (failureContext: string) => string;
  genericCompletionFallbacks?: ReadonlySet<string>;
};

export const DEFAULT_GENERIC_COMPLETION_FALLBACKS = new Set([
  "Completed the configuration task.",
]);

export const defaultReplyUxConfig: ReplyUxConfig = {
  genericCompletionFallbacks: DEFAULT_GENERIC_COMPLETION_FALLBACKS,
  buildEmptyReplySystemPrompt: ({ agentName, toolContext }) => [
    "You write a final user-facing status message for a specialized agent that stopped without replying.",
    "Return plain text only. Do not return JSON, routing instructions, tool calls, or a plan for future work.",
    "Treat the supplied tool result as authoritative and report only facts it supports.",
    "If it shows the requested state is already present, say it is already present; do not say you will perform the change.",
    "Do not claim a write occurred unless the tool result explicitly proves it.",
    `Specialized agent: ${agentName}`,
    toolContext.length > 0
      ? `Authoritative last tool result:\n${toolContext}`
      : "No tool result is available.",
  ].join("\n\n"),
  buildEmptyReplySafeFallback: ({ agentName, toolContext }) =>
    toolContext.length > 0
      ? `${agentName} did not produce a reliable summary. Its last tool result was:\n${toolContext}`
      : `${agentName} did not produce a user-facing reply, and no tool result was available to summarize.`,
  buildPostHandoffFinishSystemPrompt: ({ agentName, toolContext, latestUserRequest }) => [
    "You write the final user-facing reply after a specialized agent already completed the user's request.",
    "Return plain text only. Do not return JSON, routing instructions, tool calls, or a plan for future work.",
    "Summarize the outcome from the supplied context. Do not say you will perform the work again.",
    "Treat tool results as authoritative and report only facts they support.",
    `User request: ${latestUserRequest || "(none)"}`,
    `Specialized agent: ${agentName}`,
    toolContext.length > 0
      ? `Authoritative tool results:\n${toolContext}`
      : "No tool result is available.",
  ].join("\n\n"),
  buildPostHandoffFinishSafeFallback: ({ agentName, toolContext, latestUserRequest }) =>
    toolContext.length > 0
      ? `${agentName} completed your request${latestUserRequest ? `: ${latestUserRequest}` : ""}. Tool results:\n${toolContext}`
      : `${agentName} completed your request${latestUserRequest ? `: ${latestUserRequest}` : ""}.`,
  buildFailureReplyInstruction: () =>
    [
      "The normal supervisor routing failed due to a temporary internal issue.",
      "Produce the final user-facing reply in plain text.",
      "Apologize briefly and suggest trying again.",
      "Do not output JSON, call tools, or mention internal errors, caches, APIs, or stack traces.",
    ].join(" "),
  buildFailureReplySafeFallback: () =>
    "I couldn't finish routing your request. Please try again in a moment.",
};
