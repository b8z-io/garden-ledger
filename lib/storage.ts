import { existsSync, mkdirSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type PlantSource = "passport" | "qr" | "photo" | "manual";

export type IdentificationCandidate = {
  scientificName: string;
  commonName: string | null;
  family: string | null;
  score: number;
};

export type PlantRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  nickname: string;
  commonName: string | null;
  scientificName: string | null;
  family: string | null;
  cultivar: string | null;
  source: PlantSource;
  passportRaw: string | null;
  passportBotanical: string | null;
  passportTraceability: string | null;
  passportOrigin: string | null;
  passportOperator: string | null;
  qrPayload: string | null;
  nursery: string | null;
  gardenLocation: string | null;
  plantedOn: string | null;
  careNotes: string | null;
  identificationConfidence: number | null;
  identificationCandidates: IdentificationCandidate[] | null;
  imageKey: string | null;
  imageContentType: string | null;
  imageFilename: string | null;
};

export type PlantInsert = Omit<PlantRecord, "createdAt"> & {
  createdAt?: string;
};

export type PlantUpdate = Omit<PlantRecord, "createdAt">;

type PlantRow = {
  id: string;
  created_at: string;
  updated_at: string;
  nickname: string;
  common_name: string | null;
  scientific_name: string | null;
  family: string | null;
  cultivar: string | null;
  source: PlantSource;
  passport_raw: string | null;
  passport_botanical: string | null;
  passport_traceability: string | null;
  passport_origin: string | null;
  passport_operator: string | null;
  qr_payload: string | null;
  nursery: string | null;
  garden_location: string | null;
  planted_on: string | null;
  care_notes: string | null;
  identification_confidence: number | null;
  identification_candidates: string | null;
  image_key: string | null;
  image_content_type: string | null;
  image_filename: string | null;
};

let db: DatabaseSync | null = null;

function dataDir() {
  return process.env.DATA_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
}

function uploadDir() {
  return process.env.UPLOAD_DIR ?? path.join(/*turbopackIgnore: true*/ dataDir(), "uploads");
}

function dbPath() {
  return process.env.SQLITE_PATH ?? path.join(/*turbopackIgnore: true*/ dataDir(), "garden-ledger.sqlite");
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

    CREATE INDEX IF NOT EXISTS plants_created_at_idx ON plants (created_at);
    CREATE INDEX IF NOT EXISTS plants_source_idx ON plants (source);
    CREATE INDEX IF NOT EXISTS plants_garden_location_idx ON plants (garden_location);
  `);

  return db;
}

function parseCandidates(value: string | null): IdentificationCandidate[] | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as IdentificationCandidate[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function rowToPlant(row: PlantRow): PlantRecord {
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
  };
}

export function imageKeyToUrl(key: string) {
  return `/api/images/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function toClientPlant(plant: PlantRecord) {
  return {
    ...plant,
    imageUrl: plant.imageKey ? imageKeyToUrl(plant.imageKey) : null,
  };
}

export function listPlants() {
  const rows = getDatabase()
    .prepare("SELECT * FROM plants ORDER BY created_at DESC")
    .all() as PlantRow[];

  return rows.map(rowToPlant);
}

export function insertPlant(record: PlantInsert) {
  const createdAt = record.createdAt ?? record.updatedAt;

  getDatabase()
    .prepare(
      `INSERT INTO plants (
        id,
        created_at,
        updated_at,
        nickname,
        common_name,
        scientific_name,
        family,
        cultivar,
        source,
        passport_raw,
        passport_botanical,
        passport_traceability,
        passport_origin,
        passport_operator,
        qr_payload,
        nursery,
        garden_location,
        planted_on,
        care_notes,
        identification_confidence,
        identification_candidates,
        image_key,
        image_content_type,
        image_filename
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.id,
      createdAt,
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
      record.imageFilename
    );

  const row = getDatabase()
    .prepare("SELECT * FROM plants WHERE id = ?")
    .get(record.id) as PlantRow | undefined;

  if (!row) {
    throw new Error("Saved plant could not be read back from storage.");
  }

  return rowToPlant(row);
}

export function updatePlant(record: PlantUpdate) {
  getDatabase()
    .prepare(
      `UPDATE plants SET
        updated_at = ?,
        nickname = ?,
        common_name = ?,
        scientific_name = ?,
        family = ?,
        cultivar = ?,
        source = ?,
        passport_raw = ?,
        passport_botanical = ?,
        passport_traceability = ?,
        passport_origin = ?,
        passport_operator = ?,
        qr_payload = ?,
        nursery = ?,
        garden_location = ?,
        planted_on = ?,
        care_notes = ?,
        identification_confidence = ?,
        identification_candidates = ?,
        image_key = ?,
        image_content_type = ?,
        image_filename = ?
      WHERE id = ?`
    )
    .run(
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
      record.id
    );

  const row = getDatabase()
    .prepare("SELECT * FROM plants WHERE id = ?")
    .get(record.id) as PlantRow | undefined;

  if (!row) {
    throw new Error("Plant was not found.");
  }

  return rowToPlant(row);
}

export function deletePlant(id: string) {
  const row = getDatabase()
    .prepare("SELECT * FROM plants WHERE id = ?")
    .get(id) as PlantRow | undefined;

  getDatabase().prepare("DELETE FROM plants WHERE id = ?").run(id);
  return row ? rowToPlant(row) : null;
}

export function cleanFilename(name: string) {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "plant-photo.jpg";
}

function safeUploadPath(key: string) {
  const normalized = path.normalize(key);
  if (
    normalized.startsWith("..") ||
    path.isAbsolute(normalized) ||
    normalized.includes(`..${path.sep}`)
  ) {
    throw new Error("Invalid upload key.");
  }

  return path.join(/*turbopackIgnore: true*/ uploadDir(), normalized);
}

export async function saveUpload(file: File, buffer: ArrayBuffer, organ: string) {
  const filename = cleanFilename(file.name);
  const imageKey = `plants/${crypto.randomUUID()}/${filename}`;
  const targetPath = safeUploadPath(imageKey);

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, Buffer.from(buffer), { flush: true });

  return {
    imageKey,
    imageUrl: imageKeyToUrl(imageKey),
    imageContentType: file.type,
    imageFilename: file.name,
    organ,
  };
}

export async function readUpload(key: string) {
  const buffer = await readFile(safeUploadPath(key));
  return buffer;
}

export async function deleteUpload(key: string | null) {
  if (!key) {
    return;
  }

  await rm(safeUploadPath(key), { force: true });
}
