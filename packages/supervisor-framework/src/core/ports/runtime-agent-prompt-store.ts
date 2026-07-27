export type RuntimeAgentPromptStore = {
  write(id: string, content: string): Promise<void>;
  delete(id: string): Promise<void>;
  describeLocation(id: string): string;
};
