> **Superseded:** This spec describes the pre–runtime-agent architecture (`Finance_SG`, `Obsidian_SG`, etc.). Current routing uses agent ids (`finance`, `obsidian`, `configuration`) via `Runtime_SG`. See [README.md](../README.md) for the current architecture.
>

## 1. Component Overview

- **Node Identifier:** `Telegram_Adapter_Node`
- **Layer/Type:** Interface Layer / Deterministic Adapter
- **Core Responsibility:** Serve as the secure, bidirectional gateway between the Telegram Bot API and the LangGraph Orchestrator. It normalizes inbound Telegram updates into standard LangChain message objects and handles formatting outbound responses.
- **Design Pattern:** Gateway / Adapter Pattern.
- **LLM Strategy:** None. This is a pure TypeScript deterministic execution layer.

## 2. State Interaction & Normalization

The Adapter does not make routing decisions or execute logic; its sole job regarding state is translation and injection.

### Inbound View (Telegram $\rightarrow$ Global State)

When a user sends a message, the adapter intercepts the Telegram `Update` object and normalizes it.

- **Reads:** Nothing from the initial state (acts as the entry point).
- **Updates:** Appends a new LangChain `HumanMessage` to the global `AgentState.messages` array.
- **Multimodal Support:** If the user sends an image (e.g., a receipt for `Finance_SG`), the adapter must extract the Telegram file URL and construct a multimodal `HumanMessage` payload containing both the image URL and the accompanying caption.

### Outbound View (Global State $\rightarrow$ Telegram)

Upon completion of the LangGraph execution cycle.

- **Reads:** The final `AIMessage` in the `AgentState.messages` array.
- **Action:** Pushes the text content (and any markdown formatting) back to the user via the Telegram `sendMessage` method.

## 3. Security & Authentication Boundary

Since this agent has write access to your personal Supabase financial ledger and local Obsidian vault, the Telegram Adapter must act as a strict firewall.

- **Hardcoded Allowlist:** The adapter must verify the inbound `ctx.from.id` or `ctx.chat.id` against a strict environment variable (e.g., `ALLOWED_TELEGRAM_USER_ID`).
- **Silent Rejection:** Any updates from unauthorized user IDs should be silently dropped (or logged internally) without returning a response, preventing unauthorized probing of your bot.

## 4. Interface Contracts & Typesafe Schemas

The adapter leverages standard Telegram bot libraries (like `telegraf` or `node-telegram-bot-api`) mapped to LangChain's core message types.

### The Adapter Execution Interface

TypeScript

```
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { Context } from "telegraf"; // Example using telegraf

export interface ITelegramAdapter {
  // 1. Validates user and extracts content
  parseInbound(ctx: Context): Promise<HumanMessage | null>;
  
  // 2. Dispatches the LangGraph execution
  triggerWorkflow(message: HumanMessage): Promise<void>;
  
  // 3. Formats and sends the final state back to Telegram
  sendOutbound(ctx: Context, stateMessages: BaseMessage[]): Promise<void>;
}
```

### Inbound Normalization Logic (Multimodal Example)

TypeScript

```
async parseInbound(ctx: Context): Promise<HumanMessage | null> {
  // 1. Security Check
  if (ctx.from?.id.toString() !== process.env.ALLOWED_TELEGRAM_USER_ID) {
    console.warn(`Unauthorized access attempt from ID: ${ctx.from?.id}`);
    return null; 
  }

  // 2. Handle Text
  if (ctx.message && 'text' in ctx.message) {
    return new HumanMessage(ctx.message.text);
  }

  // 3. Handle Images (e.g., Receipts for Finance_SG)
  if (ctx.message && 'photo' in ctx.message) {
    const photo = ctx.message.photo.pop(); // Get highest resolution
    const fileLink = await ctx.telegram.getFileLink(photo!.file_id);
    const caption = 'caption' in ctx.message ? ctx.message.caption : "Process this image.";

    return new HumanMessage({
      content: [
        { type: "text", text: caption },
        { type: "image_url", image_url: { url: fileLink.href } }
      ]
    });
  }

  return null;
}
```

## 5. Execution Flow & Lifecycle

1. **Listen:** The node runs as a persistent listener (Long Polling) or via Serverless Webhooks.
2. **Intercept:** An update is received. The Adapter validates the `user_id`.
3. **Normalize:** The payload is converted into a `HumanMessage` (handling text or images).
4. **Invoke:** The Adapter calls `app.invoke({ messages: [newHumanMessage] })` on the compiled LangGraph `WorkflowGraph`.
5. **Await:** LangGraph processes the intent, routes to sub-graphs (Finance/Obsidian), executes tools, and resolves.
6. **Respond:** The Adapter extracts the last `BaseMessage` from the returned state and uses `ctx.reply()` to send the markdown-formatted response back to your Telegram client.
7. **Error Fallback:** If the LangGraph execution fails or times out, the Adapter catches the exception and replies with a real reason explanation. 