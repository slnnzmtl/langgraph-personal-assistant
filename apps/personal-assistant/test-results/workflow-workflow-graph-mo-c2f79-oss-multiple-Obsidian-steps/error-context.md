# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workflow.spec.ts >> workflow graph >> moves unchecked tasks from yesterday into today's routine across multiple Obsidian steps
- Location: tests/e2e/workflow.spec.ts:357:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

- Expected  - 1
+ Received  + 3

- Moved unchecked tasks from yesterday into today's routine saved to routine/July/July 5 - Sun.md.
+ ## Yesterday
+ - [ ] Buy milk
+ - [x] Archive receipt
```

# Test source

```ts
  322 |       });
  323 | 
  324 |       let finalState = await app.invoke(
  325 |         {
  326 |           messages: [new HumanMessage("turn 1")],
  327 |         },
  328 |         workflowConfig,
  329 |       );
  330 | 
  331 |       for (let turn = 2; turn <= 12; turn += 1) {
  332 |         const prompt = turn === 6 ? "please save turn 6" : `turn ${turn}`;
  333 |         finalState = await app.invoke(
  334 |           {
  335 |             messages: [new HumanMessage(prompt)],
  336 |           },
  337 |           workflowConfig,
  338 |         );
  339 |       }
  340 | 
  341 |       const saved = await readFile(path.join(vaultRoot, "notes/turn-6.md"), "utf8");
  342 |       const messageContents = finalState.messages.map((message) =>
  343 |         typeof message.content === "string" ? message.content : JSON.stringify(message.content),
  344 |       );
  345 | 
  346 |       expect(saved).toBe("Turn 6 saved to the vault\n");
  347 |       expect(finalState.messages.length).toBeGreaterThan(10);
  348 |       expect(messageContents).toContain("turn 1");
  349 |       expect(messageContents.some((message) => message.includes("Handled turn 1"))).toBe(true);
  350 |       expect(messageContents).toContain("turn 12");
  351 |       expect(messageContents.some((message) => message.includes("Handled turn 12"))).toBe(true);
  352 |     } finally {
  353 |       await rm(vaultRoot, { recursive: true, force: true });
  354 |     }
  355 |   });
  356 | 
  357 |   test("moves unchecked tasks from yesterday into today's routine across multiple Obsidian steps", async () => {
  358 |     const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "pa-e2e-multistep-vault-"));
  359 |     const yesterdayPath = "routine/July/July 4 - Sat.md";
  360 |     const todayPath = "routine/July/July 5 - Sun.md";
  361 | 
  362 |     await mkdir(path.join(vaultRoot, "routine", "July"), { recursive: true });
  363 |     await writeFile(
  364 |       path.join(vaultRoot, yesterdayPath),
  365 |       "## Yesterday\n- [ ] Buy milk\n- [x] Archive receipt\n",
  366 |       "utf8",
  367 |     );
  368 |     await writeFile(path.join(vaultRoot, todayPath), "## Today\n", "utf8");
  369 | 
  370 |     try {
  371 |       const app = makeWorkflowGraph(
  372 |         createRouteSupervisor(),
  373 |         vaultRoot,
  374 |         undefined,
  375 |         undefined,
  376 |         {
  377 |           obsidian: (input) => {
  378 |             const latestMessage = latestInputMessage(input);
  379 | 
  380 |             if (latestMessage instanceof HumanMessage) {
  381 |               return makeToolCallMessage("read_file", {
  382 |                 relativePath: yesterdayPath,
  383 |               }, "read-yesterday");
  384 |             }
  385 | 
  386 |             if (latestMessage instanceof ToolMessage) {
  387 |               const toolContent = typeof latestMessage.content === "string"
  388 |                 ? latestMessage.content
  389 |                 : JSON.stringify(latestMessage.content);
  390 | 
  391 |               if (toolContent.includes("- [ ] Buy milk") && !toolContent.startsWith("Success:")) {
  392 |                 return makeToolCallMessage("write_file", {
  393 |                   relativePath: todayPath,
  394 |                   operation: "append",
  395 |                   content: "- [ ] Buy milk",
  396 |                   summary: "Moved unchecked tasks from yesterday into today's routine",
  397 |                 }, "append-today");
  398 |               }
  399 | 
  400 |               return obsidianDoneResponse();
  401 |             }
  402 | 
  403 |             return obsidianDoneResponse();
  404 |           },
  405 |         },
  406 |       );
  407 | 
  408 |       const finalState = await app.invoke(
  409 |         {
  410 |           messages: [new HumanMessage("move all unchecked tasks from yesterday into today's task")],
  411 |         },
  412 |         workflowConfig,
  413 |       );
  414 | 
  415 |       const todayContent = await readFile(path.join(vaultRoot, todayPath), "utf8");
  416 |       const yesterdayContent = await readFile(path.join(vaultRoot, yesterdayPath), "utf8");
  417 | 
  418 |       expect(todayContent).toContain("## Today");
  419 |       expect(todayContent).toContain("- [ ] Buy milk");
  420 |       expect(yesterdayContent).toContain("- [ ] Buy milk");
  421 |       expect(yesterdayContent).toContain("- [x] Archive receipt");
> 422 |       expect(finalState.messages.at(-1)?.content).toBe(
      |                                                   ^ Error: expect(received).toBe(expected) // Object.is equality
  423 |         writeSuccessSummary(
  424 |           "Moved unchecked tasks from yesterday into today's routine",
  425 |           todayPath,
  426 |         ),
  427 |       );
  428 |     } finally {
  429 |       await rm(vaultRoot, { recursive: true, force: true });
  430 |     }
  431 |   });
  432 | 
  433 |   test("returns a notice when today already exists and the first Obsidian step still chooses create_new", async () => {
  434 |     const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "pa-e2e-mixed-recovery-vault-"));
  435 |     const yesterdayPath = "routine/July/July 4 - Sat.md";
  436 |     const todayPath = "routine/July/July 5 - Sun.md";
  437 |     let sawCreateNotice = false;
  438 | 
  439 |     await mkdir(path.join(vaultRoot, "routine", "July"), { recursive: true });
  440 |     await writeFile(
  441 |       path.join(vaultRoot, yesterdayPath),
  442 |       "## Yesterday\n- [ ] Buy milk\n- [x] Archive receipt\n",
  443 |       "utf8",
  444 |     );
  445 |     await writeFile(path.join(vaultRoot, todayPath), "## Today\n", "utf8");
  446 | 
  447 |     try {
  448 |       const app = makeWorkflowGraph(
  449 |         createRouteSupervisor(),
  450 |         vaultRoot,
  451 |         undefined,
  452 |         undefined,
  453 |         {
  454 |           obsidian: (input) => {
  455 |             const latestMessage = latestInputMessage(input);
  456 | 
  457 |             if (latestMessage instanceof HumanMessage) {
  458 |               return makeToolCallMessage("write_file", {
  459 |                 relativePath: todayPath,
  460 |                 operation: "create_new",
  461 |                 content: "## Today\n",
  462 |                 summary: "Created today's routine note",
  463 |               }, "create-today");
  464 |             }
  465 | 
  466 |             if (latestMessage instanceof ToolMessage) {
  467 |               const toolContent = typeof latestMessage.content === "string"
  468 |                 ? latestMessage.content
  469 |                 : JSON.stringify(latestMessage.content);
  470 | 
  471 |               if (toolContent.includes(`Notice: File already exists at ${todayPath}.`)) {
  472 |                 sawCreateNotice = true;
  473 |                 return makeToolCallMessage("read_file", {
  474 |                   relativePath: yesterdayPath,
  475 |                 }, "read-yesterday-after-notice");
  476 |               }
  477 | 
  478 |               if (toolContent.includes("- [ ] Buy milk") && !toolContent.startsWith("Success:")) {
  479 |                 return makeToolCallMessage("write_file", {
  480 |                   relativePath: todayPath,
  481 |                   operation: "append",
  482 |                   content: "- [ ] Buy milk",
  483 |                   summary: "Moved unchecked tasks from yesterday into today's routine",
  484 |                 }, "append-after-read");
  485 |               }
  486 | 
  487 |               return obsidianDoneResponse();
  488 |             }
  489 | 
  490 |             return obsidianDoneResponse();
  491 |           },
  492 |         },
  493 |       );
  494 | 
  495 |       const finalState = await app.invoke(
  496 |         {
  497 |           messages: [new HumanMessage("create a note for today, move unchecked todos from yesterday's note")],
  498 |         },
  499 |         workflowConfig,
  500 |       );
  501 | 
  502 |       const todayContent = await readFile(path.join(vaultRoot, todayPath), "utf8");
  503 |       const yesterdayContent = await readFile(path.join(vaultRoot, yesterdayPath), "utf8");
  504 | 
  505 |       expect(sawCreateNotice).toBe(true);
  506 |       expect(todayContent).toContain("## Today");
  507 |       expect(todayContent).toContain("- [ ] Buy milk");
  508 |       expect(yesterdayContent).toContain("- [ ] Buy milk");
  509 |       expect(yesterdayContent).toContain("- [x] Archive receipt");
  510 |       expect(finalState.messages.at(-1)?.content).toBe(
  511 |         writeSuccessSummary(
  512 |           "Moved unchecked tasks from yesterday into today's routine",
  513 |           todayPath,
  514 |         ),
  515 |       );
  516 |     } finally {
  517 |       await rm(vaultRoot, { recursive: true, force: true });
  518 |     }
  519 |   });
  520 | 
  521 |   test("stops the Obsidian loop after the configured maximum number of tool steps", async () => {
  522 |     const loopTestAgents = buildTestRuntimeAgents().map((agent) =>
```