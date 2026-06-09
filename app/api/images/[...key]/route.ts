import path from "node:path";
import { readUpload } from "@/lib/storage";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string[] }> | { key: string[] } }
) {
  const params = await context.params;
  const key = params.key.join("/");

  try {
    const buffer = await readUpload(key);
    const contentType = CONTENT_TYPES[path.extname(key).toLowerCase()] ?? "application/octet-stream";

    return new Response(buffer, {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": contentType,
      },
    });
  } catch {
    return Response.json({ error: "Plant image was not found." }, { status: 404 });
  }
}
