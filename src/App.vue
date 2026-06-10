<script setup>
import { computed, onMounted, ref, watch } from "vue";

const sourceLabels = {
  passport: "Passport",
  qr: "QR",
  photo: "Photo ID",
  manual: "Manual",
};

const filterLabels = {
  all: "All",
  ...sourceLabels,
};

const blankForm = () => ({
  nickname: "",
  commonName: "",
  scientificName: "",
  family: "",
  cultivar: "",
  source: "manual",
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
  mapX: null,
  mapY: null,
});

const plants = ref([]);
const gardenMap = ref(null);
const form = ref(blankForm());
const activeView = ref("database");
const activeSource = ref("manual");
const editingPlantId = ref(null);
const showEditor = ref(false);
const theme = ref("light");
const loading = ref(true);
const saving = ref(false);
const identifying = ref(false);
const uploadingMap = ref(false);
const status = ref("Ready");
const error = ref("");
const registerQuery = ref("");
const sourceFilter = ref("all");
const selectedImageName = ref("");
const selectedMapPlantId = ref("");

const sourceTotals = computed(() => {
  return plants.value.reduce(
    (acc, plant) => {
      acc[plant.source] += 1;
      return acc;
    },
    { passport: 0, qr: 0, photo: 0, manual: 0 }
  );
});

const stats = computed(() => {
  const locations = new Set(
    plants.value.map((plant) => plant.gardenLocation).filter(Boolean)
  );
  const mapped = plants.value.filter(
    (plant) => plant.mapX !== null && plant.mapY !== null
  ).length;

  return {
    total: plants.value.length,
    locations: locations.size,
    photoIdentified: sourceTotals.value.photo,
    mapped,
  };
});

const filteredPlants = computed(() => {
  const query = registerQuery.value.trim().toLowerCase();

  return plants.value.filter((plant) => {
    if (sourceFilter.value !== "all" && plant.source !== sourceFilter.value) {
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
      .some((value) => value.toLowerCase().includes(query));
  });
});

const unmappedPlants = computed(() =>
  plants.value.filter((plant) => plant.mapX === null || plant.mapY === null)
);

const selectedMapPlant = computed(() =>
  plants.value.find((plant) => plant.id === selectedMapPlantId.value)
);

watch(theme, (value) => {
  document.documentElement.dataset.theme = value;
  window.localStorage.setItem("garden-ledger-theme", value);
});

onMounted(async () => {
  const savedTheme = window.localStorage.getItem("garden-ledger-theme");
  if (savedTheme === "dark" || savedTheme === "light") {
    theme.value = savedTheme;
  } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    theme.value = "dark";
  }

  await Promise.all([loadPlants(), loadGardenMap()]);
});

function sourceClass(source) {
  return `source-pill source-${source}`;
}

function confidenceLabel(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatDate(value) {
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

function extractPassportValue(text, marker) {
  const pattern = new RegExp(`(?:^|[\\s;|])${marker}[\\s:.-]+([^\\n;|]+)`, "i");
  return text.match(pattern)?.[1]?.trim() ?? "";
}

function parsePassport(text) {
  return {
    passportBotanical: extractPassportValue(text, "A"),
    passportTraceability: extractPassportValue(text, "B"),
    passportOrigin: extractPassportValue(text, "C"),
    passportOperator: extractPassportValue(text, "D"),
  };
}

function plantToForm(plant) {
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
    mapX: plant.mapX,
    mapY: plant.mapY,
  };
}

function setSource(source) {
  activeSource.value = source;
  form.value.source = source;
}

async function loadPlants() {
  loading.value = true;
  error.value = "";

  try {
    const response = await fetch("/api/plants");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error ?? "Could not load garden records.");
    }

    plants.value = data.plants ?? [];
    if (!selectedMapPlantId.value && plants.value.length) {
      selectedMapPlantId.value = unmappedPlants.value[0]?.id ?? plants.value[0].id;
    }
    status.value = plants.value.length ? "Garden loaded" : "No records yet";
  } catch (err) {
    plants.value = [];
    error.value = err instanceof Error ? err.message : "Could not load garden records.";
    status.value = "Storage offline";
  } finally {
    loading.value = false;
  }
}

async function loadGardenMap() {
  try {
    const response = await fetch("/api/garden-map");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error ?? "Could not load garden map.");
    }

    gardenMap.value = data.map;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not load garden map.";
  }
}

function openCreate() {
  form.value = blankForm();
  activeSource.value = "manual";
  editingPlantId.value = null;
  selectedImageName.value = "";
  showEditor.value = true;
  error.value = "";
}

function openEdit(plant) {
  form.value = plantToForm(plant);
  activeSource.value = plant.source;
  editingPlantId.value = plant.id;
  selectedImageName.value = plant.imageFilename ?? "";
  showEditor.value = true;
  error.value = "";
}

function closeEditor() {
  showEditor.value = false;
  form.value = blankForm();
  editingPlantId.value = null;
  activeSource.value = "manual";
  selectedImageName.value = "";
}

function applyPassportText(text, source = "passport") {
  const parsed = parsePassport(text);
  activeSource.value = source;
  form.value.source = source;
  if (source === "passport") {
    form.value.passportRaw = text;
  } else {
    form.value.qrPayload = text;
  }
  form.value.passportBotanical =
    parsed.passportBotanical || form.value.passportBotanical;
  form.value.passportTraceability =
    parsed.passportTraceability || form.value.passportTraceability;
  form.value.passportOrigin = parsed.passportOrigin || form.value.passportOrigin;
  form.value.passportOperator =
    parsed.passportOperator || form.value.passportOperator;
  form.value.scientificName = parsed.passportBotanical || form.value.scientificName;
}

async function scanQrFile(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  error.value = "";

  if (!window.BarcodeDetector) {
    error.value = "QR scanning is not available in this browser.";
    return;
  }

  try {
    const image = await createImageBitmap(file);
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    const results = await detector.detect(image);
    image.close();

    const value = results[0]?.rawValue;
    if (!value) {
      error.value = "No QR code was found in that image.";
      return;
    }

    applyPassportText(value, "qr");
    status.value = "QR captured";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "QR scan failed.";
  }
}

async function identifyPhoto(event) {
  const file = event?.target?.files?.[0] ?? event;
  if (!file) {
    error.value = "Choose a plant photo first.";
    return;
  }

  selectedImageName.value = file.name;
  identifying.value = true;
  error.value = "";
  status.value = "Checking PlantNet";

  const body = new FormData();
  body.append("image", file);
  body.append("organ", "leaf");

  try {
    const response = await fetch("/api/identify", {
      method: "POST",
      body,
    });
    const data = await response.json();

    if (!response.ok && data.status !== "provider-error") {
      throw new Error(data.message ?? "Photo identification failed.");
    }

    const candidates = data.candidates ?? [];
    const best = candidates[0];
    activeSource.value = "photo";
    form.value.source = "photo";
    form.value.commonName = best?.commonName ?? form.value.commonName;
    form.value.scientificName = best?.scientificName ?? form.value.scientificName;
    form.value.family = best?.family ?? form.value.family;
    form.value.identificationConfidence =
      best?.score ?? form.value.identificationConfidence;
    form.value.identificationCandidates = candidates;
    form.value.imageKey = data.imageKey ?? form.value.imageKey;
    form.value.imageUrl = data.imageUrl ?? form.value.imageUrl;
    form.value.imageContentType =
      data.imageContentType ?? form.value.imageContentType;
    form.value.imageFilename = data.imageFilename ?? form.value.imageFilename;

    status.value =
      data.status === "missing-token"
        ? "PlantNet token needed"
        : best
          ? "Identification ready"
          : "No match returned";

    if (data.message) {
      error.value = data.message;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Photo identification failed.";
    status.value = "Identification failed";
  } finally {
    identifying.value = false;
  }
}

function applyCandidate(candidate) {
  form.value.commonName = candidate.commonName ?? form.value.commonName;
  form.value.scientificName = candidate.scientificName;
  form.value.family = candidate.family ?? form.value.family;
  form.value.identificationConfidence = candidate.score;
  form.value.source = "photo";
  activeSource.value = "photo";
}

async function savePlant() {
  saving.value = true;
  error.value = "";

  try {
    const url = editingPlantId.value
      ? `/api/plants?id=${encodeURIComponent(editingPlantId.value)}`
      : "/api/plants";
    const response = await fetch(url, {
      method: editingPlantId.value ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form.value),
    });
    const data = await response.json();

    if (!response.ok || !data.plant) {
      throw new Error(data.error ?? "Could not save plant.");
    }

    if (editingPlantId.value) {
      plants.value = plants.value.map((plant) =>
        plant.id === editingPlantId.value ? data.plant : plant
      );
      status.value = "Plant updated";
    } else {
      plants.value = [data.plant, ...plants.value];
      selectedMapPlantId.value = data.plant.id;
      status.value = "Plant saved";
    }

    closeEditor();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not save plant.";
    status.value = "Save failed";
  } finally {
    saving.value = false;
  }
}

async function deletePlant(id) {
  error.value = "";

  try {
    const response = await fetch(`/api/plants?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error ?? "Could not delete plant.");
    }

    plants.value = plants.value.filter((plant) => plant.id !== id);
    if (selectedMapPlantId.value === id) {
      selectedMapPlantId.value = plants.value[0]?.id ?? "";
    }
    status.value = "Plant removed";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not delete plant.";
  }
}

async function uploadGardenMap(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  uploadingMap.value = true;
  error.value = "";

  try {
    const body = new FormData();
    body.append("image", file);
    const response = await fetch("/api/garden-map", {
      method: "POST",
      body,
    });
    const data = await response.json();

    if (!response.ok || !data.map) {
      throw new Error(data.error ?? "Could not upload garden map.");
    }

    gardenMap.value = data.map;
    status.value = "Garden photo updated";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not upload garden map.";
  } finally {
    uploadingMap.value = false;
    event.target.value = "";
  }
}

async function placePlant(event) {
  if (!gardenMap.value || !selectedMapPlant.value) {
    return;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  const mapX = (event.clientX - rect.left) / rect.width;
  const mapY = (event.clientY - rect.top) / rect.height;
  const payload = {
    ...plantToForm(selectedMapPlant.value),
    mapX,
    mapY,
  };

  try {
    const response = await fetch(
      `/api/plants?id=${encodeURIComponent(selectedMapPlant.value.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();

    if (!response.ok || !data.plant) {
      throw new Error(data.error ?? "Could not place plant.");
    }

    plants.value = plants.value.map((plant) =>
      plant.id === data.plant.id ? data.plant : plant
    );
    status.value = `${data.plant.nickname} placed on map`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not place plant.";
  }
}
</script>

<template>
  <main class="app-shell">
    <aside class="sidebar">
      <div class="brand-lockup">
        <span class="brand-mark">GL</span>
        <div>
          <strong>Garden Ledger</strong>
          <small>Plant database</small>
        </div>
      </div>

      <nav class="side-nav" aria-label="Main views">
        <button
          :class="{ active: activeView === 'database' }"
          type="button"
          @click="activeView = 'database'"
        >
          Plant database
        </button>
        <button
          :class="{ active: activeView === 'map' }"
          type="button"
          @click="activeView = 'map'"
        >
          Garden map
        </button>
      </nav>

      <div class="sidebar-card">
        <span class="status-dot" :class="{ error: error }"></span>
        <p>{{ error || status }}</p>
      </div>

      <label class="theme-switch">
        <input
          v-model="theme"
          false-value="light"
          true-value="dark"
          type="checkbox"
        />
        <span></span>
        <em>{{ theme === "dark" ? "Dark" : "Light" }}</em>
      </label>
    </aside>

    <section class="content">
      <header class="topbar">
        <div>
          <p class="eyebrow">Garden workspace</p>
          <h1>{{ activeView === "database" ? "Plant database" : "Garden map" }}</h1>
        </div>
        <button class="primary-action" type="button" @click="openCreate">
          Add new plant
        </button>
      </header>

      <section class="metric-grid">
        <article>
          <span>{{ stats.total }}</span>
          <small>Total plants</small>
        </article>
        <article>
          <span>{{ stats.locations }}</span>
          <small>Garden spots</small>
        </article>
        <article>
          <span>{{ stats.photoIdentified }}</span>
          <small>Photo IDs</small>
        </article>
        <article>
          <span>{{ stats.mapped }}</span>
          <small>Mapped plants</small>
        </article>
      </section>

      <section v-if="activeView === 'database'" class="view-panel">
        <div class="database-toolbar">
          <label>
            <span>Browse plants</span>
            <input
              v-model="registerQuery"
              placeholder="Search name, location, nursery, notes"
              type="search"
            />
          </label>
          <div class="filter-row" aria-label="Filter plants by source">
            <button
              v-for="(label, source) in filterLabels"
              :key="source"
              :class="{ active: sourceFilter === source }"
              type="button"
              @click="sourceFilter = source"
            >
              {{ label }}
            </button>
          </div>
        </div>

        <div class="database-head">
          <div>
            <h2>All plants</h2>
            <p>Showing {{ filteredPlants.length }} of {{ plants.length }}</p>
          </div>
          <div class="source-summary">
            <span
              v-for="(label, source) in sourceLabels"
              :key="source"
              :class="sourceClass(source)"
            >
              {{ label }} {{ sourceTotals[source] }}
            </span>
          </div>
        </div>

        <div v-if="!plants.length" class="empty-state">
          <img src="/garden-workbench.png" alt="" />
          <div>
            <strong>No plants recorded yet</strong>
            <p>Add your first plant from a passport, QR label, manual entry, or photo ID.</p>
          </div>
        </div>

        <div v-else-if="!filteredPlants.length" class="empty-state compact">
          <strong>No plants match that filter</strong>
        </div>

        <div v-else class="plant-grid">
          <article v-for="plant in filteredPlants" :key="plant.id" class="plant-card">
            <div class="plant-thumb">
              <img v-if="plant.imageUrl" :src="plant.imageUrl" alt="" />
              <span v-else>{{ plant.nickname[0] }}</span>
            </div>
            <div class="plant-main">
              <div class="plant-title-row">
                <div>
                  <span :class="sourceClass(plant.source)">
                    {{ sourceLabels[plant.source] }}
                  </span>
                  <h3>{{ plant.nickname }}</h3>
                </div>
                <div class="card-actions">
                  <button type="button" @click="openEdit(plant)">Edit</button>
                  <button type="button" @click="deletePlant(plant.id)">Delete</button>
                </div>
              </div>
              <p>
                {{ plant.commonName || plant.scientificName || "Unidentified" }}
                <template v-if="plant.cultivar">, {{ plant.cultivar }}</template>
              </p>
              <dl>
                <template v-if="plant.scientificName">
                  <dt>Scientific</dt>
                  <dd>{{ plant.scientificName }}</dd>
                </template>
                <template v-if="plant.gardenLocation">
                  <dt>Spot</dt>
                  <dd>{{ plant.gardenLocation }}</dd>
                </template>
                <template v-if="plant.plantedOn">
                  <dt>Planted</dt>
                  <dd>{{ formatDate(plant.plantedOn) }}</dd>
                </template>
                <template v-if="plant.identificationConfidence !== null">
                  <dt>Match</dt>
                  <dd>{{ confidenceLabel(plant.identificationConfidence) }}</dd>
                </template>
                <template v-if="plant.mapX !== null && plant.mapY !== null">
                  <dt>Map</dt>
                  <dd>Placed</dd>
                </template>
              </dl>
            </div>
          </article>
        </div>
      </section>

      <section v-else class="view-panel map-view">
        <div class="map-sidebar">
          <div class="map-upload">
            <h2>Garden photo</h2>
            <p>Upload a broad garden photo, then choose a plant and click its position.</p>
            <label class="upload-button">
              <input accept="image/jpeg,image/png,image/webp" type="file" @change="uploadGardenMap" />
              {{ uploadingMap ? "Uploading..." : "Upload overview photo" }}
            </label>
          </div>

          <label>
            <span>Plant to place</span>
            <select v-model="selectedMapPlantId">
              <option disabled value="">Choose a plant</option>
              <option v-for="plant in plants" :key="plant.id" :value="plant.id">
                {{ plant.nickname }}
              </option>
            </select>
          </label>

          <div class="map-hints">
            <strong>{{ unmappedPlants.length }} unmapped</strong>
            <p>Click the image to place or move the selected plant.</p>
          </div>
        </div>

        <div class="map-canvas-wrap">
          <div v-if="gardenMap" class="map-canvas" @click="placePlant">
            <img :src="gardenMap.imageUrl" alt="Garden overview" />
            <button
              v-for="plant in plants.filter((item) => item.mapX !== null && item.mapY !== null)"
              :key="plant.id"
              class="map-pin"
              :class="{ selected: plant.id === selectedMapPlantId }"
              :style="{ left: `${plant.mapX * 100}%`, top: `${plant.mapY * 100}%` }"
              type="button"
              @click.stop="selectedMapPlantId = plant.id"
            >
              <span>{{ plant.nickname[0] }}</span>
              <em>{{ plant.nickname }}</em>
            </button>
          </div>
          <div v-else class="map-empty">
            <img src="/garden-workbench.png" alt="" />
            <strong>No garden overview yet</strong>
            <p>Use a photo from upstairs or the end of the garden to create a placement map.</p>
          </div>
        </div>
      </section>
    </section>

    <div v-if="showEditor" class="modal-backdrop" @click.self="closeEditor">
      <form class="plant-editor" @submit.prevent="savePlant">
        <div class="modal-head">
          <div>
            <p class="eyebrow">{{ editingPlantId ? "Edit plant" : "New plant" }}</p>
            <h2>{{ editingPlantId ? form.nickname || "Edit plant" : "Add new plant" }}</h2>
          </div>
          <button type="button" @click="closeEditor">Close</button>
        </div>

        <div class="source-tabs">
          <button
            v-for="(label, source) in sourceLabels"
            :key="source"
            :class="{ active: activeSource === source }"
            type="button"
            @click="setSource(source)"
          >
            {{ label }}
          </button>
        </div>

        <section v-if="activeSource === 'passport'" class="editor-panel">
          <label>
            <span>Plant passport</span>
            <textarea
              v-model="form.passportRaw"
              placeholder="Plant Passport A Lavandula angustifolia B LV-24-118 C GB D Nursery"
              @input="applyPassportText(form.passportRaw, 'passport')"
            ></textarea>
          </label>
          <div class="mini-grid">
            <label>
              <span>A botanical</span>
              <input v-model="form.passportBotanical" />
            </label>
            <label>
              <span>B traceability</span>
              <input v-model="form.passportTraceability" />
            </label>
            <label>
              <span>C origin</span>
              <input v-model="form.passportOrigin" />
            </label>
            <label>
              <span>D operator</span>
              <input v-model="form.passportOperator" />
            </label>
          </div>
        </section>

        <section v-else-if="activeSource === 'qr'" class="editor-panel">
          <label>
            <span>Scan QR label</span>
            <input accept="image/*" type="file" @change="scanQrFile" />
          </label>
          <label>
            <span>QR payload</span>
            <textarea
              v-model="form.qrPayload"
              placeholder="QR payload or nursery label URL"
              @input="applyPassportText(form.qrPayload, 'qr')"
            ></textarea>
          </label>
        </section>

        <section v-else-if="activeSource === 'photo'" class="editor-panel">
          <label class="photo-drop">
            <span>Plant photo</span>
            <input accept="image/jpeg,image/png,image/webp" type="file" @change="identifyPhoto" />
            <strong>{{ selectedImageName || "JPEG, PNG, or WebP" }}</strong>
            <em>{{ identifying ? "Checking PlantNet..." : "Choose a photo to identify" }}</em>
          </label>
          <div v-if="form.identificationCandidates.length" class="candidate-list">
            <button
              v-for="candidate in form.identificationCandidates"
              :key="`${candidate.scientificName}-${candidate.score}`"
              type="button"
              @click="applyCandidate(candidate)"
            >
              <strong>{{ candidate.commonName || candidate.scientificName }}</strong>
              <span>
                {{ candidate.scientificName }}
                <template v-if="candidate.family">, {{ candidate.family }}</template>
              </span>
              <em>{{ confidenceLabel(candidate.score) }}</em>
            </button>
          </div>
        </section>

        <section class="details-section">
          <div class="details-grid">
            <label class="wide">
              <span>Garden name</span>
              <input v-model="form.nickname" required placeholder="Rosemary by kitchen door" />
            </label>
            <label>
              <span>Common name</span>
              <input v-model="form.commonName" placeholder="Rosemary" />
            </label>
            <label>
              <span>Scientific name</span>
              <input v-model="form.scientificName" placeholder="Salvia rosmarinus" />
            </label>
            <label>
              <span>Cultivar</span>
              <input v-model="form.cultivar" placeholder="Miss Jessopp's Upright" />
            </label>
            <label>
              <span>Family</span>
              <input v-model="form.family" placeholder="Lamiaceae" />
            </label>
            <label>
              <span>Nursery</span>
              <input v-model="form.nursery" placeholder="Local garden centre" />
            </label>
            <label>
              <span>Garden spot</span>
              <input v-model="form.gardenLocation" placeholder="South bed" />
            </label>
            <label>
              <span>Planted on</span>
              <input v-model="form.plantedOn" type="date" />
            </label>
          </div>
          <label>
            <span>Care notes</span>
            <textarea
              v-model="form.careNotes"
              placeholder="Sun, watering, pruning, winter protection"
            ></textarea>
          </label>
        </section>

        <div class="modal-actions">
          <button type="button" @click="closeEditor">Cancel</button>
          <button class="primary-action" :disabled="saving" type="submit">
            {{ saving ? "Saving..." : editingPlantId ? "Update plant" : "Save plant" }}
          </button>
        </div>
      </form>
    </div>
  </main>
</template>
