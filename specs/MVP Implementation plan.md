> **Superseded:** This spec describes the pre–runtime-agent architecture (`Finance_SG`, `Obsidian_SG`, etc.). Current routing uses agent ids (`finance`, `obsidian`, `configuration`) via `Runtime_SG`. See [README.md](../README.md) for the current architecture.
>

1. The Global State (AgentState)
In LangGraph, the state is the single source of truth. For the MVP, we will keep it lightweight but strictly typed.

TypeScript Interface
TypeScript
import { BaseMessage } from "@langchain/core/messages";

// The state schema definition for LangGraph
export interface AgentState {
  // LangGraph handles appending to this array automatically via a reducer
  messages: BaseMessage[];
  
  // The deterministic routing flag set by the Supervisor
  next?: "Finance_SG" | "Obsidian_SG" | "FINISH";
  
  // A generic store for environment data or global flags
  context?: Record<string, any>; 
}
State Reducers (The Mutation Rules)
messages: Must be configured with an "append" reducer. When a node returns { messages: [newMessage] }, LangGraph should push it to the existing array, not overwrite it.

next: Uses a "replace" reducer. The latest routing decision always overwrites the previous one.

2. The Orchestration Layer (WorkflowGraph & Supervisor)
The MVP Orchestrator is a LangGraph StateGraph consisting of one active node (the Supervisor) and placeholder (stub) nodes for your sub-graphs.

The Routing Schema (Zod)
This is the strict contract your Gemini model must adhere to when deciding where to send the user's request.

TypeScript
import { z } from "zod";

export const MVPRoutingSchema = z.object({
  next: z.enum(["Finance_SG", "Obsidian_SG", "FINISH"])
    .describe("Route 'Finance_SG' for money/logging, 'Obsidian_SG' for notes, or 'FINISH' for general chat."),
  reply: z.string()
    .optional()
    .describe("If routing to FINISH, provide the conversational reply to the user here.")
});
The Supervisor Node
Responsibility: Read state.messages, invoke Gemini 1.5 Flash with withStructuredOutput(MVPRoutingSchema), and mutate the next state.

MVP Mock Nodes: To test the graph before building the real sub-graphs, create dummy nodes for Finance and Obsidian that simply append a system message like "Mock Finance Sub-Graph Executed".

Graph Compilation Flow
Add Nodes: Add supervisorNode, financeMockNode, obsidianMockNode.

Set Entry Point: The graph always starts at supervisorNode.

Define Conditional Edges: Add a conditional edge originating from supervisorNode. It reads state.next. If "Finance_SG", it goes to financeMockNode. If "FINISH", it goes to the END node.

Define Static Edges: Both financeMockNode and obsidianMockNode route to the END node upon completion.

Compile: const app = graph.compile({ checkpointer: memory });

3. The Interface Layer (Telegram Wrapper)
The wrapper acts as the external event loop. It translates Telegram webhooks/polling into LangGraph invocations.

Core Responsibilities & Security
Authentication: Must intercept every incoming payload and verify the Telegram User ID against your .env allowlist.

Format Translation: Converts Telegram text into a LangChain HumanMessage. Converts the final LangGraph AIMessage back into Telegram Markdown.

Thread Management: Passes the Telegram chat_id into LangGraph as the thread_id to maintain conversation memory across sessions.

MVP Execution Script (Telegraf Example)
TypeScript
import { Telegraf } from "telegraf";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
// Import your compiled LangGraph app
import { app } from "./graph/workflow"; 

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const ALLOWED_ID = parseInt(process.env.ALLOWED_TELEGRAM_USER_ID!);

bot.on("text", async (ctx) => {
  // 1. Strict Security Firewall
  if (ctx.from.id !== ALLOWED_ID) {
    console.warn(`Unauthorized access from ID: ${ctx.from.id}`);
    return; // Silently drop
  }

  const userText = ctx.message.text;
  const threadId = ctx.chat.id.toString();

  try {
    // 2. Translate and Invoke Orchestrator
    const inputs = { messages: [new HumanMessage(userText)] };
    const config = { configurable: { thread_id: threadId } };
    
    // Send a typing action to Telegram while Gemini thinks
    await ctx.sendChatAction("typing");

    // Execute the LangGraph state machine
    const finalState = await app.invoke(inputs, config);

    // 3. Extract Result and Reply
    // Get the last message in the state array
    const lastMessage = finalState.messages[finalState.messages.length - 1];

    if (lastMessage instanceof AIMessage) {
        await ctx.reply(lastMessage.content.toString(), { parse_mode: "Markdown" });
    } else {
        // Fallback if a sub-graph just returned a system confirmation
        await ctx.reply(lastMessage.content.toString()); 
    }

  } catch (error) {
    console.error("Agent Execution Error:", error);
    await ctx.reply("❌ System Error: The orchestrator failed to process the request.");
  }
});

// Start listening
bot.launch();