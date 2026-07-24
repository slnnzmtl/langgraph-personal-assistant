import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import {
  CAPTIONLESS_PHOTO_BOILERPLATE,
  findLatestHumanMessageText,
  findLatestSubstantiveHumanMessageText,
} from "../../src/core/supervisor/reply-helpers.js";

describe("findLatestSubstantiveHumanMessageText", () => {
  it("skips captionless photo boilerplate and returns the latest real request", () => {
    const messages = [
      new HumanMessage(CAPTIONLESS_PHOTO_BOILERPLATE),
      new HumanMessage("Parse text from the screenshots and replace the natal card in Лerочka."),
    ];

    expect(findLatestSubstantiveHumanMessageText(messages)).toBe(
      "Parse text from the screenshots and replace the natal card in Лerочka.",
    );
  });

  it("falls back to the latest human text when every turn is boilerplate", () => {
    const messages = [
      new HumanMessage(CAPTIONLESS_PHOTO_BOILERPLATE),
      new HumanMessage(CAPTIONLESS_PHOTO_BOILERPLATE),
    ];

    expect(findLatestSubstantiveHumanMessageText(messages)).toBe(CAPTIONLESS_PHOTO_BOILERPLATE);
    expect(findLatestHumanMessageText(messages)).toBe(CAPTIONLESS_PHOTO_BOILERPLATE);
  });

  it("returns path clarifications after boilerplate photo turns", () => {
    const messages = [
      new HumanMessage(CAPTIONLESS_PHOTO_BOILERPLATE),
      new HumanMessage("people/лерочка"),
    ];

    expect(findLatestSubstantiveHumanMessageText(messages)).toBe("people/лерочка");
  });
});
