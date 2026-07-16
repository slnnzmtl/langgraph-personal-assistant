> **Superseded:** This spec describes the pre–runtime-agent architecture (`Finance_SG`, `Obsidian_SG`, etc.). Current routing uses agent ids (`finance`, `obsidian`, `configuration`) via `Runtime_SG`. See [README.md](../README.md) for the current architecture.
>

# Architectural Specification: Obsidian Sub-Graph (`Obsidian_SG`)

## 1. Component Overview

- **Node Identifier:** `Obsidian_SG`
- **Layer/Type:** Encapsulated Sub-Graph Agent / Local State Machine
- **Core Responsibility:** Manage local knowledge base creation, reading, and markdown formatting strictly within the bounds of the Obsidian vault.
- **Design Pattern:** Isolated Scratchpad State Machine with Internal Router.

## 2. State Isolation & Filtering (The "Local Membrane")

Operating behind a restricted "membrane", `Obsidian_SG` only receives context related to note-taking and knowledge base management. This prevents it from interacting with the financial ledger, external APIs, or other unrelated domains.

### Inbound View (From Global State)

The Root Orchestrator slices the global context and passes only:

- Filtered `messages` containing only the raw text, ideas, or events to be documented.
- `context` block detailing Obsidian path structures and specific formatting guidelines.

### Isolated Sub-Graph Local Scratchpad

TypeScript

```
interface ObsidianLocalState {
  target_path: string;           // Calculated path for the note (e.g., '~/obsidian-vault/private/routine/')
  file_operation_result: { success: boolean; path: string; error?: string }; // File system response status
  draft_content: string;         // Intermediate markdown draft before committing
}
```

### Outbound Reducer Mutation (To Global State)

Upon returning `END`, the sub-graph yields a single summary message appended to the root thread (e.g., `"Successfully documented meeting notes in ~/obsidian-vault/dev/meetings.md"`).

## 3. Internal Node Specifications

Code snippet

```
graph TD
    In([Inbound View]) --> Router[Node A: Obsidian Router]
    Router -->|Read Request| Reader[Node B: Note Reader]
    Router -->|Write / Append| Writer[Node C: Note Writer]
    Reader --> FS_Tool[(Zod FS Wrapper)]
    Writer --> FS_Tool
    FS_Tool --> Out([Outbound Mutation])
```

### Node A: Obsidian Router (Internal Orchestrator)

- **Core Responsibility:** Classify the intent: is the user asking to read an existing note, create a new entry, or append to a specific file (like `Places.md`)?
- **LLM Strategy:** Fast Reasoning Model (e.g., Gemini 1.5 Flash) bound with routing tools.
- **Outbound Routing Logic:** `Note_Reader_Node` or `Note_Writer_Node`.

### Node B: Note Writer Node

- **Core Responsibility:** Format raw text into proper markdown, adhering to strict styling rules, and execute the file write tool.
- **LLM Strategy:** High-Logic Model (e.g., Gemini 1.5 Pro) to ensure perfect markdown generation and reasoning about file placement.
- **Prompts, Constraints & Schema Rules:**
    - **No Redundant Headers:** Do not include a top-level H1 header (e.g., `# Header`) in notes if the filename itself already serves as the title.
    - **Path Awareness:** Always verify paths. For example, check `~/obsidian-vault/events/` before assuming an event folder belongs inside `private/`. Events are often top-level.
    - **Places Format:** When appending to `Places.md`, read the existing file first to match its formatting (e.g., whether it uses bulleted lists or markdown tables).
- **Connected Tooling:** Local File System (Node.js `fs` module wrapped in Zod constraints).
    

## 4. Zod Schema Assertions & Typesafe Data Contracts

To prevent the agent from destroying system files or writing outside the vault, all file paths must be strictly validated through Zod middleware.

### Target File System Boundaries

- **Vault Root:** `~/obsidian-vault/`
- **Common Paths:** * `~/obsidian-vault/private/routine/`
    - `~/obsidian-vault/dev/`
    - `~/obsidian-vault/private/cities//Places.md`\

### File Write Zod Verification Contract

TypeScript

```
import { z } from "zod";

export const ObsidianWriteSchema = z.object({
  relative_path: z.string()
    .min(1)
    .describe("The destination path relative to the vault root (e.g., 'private/routine/June 11 - Thu.md')."),
  content: z.string()
    .describe("The perfectly formatted markdown content to write or append."),
  mode: z.enum(["overwrite", "append", "create_new"])
    .describe("The file operation mode."),
  check_existing: z.boolean()
    .default(true)
    .describe("Whether to read the file first to match formatting (critical for Places.md).")
}).refine(data => !data.relative_path.includes(".."), {
  message: "Path traversal is strictly forbidden. Must remain inside vault boundaries."
});

export type ObsidianWriteRequest = z.infer<typeof ObsidianWriteSchema>;
```