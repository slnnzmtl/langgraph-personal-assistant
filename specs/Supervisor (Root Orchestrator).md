> **Superseded:** This spec describes the pre–runtime-agent architecture (`Finance_SG`, `Obsidian_SG`, etc.). Current routing uses agent ids (`finance`, `obsidian`, `configuration`) via `Runtime_SG`. See [README.md](../README.md) for the current architecture.
>

### **1. Core Identity & Responsibility**

- **Node Identifier:** `Root_Supervisor`
- **Layer/Type:** Orchestration Layer / Root StateGraph Node.
- **Core Responsibility:** Act as the traffic cop, analyzing the user's intent and utilizing Zod-bound tools to deterministically route the request to the correct sub-graph.
- **Design Pattern:** Strategy Pattern (for LLM swapping) + Membrane Pattern (for state filtering).
### **2. State Separation (The "Membrane" Pattern)**

The Supervisor does not "own" or store the state. It receives a read-only projection of the global `AgentState`, makes a routing decision, and returns an update object that the LangGraph reducer applies to the global state.

By acting as a membrane, the Supervisor guarantees it only passes the necessary context slice to the sub-graphs, preventing token bleed.

**TypeScript Interface Abstraction:**

TypeScript

```
// 1. The Global State (Managed entirely by LangGraph's MemorySaver/Checkpointer)
interface GlobalAgentState {
  messages: BaseMessage[];
  next: "Finance_SG" | "Obsidian_SG" | "FINISH";
  context: Record<string, any>;
}

// 2. The Supervisor's Execution Signature
// The Supervisor only receives what it needs and returns a state mutation.
type SupervisorNodeFn = (state: GlobalAgentState) => Promise<Partial<GlobalAgentState>>;
```

### **3. The LLM Connector (Provider Agnostic Layer)**

To ensure you can easily swap Gemini out for Anthropic, OpenAI, or a local model, the Supervisor must not instantiate the LLM directly. Instead, it relies on an injected `ILLMConnector` interface.

This connector leverages LangChain's universal `BaseChatModel` and strictly enforces Zod tool binding regardless of the underlying API.

**The Connector Interface:**

TypeScript

```
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { z } from "zod";

export interface ILLMConnector {
  // Returns the configured LangChain chat model
  getModel(): BaseChatModel;
  
  // Binds the Zod routing schema to the model
  bindRoutingTools(schema: z.ZodType<any>): Runnable;
}
```

**Implementation Example (Gemini):**

TypeScript

```
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

export class GeminiConnector implements ILLMConnector {
  private model: ChatGoogleGenerativeAI;

  constructor(apiKey: string, modelName: string = "gemini-1.5-flash") {
    this.model = new ChatGoogleGenerativeAI({
      apiKey,
      modelName,
      temperature: 0, // Deterministic routing
    });
  }

  getModel() { return this.model; }

  bindRoutingTools(schema: z.ZodType<any>) {
    // LangChain automatically translates the Zod schema into the 
    // correct native tool-calling format for the specific provider.
    return this.model.withStructuredOutput(schema, {
      name: "route_request",
    });
  }
}
```

### **4. Routing Logic & Tool Binding (Zod)**

The Supervisor relies on Strict Function Calling via Zod. The LLM is provided with a schema and forced to output a structured JSON object detailing where the execution should go next.

**The Routing Schema:**

TypeScript

```
import { z } from "zod";

export const RoutingSchema = z.object({
  next: z.enum(["Finance_SG", "Obsidian_SG", "FINISH"])
    .describe("The next sub-graph to route the user's request to."),
  reasoning: z.string()
    .describe("Brief internal reasoning for why this route was selected.")
});
```

### **5. The Supervisor Node Implementation**

Bringing it all together, the Supervisor node is a pure function. You inject the `ILLMConnector` into a factory function that generates the node. This keeps the node stateless and highly testable.

**Node Factory Code:**

TypeScript

```
import { SystemMessage } from "@langchain/core/messages";

export const createSupervisorNode = (llmConnector: ILLMConnector) => {
  
  // 1. Initialize the agnostic LLM with our Zod routing schema
  const routingChain = llmConnector.bindRoutingTools(RoutingSchema);

  const systemPrompt = new SystemMessage(`
    You are the Root Supervisor. Your only job is to analyze the user's 
    latest request and route it to the correct specialized sub-graph.
    - If the request is about logging, checking, or analyzing money/expenses, route to Finance_SG.
    - If the request is about saving notes, markdown, or documentation, route to Obsidian_SG.
    - If the request is conversational or the task is complete, route to FINISH.
  `);

  // 2. Return the actual Node function required by LangGraph
  return async (state: GlobalAgentState): Promise<Partial<GlobalAgentState>> => {
    
    // Read the messages from the separated AgentState
    const messages = [systemPrompt, ...state.messages];

    // Execute the agnostic routing chain
    const response = await routingChain.invoke(messages);

    // Return the state mutation (LangGraph will update the `next` field)
    return {
      next: response.next,
    };
  };
};
```

### **Summary of the Execution Flow**

1. **Trigger:** The LangGraph engine invokes the `Root_Supervisor` node, passing in the current `GlobalAgentState`.
2. **Context Assembly:** The Supervisor prepends its systemic instructions to the conversation history.
3. **Agnostic LLM Call:** It passes the array to the `ILLMConnector`. Whether this is Gemini, Claude, or GPT-4, the connector forces the model to adhere to the `RoutingSchema`.
4. **State Update:** The Supervisor receives the typed response (e.g., `{ next: "Finance_SG", reasoning: "..." }`) and returns `{ next: "Finance_SG" }`.
5. **Delegation:** The LangGraph orchestrator intercepts this state mutation and shifts execution to the `Finance_SG` node.