export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json(
    {
      ok: true,
      service: 'puddle',
      phase: 'repository-stabilization'
    },
    {
      headers: {
        'Cache-Control': 'no-store'
      }
    }
  )
}
