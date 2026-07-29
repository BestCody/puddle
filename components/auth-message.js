export async function AuthMessage({ searchParams }) {
  const params = await searchParams
  const error = params?.error
  const success = params?.success
  if (!error && !success) return null
  return <p className={`auth-message ${error ? 'is-error' : 'is-success'}`}>{error || success}</p>
}
