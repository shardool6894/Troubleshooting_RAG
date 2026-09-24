# Workshop Troubleshooter

Upload a machine manual (PDF), describe a fault, get the relevant fix with page references.

## Run
    npm install
    npm run dev        # then open the URL it prints (usually http://localhost:5173)

## Structure
- src/rag.js      PDF reading, chunking, BM25 search (the "retrieval")
- src/claude.js   Claude API call (the "generation"), optional
- src/App.jsx     main screen
- src/components/SourceCard.jsx   one matched manual section
