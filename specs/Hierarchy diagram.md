

```mermaid
graph TD
    %% External Interface
    subgraph Telegram_Layer ["Telegram Interface Layer"]
        User(("User"))
        TelegramAPI[("Telegram API")]
        Wrapper["Telegram Wrapper Node (Adapter)"]
    end

    %% Main Application
    subgraph Root_System ["Root LangGraph Orchestrator"]
        Supervisor["Supervisor (Router)"]
    end

    %% Specialized Modules
    subgraph Sub_Graphs ["Encapsulated Sub-Graph Agents"]
        Finance_SG["Finance Sub-Graph"]
        Obsidian_SG["Obsidian Sub-Graph"]
    end

    %% Interactions
    User <-->|Message/Image| TelegramAPI
    TelegramAPI <-->|Webhook/Polling| Wrapper
    
    Wrapper -->|Invoke| Supervisor
    
    Supervisor <-->|Route Intent| Finance_SG
    Supervisor <-->|Route Intent| Obsidian_SG
    
    Finance_SG -.->|Tool Output| Supervisor
    Obsidian_SG -.->|Tool Output| Supervisor
    
    Supervisor -->|Final Output| Wrapper
    Wrapper -->|Reply| TelegramAPI

    %% Styling
    classDef internal fill:#f9f,stroke:#333,stroke-width:2px;
    classDef external fill:#bbf,stroke:#333,stroke-width:1px;
    class Wrapper,Supervisor internal;
    class User,TelegramAPI external;
```



### Key Responsibilities by Layer

#### 1. The Telegram Wrapper (The Ingress)

- **Parsing:** It acts as the "translator." It takes the raw Telegram JSON object and extracts the `chat_id`, `text`, and any `photo` payloads.
- **Normalization:** It converts these into standard LangChain `HumanMessage` objects.
- **State Trigger:** It calls `app.invoke()` (or `stream()`), passing the normalized message into the graph’s memory.
- **Response Handling:** When the graph reaches the `END` state, the Wrapper intercepts the final message and ships it back to the user via the `sendMessage` Telegram API.

#### 2. The Root Orchestrator (The Supervisor)

- **Context Management:** It holds the `RootState` (the shared memory for the session).
- **Routing Logic:** It examines the latest `HumanMessage` from the Wrapper and decides which sub-graph (if any) should handle the request based on the user's intent.
- **Traffic Cop:** It ensures the Finance Agent doesn't receive "Obsidian" related messages, keeping tokens low and execution precise.

#### 3. The Sub-Graphs (The Workers)

- **Task Isolation:** Each sub-graph contains its own specialized system prompt and tools.
- **Memory Scope:** They only receive the `RootState` subset that they need to function. They don't need to know the Telegram API exists; they only know how to process their specific logic and return the result to the Orchestrator.