export type SystemMetadataOptions = {
  runtimeAgent?: string;
};

export type SystemContextFormatter = (
  date: Date,
  options?: SystemMetadataOptions,
) => string;

export type RuntimeShellFormatters = {
  formatSystemMetadata: SystemContextFormatter;
  appendSkillAttachments?: (
    basePrompt: string,
    definition: import("./types/agent.js").RuntimeAgentDefinition,
    messages: import("@langchain/core/messages").BaseMessage[],
  ) => string;
  appendDynamicSections?: (staticPrompt: string, ...sections: string[]) => string;
};

export const defaultAppendDynamicSections = (
  staticPrompt: string,
  ...sections: string[]
): string => {
  const dynamic = sections
    .map((section) => section.trim())
    .filter((section) => section.length > 0)
    .join("\n\n");

  if (dynamic.length === 0) {
    return staticPrompt.trim();
  }

  return `${staticPrompt.trim()}\n\n${dynamic}`;
};
