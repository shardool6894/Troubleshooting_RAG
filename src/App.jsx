import { useState } from "react";
import { readPdf, chunkPages, buildIndex, search } from "./rag.js";
import { askClaude } from "./claude.js";
import SourceCard from "./components/SourceCard.jsx";

const EXAMPLES = ["Machine won't start", "Grinding noise", "Overheating", "Oil leak"];
const DANGER = /warning|danger|caution|lockout|high voltage|isolate/i;

export default function App() {
  const [manual, setManual] = useState(null); // { name, info, chunks, index }
  const [question, setQuestion] = useState("");
  const [hits, setHits] = useState(null);
  const [answer, setAnswer] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");

  async function onFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError(""); setBusy(true); setHits(null); setAnswer("");
    try {
      const pages = await readPdf(file, setProgress);
      if (!pages.length) throw new Error("No text could be read from this PDF.");
      const chunks = chunkPages(pages);
      setManual({
        name: file.name,
        info: `${pages.length} pages · ${chunks.length} sections`,
        chunks,
        index: buildIndex(chunks),
      });
    } catch (err) {
      setError(err.message);
    }
    setProgress("");
    setBusy(false);
  }

  async function run(text) {
    const q = (text ?? question).trim();
    if (!q) return;
    setQuestion(q); setError(""); setAnswer("");
    const found = search(q, manual.chunks, manual.index);
    setHits(found);
    if (apiKey && found.length) {
      setBusy(true);
      try { setAnswer(await askClaude(apiKey, q, found)); }
      catch (err) { setError("AI answer failed: " + err.message); }
      setBusy(false);
    }
  }

  const dangerPages = hits
    ? [...new Set(hits.filter((h) => DANGER.test(h.text)).map((h) => h.page))].sort((a, b) => a - b)
    : [];
  const ready = !!manual && !busy;

  return (
    <div className="wrap">
      <div className="hero">
        <h1>🔧 Workshop Troubleshooter</h1>
        <p>Describe the fault. Get the fix straight from your machine manual.</p>
      </div>

      <div className="card">
        <div className="row sp">
          <label className="btn">
            📘 {manual ? "Change manual" : "Upload manual (PDF)"}
            <input type="file" accept="application/pdf" onChange={onFile} hidden />
          </label>
          <span className="muted">
            {manual ? `✅ ${manual.name} · ${manual.info}` : "Step 1: upload your machine manual"}
          </span>
        </div>
        <div className="label">CLAUDE API KEY (OPTIONAL, FOR WRITTEN STEP-BY-STEP ANSWERS)</div>
        <input type="password" placeholder="sk-ant-..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </div>

      <div className="label">QUICK PROBLEMS</div>
      <div className="row">
        {EXAMPLES.map((ex) => (
          <button key={ex} disabled={!ready} onClick={() => run(ex)}>{ex}</button>
        ))}
      </div>

      <div className="label">WHAT'S GOING WRONG?</div>
      <textarea
        rows="3"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="e.g. The lathe spindle makes a grinding noise at high speed"
      />
      <div style={{ margin: "12px 0 20px" }}>
        <button className="primary" disabled={!ready || !question.trim()} onClick={() => run()}>
          {busy && manual ? "Working..." : "🔍 Find solution"}
        </button>
        {progress && <span className="muted" style={{ marginLeft: 12 }}>{progress}</span>}
      </div>

      {error && <div className="card err">{error}</div>}
      {dangerPages.length > 0 && (
        <div className="card warn">
          ⚠️ <b>Safety first.</b> The manual has warnings on page {dangerPages.join(", ")}. Switch off and isolate the machine before starting.
        </div>
      )}
      {answer && (
        <div className="card ok">
          <h3 style={{ marginTop: 0 }}>✅ Suggested solution</h3>
          <div className="ans">{answer}</div>
        </div>
      )}

      {hits && (
        <>
          <h3>📄 From the manual</h3>
          {!hits.length && <div className="card muted">No matching section found. Try different words, e.g. the part name or symptom.</div>}
          {hits.map((h, i) => <SourceCard key={i} hit={h} />)}
          {!apiKey && <p className="muted">Add a Claude API key above to also get a written step-by-step answer.</p>}
        </>
      )}
    </div>
  );
}
