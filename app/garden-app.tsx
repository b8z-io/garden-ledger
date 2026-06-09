"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

type Source = "passport" | "qr" | "photo" | "manual";
type Theme = "light" | "dark";

type Candidate = {
  scientificName: string;
  commonName: string | null;
  family: string | null;
  score: number;
};

type Plant = {
  id: string;
  createdAt: string;
  updatedAt: string;
  nickname: string;
  commonName: string | null;
  scientificName: string | null;
  family: string | null;
  cultivar: string | null;
  source: Source;
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
  identificationCandidates: Candidate[] | null;
  imageKey: string | null;
  imageContentType: string | null;
  imageFilename: string | null;
  imageUrl: string | null;
};

type FormState = {
  nickname: string;
  commonName: string;
  scientificName: string;
  family: string;
  cultivar: string;
  source: Source;
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
  identificationConfidence: number | null;
  identificationCandidates: Candidate[];
  imageKey: string;
  imageContentType: string;
  imageFilename: string;
  imageUrl: string;
};

type BarcodeDetectorLike = new (options?: {
  formats?: string[];
}) => {
  detect(image: ImageBitmapSource): Promise<Array<{ rawValue?: string }>>;
};

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorLike;
  }
}

const BLANK_FORM: FormState = {
  nickname: "",
  commonName: "",
  scientificName: "",
  family: "",
  cultivar: "",
  source: "passport",
  passportRaw: "",
  passportBotanical: "",
  passportTraceability: "",
  passportOrigin: "",
  passportOperator: "",
  qrPayload: "",
  nursery: "",
  gardenLocation: "",
  plantedOn: "",
  careNotes: "",
  identificationConfidence: null,
  identificationCandidates: [],
  imageKey: "",
  imageContentType: "",
  imageFilename: "",
  imageUrl: "",
};

const SOURCE_LABELS: Record<Source, string> = {
  passport: "Passport",
  qr: "QR",
  photo: "Photo ID",
  manual: "Manual",
};

const FILTER_LABELS: Record<Source | "all", string> = {
  all: "All",
  ...SOURCE_LABELS,
};

function extractPassportValue(text: string, marker: string) {
  const pattern = new RegExp(`(?:^|[\\s;|])${marker}[\\s:.-]+([^\\n;|]+)`, "i");
  return text.match(pattern)?.[1]?.trim() ?? "";
}

function parsePassport(text: string) {
  return {
    passportBotanical: extractPassportValue(text, "A"),
    passportTraceability: extractPassportValue(text, "B"),
    passportOrigin: extractPassportValue(text, "C"),
    passportOperator: extractPassportValue(text, "D"),
  };
}

function formatDate(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function sourceClass(source: Source) {
  return `source-pill source-${source}`;
}

function confidenceLabel(value: number | null) {
  if (value === null) {
    return "";
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function plantToForm(plant: Plant): FormState {
  return {
    nickname: plant.nickname,
    commonName: plant.commonName ?? "",
    scientificName: plant.scientificName ?? "",
    family: plant.family ?? "",
    cultivar: plant.cultivar ?? "",
    source: plant.source,
    passportRaw: plant.passportRaw ?? "",
    passportBotanical: plant.passportBotanical ?? "",
    passportTraceability: plant.passportTraceability ?? "",
    passportOrigin: plant.passportOrigin ?? "",
    passportOperator: plant.passportOperator ?? "",
    qrPayload: plant.qrPayload ?? "",
    nursery: plant.nursery ?? "",
    gardenLocation: plant.gardenLocation ?? "",
    plantedOn: plant.plantedOn ?? "",
    careNotes: plant.careNotes ?? "",
    identificationConfidence: plant.identificationConfidence,
    identificationCandidates: plant.identificationCandidates ?? [],
    imageKey: plant.imageKey ?? "",
    imageContentType: plant.imageContentType ?? "",
    imageFilename: plant.imageFilename ?? "",
    imageUrl: plant.imageUrl ?? "",
  };
}

export default function GardenApp() {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [activeSource, setActiveSource] = useState<Source>("passport");
  const [theme, setTheme] = useState<Theme>("light");
  const [editingPlantId, setEditingPlantId] = useState<string | null>(null);
  const [registerQuery, setRegisterQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<Source | "all">("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [selectedImageName, setSelectedImageName] = useState("");
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const qrInputRef = useRef<HTMLInputElement | null>(null);

  const stats = useMemo(() => {
    const sourceTotals = plants.reduce<Record<Source, number>>(
      (acc, plant) => {
        acc[plant.source] += 1;
        return acc;
      },
      { passport: 0, qr: 0, photo: 0, manual: 0 }
    );
    const locations = new Set(plants.map((plant) => plant.gardenLocation).filter(Boolean));

    return {
      total: plants.length,
      locations: locations.size,
      photoIdentified: sourceTotals.photo,
      sourceTotals,
    };
  }, [plants]);

  const filteredPlants = useMemo(() => {
    const query = registerQuery.trim().toLowerCase();

    return plants.filter((plant) => {
      const matchesSource = sourceFilter === "all" || plant.source === sourceFilter;
      if (!matchesSource) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [
        plant.nickname,
        plant.commonName,
        plant.scientificName,
        plant.family,
        plant.cultivar,
        plant.nursery,
        plant.gardenLocation,
        plant.careNotes,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query));
    });
  }, [plants, registerQuery, sourceFilter]);

  useEffect(() => {
    void loadPlants();
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      const storedTheme = window.localStorage.getItem("garden-ledger-theme");
      if (storedTheme === "dark" || storedTheme === "light") {
        setTheme(storedTheme);
        return;
      }

      setTheme(
        window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
      );
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("garden-ledger-theme", theme);
  }, [theme]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function selectSource(source: Source) {
    setActiveSource(source);
    updateField("source", source);
  }

  function resetForm() {
    setForm(BLANK_FORM);
    setActiveSource("passport");
    setEditingPlantId(null);
    setSelectedImageName("");
    if (photoInputRef.current) {
      photoInputRef.current.value = "";
    }
    if (qrInputRef.current) {
      qrInputRef.current.value = "";
    }
  }

  function editPlant(plant: Plant) {
    setForm(plantToForm(plant));
    setActiveSource(plant.source);
    setEditingPlantId(plant.id);
    setSelectedImageName(plant.imageFilename ?? "");
    setError("");
    setStatus(`Editing ${plant.nickname}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function loadPlants() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/plants");
      const data = (await response.json()) as { plants?: Plant[]; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not load garden records.");
      }

      setPlants(data.plants ?? []);
      setStatus(data.plants?.length ? "Garden loaded" : "No records yet");
    } catch (err) {
      setPlants([]);
      setError(err instanceof Error ? err.message : "Could not load garden records.");
      setStatus("Storage offline");
    } finally {
      setLoading(false);
    }
  }

  function applyPassportText(text: string, source: Source = "passport") {
    const parsed = parsePassport(text);
    setActiveSource(source);
    setForm((current) => ({
      ...current,
      source,
      passportRaw: source === "passport" ? text : current.passportRaw,
      qrPayload: source === "qr" ? text : current.qrPayload,
      passportBotanical: parsed.passportBotanical || current.passportBotanical,
      passportTraceability: parsed.passportTraceability || current.passportTraceability,
      passportOrigin: parsed.passportOrigin || current.passportOrigin,
      passportOperator: parsed.passportOperator || current.passportOperator,
      scientificName: parsed.passportBotanical || current.scientificName,
    }));
  }

  async function scanQrFile(file: File) {
    setError("");

    if (!window.BarcodeDetector) {
      setError("QR scanning is not available in this browser.");
      return;
    }

    try {
      const image = await createImageBitmap(file);
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      const results = await detector.detect(image);
      image.close();

      const value = results[0]?.rawValue;
      if (!value) {
        setError("No QR code was found in that image.");
        return;
      }

      applyPassportText(value, "qr");
      setStatus("QR captured");
    } catch (err) {
      setError(err instanceof Error ? err.message : "QR scan failed.");
    }
  }

  async function identifyPhoto() {
    const file = photoInputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a plant photo first.");
      return;
    }

    setIdentifying(true);
    setError("");
    setStatus("Checking PlantNet");

    const body = new FormData();
    body.append("image", file);
    body.append("organ", "leaf");

    try {
      const response = await fetch("/api/identify", {
        method: "POST",
        body,
      });
      const data = (await response.json()) as {
        status?: string;
        message?: string;
        imageKey?: string | null;
        imageUrl?: string | null;
        imageContentType?: string;
        imageFilename?: string;
        candidates?: Candidate[];
      };

      if (!response.ok && data.status !== "provider-error") {
        throw new Error(data.message ?? "Photo identification failed.");
      }

      const candidates = data.candidates ?? [];
      const best = candidates[0];
      setActiveSource("photo");
      setForm((current) => ({
        ...current,
        source: "photo",
        commonName: best?.commonName ?? current.commonName,
        scientificName: best?.scientificName ?? current.scientificName,
        family: best?.family ?? current.family,
        identificationConfidence: best?.score ?? current.identificationConfidence,
        identificationCandidates: candidates,
        imageKey: data.imageKey ?? current.imageKey,
        imageUrl: data.imageUrl ?? current.imageUrl,
        imageContentType: data.imageContentType ?? current.imageContentType,
        imageFilename: data.imageFilename ?? current.imageFilename,
      }));

      setStatus(
        data.status === "missing-token"
          ? "PlantNet token needed"
          : best
            ? "Identification ready"
            : "No match returned"
      );
      if (data.message) {
        setError(data.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo identification failed.");
      setStatus("Identification failed");
    } finally {
      setIdentifying(false);
    }
  }

  function applyCandidate(candidate: Candidate) {
    setForm((current) => ({
      ...current,
      commonName: candidate.commonName ?? current.commonName,
      scientificName: candidate.scientificName,
      family: candidate.family ?? current.family,
      identificationConfidence: candidate.score,
      source: "photo",
    }));
    setActiveSource("photo");
  }

  async function savePlant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const response = await fetch(
        editingPlantId
          ? `/api/plants?id=${encodeURIComponent(editingPlantId)}`
          : "/api/plants",
        {
          method: editingPlantId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        }
      );
      const data = (await response.json()) as { plant?: Plant; error?: string };

      if (!response.ok || !data.plant) {
        throw new Error(data.error ?? "Could not save plant.");
      }

      setPlants((current) =>
        editingPlantId
          ? current.map((plant) => (plant.id === editingPlantId ? data.plant! : plant))
          : [data.plant!, ...current]
      );
      resetForm();
      setStatus(editingPlantId ? "Plant updated" : "Plant saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save plant.");
      setStatus("Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deletePlant(id: string) {
    setError("");

    try {
      const response = await fetch(`/api/plants?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not delete plant.");
      }

      setPlants((current) => current.filter((plant) => plant.id !== id));
      if (editingPlantId === id) {
        resetForm();
      }
      setStatus("Plant removed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete plant.");
    }
  }

  return (
    <main className="garden-shell">
      <section className="top-band">
        <div className="brand-block">
          <div className="brand-top-row">
            <p className="eyebrow">Garden Ledger</p>
            <label className="theme-toggle">
              <input
                checked={theme === "dark"}
                onChange={(event) =>
                  setTheme(event.target.checked ? "dark" : "light")
                }
                type="checkbox"
              />
              <span aria-hidden="true" />
              <em>{theme === "dark" ? "Dark" : "Light"}</em>
            </label>
          </div>
          <h1>Plants in this garden</h1>
          <div className="status-row" aria-live="polite">
            <span className={error ? "status-dot status-error" : "status-dot"} />
            <span>{error || status}</span>
          </div>
        </div>
        <div className="hero-asset" aria-label="Garden plant recording workbench">
          <Image
            alt=""
            className="fill-image"
            fill
            priority
            sizes="(max-width: 1080px) 100vw, 520px"
            src="/garden-workbench.png"
          />
        </div>
        <div className="metric-strip">
          <div>
            <span>{stats.total}</span>
            <small>Plants</small>
          </div>
          <div>
            <span>{stats.locations}</span>
            <small>Spots</small>
          </div>
          <div>
            <span>{stats.photoIdentified}</span>
            <small>Photo IDs</small>
          </div>
        </div>
      </section>

      <section className="workspace-grid">
        <form className="plant-form" onSubmit={savePlant}>
          <div className="section-heading">
            <h2>{editingPlantId ? "Edit plant" : "Add plant"}</h2>
            <div className="segmented-control" aria-label="Record source">
              {(Object.keys(SOURCE_LABELS) as Source[]).map((source) => (
                <button
                  className={activeSource === source ? "active" : ""}
                  key={source}
                  onClick={() => selectSource(source)}
                  type="button"
                >
                  {SOURCE_LABELS[source]}
                </button>
              ))}
            </div>
          </div>

          <div className="source-panels">
            <fieldset className={activeSource === "passport" ? "source-panel active" : "source-panel"}>
              <legend>Plant passport</legend>
              <textarea
                value={form.passportRaw}
                onChange={(event) => {
                  updateField("passportRaw", event.target.value);
                  applyPassportText(event.target.value, "passport");
                }}
                placeholder="Plant Passport A Lavandula angustifolia B LV-24-118 C GB D Nursery"
              />
              <div className="mini-grid">
                <label>
                  <span>A botanical</span>
                  <input
                    value={form.passportBotanical}
                    onChange={(event) => updateField("passportBotanical", event.target.value)}
                  />
                </label>
                <label>
                  <span>B traceability</span>
                  <input
                    value={form.passportTraceability}
                    onChange={(event) => updateField("passportTraceability", event.target.value)}
                  />
                </label>
                <label>
                  <span>C origin</span>
                  <input
                    value={form.passportOrigin}
                    onChange={(event) => updateField("passportOrigin", event.target.value)}
                  />
                </label>
                <label>
                  <span>D operator</span>
                  <input
                    value={form.passportOperator}
                    onChange={(event) => updateField("passportOperator", event.target.value)}
                  />
                </label>
              </div>
            </fieldset>

            <fieldset className={activeSource === "qr" ? "source-panel active" : "source-panel"}>
              <legend>QR label</legend>
              <div className="upload-row">
                <input
                  accept="image/*"
                  ref={qrInputRef}
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void scanQrFile(file);
                    }
                  }}
                />
              </div>
              <textarea
                value={form.qrPayload}
                onChange={(event) => {
                  updateField("qrPayload", event.target.value);
                  applyPassportText(event.target.value, "qr");
                }}
                placeholder="QR payload or nursery label URL"
              />
            </fieldset>

            <fieldset className={activeSource === "photo" ? "source-panel active" : "source-panel"}>
              <legend>Photo identification</legend>
              <div className="photo-drop">
                <input
                  accept="image/jpeg,image/png,image/webp"
                  ref={photoInputRef}
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    setSelectedImageName(file?.name ?? "");
                    if (file) {
                      setActiveSource("photo");
                      updateField("source", "photo");
                    }
                  }}
                />
                <span>{selectedImageName || "JPEG, PNG, or WebP"}</span>
                <button disabled={identifying} onClick={identifyPhoto} type="button">
                  {identifying ? "Checking" : "Identify"}
                </button>
              </div>

              {form.identificationCandidates.length > 0 && (
                <div className="candidate-list">
                  {form.identificationCandidates.map((candidate) => (
                    <button
                      key={`${candidate.scientificName}-${candidate.score}`}
                      onClick={() => applyCandidate(candidate)}
                      type="button"
                    >
                      <strong>{candidate.commonName ?? candidate.scientificName}</strong>
                      <span>
                        {candidate.scientificName}
                        {candidate.family ? `, ${candidate.family}` : ""}
                      </span>
                      <em>{confidenceLabel(candidate.score)}</em>
                    </button>
                  ))}
                </div>
              )}
            </fieldset>
          </div>

          <div className="details-grid">
            <label>
              <span>Garden name</span>
              <input
                required
                value={form.nickname}
                onChange={(event) => updateField("nickname", event.target.value)}
                placeholder="Rosemary by kitchen door"
              />
            </label>
            <label>
              <span>Common name</span>
              <input
                value={form.commonName}
                onChange={(event) => updateField("commonName", event.target.value)}
                placeholder="Rosemary"
              />
            </label>
            <label>
              <span>Scientific name</span>
              <input
                value={form.scientificName}
                onChange={(event) => updateField("scientificName", event.target.value)}
                placeholder="Salvia rosmarinus"
              />
            </label>
            <label>
              <span>Cultivar</span>
              <input
                value={form.cultivar}
                onChange={(event) => updateField("cultivar", event.target.value)}
                placeholder="Miss Jessopp's Upright"
              />
            </label>
            <label>
              <span>Family</span>
              <input
                value={form.family}
                onChange={(event) => updateField("family", event.target.value)}
                placeholder="Lamiaceae"
              />
            </label>
            <label>
              <span>Nursery</span>
              <input
                value={form.nursery}
                onChange={(event) => updateField("nursery", event.target.value)}
                placeholder="Local garden centre"
              />
            </label>
            <label>
              <span>Garden spot</span>
              <input
                value={form.gardenLocation}
                onChange={(event) => updateField("gardenLocation", event.target.value)}
                placeholder="South bed"
              />
            </label>
            <label>
              <span>Planted on</span>
              <input
                type="date"
                value={form.plantedOn}
                onChange={(event) => updateField("plantedOn", event.target.value)}
              />
            </label>
          </div>

          <label className="notes-field">
            <span>Care notes</span>
            <textarea
              value={form.careNotes}
              onChange={(event) => updateField("careNotes", event.target.value)}
              placeholder="Sun, watering, pruning, winter protection"
            />
          </label>

          <div className="form-actions">
            <button disabled={saving} type="submit">
              {saving
                ? editingPlantId
                  ? "Updating"
                  : "+ Saving"
                : editingPlantId
                  ? "Update plant"
                  : "+ Save plant"}
            </button>
            <button
              onClick={resetForm}
              type="button"
            >
              {editingPlantId ? "Cancel edit" : "Reset"}
            </button>
          </div>
        </form>

        <section className="register-panel">
          <div className="section-heading">
            <h2>Garden register</h2>
            <button disabled={loading} onClick={loadPlants} type="button">
              Refresh
            </button>
          </div>

          <div className="register-tools">
            <label>
              <span>Browse plants</span>
              <input
                value={registerQuery}
                onChange={(event) => setRegisterQuery(event.target.value)}
                placeholder="Search name, location, nursery, notes"
              />
            </label>
            <div className="filter-row" aria-label="Filter plants by source">
              {(Object.keys(FILTER_LABELS) as Array<Source | "all">).map((source) => (
                <button
                  className={sourceFilter === source ? "active" : ""}
                  key={source}
                  onClick={() => setSourceFilter(source)}
                  type="button"
                >
                  {FILTER_LABELS[source]}
                </button>
              ))}
            </div>
          </div>

          <div className="source-summary" aria-label="Plants by source">
            {(Object.keys(SOURCE_LABELS) as Source[]).map((source) => (
              <span key={source} className={sourceClass(source)}>
                {SOURCE_LABELS[source]} {stats.sourceTotals[source]}
              </span>
            ))}
          </div>

          <p className="register-count">
            Showing {filteredPlants.length} of {plants.length}
          </p>

          <div className="plant-list">
            {plants.length === 0 && (
              <div className="empty-state">
                <div className="empty-image">
                  <Image
                    alt=""
                    className="fill-image"
                    fill
                    sizes="(max-width: 1080px) 100vw, 420px"
                    src="/garden-workbench.png"
                  />
                </div>
                <strong>{loading ? "Loading garden" : "No plants recorded"}</strong>
              </div>
            )}

            {plants.length > 0 && filteredPlants.length === 0 && (
              <div className="empty-state compact-empty">
                <strong>No plants match that browse filter</strong>
              </div>
            )}

            {filteredPlants.map((plant) => (
              <article className="plant-card" key={plant.id}>
                <div className="plant-image">
                  {plant.imageUrl ? (
                    <Image
                      alt=""
                      className="fill-image"
                      fill
                      sizes="118px"
                      src={plant.imageUrl}
                      unoptimized
                    />
                  ) : (
                    <span>{plant.nickname[0]}</span>
                  )}
                </div>
                <div className="plant-body">
                  <div className="plant-title-row">
                    <div>
                      <span className={sourceClass(plant.source)}>{SOURCE_LABELS[plant.source]}</span>
                      <h3>{plant.nickname}</h3>
                    </div>
                    <div className="plant-card-actions">
                      <button onClick={() => editPlant(plant)} type="button">
                        Edit
                      </button>
                      <button onClick={() => void deletePlant(plant.id)} type="button" aria-label="Delete plant">
                        x
                      </button>
                    </div>
                  </div>
                  <p>
                    {plant.commonName || plant.scientificName || "Unidentified"}
                    {plant.cultivar ? `, ${plant.cultivar}` : ""}
                  </p>
                  <dl>
                    {plant.scientificName && (
                      <>
                        <dt>Scientific</dt>
                        <dd>{plant.scientificName}</dd>
                      </>
                    )}
                    {plant.gardenLocation && (
                      <>
                        <dt>Spot</dt>
                        <dd>{plant.gardenLocation}</dd>
                      </>
                    )}
                    {plant.plantedOn && (
                      <>
                        <dt>Planted</dt>
                        <dd>{formatDate(plant.plantedOn)}</dd>
                      </>
                    )}
                    {plant.identificationConfidence !== null && (
                      <>
                        <dt>Match</dt>
                        <dd>{confidenceLabel(plant.identificationConfidence)}</dd>
                      </>
                    )}
                  </dl>
                  {plant.careNotes && <p className="care-note">{plant.careNotes}</p>}
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
