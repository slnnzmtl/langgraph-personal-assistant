import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";

type TracerWithRunStore = LangChainTracer & {
  runTreeMap: Map<string, unknown>;
};

const getTracerRunStoreKey = (tracer: LangChainTracer): object => {
  const candidate = tracer as TracerWithRunStore;
  return candidate.runTreeMap ?? tracer;
};

const mergeTracerConfig = (
  target: LangChainTracer,
  source: LangChainTracer,
): LangChainTracer => {
  if (target === source) {
    return target;
  }

  return target.copyWithTracingConfig({
    ...(source.tracingMetadata ? { metadata: source.tracingMetadata } : {}),
    ...(source.tracingTags.length > 0 ? { tags: source.tracingTags } : {}),
  });
};

export const coalesceLangChainTracers = (
  handlers: BaseCallbackHandler[],
  inheritableHandlers: BaseCallbackHandler[],
): {
  handlers: BaseCallbackHandler[];
  inheritableHandlers: BaseCallbackHandler[];
} => {
  const groups = new Map<object, { index: number; tracer: LangChainTracer }>();
  const coalescedHandlers: BaseCallbackHandler[] = [];

  for (const handler of handlers) {
    if (!(handler instanceof LangChainTracer)) {
      coalescedHandlers.push(handler);
      continue;
    }

    const key = getTracerRunStoreKey(handler);
    const group = groups.get(key);

    if (group === undefined) {
      groups.set(key, {
        index: coalescedHandlers.length,
        tracer: handler,
      });
      coalescedHandlers.push(handler);
      continue;
    }

    group.tracer = mergeTracerConfig(group.tracer, handler);
    coalescedHandlers[group.index] = group.tracer;
  }

  const seenTracerStores = new Set<object>();
  const coalescedInheritableHandlers = inheritableHandlers.flatMap((handler) => {
    if (!(handler instanceof LangChainTracer)) {
      return [handler];
    }

    const key = getTracerRunStoreKey(handler);
    if (seenTracerStores.has(key)) {
      return [];
    }

    seenTracerStores.add(key);
    return [groups.get(key)?.tracer ?? handler];
  });

  return {
    handlers: coalescedHandlers,
    inheritableHandlers: coalescedInheritableHandlers,
  };
};
