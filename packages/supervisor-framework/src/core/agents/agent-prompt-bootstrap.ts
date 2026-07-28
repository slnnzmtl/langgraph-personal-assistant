/** JSON snapshot when the runtime prompt is stored in a writable prompt file. */
export const formatDataAgentPromptBootstrap = (id: string): string =>
  `Runtime prompt is loaded from data/prompts/${id}.xml via promptSourceKey.`;
