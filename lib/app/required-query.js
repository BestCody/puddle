export async function requiredQuery(query) {
  const { data, error } = await query
  if (error) throw error
  return data
}
