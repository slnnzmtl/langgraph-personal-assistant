### **The Architecture: External Trigger, Internal Execution**

1. **The Infrastructure Layer (External):** A standard Node.js script using a library like `node-cron` (or a serverless CRON trigger if you are on Vercel/AWS).
    
2. **The Synthetic Payload:** When the cron fires, it constructs a fake `HumanMessage` or `SystemMessage` with a highly specific trigger string (e.g., `"SYSTEM_CRON_TRIGGER: RUN_WISE_SYNC"`).
    
3. **The Routing:** This message is passed into your LangGraph `app.invoke()`. The Supervisor routes it to `Finance_SG`, which recognizes the strict string and immediately routes to the `Wise_Sync_Node`.
    

### **Implementation Plan**

#### **Step 1: Setup the External Cron Runner**

Install a cron package in your TypeScript project. `npm install node-cron` `npm install --save-dev @types/node-cron`

#### **Step 2: Create the Trigger Script**

In your project root (perhaps in your `index.ts` alongside your Telegram webhook listener), you initialize the cron job.

TypeScript

```
import cron from "node-cron";
import { HumanMessage } from "@langchain/core/messages";
import { app } from "./graph/workflow"; // Your compiled LangGraph instance

// This runs every day at 23:59 (11:59 PM)
cron.schedule("59 23 * * *", async () => {
  console.log("CRON FIRED: Initiating Wise Sync...");

  // 1. Create a synthetic message that the agent understands is a system command, not a user chat.
  const cronMessage = new HumanMessage({
    content: "SYSTEM_CRON_TRIGGER: RUN_WISE_SYNC",
    name: "SystemCron" // Optional: helps the LLM distinguish the source
  });

  try {
    // 2. Invoke the graph just like the Telegram adapter does.
    // Use a specific thread_id so cron jobs don't pollute your daily chat history.
    await app.invoke(
      { messages: [cronMessage] },
      { configurable: { thread_id: "system_cron_thread" } }
    );
    
    console.log("CRON SUCCESS: Wise sync complete.");
  } catch (error) {
    console.error("CRON FAILED: Error executing LangGraph sync.", error);
    // Optional: Push a Telegram alert to yourself here that the cron failed.
  }
});
```

#### **Step 3: Update the Finance Router Node**

Inside your `Finance_SG`, update the logic of your **Finance Router** (Node A) so it doesn't waste LLM tokens trying to "reason" about the cron message. Add a deterministic interceptor:

TypeScript

```
export const financeRouterNode = async (state: FinanceLocalState) => {
  const lastMessage = state.messages[state.messages.length - 1];

  // Deterministic short-circuit: Zero token cost
  if (lastMessage.content === "SYSTEM_CRON_TRIGGER: RUN_WISE_SYNC") {
    return { next: "Wise_Sync_Node" };
  }

  // Otherwise, fall back to the LLM (Gemini) to route manual user inputs
  const response = await llmRoutingChain.invoke(state.messages);
  return { next: response.next };
};
```

