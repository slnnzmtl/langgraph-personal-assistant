import { tool } from "@langchain/core/tools";
import * as cheerio from "cheerio";
import { z } from "zod";

const MAX_RESULTS = 5;

export const webSearchTool = tool(
  async ({ query }: { query: string }) => {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
      },
    );

    if (!res.ok) {
      throw new Error(`DuckDuckGo search failed with status ${res.status}`);
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const results = $(".result__body")
      .slice(0, MAX_RESULTS)
      .map((_, el) => ({
        title: $(el).find(".result__a").text().trim(),
        url: $(el).find(".result__a").attr("href") ?? "",
        snippet: $(el).find(".result__snippet").text().trim(),
      }))
      .get();

    if (results.length === 0) {
      return `No results for: ${query}`;
    }

    return results
      .map((result, index) => `${index + 1}. ${result.title}\n${result.url}\n${result.snippet}`)
      .join("\n\n");
  },
  {
    name: "web_search",
    description: "Search the public web via DuckDuckGo.",
    schema: z.object({ query: z.string() }),
  },
);
