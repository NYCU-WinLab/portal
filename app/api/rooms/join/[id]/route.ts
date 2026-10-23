// Invites mailed by the old portal link here; the page lives at /rooms/join.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  return Response.redirect(
    `${process.env.BETTER_AUTH_URL}/rooms/join/${encodeURIComponent(id)}`,
    308
  )
}
