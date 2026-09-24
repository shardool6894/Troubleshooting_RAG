// Retrieval part of RAG: read PDF -> chunk -> index -> search (BM25 keyword ranking)
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";
import { createWorker } from "tesseract.js";
import { groqChat, hasGroqKey, VISION_MODEL } from "./groq.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const STOP = new Set(
  "a an the is are was were of to in on at for and or with it this that my our be by from as not no there has have had do does why how what when machine machines equipment unit problem issue".split(" ")
);
const SUFFIXES = ["ations", "ation", "ings", "ing", "ies", "ied", "ed", "es", "age", "e", "s"];
function stem(w) {
  for (const suf of SUFFIXES) {
    if (w.length - suf.length >= 3 && w.endsWith(suf)) return w.slice(0, -suf.length);
  }
  return w;
}
const tokenize = (s) =>
  s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);

// Words that mean nearly the same thing in a workshop. Edit/extend for your machine!
const SYNONYM_GROUPS = [
  ["noise", "sound", "rattle", "squeal", "squeak", "knock", "grinding", "hum", "buzz", "whine"],
  ["vibration", "vibrate", "vibrating", "shake", "shaking", "wobble", "judder", "unbalance"],
  ["leak", "leakage", "leaking", "drip", "seep", "spill"],
  ["overheat", "overheating", "hot", "heat", "temperature", "thermal", "burning"],
  ["oil", "lubricant", "lubrication", "grease", "lube"],
  ["start", "startup", "ignition", "crank", "stall"],
  ["stop", "shutdown", "halt", "trip", "cutout"],
  ["pressure", "psi", "gauge"],
  ["belt", "pulley", "drive"],
  ["smell", "odor", "odour", "smoke", "fume", "burning"],
  ["broken", "crack", "fracture", "damage", "fault", "failure"],
];
const SYNONYMS = {};
SYNONYM_GROUPS.forEach((group) => {
  const stems = [...new Set(group.map((w) => stem(w)))];
  stems.forEach((st) => { SYNONYMS[st] = [...new Set([...(SYNONYMS[st] || []), ...stems.filter((x) => x !== st)])]; });
});

// ---------- OCR settings ----------
const OCR_LANG = "eng";          // built-in fallback OCR ("eng+hin" for English + Hindi)
const MAX_OCR_WORKERS = 4;       // fallback: pages scanned at the same time
const AI_PARALLEL = 2;           // pages sent to the AI at the same time (Groq free tier has rate limits)

const clean = (t) => t.replace(/\s+/g, " ").trim();
const OCR_PROMPT =
  "Transcribe ALL text on this page exactly as written, including tables (one row per line), warnings and part numbers. Output only the transcription.";

// ---------- Fast path: a vision AI (Groq) reads each scanned page ----------
async function aiOcrPage(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
  canvas.width = 0;
  return groqChat(
    VISION_MODEL,
    [{ role: "user", content: [
      { type: "text", text: OCR_PROMPT },
      { type: "image_url", image_url: { url: dataUrl } },
    ] }],
    3000,
    { reasoning_effort: "none" } // no "thinking" needed for plain transcription
  );
}

// returns the pages the AI could not read (they go to the built-in OCR)
async function aiOcr(pdf, pages, texts, onProgress) {
  const failed = [];
  let next = 0, done = 0, broken = false;
  const run = async () => {
    while (next < pages.length) {
      const n = pages[next++];
      if (broken) { failed.push(n); continue; }
      try {
        const t = clean(await aiOcrPage(pdf, n));
        if (t) texts[n] = t; else failed.push(n);
      } catch (err) {
        if (err.fatal) throw err;
        broken = true; // model unavailable etc.: stop calling it, use the fallback
        failed.push(n);
      }
      onProgress(`AI reading scanned pages: ${++done} of ${pages.length} done...`);
    }
  };
  await Promise.all(Array.from({ length: AI_PARALLEL }, run));
  return failed;
}

// ---------- Fallback: OCR inside the browser (slow, free, offline-ish) ----------
async function browserOcr(pdf, pages, texts, onProgress) {
  let next = 0, done = 0;
  const nWorkers = Math.max(1, Math.min(navigator.hardwareConcurrency || 2, MAX_OCR_WORKERS, pages.length));
  onProgress(`Starting built-in OCR (${nWorkers} workers)...`);
  const run = async () => {
    const worker = await createWorker(OCR_LANG);
    while (next < pages.length) {
      const i = pages[next++];
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      texts[i] = clean((await worker.recognize(canvas)).data.text);
      canvas.width = 0;
      onProgress(`Built-in OCR: ${++done} of ${pages.length} pages done...`);
    }
    await worker.terminate();
  };
  await Promise.all(Array.from({ length: nWorkers }, run));
}

// 1. Read every page as text. Text pages are instant; scanned pages use AI OCR (if a key
//    is given) or the built-in OCR.
export async function readPdf(file, onProgress = () => {}) {
  const bytes = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({
    data: bytes.slice(0),
    isEvalSupported: false, // blocks a known malicious-PDF exploit
  }).promise;
  const texts = {};
  let scanned = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    const text = clean(content.items.map((x) => x.str).join(" "));
    if (text.length < 20) scanned.push(i);
    else texts[i] = text;
    onProgress(`Reading page ${i} of ${pdf.numPages}...`);
  }

  if (scanned.length && hasGroqKey) {
    try {
      scanned = await aiOcr(pdf, scanned, texts, onProgress);
    } catch (err) {
      if (err.fatal) throw err;
      onProgress("AI OCR unavailable, switching to built-in OCR...");
    }
  }
  if (scanned.length) await browserOcr(pdf, scanned, texts, onProgress);

  return Object.keys(texts).map(Number).sort((x, y) => x - y)
    .filter((i) => texts[i]).map((i) => ({ page: i, text: texts[i] }));
}

// 2. Split pages into overlapping chunks
export function chunkPages(pages, size = 900, overlap = 150) {
  const chunks = [];
  pages.forEach((p) => {
    for (let s = 0; s < p.text.length; s += size - overlap) {
      chunks.push({ page: p.page, text: p.text.slice(s, s + size) });
    }
  });
  return chunks;
}

// 3. Build the search index
export function buildIndex(chunks) {
  const docs = chunks.map((c) => tokenize(c.text));
  const df = {};
  docs.forEach((d) => new Set(d).forEach((t) => (df[t] = (df[t] || 0) + 1)));
  const avg = docs.reduce((s, d) => s + d.length, 0) / docs.length;
  return { docs, df, avg, N: docs.length };
}

// 4. Find the best chunks for a problem description
export function search(question, chunks, index, k = 4) {
  // user's own words count fully; synonyms count less
  const weights = new Map();
  tokenize(question).forEach((t) => weights.set(t, 1));
  [...weights.keys()].forEach((t) =>
    (SYNONYMS[t] || []).forEach((sy) => { if (!weights.has(sy)) weights.set(sy, 0.4); })
  );

  const ranked = index.docs
    .map((doc, i) => {
      const tf = {};
      doc.forEach((t) => (tf[t] = (tf[t] || 0) + 1));
      let score = 0;
      weights.forEach((w, t) => {
        if (!tf[t]) return;
        const idf = Math.log(1 + (index.N - index.df[t] + 0.5) / (index.df[t] + 0.5));
        score += w * ((idf * tf[t] * 2.5) / (tf[t] + 1.5 * (0.25 + (0.75 * doc.length) / index.avg)));
      });
      return { ...chunks[i], score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .filter((h) => h.score > 0);
  const max = ranked[0]?.score || 1;
  return ranked.map((h) => ({ ...h, pct: Math.round((h.score / max) * 100) }));
}
