const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Groq retires models often. Override these in .env if a model stops working.
// (Model names aren't secret, so these can stay client-side / VITE_-prefixed.)
const TEXT_MODEL = import.meta.env.VITE_GROQ_MODEL || "openai/gpt-oss-120b";
export const VISION_MODEL = import.meta.env.VITE_GROQ_VISION_MODEL || "qwen/qwen3.6-27b";

// The real API key lives server-side only, in /api/groq.js. This asks the server once,
// on load, whether it has a key configured, so the UI can gracefully degrade without one.
// It's a promise (not a plain boolean) because it's a network call — callers `await` it.
export const groqKeyStatus = fetch("/api/groq-status")
  .then((r) => r.json())
  .then((d) => Boolean(d.hasKey))
  .catch(() => false);

export async function groqChat(model, messages, maxTokens = 1200, extra = {}) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch("/api/groq", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages, max_completion_tokens: maxTokens, temperature: 0.2, ...extra }),
    });
    if (res.status === 429 || res.status >= 500) { await sleep(4000 * attempt); continue; } // rate limit: wait, retry
    const json = await res.json();
    if (res.status === 401 || res.status === 403) {
      const e = new Error(json.error?.message || "Groq API key rejected or not configured on the server.");
      e.fatal = true;
      throw e;
    }
    if (!res.ok) throw new Error(json.error?.message || "Groq request failed");
    return (json.choices[0].message.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  }
  throw new Error("Groq rate limit reached. Wait a minute and try again.");
}

// Generation step of RAG: answer ONLY from the retrieved manual sections
export function askGroq(question, hits) {
  const context = hits.map((h) => `[Page ${h.page}]\n${h.text}`).join("\n\n");
  return groqChat(TEXT_MODEL, [
    {
      role: "system",
      content:
        "You are a workshop troubleshooting assistant. Answer ONLY from the manual excerpts. Reply as plain-text numbered steps (no markdown symbols), cite page numbers, and put safety warnings first. If the excerpts don't contain the answer, say so. Never guess.",
    },
    { role: "user", content: `Manual excerpts:\n${context}\n\nProblem: ${question}` },
  ]);
}