export type EmptyReplyContext = {
  agentName: string;
  toolContext: string;
  latestUserRequest: string;
};

export type ReplyUxConfig = {
  buildEmptyReplySystemPrompt: (ctx: EmptyReplyContext) => string;
  buildEmptyReplySafeFallback: (ctx: EmptyReplyContext) => string;
  buildFailureReplyInstruction: (failureContext: string) => string;
};

export const defaultReplyUxConfig: ReplyUxConfig = {
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
  buildFailureReplyInstruction: (failureContext) =>
    `The normal supervisor routing failed. Produce the final user-facing reply in plain text. Explain the issue briefly and helpfully, and do not output JSON or call tools. Failure context: ${failureContext}`,
};
