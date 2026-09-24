// Generation part of RAG: ask Claude to answer using ONLY the retrieved chunks
export async function askClaude(apiKey, question, hits) {
  const context = hits.map((h) => `[Page ${h.page}]\n${h.text}`).join("\n\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      system:
        "You are a workshop troubleshooting assistant. Answer ONLY from the manual excerpts. Reply as plain-text numbered steps (no markdown symbols), cite page numbers, and put safety warnings first. If the excerpts don't contain the answer, say so. Never guess.",
      messages: [{ role: "user", content: `Manual excerpts:\n${context}\n\nProblem: ${question}` }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Request failed");
  return data.content[0].text;
}
