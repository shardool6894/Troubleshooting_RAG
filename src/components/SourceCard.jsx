export default function SourceCard({ hit }) {
  return (
    <div className="card">
      <div className="row sp">
        <span className="badge">Page {hit.page}</span>
        <span className="muted">Relevance {hit.pct}%</span>
      </div>
      <div className="bar"><div style={{ width: `${hit.pct}%` }} /></div>
      <div className="src">{hit.text}</div>
    </div>
  );
}
