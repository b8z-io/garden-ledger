<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

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
const gardenMaps = ref([]);
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
const selectedMapId = ref("");
const selectedMapPlantId = ref("");
const activePinPlantId = ref("");
const movingPlantId = ref("");
const newMapName = ref("");
const mapZoom = ref(1);
const mapCanvasWrapEl = ref(null);
const mapImageEl = ref(null);
const mapNaturalSize = ref({ width: 0, height: 0 });
const mapBaseSize = ref({ width: 0, height: 0 });

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

  return {
    total: plants.value.length,
    locations: locations.size,
    photoIdentified: sourceTotals.value.photo,
    mapped: placedPlantIds.value.size,
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

const placedPlantIds = computed(
  () =>
    new Set(
      gardenMaps.value.flatMap((map) =>
        (map.placements ?? []).map((placement) => placement.plantId)
      )
    )
);

const selectedMap = computed(() =>
  gardenMaps.value.find((map) => map.id === selectedMapId.value)
);

const selectedMapPlacements = computed(() => selectedMap.value?.placements ?? []);

const selectedMapPlantIds = computed(
  () =>
    new Set(
      selectedMapPlacements.value.map((placement) => placement.plantId)
    )
);

const unmappedPlantsForSelectedMap = computed(() =>
  selectedMap.value
    ? plants.value.filter((plant) => !selectedMapPlantIds.value.has(plant.id))
    : []
);

const selectedMapPlant = computed(() =>
  plants.value.find((plant) => plant.id === selectedMapPlantId.value)
);

const movingPlant = computed(() =>
  plants.value.find((plant) => plant.id === movingPlantId.value)
);

const placementTargetPlant = computed(
  () => movingPlant.value ?? selectedMapPlant.value
);

const mapPins = computed(() =>
  selectedMapPlacements.value
    .map((placement) => ({
      ...placement,
      plant: plants.value.find((plant) => plant.id === placement.plantId),
    }))
    .filter((pin) => pin.plant)
);

const activePin = computed(() =>
  mapPins.value.find((pin) => pin.plantId === activePinPlantId.value)
);

const activePinPlant = computed(() => activePin.value?.plant);

const activePinStyle = computed(() => {
  if (!activePin.value) {
    return {};
  }

  const x = activePin.value.x;
  const y = activePin.value.y;
  const style = {
    top: `${y * 100}%`,
  };
  const translateY = y < 0.36 ? "18px" : "calc(-100% - 18px)";
  let translateX = "-50%";

  if (x > 0.62) {
    style.right = `${100 - x * 100}%`;
    translateX = "12px";
  } else {
    style.left = `${x * 100}%`;
    if (x < 0.38) {
      translateX = "-12px";
    }
  }

  style.transform = `translate(${translateX}, ${translateY})`;
  return style;
});

const mapZoomPercent = computed(() => Math.round(mapZoom.value * 100));

const mapCanvasStyle = computed(() => {
  if (!mapBaseSize.value.width || !mapBaseSize.value.height) {
    return {};
  }

  return {
    height: `${mapBaseSize.value.height * mapZoom.value}px`,
    width: `${mapBaseSize.value.width * mapZoom.value}px`,
  };
});

watch(theme, (value) => {
  document.documentElement.dataset.theme = value;
  window.localStorage.setItem("garden-ledger-theme", value);
});

watch(selectedMapId, () => {
  activePinPlantId.value = "";
  movingPlantId.value = "";
  mapZoom.value = 1;
  mapBaseSize.value = { width: 0, height: 0 };
  chooseFirstUnmappedPlant();
  nextTick(updateMapBaseSize);
});

watch(unmappedPlantsForSelectedMap, () => {
  if (
    selectedMapPlantId.value &&
    !unmappedPlantsForSelectedMap.value.some(
      (plant) => plant.id === selectedMapPlantId.value
    )
  ) {
    chooseFirstUnmappedPlant();
  }
});

onMounted(async () => {
  const savedTheme = window.localStorage.getItem("garden-ledger-theme");
  if (savedTheme === "dark" || savedTheme === "light") {
    theme.value = savedTheme;
  } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    theme.value = "dark";
  }

  await Promise.all([loadPlants(), loadGardenMaps()]);
  window.addEventListener("resize", updateMapBaseSize);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", updateMapBaseSize);
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setMapZoom(value) {
  mapZoom.value = clamp(Number(value) || 1, 1, 4);
}

function adjustMapZoom(amount) {
  setMapZoom(Math.round((mapZoom.value + amount) * 100) / 100);
}

function resetMapZoom() {
  setMapZoom(1);
}

function updateMapBaseSize() {
  const image = mapImageEl.value;
  const wrap = mapCanvasWrapEl.value;
  const natural = mapNaturalSize.value;

  if (!image || !wrap || !natural.width || !natural.height) {
    return;
  }

  const maxWidth = wrap.clientWidth || natural.width;
  const maxHeight = Math.max(240, window.innerHeight * 0.68);
  const fit = Math.min(maxWidth / natural.width, maxHeight / natural.height, 1);

  mapBaseSize.value = {
    width: Math.round(natural.width * fit),
    height: Math.round(natural.height * fit),
  };
}

function onMapImageLoad(event) {
  mapNaturalSize.value = {
    width: event.currentTarget.naturalWidth,
    height: event.currentTarget.naturalHeight,
  };
  updateMapBaseSize();
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

function chooseFirstUnmappedPlant() {
  selectedMapPlantId.value = unmappedPlantsForSelectedMap.value[0]?.id ?? "";
}

function mapPlacementCount(plantId) {
  return gardenMaps.value.reduce(
    (count, map) =>
      count +
      (map.placements ?? []).filter((placement) => placement.plantId === plantId)
        .length,
    0
  );
}

function plantMapNames(plantId) {
  return gardenMaps.value
    .filter((map) =>
      (map.placements ?? []).some((placement) => placement.plantId === plantId)
    )
    .map((map) => map.name);
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
    chooseFirstUnmappedPlant();
    status.value = plants.value.length ? "Garden loaded" : "No records yet";
  } catch (err) {
    plants.value = [];
    error.value = err instanceof Error ? err.message : "Could not load garden records.";
    status.value = "Storage offline";
  } finally {
    loading.value = false;
  }
}

async function loadGardenMaps() {
  try {
    const response = await fetch("/api/garden-maps");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error ?? "Could not load garden maps.");
    }

    gardenMaps.value = data.maps ?? [];
    if (!selectedMapId.value || !gardenMaps.value.some((map) => map.id === selectedMapId.value)) {
      selectedMapId.value = gardenMaps.value[0]?.id ?? "";
    }
    chooseFirstUnmappedPlant();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not load garden maps.";
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
    gardenMaps.value = gardenMaps.value.map((map) => ({
      ...map,
      placements: (map.placements ?? []).filter(
        (placement) => placement.plantId !== id
      ),
    }));
    if (selectedMapPlantId.value === id) {
      chooseFirstUnmappedPlant();
    }
    if (activePinPlantId.value === id) {
      activePinPlantId.value = "";
    }
    if (movingPlantId.value === id) {
      movingPlantId.value = "";
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
    body.append("name", newMapName.value);
    const response = await fetch("/api/garden-maps", {
      method: "POST",
      body,
    });
    const data = await response.json();

    if (!response.ok || !data.map) {
      throw new Error(data.error ?? "Could not upload garden map.");
    }

    gardenMaps.value = [data.map, ...gardenMaps.value];
    selectedMapId.value = data.map.id;
    newMapName.value = "";
    status.value = `${data.map.name} added`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not upload garden map.";
  } finally {
    uploadingMap.value = false;
    event.target.value = "";
  }
}

async function deleteSelectedMap() {
  if (!selectedMap.value) {
    return;
  }

  const map = selectedMap.value;
  error.value = "";

  try {
    const response = await fetch(`/api/garden-maps?id=${encodeURIComponent(map.id)}`, {
      method: "DELETE",
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error ?? "Could not delete garden map.");
    }

    gardenMaps.value = gardenMaps.value.filter((item) => item.id !== map.id);
    selectedMapId.value = gardenMaps.value[0]?.id ?? "";
    activePinPlantId.value = "";
    movingPlantId.value = "";
    status.value = `${map.name} removed`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not delete garden map.";
  }
}

function updatePlacementState(placement) {
  gardenMaps.value = gardenMaps.value.map((map) => {
    if (map.id !== placement.mapId) {
      return map;
    }

    return {
      ...map,
      placements: [
        placement,
        ...(map.placements ?? []).filter(
          (item) => item.plantId !== placement.plantId
        ),
      ],
    };
  });
}

async function placePlant(event) {
  if (!selectedMap.value) {
    return;
  }

  if (!placementTargetPlant.value) {
    status.value = "Choose a plant to place";
    return;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;

  try {
    const response = await fetch("/api/garden-map-placements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mapId: selectedMap.value.id,
        plantId: placementTargetPlant.value.id,
        x,
        y,
      }),
    });
    const data = await response.json();

    if (!response.ok || !data.placement) {
      throw new Error(data.error ?? "Could not place plant.");
    }

    const plantName = placementTargetPlant.value.nickname;
    updatePlacementState(data.placement);
    activePinPlantId.value = data.placement.plantId;
    movingPlantId.value = "";
    chooseFirstUnmappedPlant();
    status.value = `${plantName} placed on ${selectedMap.value.name}`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not place plant.";
  }
}

function selectPin(plantId) {
  activePinPlantId.value = plantId;
  movingPlantId.value = "";
}

function startMovePlant(plantId) {
  movingPlantId.value = plantId;
  selectedMapPlantId.value = "";
  activePinPlantId.value = plantId;
  const plant = plants.value.find((item) => item.id === plantId);
  status.value = plant ? `Click the map to move ${plant.nickname}` : "Click the map to move pin";
}

function cancelMove() {
  movingPlantId.value = "";
  chooseFirstUnmappedPlant();
  status.value = "Move cancelled";
}

async function removeMapPlacement(plantId) {
  if (!selectedMap.value) {
    return;
  }

  error.value = "";

  try {
    const response = await fetch(
      `/api/garden-map-placements?mapId=${encodeURIComponent(
        selectedMap.value.id
      )}&plantId=${encodeURIComponent(plantId)}`,
      { method: "DELETE" }
    );
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error ?? "Could not remove map pin.");
    }

    gardenMaps.value = gardenMaps.value.map((map) =>
      map.id === selectedMap.value.id
        ? {
            ...map,
            placements: (map.placements ?? []).filter(
              (placement) => placement.plantId !== plantId
            ),
          }
        : map
    );
    activePinPlantId.value = "";
    movingPlantId.value = "";
    chooseFirstUnmappedPlant();
    status.value = "Map pin removed";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not remove map pin.";
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
                <template v-if="mapPlacementCount(plant.id)">
                  <dt>Map</dt>
                  <dd>{{ plantMapNames(plant.id).join(", ") }}</dd>
                </template>
              </dl>
            </div>
          </article>
        </div>
      </section>

      <section v-else class="view-panel map-view">
        <div class="map-sidebar">
          <div class="map-upload">
            <h2>Garden maps</h2>
            <p>Add one overview for the whole garden, or separate photos for each bed.</p>

            <div v-if="gardenMaps.length" class="map-list" aria-label="Garden maps">
              <button
                v-for="map in gardenMaps"
                :key="map.id"
                :class="{ active: selectedMapId === map.id }"
                type="button"
                @click="selectedMapId = map.id"
              >
                <strong>{{ map.name }}</strong>
                <span>{{ (map.placements ?? []).length }} pins</span>
              </button>
            </div>

            <label class="map-name-field">
              <span>New map name</span>
              <input v-model="newMapName" placeholder="South bed, patio pots, whole garden" />
            </label>

            <label class="upload-button">
              <input accept="image/jpeg,image/png,image/webp" type="file" @change="uploadGardenMap" />
              {{ uploadingMap ? "Uploading..." : "Add map photo" }}
            </label>

            <button
              v-if="selectedMap"
              class="danger-action"
              type="button"
              @click="deleteSelectedMap"
            >
              Delete selected map
            </button>
          </div>

          <label v-if="selectedMap">
            <span>Plant to place</span>
            <select v-model="selectedMapPlantId" :disabled="!!movingPlantId || !unmappedPlantsForSelectedMap.length">
              <option disabled value="">
                {{ unmappedPlantsForSelectedMap.length ? "Choose an unmapped plant" : "All plants placed" }}
              </option>
              <option v-for="plant in unmappedPlantsForSelectedMap" :key="plant.id" :value="plant.id">
                {{ plant.nickname }}
              </option>
            </select>
          </label>

          <div v-if="selectedMap" class="map-hints">
            <strong v-if="movingPlant">Moving {{ movingPlant.nickname }}</strong>
            <strong v-else>{{ unmappedPlantsForSelectedMap.length }} unmapped on {{ selectedMap.name }}</strong>
            <p>
              {{
                movingPlant
                  ? "Click the image to set the new pin position."
                  : unmappedPlantsForSelectedMap.length
                    ? "Choose an unmapped plant, then click the image to place it."
                    : "Every plant is pinned on this map. Use a pin popup to move or remove one."
              }}
            </p>
            <button v-if="movingPlant" type="button" @click="cancelMove">
              Cancel move
            </button>
          </div>

          <div v-if="selectedMap" class="map-zoom-controls">
            <div>
              <strong>Zoom</strong>
              <span>{{ mapZoomPercent }}%</span>
            </div>
            <label>
              <span>Map zoom</span>
              <input
                :value="mapZoom"
                max="4"
                min="1"
                step="0.05"
                type="range"
                @input="setMapZoom($event.target.value)"
              />
            </label>
            <div class="zoom-buttons">
              <button type="button" @click="adjustMapZoom(-0.25)">-</button>
              <button type="button" @click="resetMapZoom">Reset</button>
              <button type="button" @click="adjustMapZoom(0.25)">+</button>
            </div>
          </div>
        </div>

        <div ref="mapCanvasWrapEl" class="map-canvas-wrap">
          <div
            v-if="selectedMap"
            class="map-canvas"
            :class="{ 'is-sized': mapBaseSize.width }"
            :style="mapCanvasStyle"
            @click="placePlant"
          >
            <img
              ref="mapImageEl"
              :src="selectedMap.imageUrl"
              :alt="selectedMap.name"
              @load="onMapImageLoad"
            />
            <button
              v-for="pin in mapPins"
              :key="pin.plantId"
              class="map-pin"
              :class="{ selected: pin.plantId === activePinPlantId || pin.plantId === movingPlantId }"
              :style="{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }"
              type="button"
              @click.stop="selectPin(pin.plantId)"
            >
              <span>{{ pin.plant.nickname[0] }}</span>
              <em>{{ pin.plant.nickname }}</em>
            </button>

            <aside
              v-if="activePinPlant"
              class="pin-popover"
              :style="activePinStyle"
              @click.stop
            >
              <div>
                <span :class="sourceClass(activePinPlant.source)">
                  {{ sourceLabels[activePinPlant.source] }}
                </span>
                <button type="button" aria-label="Close plant popup" @click="activePinPlantId = ''">
                  Close
                </button>
              </div>
              <h3>{{ activePinPlant.nickname }}</h3>
              <img
                v-if="activePinPlant.imageUrl"
                class="pin-photo"
                :src="activePinPlant.imageUrl"
                :alt="activePinPlant.nickname"
              />
              <p>{{ activePinPlant.commonName || activePinPlant.scientificName || "Unidentified" }}</p>
              <dl>
                <template v-if="activePinPlant.scientificName">
                  <dt>Scientific</dt>
                  <dd>{{ activePinPlant.scientificName }}</dd>
                </template>
                <template v-if="activePinPlant.gardenLocation">
                  <dt>Spot</dt>
                  <dd>{{ activePinPlant.gardenLocation }}</dd>
                </template>
                <template v-if="activePinPlant.careNotes">
                  <dt>Notes</dt>
                  <dd>{{ activePinPlant.careNotes }}</dd>
                </template>
              </dl>
              <div class="pin-actions">
                <button type="button" @click="openEdit(activePinPlant)">Edit</button>
                <button type="button" @click="startMovePlant(activePinPlant.id)">Move pin</button>
                <button type="button" @click="removeMapPlacement(activePinPlant.id)">Remove</button>
              </div>
            </aside>
          </div>
          <div v-else class="map-empty">
            <img src="/garden-workbench.png" alt="" />
            <strong>No garden maps yet</strong>
            <p>Upload an upstairs overview, a bed close-up, or a patio container photo.</p>
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
