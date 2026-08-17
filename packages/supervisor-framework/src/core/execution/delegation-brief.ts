import { HumanMessage } from "@langchain/core/messages";

import {
  DELEGATION_TASK_CONTEXT_KEY,
  PRIOR_SPECIALIST_SUMMARY_CONTEXT_KEY,
} from "../types/agent.js";

const readContextString = (context: Record<string, unknown>, key: string): string => {
  const value = context[key];
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
};

export const buildDelegationBriefMessages = (
  context: Record<string, unknown> | undefined,
): HumanMessage[] => {
  if (!context) {
    return [];
  }

  const priorSummary = readContextString(context, PRIOR_SPECIALIST_SUMMARY_CONTEXT_KEY);
  const task = readContextString(context, DELEGATION_TASK_CONTEXT_KEY);

  if (!priorSummary && !task) {
    return [];
  }

  const parts: string[] = [];
  if (priorSummary) {
    parts.push(`Prior specialist result:\n${priorSummary}`);
  }
  if (task) {
    parts.push(`Supervisor task:\n${task}`);
  }

  return [new HumanMessage(parts.join("\n\n"))];
};
