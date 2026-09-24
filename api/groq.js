// Server-side proxy: the browser calls this instead of api.groq.com directly,
// so GROQ_API_KEY never ships in the client bundle.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: { message: "Method not allowed" } });
  }

  const KEY = process.env.GROQ_API_KEY; // plain env var, no VITE_ prefix — server only
  if (!KEY) {
    // 401 here (not 500) so the client's existing "fatal, don't retry" branch handles it
    // instead of getting treated as a transient rate limit.
    return res.status(401).json({
      error: { message: "GROQ_API_KEY is not set in the Vercel project's environment variables." },
    });
  }

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify(req.body),
    });
    const data = await groqRes.json();
    return res.status(groqRes.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: { message: err.message || "Groq proxy request failed" } });
  }
}