import { CallbackManager } from "@langchain/core/callbacks/manager";

import { coalesceLangChainTracers } from "./coalesce-tracers.js";

type ConfigureSync = typeof CallbackManager._configureSync;

let patched = false;

const patchCallbackManagerHandlers = (manager: CallbackManager): CallbackManager => {
  const coalesced = coalesceLangChainTracers(
    manager.handlers,
    manager.inheritableHandlers,
  );
  manager.handlers = coalesced.handlers;
  manager.inheritableHandlers = coalesced.inheritableHandlers;
  return manager;
};

/**
 * Work around langchain-ai/langchainjs#11189: nested compiled-graph invokes
 * configure duplicate LangChainTracer copies that share run bookkeeping, which
 * makes the second copy log "No chain run to end" on every end event.
 */
export const patchCallbackManagerForNestedTracing = (): void => {
  if (patched) {
    return;
  }

  const originalConfigureSync = CallbackManager._configureSync.bind(CallbackManager) as ConfigureSync;

  CallbackManager._configureSync = (
    inheritableHandlers,
    localHandlers,
    inheritableTags,
    localTags,
    inheritableMetadata,
    localMetadata,
    options,
  ) => {
    const manager = originalConfigureSync(
      inheritableHandlers,
      localHandlers,
      inheritableTags,
      localTags,
      inheritableMetadata,
      localMetadata,
      options,
    );

    if (!manager) {
      return manager;
    }

    return patchCallbackManagerHandlers(manager);
  };

  patched = true;
};
