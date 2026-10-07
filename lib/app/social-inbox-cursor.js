export function lastInboxCursor(rows) {
  const last = Array.isArray(rows) ? rows.at(-1) : null
  return last?.sort_at && last?.conversation_id
    ? { sort_at: last.sort_at, conversation_id: last.conversation_id }
    : null
}
