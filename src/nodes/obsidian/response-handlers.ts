/**
 * Response handlers for Obsidian tool results.
 * Pure functions that extract and normalize tool output for the LLM node,
 * decoupling response formatting from LLM orchestration logic.
 */

/**
 * Extract the summary from a successful write_markdown_file response.
 * Format: "Success: {summary} saved to {path}."
 * Returns the extracted summary or the full content if parsing fails.
 */
export const handleWriteMarkdownResult = (
  toolContent: string,
): { summary: string; success: boolean } => {
  const match = toolContent.match(/^Success:\s*(.+?)\s+saved to\s+/);
  if (match?.[1]) {
    let summary = match[1];
    // Ensure summary ends with a period
    if (!summary.endsWith(".")) {
      summary += ".";
    }
    return { summary, success: true };
  }
  return { summary: toolContent, success: false };
};

/**
 * Normalize search_markdown_files results into concise paths.
 * Extracts markdown paths from response text, limits to 3 most relevant matches.
 * Falls back to the raw response or a default message.
 */
export const normalizeSearchResponseText = (
  responseText: string,
  toolContent: string,
): string => {
  const responseLines = responseText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const pathLines = responseLines.filter(
    (line) => line.includes(".md") && line.includes("/"),
  );

  if (pathLines.length > 0) {
    return pathLines.slice(0, 3).join("\n");
  }

  return responseText.length > 0
    ? responseText
    : formatSearchResultFallback(toolContent);
};

/**
 * Format a fallback response when search returns raw results with no path extraction.
 * Returns at most 3 lines from the tool content, or a default message.
 */
export const formatSearchResultFallback = (toolContent: string): string => {
  const matches = toolContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 3);

  return matches.length > 0 ? matches.join("\n") : "No files matched your search.";
};
