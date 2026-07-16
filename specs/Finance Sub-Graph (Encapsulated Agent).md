> **Superseded:** This spec describes the pre–runtime-agent architecture (`Finance_SG`, `Obsidian_SG`, etc.). Current routing uses agent ids (`finance`, `obsidian`, `configuration`) via `Runtime_SG`. See [README.md](../README.md) for the current architecture.
>

# Architectural Specification: Finance Sub-Graph (`Finance_SG`)

## 1. Component Overview

- **Node Identifier:** `Finance_SG`
- **Layer/Type:** Encapsulated Sub-Graph Agent / Local State Machine
- **Core Responsibility:** Handle manual expense categorization, Supabase ledger insertions, and automated Wise transaction synchronization within a network-isolated boundary.
- **Design Pattern:** Isolated Scratchpad State Machine with Internal Router.
## 2. State Isolation & Filtering (The "Local Membrane")

To eliminate token bleed and prevent leakages across domains, the `Finance_SG` operates on a restricted "membrane" pattern. It cannot view global state keys from other sub-graphs (e.g., Obsidian configurations).

### Inbound View (From Global State)

The Root Orchestrator slices the global context and passes only:

- Filtered `messages` history containing the immediate finance-related request.
- The `context` block containing credentials and environment specifics.

### Isolated Sub-Graph Local Scratchpad

TypeScript

```
interface FinanceLocalState {
  transactions_to_log: Array<ParsedWiseTransaction>; // Intermediate parsed JSON array [cite: 4374]
  sync_start_date: string;                           // 'YYYY-MM-DD' cursor fetched from database [cite: 4374]
  db_operation_result: { success: boolean; rowsAffected: number; error?: string }; // Supabase MCP response status 
}
```

### Outbound Reducer Mutation (To Global State)

Upon calling `END` internally, the sub-graph returns a synthesized `BaseMessage` summary (e.g., `"Successfully logged $15 for dinner to Supabase and verified balance."`) which is appended to the root thread.

## 3. Internal Node Specifications

Code snippet

```
graph TD
    In([Inbound View]) --> Router[Node A: Finance Router]
    Router -->|Manual Log / Query| Logger[Node B: Manual Logger]
    Router -->|Cron / Automated Sync| WiseSync[Node C: Wise Sync Node]
    Logger --> DB_Tool[(Supabase MCP)]
    WiseSync --> Fetch_Tool[Wise REST Fetcher]
    Fetch_Tool --> WiseSync
    WiseSync --> DB_Tool
    DB_Tool --> Out([Outbound Mutation])
```

### Node A: Finance Router (Internal Orchestrator)

- **Core Responsibility:** Categorize inbound finance requests as a manual entry parsing task, a query execution, or an automated cron/heartbeat synchronization run.
- **LLM Strategy:** Fast Reasoning Model (e.g., Gemini 1.5 Flash) bound strictly with a router schema tool definition.
- **Outbound Routing Logic:** `Manual_Logger_Node` or `Wise_Sync_Node`.

### Node B: Manual Logger Node

- **Core Responsibility:** Extract unstructured user text into typed transactions, execute hardcoded algorithmic constraints, and pass values to the database connector.
- **LLM Strategy:** High-Logic Model (e.g., Gemini 1.5 Pro) to correctly interpret natural dialogue or context cues.
- **Prompts, Constraints & Schema Rules:**
    - **Strict Rounding:** Always convert prices using the `ceil()` ceiling function, rounding transaction balances up to the nearest integer.        
    - **Algorithmic Thresholds:** If the transaction name or line items contain the string `"Grab"`:
        - Amount $\le \$1.50$ $\rightarrow$ Route directly to Category: `Taxi` (ID: 35).
        - Amount $> \$1.50$ $\rightarrow$ Route directly to Category: `Food` (ID: 4).
    - **Date Standards:** Enforce strict ISO `YYYY-MM-DD` formatting.
- **Connected Tooling:** Supabase Model Context Protocol (MCP) utilizing `postgres_execute` targeting the active repository.
### Node C: Wise Sync Node (Cron/Heartbeat Mode)

- **Core Responsibility:** Execute a self-healing, multi-step workflow syncing digital statement events directly from Wise over REST.

- **LLM Strategy:** Gemini 1.5 Flash (acting as a deterministic step execution engine).
- **Execution Blueprint Steps:**
    1. **Get Sync Start Date:** Run a query via the Supabase MCP to find the last known point of entry (`SELECT MAX(paid_date) FROM public.expense;`) and allocate this string into the local scratchpad as `StartDate`.
    2. **Fetch Wise Activities:** Invoke a `GET` request against the target account path (`https://api.transferwise.com/v1/profiles/$WISE_PROFILE_ID/activities`) appending `since={StartDate}` and `until={Today}`.
    3. **Filter Array:** Retain only elements matching statuses of `COMPLETED` or `PENDING` where funds flow outward (ignore inbound card deposits/credits).
    4. **Perform In-Memory Deduplication:** Locally cross-reference the generated array maps against recent database records utilizing a combined match of `name` and `paid_date` rows to guarantee no double-billing occurs if cron tasks overlap.
    5. **Insert Ledgers:** Package the clean records list and pipe them downstream to the DB.
- **Connected Tooling:**
    
    - **Supabase MCP:** Handles transactional database state execution.
    - **Wise REST Fetcher:** A custom tool written in LangChain exposing Node `fetch`, strongly schemas-typed with Zod to extract fields limited to `title`, `secondaryAmount`, and `createdOn`.

## 4. Zod Schema Assertions & Typesafe Data Contracts

All tool outputs and parameter extractions are validated _prior_ to passing database calls to protect the relational schema columns from LLM hallucinations or textual datatype leaks.

### Target Relational Database Layout

- **Database Reference:** `vwtvsymwjzrvtvereeiw`
- **Target Schema Tables:** `public.expense`, `public.category`

### Expense Data Ingestion Zod Verification Contract

TypeScript

```
import { z } from "zod";

export const ExpenseIngestionSchema = z.object({
  name: z.string()
    .min(1)
    .describe("Cleaned merchant name or transaction summary string with HTML tags removed."),
  amount: z.number()
    .int()
    .positive()
    .describe("The integer cost of the item. Must be pre-processed using Math.ceil formatting."),
  category_id: z.number()
    .int()
    .describe("The relational primary key integer pointing to the matched category in public.category."),
  paid_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("ISO string representation of the payment event formatted cleanly as YYYY-MM-DD."),
  paid: z.boolean()
    .default(true)
    .describe("Indicates ledger balancing status."),
  note: z.string()
    .optional()
    .describe("Optional extended reference parameters captured during processing.")
});

export type ExpenseRecord = z.infer<typeof ExpenseIngestionSchema>;
```