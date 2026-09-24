export default function handler(req, res) {
  return res.status(200).json({ hasKey: Boolean(process.env.GROQ_API_KEY) });
}