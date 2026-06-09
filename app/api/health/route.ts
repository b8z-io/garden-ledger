export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    ok: true,
    service: "garden-ledger",
    time: new Date().toISOString(),
  });
}
