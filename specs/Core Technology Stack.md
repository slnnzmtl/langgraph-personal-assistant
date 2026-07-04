

|**Component**|**Technology**|**Rationale**|
|---|---|---|
|**Framework**|LangChain (`@langchain/langgraph` + `@langchain/core`)|Shifts the agent from a chaotic, prompt-heavy system to a deterministic, state-machine model.|
|**Runtime Language**|TypeScript (Node.js)|Enforces compile-time type-safety over state modifications, payloads, and interface inputs.|
|**Primary LLMs**|Gemini 1.5 Flash & Gemini 1.5 Pro|**Flash:** Low-latency, cost-effective routing and simple queries.<br><br>  <br><br>**Pro:** Context-aware entity extraction and Markdown formatting.|
|**Primary User Interface**|Telegram Bot API (`telegraf` via Long Polling)|Secure, conversational entry point. Long polling removes the need to expose ports via reverse proxies (e.g., Ngrok).|
|**Financial Database**|Supabase API / Postgres MCP|Robust transactional ledger backing project `vwtvsymwjzrvtvereeiw`.|
|**Banking Data Feed**|Wise REST API|Automated bank statement tracking via profile activity endpoints.|
|**Knowledge Base**|Local Obsidian Vault|Local filesystem storage (`~/obsidian-vault/`) processing native Markdown files.|

## 🏗️ Architectural Topology

The system implements a **hierarchical state-machine design pattern** utilizing an isolation layer (the "Membrane Pattern") to prevent context window bloat and control API token costs.

Code snippet

```
graph TD
    User((User)) <-->|Telegram Message| TG_Adapter[Telegram Adapter Node]
    Cron([node-cron Daemon]) -->|Synthetic Trigger| TG_Adapter
    
    subgraph Root Graph [Root LangGraph Orchestrator]
        TG_Adapter -->|Invoke GlobalState| Supervisor{Root Supervisor}
        Supervisor -->|Route / Filtered State| Finance_SG[[Finance Sub-Graph]]
        Supervisor -->|Route / Filtered State| Obsidian_SG[[Obsidian Sub-Graph]]
        Supervisor -->|End Turn| TG_Adapter
    end

    subgraph Finance Boundary
        Finance_SG <-->|SQL Queries| Supabase[(Supabase DB)]
        Finance_SG <-->|HTTP Request| Wise[Wise API]
    end

    subgraph Knowledge Boundary
        Obsidian_SG <-->|Read / Write| Local_FS[(Local Filesystem Vault)]
    end
```

### 1. The Interface & Guardrail Layer

- **Telegram Adapter:** Serves as the bidirectional gateway. It acts as a **hardcoded firewall** dropping any updates where `ctx.from.id !== ALLOWED_TELEGRAM_USER_ID`. It normalizes text inputs and handles **multimodal uploads** (extracting temporary photo binary URLs for receipt processing).
    

### 2. The Orchestration Layer

- **Root Supervisor:** A state node tasked _exclusively_ with intent classification. It uses strict **Zod-bound function calling** to output a type-safe JSON schema specifying the next branch. It features a zero-token short-circuit interceptor for automated script execution.
    
- **The Global State (`AgentState`):** An asynchronous append-only message ledger combined with a state-trimming window to prune older history and avoid token bleed.
    

### 3. The Specialized Execution Domain (Sub-Graphs)

- **Finance Sub-Graph (`Finance_SG`):** Isolated workspace executing database insertions (`public.expense`) and statement retrieval.
    
    - _Business Logic Automation:_ Algorithmic conditional category routing (e.g., automatically sorting `Grab` transport logs into `Taxi` [ID: 35] or `Food` [ID: 4] using price-ceiling boundaries) and strict integer rounding (`Math.ceil()`).
        
- **Obsidian Sub-Graph (`Obsidian_SG`):** Local sandbox translating unstructured summaries into structured markdown pages. It implements strict rules preventing duplicate layout titles (no redundant H1 headers) and relies on deep path validations to block path-traversal vulnerabilities.
    

## 🔒 Security & Automation Strategy

- **Local-Cloud Hybrid Bridge:** The application runs locally as a system daemon (via `pm2` or Docker) on the host machine storing the Obsidian vault. It pulls messages from Telegram's cloud via polling and uses local filesystem privileges to manipulate note paths securely.
    
- **Deterministic Parameter Safeguards:** All external tool inputs are bounded and parsed using **Zod Validation Schemas** before being forwarded to local disk or database layers. This forces the LLM to self-correct during parameter hallucination before execution errors occur.
    
- **Infrastructure-Driven Cron Tasks:** System synchronization (like the daily Wise transaction sync) is maintained by an external node daemon (`node-cron`). This injects synthetic system triggers into the graph, keeping the state machine event-driven and passive.