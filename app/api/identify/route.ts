import { cleanFilename, saveUpload } from "@/lib/storage";

type PlantNetCandidate = {
  scientificName: string;
  commonName: string | null;
  family: string | null;
  score: number;
};

type PlantNetResult = {
  score?: number;
  species?: {
    scientificName?: string;
    scientificNameWithoutAuthor?: string;
    scientificNameAuthorship?: string;
    commonNames?: string[];
    family?: {
      scientificName?: string;
      scientificNameWithoutAuthor?: string;
    };
  };
};

export const runtime = "nodejs";

const PLANTNET_ENDPOINT = "https://my-api.plantnet.org/v2/identify/all";
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function normalizeOrgan(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return "leaf";
  }

  return ["leaf", "flower", "fruit", "bark", "habit", "other"].includes(value)
    ? value
    : "leaf";
}

function mapPlantNetResults(results: PlantNetResult[]): PlantNetCandidate[] {
  return results.slice(0, 6).map((result) => {
    const species = result.species ?? {};
    const scientificName =
      [species.scientificNameWithoutAuthor, species.scientificNameAuthorship]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      species.scientificName ||
      "Unknown species";
    const family = species.family?.scientificNameWithoutAuthor ?? species.family?.scientificName ?? null;
    const score = Math.round(Math.max(0, Math.min(1, result.score ?? 0)) * 1000) / 10;

    return {
      scientificName,
      commonName: species.commonNames?.[0] ?? null,
      family,
      score,
    };
  });
}

async function identifyWithPlantNet(
  imageBuffer: ArrayBuffer,
  image: File,
  organ: string,
  apiKey: string
) {
  const url = new URL(PLANTNET_ENDPOINT);
  url.searchParams.set("api-key", apiKey);
  url.searchParams.set("include-related-images", "true");
  url.searchParams.set("lang", "en");

  const form = new FormData();
  form.append("images", new Blob([imageBuffer], { type: image.type }), cleanFilename(image.name));
  form.append("organs", organ);

  const response = await fetch(url, {
    method: "POST",
    body: form,
  });
  const body = (await response.json().catch(() => ({}))) as {
    results?: PlantNetResult[];
    message?: string;
  };

  if (!response.ok) {
    throw new Error(body.message ?? `PlantNet returned HTTP ${response.status}`);
  }

  return mapPlantNetResults(body.results ?? []);
}

export async function POST(request: Request) {
  const form = await request.formData();
  const image = form.get("image");
  const organ = normalizeOrgan(form.get("organ"));

  if (!(image instanceof File)) {
    return Response.json({ error: "A plant photo is required." }, { status: 400 });
  }

  if (!ALLOWED_IMAGE_TYPES.has(image.type)) {
    return Response.json(
      { error: "Use a JPEG, PNG, or WebP plant photo." },
      { status: 400 }
    );
  }

  const imageBuffer = await image.arrayBuffer();
  const saved = await saveUpload(image, imageBuffer, organ);
  const apiKey = process.env.PLANTNET_API_KEY;

  if (!apiKey) {
    return Response.json({
      status: "missing-token",
      message: "PLANTNET_API_KEY is not configured yet.",
      ...saved,
      candidates: [],
    });
  }

  try {
    const candidates = await identifyWithPlantNet(imageBuffer, image, organ, apiKey);

    return Response.json({
      status: candidates.length ? "identified" : "no-match",
      ...saved,
      candidates,
    });
  } catch (error) {
    console.error(error);
    return Response.json(
      {
        status: "provider-error",
        message: error instanceof Error ? error.message : "PlantNet identification failed.",
        ...saved,
        candidates: [],
      },
      { status: 502 }
    );
  }
}
