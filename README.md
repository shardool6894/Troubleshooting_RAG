# Workshop Troubleshooter

A web app that lets workshop staff describe a machine problem in plain words and get the
relevant fix straight from the machine's own manual — instead of having to read the whole
manual themselves.

Upload the manual once (PDF, including scanned copies). Type a problem. Get the matching
manual sections with page numbers, plus an optional AI-written, step-by-step answer.

---

## How it works (RAG in three steps)

1. **Read** — the manual is split into overlapping text sections ("chunks"), one per part
   of a page. Scanned pages with no text layer are read by an AI vision model.
2. **Retrieve** — when a problem is typed, the app scores every chunk by how well its words
   (and known synonyms) match the problem, and keeps the best few.
3. **Generate** — those chunks, and only those chunks, are handed to an AI model with the
   instruction "answer using only this text." The model replies with numbered steps and page
   references. Safety warnings are always surfaced first.

This is what "RAG" (Retrieval-Augmented Generation) means: the AI never answers from general
knowledge, only from the manual it was given.

---

## Live architecture

```
┌────────────────────────────────┐        ┌────────────────────────────────┐
│   Your browser                 │        │      Groq cloud (AI service)   │
│                                │        │      runs on Groq's computers  │
│                                │        │                                │
│  • Reads the PDF (PDF.js)      │◄──────►│  • Reads scanned pages         │
│  • Finds matching pages        │        │    (vision model)              │
│    (keyword search, BM25)      │        │  • Writes the answer           │
│                                │        │    (text model)                │
└────────────────────────────────┘        └────────────────────────────────┘
```

## Tech stack, in plain terms

| Piece | What it does |
|---|---|
| **React** | Builds the buttons, boxes and text on the page — the visual building blocks. |
| **Vite** | Packages all the code into one fast website and runs it during development. |
| **PDF.js** (`pdfjs-dist`) | Lets the browser open and read a PDF, the way Adobe Reader would. |
| **Tesseract.js** | A free, in-browser "reading robot" for scanned pages — the backup plan if Groq is unavailable. |
| **Groq API** | A cloud service that runs AI models very fast. Sent a problem and manual text, it writes the answer; sent a page image, it transcribes it. |
| **BM25** (hand-written, in `rag.js`) | The scoring method that ranks manual sections by how well they match a typed problem. |
| **Vercel** | Hosts the finished website and gives it a public link, for free. |

---

## Project structure

```
## Project structure

workshop-troubleshooter/
├── index.html              Page shell
├── package.json             Dependencies and scripts
├── package-lock.json          Locked dependency versions
├── vite.config.js            Build configuration
├── .env                        Your Groq API key (not committed to git)
├── .gitignore                  Keeps node_modules, dist and .env out of git
├── README.md                    Project documentation
├── api/                          Vercel serverless functions (run on Vercel's server, not the browser)
│   ├── groq.js                    Likely a backend proxy for Groq calls — this is what
│   │                               keeps the API key hidden from visitors, instead of
│   │                               calling Groq directly from the browser
│   └── groq-status.js              Likely a health-check endpoint, e.g. to confirm the
│                                    key works or report Groq's availability
├── public/                        Static files served as-is (e.g. a preloaded manual.json,
│                                   favicon) — content depends on what you've put here
└── src/
    ├── main.jsx                 Entry point — mounts the app
    ├── App.jsx                   Main screen: upload, search box, results
    ├── rag.js                     PDF reading, chunking, BM25 search, scanned-page OCR
    ├── groq.js                     Client-side Groq calls — check whether this is now
    │                               unused, since api/groq.js may have replaced it
    ├── index.css                   Styling (dark, workshop-orange theme)
    └── components/
        └── SourceCard.jsx           Displays one matched manual section
---

## Setup

### 1. Install
```bash
npm install
```

### 2. Add your Groq API key
```bash
cp .env.example .env        # Windows: copy .env.example .env
```
Open `.env` and set:
```
VITE_GROQ_API_KEY=gsk_your_key_here
```
Get a free key at [console.groq.com/keys](https://console.groq.com/keys).

### 3. Run it
```bash
npm run dev
```
Open the URL it prints (usually `http://localhost:5173`), upload a manual PDF, and type a
problem.

Without a key, the app still works — it shows the matching manual passages and page numbers,
just without the AI-written answer, and scanned pages fall back to the slower in-browser OCR.

### 4. Build for production
```bash
npm run build      # output goes to dist/
```

---

## Deploying to Vercel

1. Push the project to GitHub (or use `vercel` CLI directly from the folder).
2. Import it at [vercel.com/new](https://vercel.com/new) — Vercel detects Vite automatically.
3. Under **Project Settings → Environment Variables**, add `VITE_GROQ_API_KEY`, then redeploy.

Keep `package-lock.json` in the repo — it pins exact dependency versions so the deployed
build matches what was tested locally.

---

## Configuration

Set these in `.env` (see `.env.example`):

| Variable | Required | Default | Purpose |
| `VITE_GROQ_API_KEY`       | For AI answers |          —            | Your Groq API key |
| `VITE_GROQ_MODEL`         | No             | `openai/gpt-oss-120b` | Model used to write answers |
| `VITE_GROQ_VISION_MODEL`  | No             | `qwen/qwen3.6-27b`    | Model used to read scanned pages |

Groq periodically retires models; if either default stops working, check
[console.groq.com/docs/models](https://console.groq.com/docs/models) for the current
replacement and set it here — no code changes needed.

---

## Known limitations & future work

- **Keyword search, not meaning-based.** The search matches words (and a small built-in
  synonym list in `rag.js`), so wording very different from the manual's own terms can miss.
  A future upgrade would use embeddings for true meaning-based matching.
- **API key is visible in the browser.** Fine for a demo; a production version should add a
  small backend server (e.g. Python + FastAPI) to keep the key private and let one server
  support several manuals.
- **Groq's free tier is rate-limited.** Large manuals with many scanned pages may be slow or
  partially fall back to in-browser OCR under heavy use.
- **Scan quality matters.** Blurry or tilted scans reduce accuracy for both the AI reader and
  the backup OCR.
- **Contingency for unreadable or physical-only manuals:** re-scan using a proper flatbed/
  sheet-fed scanner, or a phone scanning app (Adobe Scan, Google Drive scan), before
  uploading — this alone usually fixes poor text extraction.

---