import pg from 'pg'

export function validateSelfHostDatabaseUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('PUDDLE_SELF_HOST_DB_URL must be a PostgreSQL connection URL.') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.pathname.slice(1) || url.search || url.hash) {
    throw new Error('PUDDLE_SELF_HOST_DB_URL must contain a database and user, without URL options.')
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('The backfill accepts only the self-hosted Postgres loopback listener; use an SSH tunnel if needed.')
  }
  return url.toString()
}

export async function connectSelfHostPostgres({ connectionString, ClientType = pg.Client }) {
  const client = new ClientType({
    connectionString: validateSelfHostDatabaseUrl(connectionString),
    ssl: false,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
    application_name: 'puddle-location-ref-backfill'
  })
  await client.connect()
  return {
    querySql: async (query, parameters = []) => (await client.query(query, parameters)).rows,
    close: () => client.end()
  }
}
