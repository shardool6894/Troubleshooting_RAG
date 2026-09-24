import { useState, useEffect, useRef } from "react";
import { readPdf, chunkPages, buildIndex, search } from "./rag.js";
import { askGroq, groqKeyStatus } from "./groq.js";
import SourceCard from "./components/SourceCard.jsx";

const EXAMPLES = ["Machine won't start", "Wire slipping", "Cooling", "Error H44"];
const DANGER = /warning|danger|caution|lockout|high voltage|isolate/i;

export default function App() {
  const [manual, setManual] = useState(null); // { name, info, chunks, index }
  const [question, setQuestion] = useState("");
  const [hits, setHits] = useState(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [preloaded, setPreloaded] = useState(null);
  const [preloadedChecked, setPreloadedChecked] = useState(false); // true once we know whether demo data is available
  const [hasAI, setHasAI] = useState(true); // optimistic default; corrected once the server status check resolves
  const intervalRef = useRef(null); // tracks the fake-progress interval so we can clear it safely

  function loadPages(name, pages) {
    const chunks = chunkPages(pages);
    setManual({ name, pages, info: `${pages.length} pages · ${chunks.length} sections`, chunks, index: buildIndex(chunks) });
  }

  // If public/manual.json exists (deployed site), load it instantly
  useEffect(() => {
    fetch("/manual.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((pages) => {
        if (Array.isArray(pages) && pages.length && pages[0].text) {
          setPreloaded(pages);
        }
      })
      .catch(() => {})
      .finally(() => setPreloadedChecked(true)); // upload stays disabled until this resolves, avoiding the race
  }, []);

  // Ask the server (never the client) whether AI features are actually available
  useEffect(() => {
    groqKeyStatus.then(setHasAI);
  }, []);

  // Clean up any in-flight fake-progress interval if the component unmounts mid-run
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  async function onFile(e) {
    const file = e.target.files[0];
    if (!file || busy || !preloadedChecked) return;
    setError(""); setBusy(true); setHits(null); setAnswer("");

    // Defensively clear any leftover interval from a previous run before starting a new one
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (preloaded) {
      setProgress("Reading PDF...");
      setTimeout(() => {
        let currentPage = 1;
        const totalPages = preloaded.length;
        intervalRef.current = setInterval(() => {
          setProgress(`Reading PDF... page ${currentPage} of ${totalPages}`);
          if (currentPage >= totalPages) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
            setTimeout(() => {
              loadPages(file.name, preloaded);
              setProgress("");
              setBusy(false);
            }, 300);
          } else {
            currentPage++;
          }
        }, 700);
      }, 600);
      return;
    }
    try {
      const pages = await readPdf(file, setProgress);
      if (!pages.length) throw new Error("No text could be read from this PDF.");
      loadPages(file.name, pages);
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
    if (hasAI && found.length) {
      setBusy(true);
      try { setAnswer(await askGroq(q, found)); }
      catch (err) { setError("AI answer failed: " + err.message); }
      setBusy(false);
    }
  }

  const dangerPages = hits
    ? [...new Set(hits.filter((h) => DANGER.test(h.text)).map((h) => h.page))].sort((a, b) => a - b)
    : [];
  const ready = !!manual && !busy;
  const uploadDisabled = busy || !preloadedChecked;

  return (
    <div className="wrap">
      <div className="hero">
        <h1>🔧 YANTRA </h1>
        <p>Describe the fault. Get the fix straight from your machine manual.</p>
      </div>

      <div className="card">
        <div className="row sp">
          <label
            className="btn"
            style={uploadDisabled ? { opacity: 0.5, pointerEvents: "none" } : undefined}
          >
            📘 {manual ? "Change manual" : preloadedChecked ? "Upload manual (PDF)" : "Preparing..."}
            <input type="file" accept="application/pdf" onChange={onFile} hidden disabled={uploadDisabled} />
          </label>
          <span className="muted">
            {manual ? `✅ ${manual.name} · ${manual.info}` : "Step 1: upload your machine manual"}
          </span>
        </div>
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
          {!hasAI && <p className="muted">AI answers are off: the server has no Groq key configured.</p>}
        </>
      )}
    </div>
  );
}