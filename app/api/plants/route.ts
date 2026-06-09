import {
  deletePlant,
  deleteUpload,
  insertPlant,
  listPlants,
  toClientPlant,
  updatePlant,
  type IdentificationCandidate,
  type PlantSource,
} from "@/lib/storage";

type PlantPayload = Partial<{
  nickname: string;
  commonName: string;
  scientificName: string;
  family: string;
  cultivar: string;
  source: PlantSource;
  passportRaw: string;
  passportBotanical: string;
  passportTraceability: string;
  passportOrigin: string;
  passportOperator: string;
  qrPayload: string;
  nursery: string;
  gardenLocation: string;
  plantedOn: string;
  careNotes: string;
  identificationConfidence: number;
  identificationCandidates: IdentificationCandidate[];
  imageKey: string;
  imageContentType: string;
  imageFilename: string;
}>;

const SOURCES: PlantSource[] = ["passport", "qr", "photo", "manual"];

export const runtime = "nodejs";

function cleanText(value: unknown, maxLength = 500) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function cleanLongText(value: unknown, maxLength = 4000) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function cleanSource(value: unknown): PlantSource {
  return SOURCES.includes(value as PlantSource) ? (value as PlantSource) : "manual";
}

function cleanConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(100, value));
}

function cleanCandidates(value: unknown): IdentificationCandidate[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const candidates = value
    .map((candidate) => {
      if (!candidate || typeof candidate !== "object") {
        return null;
      }

      const item = candidate as Partial<IdentificationCandidate>;
      const scientificName = cleanText(item.scientificName, 180);
      if (!scientificName) {
        return null;
      }

      return {
        scientificName,
        commonName: cleanText(item.commonName, 140),
        family: cleanText(item.family, 140),
        score: cleanConfidence(item.score) ?? 0,
      };
    })
    .filter((candidate): candidate is IdentificationCandidate => Boolean(candidate))
    .slice(0, 8);

  return candidates.length ? candidates : null;
}

function storageError(error: unknown) {
  console.error(error);
  return Response.json(
    {
      error:
        "Garden storage is unavailable. Check that the container has write access to DATA_DIR.",
      plants: [],
    },
    { status: 503 }
  );
}

function cleanPayload(payload: PlantPayload, id: string, now: string) {
  const nickname =
    cleanText(payload.nickname, 120) ??
    cleanText(payload.commonName, 120) ??
    cleanText(payload.scientificName, 120) ??
    "Unnamed plant";

  return {
    id,
    updatedAt: now,
    nickname,
    commonName: cleanText(payload.commonName, 140),
    scientificName: cleanText(payload.scientificName, 180),
    family: cleanText(payload.family, 140),
    cultivar: cleanText(payload.cultivar, 140),
    source: cleanSource(payload.source),
    passportRaw: cleanLongText(payload.passportRaw),
    passportBotanical: cleanText(payload.passportBotanical, 180),
    passportTraceability: cleanText(payload.passportTraceability, 180),
    passportOrigin: cleanText(payload.passportOrigin, 120),
    passportOperator: cleanText(payload.passportOperator, 180),
    qrPayload: cleanLongText(payload.qrPayload),
    nursery: cleanText(payload.nursery, 180),
    gardenLocation: cleanText(payload.gardenLocation, 160),
    plantedOn: cleanText(payload.plantedOn, 32),
    careNotes: cleanLongText(payload.careNotes),
    identificationConfidence: cleanConfidence(payload.identificationConfidence),
    identificationCandidates: cleanCandidates(payload.identificationCandidates),
    imageKey: cleanText(payload.imageKey, 500),
    imageContentType: cleanText(payload.imageContentType, 80),
    imageFilename: cleanText(payload.imageFilename, 220),
  };
}

export async function GET() {
  try {
    return Response.json({ plants: listPlants().map(toClientPlant) });
  } catch (error) {
    return storageError(error);
  }
}

export async function POST(request: Request) {
  let payload: PlantPayload;

  try {
    payload = (await request.json()) as PlantPayload;
  } catch {
    return Response.json({ error: "Plant data was not valid JSON." }, { status: 400 });
  }

  const now = new Date().toISOString();

  try {
    const plant = insertPlant({
      ...cleanPayload(payload, crypto.randomUUID(), now),
      createdAt: now,
    });

    return Response.json({ plant: toClientPlant(plant) }, { status: 201 });
  } catch (error) {
    return storageError(error);
  }
}

export async function PATCH(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return Response.json({ error: "Plant id is required." }, { status: 400 });
  }

  let payload: PlantPayload;

  try {
    payload = (await request.json()) as PlantPayload;
  } catch {
    return Response.json({ error: "Plant data was not valid JSON." }, { status: 400 });
  }

  try {
    const plant = updatePlant(cleanPayload(payload, id, new Date().toISOString()));
    return Response.json({ plant: toClientPlant(plant) });
  } catch (error) {
    return storageError(error);
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return Response.json({ error: "Plant id is required." }, { status: 400 });
  }

  try {
    const removed = deletePlant(id);
    await deleteUpload(removed?.imageKey ?? null);
    return Response.json({ ok: true });
  } catch (error) {
    return storageError(error);
  }
}
