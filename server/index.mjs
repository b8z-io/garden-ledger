import { existsSync, mkdirSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const isDev = process.argv.includes("--dev");
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const distDir = path.join(rootDir, "dist");
const publicDir = path.join(rootDir, "public");

const SOURCE_VALUES = new Set(["passport", "qr", "photo", "manual"]);
const PLANTNET_ENDPOINT = "https://my-api.plantnet.org/v2/identify/all";
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

let db = null;
const viteServer = isDev ? await createDevViteServer() : null;

async function createDevViteServer() {
  const { createServer } = await import("vite");

  return createServer({
    appType: "spa",
    server: {
      middlewareMode: true,
    },
  });
}

function dataDir() {
  return process.env.DATA_DIR ?? path.join(rootDir, "data");
}

function uploadDir() {
  return process.env.UPLOAD_DIR ?? path.join(dataDir(), "uploads");
}

function dbPath() {
  return process.env.SQLITE_PATH ?? path.join(dataDir(), "garden-ledger.sqlite");
}

function ensureDirs() {
  for (const directory of [dataDir(), uploadDir()]) {
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
    }
  }
}

function getDatabase() {
  if (db) {
    return db;
  }

  ensureDirs();
  db = new DatabaseSync(dbPath());
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS plants (
      id TEXT PRIMARY KEY NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT NOT NULL,
      nickname TEXT NOT NULL,
      common_name TEXT,
      scientific_name TEXT,
      family TEXT,
      cultivar TEXT,
      source TEXT DEFAULT 'manual' NOT NULL,
      passport_raw TEXT,
      passport_botanical TEXT,
      passport_traceability TEXT,
      passport_origin TEXT,
      passport_operator TEXT,
      qr_payload TEXT,
      nursery TEXT,
      garden_location TEXT,
      planted_on TEXT,
      care_notes TEXT,
      identification_confidence REAL,
      identification_candidates TEXT,
      image_key TEXT,
      image_content_type TEXT,
      image_filename TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS garden_maps (
      id TEXT PRIMARY KEY NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT NOT NULL,
      name TEXT NOT NULL,
      image_key TEXT NOT NULL,
      image_content_type TEXT,
      image_filename TEXT
    );

    CREATE TABLE IF NOT EXISTS garden_map_positions (
      map_id TEXT NOT NULL,
      plant_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (map_id, plant_id),
      FOREIGN KEY (map_id) REFERENCES garden_maps (id) ON DELETE CASCADE,
      FOREIGN KEY (plant_id) REFERENCES plants (id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS plants_created_at_idx ON plants (created_at);
    CREATE INDEX IF NOT EXISTS plants_source_idx ON plants (source);
    CREATE INDEX IF NOT EXISTS plants_garden_location_idx ON plants (garden_location);
    CREATE INDEX IF NOT EXISTS garden_map_positions_plant_idx ON garden_map_positions (plant_id);
  `);

  ensurePlantColumn("map_x", "REAL");
  ensurePlantColumn("map_y", "REAL");
  migrateLegacyGardenMap();
  return db;
}

function ensurePlantColumn(name, type) {
  const columns = getDatabase()
    .prepare("PRAGMA table_info(plants)")
    .all()
    .map((column) => column.name);

  if (!columns.includes(name)) {
    getDatabase().exec(`ALTER TABLE plants ADD COLUMN ${name} ${type}`);
  }
}

function parseCandidates(value) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function rowToPlant(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nickname: row.nickname,
    commonName: row.common_name,
    scientificName: row.scientific_name,
    family: row.family,
    cultivar: row.cultivar,
    source: row.source,
    passportRaw: row.passport_raw,
    passportBotanical: row.passport_botanical,
    passportTraceability: row.passport_traceability,
    passportOrigin: row.passport_origin,
    passportOperator: row.passport_operator,
    qrPayload: row.qr_payload,
    nursery: row.nursery,
    gardenLocation: row.garden_location,
    plantedOn: row.planted_on,
    careNotes: row.care_notes,
    identificationConfidence: row.identification_confidence,
    identificationCandidates: parseCandidates(row.identification_candidates),
    imageKey: row.image_key,
    imageContentType: row.image_content_type,
    imageFilename: row.image_filename,
    mapX: row.map_x,
    mapY: row.map_y,
  };
}

function imageKeyToUrl(key) {
  return `/api/images/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function toClientPlant(plant) {
  return {
    ...plant,
    imageUrl: plant.imageKey ? imageKeyToUrl(plant.imageKey) : null,
  };
}

function listPlants() {
  return getDatabase()
    .prepare("SELECT * FROM plants ORDER BY created_at DESC")
    .all()
    .map(rowToPlant);
}

function readPlant(id) {
  const row = getDatabase().prepare("SELECT * FROM plants WHERE id = ?").get(id);
  return row ? rowToPlant(row) : null;
}

function cleanText(value, maxLength = 500) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function cleanLongText(value, maxLength = 4000) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function cleanSource(value) {
  return SOURCE_VALUES.has(value) ? value : "manual";
}

function cleanConfidence(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(100, value));
}

function cleanCoordinate(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(1, value));
}

function cleanCandidates(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  const candidates = value
    .map((candidate) => {
      if (!candidate || typeof candidate !== "object") {
        return null;
      }

      const scientificName = cleanText(candidate.scientificName, 180);
      if (!scientificName) {
        return null;
      }

      return {
        scientificName,
        commonName: cleanText(candidate.commonName, 140),
        family: cleanText(candidate.family, 140),
        score: cleanConfidence(candidate.score) ?? 0,
      };
    })
    .filter(Boolean)
    .slice(0, 8);

  return candidates.length ? candidates : null;
}

function cleanPlantPayload(payload, id, now) {
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
    mapX: cleanCoordinate(payload.mapX),
    mapY: cleanCoordinate(payload.mapY),
  };
}

function plantParams(record) {
  return [
    record.updatedAt,
    record.nickname,
    record.commonName,
    record.scientificName,
    record.family,
    record.cultivar,
    record.source,
    record.passportRaw,
    record.passportBotanical,
    record.passportTraceability,
    record.passportOrigin,
    record.passportOperator,
    record.qrPayload,
    record.nursery,
    record.gardenLocation,
    record.plantedOn,
    record.careNotes,
    record.identificationConfidence,
    record.identificationCandidates ? JSON.stringify(record.identificationCandidates) : null,
    record.imageKey,
    record.imageContentType,
    record.imageFilename,
    record.mapX,
    record.mapY,
  ];
}

function insertPlant(payload) {
  const now = new Date().toISOString();
  const record = cleanPlantPayload(payload, randomUUID(), now);

  getDatabase()
    .prepare(
      `INSERT INTO plants (
        id, created_at, updated_at, nickname, common_name, scientific_name,
        family, cultivar, source, passport_raw, passport_botanical,
        passport_traceability, passport_origin, passport_operator, qr_payload,
        nursery, garden_location, planted_on, care_notes,
        identification_confidence, identification_candidates, image_key,
        image_content_type, image_filename, map_x, map_y
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(record.id, now, ...plantParams(record));

  return readPlant(record.id);
}

function updatePlant(id, payload) {
  const record = cleanPlantPayload(payload, id, new Date().toISOString());

  getDatabase()
    .prepare(
      `UPDATE plants SET
        updated_at = ?, nickname = ?, common_name = ?, scientific_name = ?,
        family = ?, cultivar = ?, source = ?, passport_raw = ?,
        passport_botanical = ?, passport_traceability = ?, passport_origin = ?,
        passport_operator = ?, qr_payload = ?, nursery = ?, garden_location = ?,
        planted_on = ?, care_notes = ?, identification_confidence = ?,
        identification_candidates = ?, image_key = ?, image_content_type = ?,
        image_filename = ?, map_x = ?, map_y = ?
      WHERE id = ?`
    )
    .run(...plantParams(record), record.id);

  return readPlant(record.id);
}

function deletePlant(id) {
  const plant = readPlant(id);
  getDatabase().prepare("DELETE FROM plants WHERE id = ?").run(id);
  return plant;
}

function cleanFilename(name) {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "upload.bin";
}

function safeUploadPath(key) {
  const normalized = path.normalize(key);
  if (
    normalized.startsWith("..") ||
    path.isAbsolute(normalized) ||
    normalized.includes(`..${path.sep}`)
  ) {
    throw new Error("Invalid upload key.");
  }

  return path.join(uploadDir(), normalized);
}

async function saveUpload(file, buffer, prefix = "plants") {
  const filename = cleanFilename(file.name);
  const imageKey = `${prefix}/${randomUUID()}/${filename}`;
  const targetPath = safeUploadPath(imageKey);

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, Buffer.from(buffer), { flush: true });

  return {
    imageKey,
    imageUrl: imageKeyToUrl(imageKey),
    imageContentType: file.type,
    imageFilename: file.name,
  };
}

async function deleteUpload(key) {
  if (!key) {
    return;
  }

  await rm(safeUploadPath(key), { force: true });
}

function getSetting(key) {
  const row = getDatabase().prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : null;
}

function setSetting(key, value) {
  getDatabase()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, JSON.stringify(value));
}

function rowToGardenMap(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    name: row.name,
    imageKey: row.image_key,
    imageContentType: row.image_content_type,
    imageFilename: row.image_filename,
  };
}

function rowToMapPlacement(row) {
  return {
    mapId: row.map_id,
    plantId: row.plant_id,
    x: row.x,
    y: row.y,
    updatedAt: row.updated_at,
  };
}

function toClientGardenMap(map) {
  return {
    ...map,
    imageUrl: imageKeyToUrl(map.imageKey),
    placements: listMapPlacements(map.id),
  };
}

function listGardenMaps() {
  return getDatabase()
    .prepare("SELECT * FROM garden_maps ORDER BY created_at DESC")
    .all()
    .map(rowToGardenMap);
}

function readGardenMap(id) {
  const row = getDatabase().prepare("SELECT * FROM garden_maps WHERE id = ?").get(id);
  return row ? rowToGardenMap(row) : null;
}

function listMapPlacements(mapId) {
  return getDatabase()
    .prepare("SELECT * FROM garden_map_positions WHERE map_id = ? ORDER BY updated_at DESC")
    .all(mapId)
    .map(rowToMapPlacement);
}

function readMapPlacement(mapId, plantId) {
  const row = getDatabase()
    .prepare("SELECT * FROM garden_map_positions WHERE map_id = ? AND plant_id = ?")
    .get(mapId, plantId);
  return row ? rowToMapPlacement(row) : null;
}

function cleanMapName(value, fallback) {
  return cleanText(value, 100) ?? fallback;
}

function createGardenMap(saved, name) {
  const now = new Date().toISOString();
  const id = randomUUID();
  const mapName = cleanMapName(name, saved.imageFilename.replace(/\.[^.]+$/, ""));

  getDatabase()
    .prepare(
      `INSERT INTO garden_maps (
        id, created_at, updated_at, name, image_key, image_content_type, image_filename
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      now,
      now,
      mapName,
      saved.imageKey,
      saved.imageContentType,
      saved.imageFilename
    );

  return readGardenMap(id);
}

function deleteGardenMap(id) {
  const map = readGardenMap(id);
  getDatabase().prepare("DELETE FROM garden_maps WHERE id = ?").run(id);
  return map;
}

function upsertMapPlacement(mapId, plantId, x, y) {
  if (!readGardenMap(mapId) || !readPlant(plantId)) {
    return null;
  }

  const cleanX = cleanCoordinate(x);
  const cleanY = cleanCoordinate(y);
  if (cleanX === null || cleanY === null) {
    throw new Error("Placement coordinates must be between 0 and 1.");
  }

  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO garden_map_positions (map_id, plant_id, x, y, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(map_id, plant_id) DO UPDATE SET
        x = excluded.x,
        y = excluded.y,
        updated_at = excluded.updated_at`
    )
    .run(mapId, plantId, cleanX, cleanY, now);

  return readMapPlacement(mapId, plantId);
}

function deleteMapPlacement(mapId, plantId) {
  const placement = readMapPlacement(mapId, plantId);
  getDatabase()
    .prepare("DELETE FROM garden_map_positions WHERE map_id = ? AND plant_id = ?")
    .run(mapId, plantId);
  return placement;
}

function migrateLegacyGardenMap() {
  if (getSetting("garden-maps-v2-migrated")) {
    return;
  }

  const legacyMap = getSetting("garden-map");
  if (legacyMap?.imageKey) {
    const existing = getDatabase()
      .prepare("SELECT * FROM garden_maps WHERE image_key = ?")
      .get(legacyMap.imageKey);
    const now = new Date().toISOString();
    const map =
      existing ??
      (() => {
        const id = randomUUID();
        getDatabase()
          .prepare(
            `INSERT INTO garden_maps (
              id, created_at, updated_at, name, image_key, image_content_type, image_filename
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            id,
            legacyMap.updatedAt ?? now,
            legacyMap.updatedAt ?? now,
            "Garden overview",
            legacyMap.imageKey,
            legacyMap.imageContentType ?? null,
            legacyMap.imageFilename ?? "garden-overview"
          );
        return readGardenMap(id);
      })();

    const positionedPlants = getDatabase()
      .prepare("SELECT id, map_x, map_y FROM plants WHERE map_x IS NOT NULL AND map_y IS NOT NULL")
      .all();
    for (const plant of positionedPlants) {
      upsertMapPlacement(map.id, plant.id, plant.map_x, plant.map_y);
    }
  }

  setSetting("garden-maps-v2-migrated", { at: new Date().toISOString() });
}

function normalizeOrgan(value) {
  return ["leaf", "flower", "fruit", "bark", "habit", "other"].includes(value)
    ? value
    : "leaf";
}

function mapPlantNetResults(results) {
  return results.slice(0, 6).map((result) => {
    const species = result.species ?? {};
    const scientificName =
      [species.scientificNameWithoutAuthor, species.scientificNameAuthorship]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      species.scientificName ||
      "Unknown species";
    const family =
      species.family?.scientificNameWithoutAuthor ??
      species.family?.scientificName ??
      null;
    const score = Math.round(Math.max(0, Math.min(1, result.score ?? 0)) * 1000) / 10;

    return {
      scientificName,
      commonName: species.commonNames?.[0] ?? null,
      family,
      score,
    };
  });
}

async function identifyWithPlantNet(imageBuffer, image, organ, apiKey) {
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
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.message ?? `PlantNet returned HTTP ${response.status}`);
  }

  return mapPlantNetResults(body.results ?? []);
}

async function requestToWebRequest(request) {
  const url = `http://${request.headers.host}${request.url}`;
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : Readable.toWeb(request),
    duplex: "half",
  });
}

function json(response, status = 200) {
  return new Response(JSON.stringify(response), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleApi(request) {
  const webRequest = await requestToWebRequest(request);
  const url = new URL(webRequest.url);

  try {
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "garden-ledger", time: new Date().toISOString() });
    }

    if (url.pathname === "/api/plants") {
      if (request.method === "GET") {
        return json({ plants: listPlants().map(toClientPlant) });
      }

      if (request.method === "POST") {
        const plant = insertPlant(await webRequest.json());
        return json({ plant: toClientPlant(plant) }, 201);
      }

      if (request.method === "PATCH") {
        const id = url.searchParams.get("id");
        if (!id) {
          return json({ error: "Plant id is required." }, 400);
        }

        const plant = updatePlant(id, await webRequest.json());
        if (!plant) {
          return json({ error: "Plant was not found." }, 404);
        }

        return json({ plant: toClientPlant(plant) });
      }

      if (request.method === "DELETE") {
        const id = url.searchParams.get("id");
        if (!id) {
          return json({ error: "Plant id is required." }, 400);
        }

        const removed = deletePlant(id);
        await deleteUpload(removed?.imageKey);
        return json({ ok: true });
      }
    }

    if (url.pathname === "/api/identify" && request.method === "POST") {
      const form = await webRequest.formData();
      const image = form.get("image");
      const organ = normalizeOrgan(form.get("organ"));

      if (!(image instanceof File)) {
        return json({ error: "A plant photo is required." }, 400);
      }

      if (!ALLOWED_IMAGE_TYPES.has(image.type)) {
        return json({ error: "Use a JPEG, PNG, or WebP plant photo." }, 400);
      }

      const imageBuffer = await image.arrayBuffer();
      const saved = await saveUpload(image, imageBuffer, "plants");
      const apiKey = process.env.PLANTNET_API_KEY;

      if (!apiKey) {
        return json({
          status: "missing-token",
          message: "PLANTNET_API_KEY is not configured yet.",
          ...saved,
          candidates: [],
        });
      }

      try {
        const candidates = await identifyWithPlantNet(imageBuffer, image, organ, apiKey);
        return json({
          status: candidates.length ? "identified" : "no-match",
          ...saved,
          candidates,
        });
      } catch (error) {
        console.error(error);
        return json(
          {
            status: "provider-error",
            message: error instanceof Error ? error.message : "PlantNet identification failed.",
            ...saved,
            candidates: [],
          },
          502
        );
      }
    }

    if (url.pathname === "/api/garden-maps") {
      if (request.method === "GET") {
        return json({ maps: listGardenMaps().map(toClientGardenMap) });
      }

      if (request.method === "POST") {
        const form = await webRequest.formData();
        const image = form.get("image");
        const name = form.get("name");

        if (!(image instanceof File)) {
          return json({ error: "A garden overview image is required." }, 400);
        }

        if (!ALLOWED_IMAGE_TYPES.has(image.type)) {
          return json({ error: "Use a JPEG, PNG, or WebP garden photo." }, 400);
        }

        const buffer = await image.arrayBuffer();
        const saved = await saveUpload(image, buffer, "garden-map");
        const map = createGardenMap(saved, name);

        return json({ map: toClientGardenMap(map) }, 201);
      }

      if (request.method === "DELETE") {
        const id = url.searchParams.get("id");
        if (!id) {
          return json({ error: "Map id is required." }, 400);
        }

        const removed = deleteGardenMap(id);
        await deleteUpload(removed?.imageKey);
        return json({ ok: true });
      }
    }

    if (url.pathname === "/api/garden-map-placements") {
      if (request.method === "POST") {
        const payload = await webRequest.json();
        const mapId = cleanText(payload.mapId, 80);
        const plantId = cleanText(payload.plantId, 80);

        if (!mapId || !plantId) {
          return json({ error: "Map id and plant id are required." }, 400);
        }

        const placement = upsertMapPlacement(mapId, plantId, payload.x, payload.y);
        if (!placement) {
          return json({ error: "Map or plant was not found." }, 404);
        }

        return json({ placement });
      }

      if (request.method === "DELETE") {
        const mapId = url.searchParams.get("mapId");
        const plantId = url.searchParams.get("plantId");

        if (!mapId || !plantId) {
          return json({ error: "Map id and plant id are required." }, 400);
        }

        deleteMapPlacement(mapId, plantId);
        return json({ ok: true });
      }
    }

    if (url.pathname === "/api/garden-map") {
      if (request.method === "GET") {
        const [map] = listGardenMaps();
        return json({ map: map ? toClientGardenMap(map) : null });
      }

      if (request.method === "POST") {
        const form = await webRequest.formData();
        const image = form.get("image");
        const name = form.get("name");

        if (!(image instanceof File)) {
          return json({ error: "A garden overview image is required." }, 400);
        }

        if (!ALLOWED_IMAGE_TYPES.has(image.type)) {
          return json({ error: "Use a JPEG, PNG, or WebP garden photo." }, 400);
        }

        const buffer = await image.arrayBuffer();
        const saved = await saveUpload(image, buffer, "garden-map");
        const map = createGardenMap(saved, name);
        return json({ map: toClientGardenMap(map) }, 201);
      }
    }

    if (url.pathname.startsWith("/api/images/") && request.method === "GET") {
      const key = decodeURIComponent(url.pathname.replace("/api/images/", ""));
      const buffer = await readFile(safeUploadPath(key));
      return new Response(buffer, {
        headers: {
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Type": contentTypeFor(key),
        },
      });
    }
  } catch (error) {
    console.error(error);
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The Garden Ledger server hit an unexpected error.",
      },
      500
    );
  }

  return json({ error: "Not found." }, 404);
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".ico": "image/x-icon",
      ".txt": "text/plain; charset=utf-8",
    }[extension] ?? "application/octet-stream"
  );
}

async function serveStatic(request) {
  const url = new URL(`http://${request.headers.host}${request.url}`);
  const decodedPath = decodeURIComponent(url.pathname);
  const relative = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const staticRoot = isDev ? publicDir : distDir;
  const candidate = path.normalize(path.join(staticRoot, relative));
  const safeRoot = `${staticRoot}${path.sep}`;

  if (!candidate.startsWith(safeRoot) && candidate !== staticRoot) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const file = await stat(candidate);
    if (file.isFile()) {
      return new Response(await readFile(candidate), {
        headers: {
          "Cache-Control": isDev ? "no-store" : "public, max-age=3600",
          "Content-Type": contentTypeFor(candidate),
        },
      });
    }
  } catch {
    // Fall through to SPA shell.
  }

  const shellPath = isDev ? path.join(rootDir, "index.html") : path.join(distDir, "index.html");
  return new Response(await readFile(shellPath), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function serveVite(request, response) {
  return new Promise((resolve) => {
    viteServer.middlewares(request, response, () => {
      resolve(false);
    });
    response.on("finish", () => resolve(true));
  });
}

async function sendResponse(serverResponse, webResponse) {
  serverResponse.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => serverResponse.setHeader(key, value));

  if (!webResponse.body) {
    serverResponse.end();
    return;
  }

  const nodeStream = Readable.fromWeb(webResponse.body);
  nodeStream.pipe(serverResponse);
}

const server = http.createServer(async (request, response) => {
  if (!request.url?.startsWith("/api/") && viteServer) {
    const handled = await serveVite(request, response);
    if (handled) {
      return;
    }
  }

  const webResponse = request.url?.startsWith("/api/")
    ? await handleApi(request)
    : await serveStatic(request);
  await sendResponse(response, webResponse);
});

server.listen(port, hostname, () => {
  console.log(`Garden Ledger listening on http://${hostname}:${port}`);
});
