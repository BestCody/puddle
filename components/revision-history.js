export function RevisionHistory({ revisions = [], label = 'Revision history' }) {
  return (
    <aside className="revision-card">
      <div className="editor-section-heading"><div><span className="section-pill section-pill-yellow">History</span><h2>{label}</h2></div><strong>{revisions.length}</strong></div>
      {revisions.length ? <ol className="revision-list">{revisions.map((revision) => <li key={revision.id}><strong>Revision {revision.revision_no}</strong><span>{revision.change_source || 'update'}</span><small>{new Date(revision.created_at).toLocaleString()}</small>{revision.note ? <p>{revision.note}</p> : null}</li>)}</ol> : <p className="muted">Each save and publication change will appear here.</p>}
    </aside>
  )
}
