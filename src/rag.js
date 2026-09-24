// Retrieval part of RAG: read PDF -> chunk -> index -> search (BM25 keyword ranking)
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";
import { createWorker } from "tesseract.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const STOP = new Set(
  "a an the is are was were of to in on at for and or with it this that my our be by from as not no there has have had do does why how what when".split(" ")
);
const tokenize = (s) =>
  s.toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => w.replace(/(ing|ed|es|s)$/, ""));

// Language(s) for scanned pages. Use "eng+hin" for English + Hindi, etc.
const OCR_LANG = "eng";

// 1. Read every page of the PDF as text. Pages with no text layer (scans) are OCR'd.
export async function readPdf(file, onProgress = () => {}) {
  const pdf = await pdfjsLib.getDocument({
    data: await file.arrayBuffer(),
    isEvalSupported: false, // blocks a known malicious-PDF exploit
  }).promise;
  const pages = [];
  let ocr = null; // OCR engine is created only if a scanned page is found

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let text = content.items.map((x) => x.str).join(" ").replace(/\s+/g, " ").trim();

    if (text.length < 20) {
      onProgress(`Scanning page ${i} of ${pdf.numPages} (OCR, please wait)...`);
      if (!ocr) ocr = await createWorker(OCR_LANG);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const { data } = await ocr.recognize(canvas);
      text = data.text.replace(/\s+/g, " ").trim();
    } else {
      onProgress(`Reading page ${i} of ${pdf.numPages}...`);
    }
    if (text) pages.push({ page: i, text });
  }
  if (ocr) await ocr.terminate();
  return pages;
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
  const terms = [...new Set(tokenize(question))];
  const ranked = index.docs
    .map((doc, i) => {
      const tf = {};
      doc.forEach((t) => (tf[t] = (tf[t] || 0) + 1));
      let score = 0;
      terms.forEach((t) => {
        if (!tf[t]) return;
        const idf = Math.log(1 + (index.N - index.df[t] + 0.5) / (index.df[t] + 0.5));
        score += (idf * tf[t] * 2.5) / (tf[t] + 1.5 * (0.25 + (0.75 * doc.length) / index.avg));
      });
      return { ...chunks[i], score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .filter((h) => h.score > 0);
  const max = ranked[0]?.score || 1;
  return ranked.map((h) => ({ ...h, pct: Math.round((h.score / max) * 100) }));
}
