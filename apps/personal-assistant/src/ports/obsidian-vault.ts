import { z } from "zod";

export const RelativePathSchema = z
  .string()
  .min(1)
  .describe("The destination path relative to the vault root.")
  .refine((value) => !value.includes(".."), {
    message: "Path traversal is forbidden.",
  });

export type ObsidianFileWriteRequest = {
  relativePath: string;
  operation: "create_new" | "append" | "overwrite";
  content: string;
  summary: string;
};

export type ObsidianVault = {
  readonly rootPath: string;
  resolvePath(relativePath: string): string;
  readFile(relativePath: string): Promise<string>;
  writeFile(request: ObsidianFileWriteRequest): Promise<string>;
  checkExists(relativePath: string): Promise<boolean>;
  listDirContents(relativeDir: string): Promise<{ files: string[]; dirs: string[] }>;
  searchFiles(queries: string[], relativeDir: string): Promise<string[]>;
  searchFilesByName(queries: string[], relativeDir: string): Promise<string[]>;
};
