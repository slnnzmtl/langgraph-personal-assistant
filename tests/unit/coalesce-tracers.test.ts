import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import { describe, expect, it } from "vitest";

import { coalesceLangChainTracers } from "../../src/core/tracing/coalesce-tracers.js";

describe("coalesceLangChainTracers", () => {
  it("collapses duplicate tracer copies that share run bookkeeping", () => {
    const source = new LangChainTracer({ metadata: { tenant: "demo" } });
    const duplicate = source.copyWithTracingConfig({ metadata: { thread_id: "abc" } });

    const coalesced = coalesceLangChainTracers([source, duplicate], [duplicate, source]);

    expect(coalesced.handlers).toHaveLength(1);
    expect(coalesced.inheritableHandlers).toHaveLength(1);
    expect(coalesced.handlers[0]).toBe(coalesced.inheritableHandlers[0]);
    expect(coalesced.handlers[0]).toBeInstanceOf(LangChainTracer);
    expect((coalesced.handlers[0] as LangChainTracer).tracingMetadata).toMatchObject({
      tenant: "demo",
      thread_id: "abc",
    });
  });

  it("keeps independent tracers with separate run stores", () => {
    const first = new LangChainTracer({ metadata: { tenant: "one" } });
    const second = new LangChainTracer({ metadata: { tenant: "two" } });

    const coalesced = coalesceLangChainTracers([first], [second]);

    expect(coalesced.handlers).toHaveLength(1);
    expect(coalesced.inheritableHandlers).toHaveLength(1);
    expect(coalesced.handlers[0]).not.toBe(coalesced.inheritableHandlers[0]);
  });
});
