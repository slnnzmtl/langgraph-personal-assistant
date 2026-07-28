import "dotenv/config";

import { loadConfig } from "./config.js";
import { runOneShot, runTerminalChat } from "./chat.js";
import { createMinimalSupervisorSystem } from "./supervisor.js";

const main = async (): Promise<void> => {
  const config = loadConfig();
  const { graph } = await createMinimalSupervisorSystem(config);
  const args = process.argv.slice(2);

  if (args.length === 0) {
    await runTerminalChat(graph);
    return;
  }

  await runOneShot(graph, args.join(" "));
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
