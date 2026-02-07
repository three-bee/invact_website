"use strict";

let DATA_ROOT = "data";
const PANEL_IDS = ["A", "B", "C"];

function createPanelState() {
  return {
    dataset: null,
    meta: [],
    labelMaps: {},
    projections: { ego: null, exo: null, avg: null },
    neighbors: null,
    searchIndex: [],
    matchMask: null,
    keyToIndex: new Map(),
    base: { centerX: 0, centerY: 0, scale: 1 },
    zoom: 1,
    panX: 0,
    panY: 0,
    hoveredIndex: null,
    hoveredView: null,
    selectedView: null,
    screenCache: { ego: null, exo: null },
    drawPending: false,
  };
}

const state = {
  datasets: [],
  panels: PANEL_IDS.map(() => createPanelState()),
  view: "both",
  showAll: true,
  colorBy: "verb",
  verbFilter: "__all__",
  takeFilter: "__all__",
  topVerbs: [],
  selectedTopVerbs: new Set(),
  verbCounts: new Map(),
  verbOrder: [],
  pointSize: 4.5,
  pointAlpha: 1,
  hoveredKey: null,
  hoveredPanel: null,
  selectedKey: null,
  selectedPanel: null,
  defaultApplied: false,
  defaultsPending: true,
  dpr: window.devicePixelRatio || 1,
};

const VIDEO_CONFIGS = [
  {
    id: "seed42_feb",
    label: "Ego-Exo4D (Seed 42 Feb)",
    gallery: "video_gallery_seed42_feb_trimmed.json",
    rankings: "video_rankings_seed42_feb.json",
  },
];


const elements = {
  datasetSubtitle: document.getElementById("datasetSubtitle"),
  datasetSelects: PANEL_IDS.map((id) => document.getElementById(`datasetSelect${id}`)),
  reloadBtn: document.getElementById("reloadBtn"),
  videoGallery: document.getElementById("videoGallery"),
  videoGalleryStatus: document.getElementById("videoGalleryStatus"),
  videoGalleryOverlay: document.getElementById("videoGalleryOverlay"),
  videoConfigTabs: document.getElementById("videoConfigTabs"),
  videoQueryRow: document.getElementById("videoQueryRow"),
  videoResultRow: document.getElementById("videoResultRow"),
  videoShuffleBtn: document.getElementById("videoShuffleBtn"),
  videoPrevBtn: document.getElementById("videoPrevBtn"),
  videoNextBtn: document.getElementById("videoNextBtn"),
  controlFab: document.getElementById("controlFab"),
  controlMenu: document.getElementById("controlMenu"),
  viewToggle: document.getElementById("viewToggle"),
  showAllToggle: document.getElementById("showAllToggle"),
  colorBy: document.getElementById("colorBy"),
  verbFilter: document.getElementById("verbFilter"),
  topVerbList: document.getElementById("topVerbList"),
  verbLegendWrap: document.getElementById("verbLegendWrap"),
  verbLegend: document.getElementById("verbLegend"),
  takeFilter: document.getElementById("takeFilter"),
  searchInput: document.getElementById("searchInput"),
  pointSize: document.getElementById("pointSize"),
  pointAlpha: document.getElementById("pointAlpha"),
  resetView: document.getElementById("resetView"),
  stats: document.getElementById("stats"),
  emptyState: document.getElementById("emptyState"),
  detailBody: document.getElementById("detailBody"),
  detailTitle: document.getElementById("detailTitle"),
  detailTags: document.getElementById("detailTags"),
  detailGrid: document.getElementById("detailGrid"),
  neighborsList: document.getElementById("neighborsList"),
  panels: PANEL_IDS.map((id) => ({
    id,
    title: document.getElementById(`panelTitle${id}`),
    canvas: document.getElementById(`scatter${id}`),
    status: document.getElementById(`status${id}`),
    hoverInfo: document.getElementById(`hoverInfo${id}`),
  })),
  globalTooltip: document.getElementById("globalTooltip"),
  globalTooltipTitle: document.getElementById("globalTooltipTitle"),
  globalTooltipMeta: document.getElementById("globalTooltipMeta"),
};

const videoState = {
  items: [],
  queries: [],
  queryIds: [],
  visibleQueries: [],
  queryWindowStart: 0,
  ranking: {},
  activeQueryId: null,
  dataRoot: null,
  ready: false,
  overlayIntroShown: false,
  configs: [],
  currentConfig: null,
  verbNameMap: null,
};


const colorCache = new Map();

function hashString(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp >= 0 && hp < 1) {
    r1 = c;
    g1 = x;
  } else if (hp < 2) {
    r1 = x;
    g1 = c;
  } else if (hp < 3) {
    g1 = c;
    b1 = x;
  } else if (hp < 4) {
    g1 = x;
    b1 = c;
  } else if (hp < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }
  const m = l - c / 2;
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

function takeGroupB(name) {
  if (!name) return "";
  const nameLow = String(name).toLowerCase();
  const presets = [
    "georgiatech_bike",
    "georgiatech_cooking",
    "georgiatech_covid",
    "iiith_cooking",
    "indiana_bike",
    "indiana_cooking",
    "minnesota_cooking",
    "nus_covidtest",
    "nus_cpr",
    "sfu_cooking",
    "sfu_covid",
    "uniandes_cooking",
    "upenn",
    "utokyo",
  ];
  for (const pat of presets) {
    if (nameLow.includes(pat)) {
      return pat;
    }
  }
  const parts = nameLow.split("_");
  if (parts.length >= 2) {
    return `${parts[0]}_${parts[1]}`;
  }
  return nameLow;
}

function getVerbFilterValue() {
  if (elements.verbFilter) {
    return elements.verbFilter.value || "__all__";
  }
  return state.verbFilter || "__all__";
}

function getLabelForIndex(panel, index) {
  const meta = panel.meta[index] || {};
  switch (state.colorBy) {
    case "verb":
      return meta.verb || "unknown";
    case "object":
      return meta.obj || "unknown";
    case "scene":
      return takeGroupB(meta.take_name || meta.scene || "unknown");
    case "body_part":
      return meta.body_part || "unknown";
    case "keystep":
      return meta.keystep_vocab_id != null ? String(meta.keystep_vocab_id) : "unknown";
    case "none":
    default:
      return "none";
  }
}

function getBaseColor(label) {
  if (label === "none") {
    return [24, 29, 38];
  }
  if (colorCache.has(label)) {
    return colorCache.get(label);
  }
  const hue = hashString(label) % 360;
  const rgb = hslToRgb(hue, 0.58, 0.55);
  colorCache.set(label, rgb);
  return rgb;
}

function rgba(rgb, alpha) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clearNode(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function formatSeconds(value) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return `${Number(value).toFixed(2)}s`;
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}`);
  }
  return response.json();
}

async function fetchBin(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}`);
  }
  const buffer = await response.arrayBuffer();
  return new Float32Array(buffer);
}

function updateStats() {
  if (elements.stats) {
    elements.stats.textContent = "";
  }
}

function updateStatus(panelIndex, text) {
  const panelEl = elements.panels[panelIndex];
  if (panelEl) {
    panelEl.status.textContent = text || "";
  }
}

function updateHoverInfo(panelIndex, text) {
  const panelEl = elements.panels[panelIndex];
  if (panelEl) {
    panelEl.hoverInfo.textContent = text || "";
  }
}

function positionTooltip(tooltip, left, top) {
  if (!tooltip) return;
  const margin = 12;
  const width = tooltip.offsetWidth || 0;
  const height = tooltip.offsetHeight || 0;
  let x = left;
  let y = top;
  if (width) {
    x = clamp(x, margin, window.innerWidth - width - margin);
  }
  if (height) {
    y = clamp(y, margin, window.innerHeight - height - margin);
  }
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}

function getReferencePanel() {
  const panel = state.panels.find((p) => p.meta.length > 0);
  return panel || state.panels[0];
}

function buildVerbOptions() {
  const ref = getReferencePanel();
  const counts = new Map();
  const takeFilter = elements.takeFilter?.value || "__all__";
  let total = 0;

  for (const meta of ref.meta) {
    const take = takeGroupB(meta?.take_name || "unknown");
    if (takeFilter !== "__all__" && take !== takeFilter) {
      continue;
    }
    total += 1;
    const verb = meta?.verb || "unknown";
    counts.set(verb, (counts.get(verb) || 0) + 1);
  }

  const sorted = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  state.verbCounts = counts;
  state.verbOrder = sorted.map(([verb]) => verb);
  state.selectedTopVerbs = new Set();

  const topList = sorted.slice(0, 15);
  state.topVerbs = topList.map(([verb]) => verb);

  const current = getVerbFilterValue();
  if (elements.verbFilter) {
    clearNode(elements.verbFilter);

    const allOption = document.createElement("option");
    allOption.value = "__all__";
    allOption.textContent = `All verbs (${total})`;
    elements.verbFilter.appendChild(allOption);

    for (const [verb, count] of sorted) {
      const option = document.createElement("option");
      option.value = verb;
      option.textContent = `${verb} (${count})`;
      elements.verbFilter.appendChild(option);
    }

    const available = new Set(sorted.map(([verb]) => verb));
    if (current !== "__all__" && available.has(current)) {
      elements.verbFilter.value = current;
    } else {
      elements.verbFilter.value = "__all__";
    }
  } else {
    state.verbFilter = "__all__";
  }
  updateVerbLegend();
  buildTopVerbChips();
}

function updateVerbLegend() {
  if (!elements.verbLegendWrap || !elements.verbLegend) return;
  const verbFilter = getVerbFilterValue();
  const useTopVerbChips = state.selectedTopVerbs.size > 0;
  if (verbFilter === "__all__" && !useTopVerbChips) {
    elements.verbLegendWrap.classList.add("hidden");
    clearNode(elements.verbLegend);
    return;
  }
  const verbs = useTopVerbChips ? Array.from(state.selectedTopVerbs) : [verbFilter];
  const order = state.verbOrder.length ? state.verbOrder : verbs;
  const ordered = verbs.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
  clearNode(elements.verbLegend);

  const viewLegend = document.createElement("div");
  viewLegend.className = "legend-group";
  const viewTitle = document.createElement("div");
  viewTitle.className = "legend-subtitle";
  viewTitle.textContent = "View";
  viewLegend.appendChild(viewTitle);

  const egoItem = document.createElement("div");
  egoItem.className = "legend-item";
  const egoSwatch = document.createElement("span");
  egoSwatch.className = "legend-swatch legend-swatch--ego";
  const egoLabel = document.createElement("span");
  egoLabel.textContent = "Ego";
  egoItem.appendChild(egoSwatch);
  egoItem.appendChild(egoLabel);

  const exoItem = document.createElement("div");
  exoItem.className = "legend-item";
  const exoSwatch = document.createElement("span");
  exoSwatch.className = "legend-swatch legend-swatch--exo";
  const exoLabel = document.createElement("span");
  exoLabel.textContent = "Exo";
  exoItem.appendChild(exoSwatch);
  exoItem.appendChild(exoLabel);

  viewLegend.appendChild(egoItem);
  viewLegend.appendChild(exoItem);
  elements.verbLegend.appendChild(viewLegend);

  const verbGroup = document.createElement("div");
  verbGroup.className = "legend-group";
  const verbTitle = document.createElement("div");
  verbTitle.className = "legend-subtitle";
  verbTitle.textContent = "Verb";
  verbGroup.appendChild(verbTitle);

  ordered.forEach((verb) => {
    const item = document.createElement("div");
    item.className = "legend-item";
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    const rgb = getBaseColor(verb);
    swatch.style.backgroundColor = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    const label = document.createElement("span");
    const count = state.verbCounts.get(verb);
    label.textContent = count ? `${verb} (${count})` : verb;
    item.appendChild(swatch);
    item.appendChild(label);
    verbGroup.appendChild(item);
  });
  elements.verbLegend.appendChild(verbGroup);
  elements.verbLegendWrap.classList.remove("hidden");
}

function buildTopVerbChips() {
  if (!elements.topVerbList) return;
  clearNode(elements.topVerbList);
  state.selectedTopVerbs = new Set(state.selectedTopVerbs);
  state.topVerbs.forEach((verb) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "verb-chip";
    const swatch = document.createElement("span");
    swatch.className = "verb-chip-swatch";
    const rgb = getBaseColor(verb);
    swatch.style.backgroundColor = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    const label = document.createElement("span");
    label.textContent = verb;
    chip.appendChild(swatch);
    chip.appendChild(label);
    if (state.selectedTopVerbs.has(verb)) {
      chip.classList.add("active");
    }
    chip.addEventListener("click", () => {
      if (state.selectedTopVerbs.has(verb)) {
        state.selectedTopVerbs.delete(verb);
        chip.classList.remove("active");
      } else {
        state.selectedTopVerbs.add(verb);
        chip.classList.add("active");
      }
      if (state.selectedTopVerbs.size > 0) {
        if (elements.verbFilter) {
          elements.verbFilter.value = "__all__";
        }
        state.verbFilter = "__all__";
        state.showAll = false;
        if (elements.showAllToggle) {
          elements.showAllToggle.checked = false;
        }
      }
      updateVerbLegend();
      updateMatchMask();
    });
    elements.topVerbList.appendChild(chip);
  });
}

function buildTakeOptions() {
  const ref = getReferencePanel();
  const counts = new Map();
  for (const meta of ref.meta) {
    const take = takeGroupB(meta?.take_name || "unknown");
    counts.set(take, (counts.get(take) || 0) + 1);
  }

  const sorted = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });

  const current = elements.takeFilter.value || "__all__";
  clearNode(elements.takeFilter);

  const allOption = document.createElement("option");
  allOption.value = "__all__";
  allOption.textContent = `All takes (${ref.meta.length})`;
  elements.takeFilter.appendChild(allOption);

  for (const [take, count] of sorted) {
    const option = document.createElement("option");
    option.value = take;
    option.textContent = `${take} (${count})`;
    elements.takeFilter.appendChild(option);
  }

  const available = new Set(sorted.map(([take]) => take));
  if (current !== "__all__" && available.has(current)) {
    elements.takeFilter.value = current;
  } else {
    elements.takeFilter.value = "__all__";
  }
}

function updateMatchMask() {
  const query = "";
  const verbFilter = getVerbFilterValue();
  const takeFilter = elements.takeFilter.value || "__all__";
  const useVerb = verbFilter !== "__all__";
  const useTopVerbChips = state.selectedTopVerbs.size > 0;
  const useTake = takeFilter !== "__all__";

  state.panels.forEach((panel) => {
    const mask = new Uint8Array(panel.meta.length);
    for (let i = 0; i < panel.searchIndex.length; i += 1) {
      if (useVerb || useTopVerbChips) {
        const verb = panel.meta[i]?.verb || "unknown";
        if (useTopVerbChips && !state.selectedTopVerbs.has(verb)) {
          continue;
        }
        if (useVerb && verb !== verbFilter) {
          continue;
        }
      }
      if (useTake) {
        const take = takeGroupB(panel.meta[i]?.take_name || "unknown");
        if (take !== takeFilter) {
          continue;
        }
      }
    if (query && !panel.searchIndex[i].includes(query)) {
      continue;
    }
      mask[i] = 1;
    }
    panel.matchMask = mask;
  });

  updateStats();
  scheduleDrawAll();
}

function computeBase(panelIndex) {
  const panel = state.panels[panelIndex];
  const { ego, exo, avg } = panel.projections;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (arr) => {
    if (!arr) return;
    for (let i = 0; i < arr.length; i += 2) {
      const x = arr[i];
      const y = arr[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  };

  if (state.view === "ego") {
    include(ego);
  } else if (state.view === "exo") {
    include(exo);
  } else {
    include(ego);
    include(exo);
  }

  if (minX === Infinity) {
    include(avg);
  }

  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  const canvas = elements.panels[panelIndex].canvas;
  const scale = Math.min(canvas.width * 0.8 / width, canvas.height * 0.8 / height);
  panel.base = {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    scale,
  };
  panel.zoom = 1;
  panel.panX = 0;
  panel.panY = 0;
}

function worldToScreen(panelIndex, x, y) {
  const panel = state.panels[panelIndex];
  const { centerX, centerY, scale } = panel.base;
  const canvas = elements.panels[panelIndex].canvas;
  return [
    (x - centerX) * scale * panel.zoom + canvas.width / 2 + panel.panX,
    (y - centerY) * scale * panel.zoom + canvas.height / 2 + panel.panY,
  ];
}

function screenToWorld(panelIndex, x, y) {
  const panel = state.panels[panelIndex];
  const { centerX, centerY, scale } = panel.base;
  const canvas = elements.panels[panelIndex].canvas;
  return [
    (x - canvas.width / 2 - panel.panX) / (scale * panel.zoom) + centerX,
    (y - canvas.height / 2 - panel.panY) / (scale * panel.zoom) + centerY,
  ];
}

function getPoint(arr, index) {
  return [arr[index * 2], arr[index * 2 + 1]];
}

function updateScreenCache(panelIndex, arr, variant) {
  if (!arr) return;
  const panel = state.panels[panelIndex];
  const showAll = state.showAll;
  const cache = new Float32Array(panel.meta.length * 2);
  const canvas = elements.panels[panelIndex].canvas;
  const margin = 10 * state.dpr;

  for (let i = 0; i < panel.meta.length; i += 1) {
    if (!showAll && panel.matchMask && !panel.matchMask[i]) {
      cache[i * 2] = Number.NaN;
      cache[i * 2 + 1] = Number.NaN;
      continue;
    }
    const [x, y] = getPoint(arr, i);
    const [sx, sy] = worldToScreen(panelIndex, x, y);
    cache[i * 2] = sx;
    cache[i * 2 + 1] = sy;
    if (sx < -margin || sy < -margin || sx > canvas.width + margin || sy > canvas.height + margin) {
      cache[i * 2] = Number.NaN;
      cache[i * 2 + 1] = Number.NaN;
      continue;
    }
  }

  panel.screenCache[variant] = cache;
}

function drawPointsFromCache(panelIndex, cache, variant) {
  if (!cache) return;
  const panel = state.panels[panelIndex];
  const ctx = elements.panels[panelIndex].canvas.getContext("2d");
  const size = state.pointSize * state.dpr;
  const activeAlpha = state.pointAlpha;
  const inactiveAlpha = 0.08;

  for (let i = 0; i < panel.meta.length; i += 1) {
    const sx = cache[i * 2];
    const sy = cache[i * 2 + 1];
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
      continue;
    }
    const isActive = !panel.matchMask || panel.matchMask[i] === 1;
    const label = getLabelForIndex(panel, i);
    const rgb = getBaseColor(label);
    const alpha = isActive ? activeAlpha : inactiveAlpha;
    ctx.fillStyle = rgba(rgb, alpha);
    if (variant === "exo") {
      const half = size / 2;
      ctx.fillRect(sx - half, sy - half, size, size);
    } else {
      ctx.beginPath();
      ctx.arc(sx, sy, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawHighlight(panelIndex, index, variant, color) {
  const panel = state.panels[panelIndex];
  const arr = variant === "exo" ? panel.projections.exo : panel.projections.ego;
  if (!arr || index == null) return;
  const ctx = elements.panels[panelIndex].canvas.getContext("2d");
  const [x, y] = getPoint(arr, index);
  const [sx, sy] = worldToScreen(panelIndex, x, y);
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.arc(sx, sy, 8 * state.dpr, 0, Math.PI * 2);
  ctx.stroke();
}

function drawPanel(panelIndex) {
  if (state.defaultsPending) {
    state.panels[panelIndex].drawPending = false;
    return;
  }
  const panel = state.panels[panelIndex];
  panel.drawPending = false;
  const canvas = elements.panels[panelIndex].canvas;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (state.view === "ego") {
    updateScreenCache(panelIndex, panel.projections.ego, "ego");
    drawPointsFromCache(panelIndex, panel.screenCache.ego, "ego");
  } else if (state.view === "exo") {
    updateScreenCache(panelIndex, panel.projections.exo, "exo");
    drawPointsFromCache(panelIndex, panel.screenCache.exo, "exo");
  } else {
    updateScreenCache(panelIndex, panel.projections.ego, "ego");
    updateScreenCache(panelIndex, panel.projections.exo, "exo");
    drawPointsFromCache(panelIndex, panel.screenCache.ego, "ego");
    drawPointsFromCache(panelIndex, panel.screenCache.exo, "exo");
  }

  if (state.hoveredKey) {
    const hoveredIndex = panelIndex === state.hoveredPanel
      ? panel.hoveredIndex
      : panel.keyToIndex.get(state.hoveredKey);
    if (hoveredIndex != null) {
      const variant = panel.hoveredView || (state.view === "both" ? "ego" : state.view);
      drawHighlight(panelIndex, hoveredIndex, variant, "rgba(231, 111, 81, 0.9)");
    }
  }

  if (state.selectedKey) {
    const selectedIndex = panel.keyToIndex.get(state.selectedKey);
    if (selectedIndex != null) {
      const variant = panel.selectedView || (state.view === "both" ? "ego" : state.view);
      drawHighlight(panelIndex, selectedIndex, variant, "rgba(42, 157, 143, 0.9)");
    }
  }
}

function scheduleDraw(panelIndex) {
  const panel = state.panels[panelIndex];
  if (panel.drawPending) return;
  panel.drawPending = true;
  requestAnimationFrame(() => drawPanel(panelIndex));
}

function scheduleDrawAll() {
  for (let i = 0; i < state.panels.length; i += 1) {
    scheduleDraw(i);
  }
}

function syncZoomFrom(panelIndex) {
  const zoom = state.panels[panelIndex].zoom;
  state.panels.forEach((panel, idx) => {
    if (idx === panelIndex) return;
    panel.zoom = zoom;
  });
}

function resizeCanvas() {
  state.dpr = window.devicePixelRatio || 1;
  state.panels.forEach((panel, idx) => {
    const canvas = elements.panels[idx].canvas;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * state.dpr;
    canvas.height = rect.height * state.dpr;
    if (panel.meta.length > 0) {
      computeBase(idx);
      scheduleDraw(idx);
    }
  });
}

function setActiveViewButton(view) {
  Array.from(elements.viewToggle.querySelectorAll("button")).forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
}

function makeSampleKey(meta) {
  if (!meta) return "";
  if (meta.take_uid) {
    return `uid:${meta.take_uid}|${meta.start_time}|${meta.end_time}`;
  }
  if (meta.raw_idx != null) {
    return `raw:${meta.raw_idx}`;
  }
  const take = meta.take_name || "";
  return `take:${take}|${meta.start_time}|${meta.end_time}|${meta.verb || ""}`;
}

function updateDetail() {
  return;
}

function updateNeighbors() {
  clearNode(elements.neighborsList);
  if (state.selectedKey == null || state.selectedPanel == null) {
    const div = document.createElement("div");
    div.className = "neighbors-item";
    div.textContent = "Neighbors unavailable";
    elements.neighborsList.appendChild(div);
    return;
  }
  const panel = state.panels[state.selectedPanel];
  const index = panel.keyToIndex.get(state.selectedKey);
  if (!panel.neighbors || index == null) {
    const div = document.createElement("div");
    div.className = "neighbors-item";
    div.textContent = "Neighbors unavailable";
    elements.neighborsList.appendChild(div);
    return;
  }
  const neighbors = panel.neighbors[index] || [];
  neighbors.slice(0, 12).forEach((neighborIdx) => {
    const meta = panel.meta[neighborIdx];
    const item = document.createElement("div");
    item.className = "neighbors-item";
    item.textContent = meta?.raw_text || meta?.verb || `Sample ${neighborIdx}`;
    item.addEventListener("click", () => {
      state.selectedKey = makeSampleKey(meta);
      state.selectedPanel = state.selectedPanel;
      panel.selectedView = state.view === "exo" ? "exo" : "ego";
      updateDetail();
      scheduleDrawAll();
    });
    elements.neighborsList.appendChild(item);
  });
}

function setHover(panelIndex, index, view, clientX, clientY) {
  if (index == null) {
    state.hoveredKey = null;
    state.hoveredPanel = null;
    elements.globalTooltip.classList.add("hidden");
    state.panels.forEach((_, idx) => updateHoverInfo(idx, ""));
    scheduleDrawAll();
    return;
  }
  const sourcePanel = state.panels[panelIndex];
  const meta = sourcePanel.meta[index];
  if (!meta) return;
  const key = makeSampleKey(meta);
  state.hoveredKey = key;
  state.hoveredPanel = panelIndex;
  const viewKey = view || (state.view === "both" ? "ego" : state.view);
  const label = meta?.raw_text || meta?.verb || `Sample ${index}`;
  elements.globalTooltipTitle.textContent = label;
  elements.globalTooltipMeta.textContent = `${viewKey.toUpperCase()} • ${meta?.take_name || ""}`.trim();
  elements.globalTooltip.classList.remove("hidden");
  state.panels.forEach((_, idx) => {
    updateHoverInfo(idx, `${viewKey.toUpperCase()} ${meta?.take_name || ""}`.trim());
  });

  if (clientX != null && clientY != null) {
    positionTooltip(elements.globalTooltip, clientX + 12, clientY + 12);
  }

  scheduleDrawAll();
}

function findNearestScreen(panelIndex, sx, sy) {
  const panel = state.panels[panelIndex];
  const views = state.view === "both" ? ["ego", "exo"] : [state.view];
  let best = { id: null, dist: Infinity, view: null };
  const hitRadius = 12 * state.dpr;
  for (const view of views) {
    const cache = panel.screenCache[view];
    if (!cache) continue;
    for (let i = 0; i < panel.meta.length; i += 1) {
      if (!state.showAll && panel.matchMask && !panel.matchMask[i]) {
        continue;
      }
      const px = cache[i * 2];
      const py = cache[i * 2 + 1];
      if (!Number.isFinite(px) || !Number.isFinite(py)) {
        continue;
      }
      const dx = px - sx;
      const dy = py - sy;
      const dist = dx * dx + dy * dy;
      if (dist < best.dist) {
        best = { id: i, dist, view };
      }
    }
  }
  return best;
}

function bindCanvasEvents(panelIndex) {
  const panelEl = elements.panels[panelIndex];
  const panel = state.panels[panelIndex];
  let dragging = false;
  let dragMoved = false;
  let lastX = 0;
  let lastY = 0;
  let lastClickTime = 0;
  let lastClickX = 0;
  let lastClickY = 0;
  const getLocalCoords = (event) => {
    const rect = panelEl.canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) * state.dpr, (event.clientY - rect.top) * state.dpr];
  };

  panelEl.canvas.addEventListener("mousedown", (event) => {
    dragging = true;
    dragMoved = false;
    lastX = event.clientX;
    lastY = event.clientY;
  });

  window.addEventListener("mouseup", () => {
    dragging = false;
  });

  panelEl.canvas.addEventListener("mouseleave", () => {
    setHover(panelIndex, null, null);
  });

  panelEl.canvas.addEventListener("mousemove", (event) => {
    if (panel.meta.length === 0) return;
    const [sx, sy] = getLocalCoords(event);

    if (dragging) {
      const dx = (event.clientX - lastX) * state.dpr;
      const dy = (event.clientY - lastY) * state.dpr;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        dragMoved = true;
      }
      panel.panX += dx;
      panel.panY += dy;
      lastX = event.clientX;
      lastY = event.clientY;
      scheduleDraw(panelIndex);
      return;
    }

    const nearest = findNearestScreen(panelIndex, sx, sy);
    const hitRadius = 12 * state.dpr;
    if (nearest.id == null || nearest.dist > hitRadius * hitRadius) {
      setHover(panelIndex, null, null);
      return;
    }
    setHover(panelIndex, nearest.id, nearest.view, event.clientX, event.clientY);
  });

  panelEl.canvas.addEventListener("click", () => {
    if (dragMoved) {
      dragMoved = false;
      return;
    }
    const now = performance.now();
    const dx = Math.abs(lastX - lastClickX);
    const dy = Math.abs(lastY - lastClickY);
    if (now - lastClickTime < 320 && dx < 6 && dy < 6) {
      lastClickTime = 0;
      state.panels.forEach((_, idx) => computeBase(idx));
      scheduleDrawAll();
      return;
    }
    lastClickTime = now;
    lastClickX = lastX;
    lastClickY = lastY;
    if (panel.hoveredIndex != null) {
      const meta = panel.meta[panel.hoveredIndex];
      if (!meta) return;
      state.selectedKey = makeSampleKey(meta);
      state.selectedPanel = panelIndex;
      panel.selectedView = panel.hoveredView;
      updateDetail();
      scheduleDrawAll();
    }
  });

  panelEl.canvas.addEventListener("dblclick", (event) => {
    event.preventDefault();
    lastClickTime = 0;
    state.panels.forEach((_, idx) => computeBase(idx));
    scheduleDrawAll();
  });

  panelEl.canvas.addEventListener("wheel", (event) => {
    if (panel.meta.length === 0) return;
    event.preventDefault();
    const [sx, sy] = getLocalCoords(event);
    const [wx, wy] = screenToWorld(panelIndex, sx, sy);
    const zoomFactor = Math.exp(-event.deltaY * 0.001);
    const nextZoom = clamp(panel.zoom * zoomFactor, 0.2, 6);
    state.panels.forEach((p, idx) => {
      if (idx === panelIndex) return;
      p.zoom = clamp(p.zoom * zoomFactor, 0.2, 6);
    });
    panel.zoom = nextZoom;
    const [nsx, nsy] = worldToScreen(panelIndex, wx, wy);
    panel.panX += sx - nsx;
    panel.panY += sy - nsy;
    scheduleDrawAll();
  }, { passive: false });
}

function updateDatasetSubtitle() {
  if (!elements.datasetSubtitle) return;
  const names = state.panels.map((panel, idx) => {
    const label = PANEL_IDS[idx];
    const name = panel.dataset?.name || panel.dataset?.id || "-";
    return `${label}: ${name}`;
  });
  elements.datasetSubtitle.textContent = names.join(" • ");
}

async function loadDatasetForPanel(panelIndex, dataset) {
  const panel = state.panels[panelIndex];
  const panelEl = elements.panels[panelIndex];
  updateStatus(panelIndex, "Loading...");
  if (!dataset) {
    panel.dataset = null;
    panel.meta = [];
    panel.projections = { ego: null, exo: null, avg: null };
    panel.neighbors = null;
    panel.searchIndex = [];
    panel.matchMask = null;
    panel.keyToIndex = new Map();
    panel.hoveredIndex = null;
    panel.hoveredView = null;
    panel.selectedView = null;
    updateStatus(panelIndex, "No dataset");
    updateStats();
    scheduleDraw(panelIndex);
    return;
  }
  const basePath = `${DATA_ROOT}/${dataset.path}`;
  const [metaPayload, statsPayload, neighborsPayload, projEgo, projExo, projAvg] = await Promise.all([
    fetchJson(`${basePath}/meta.json`),
    fetchJson(`${basePath}/stats.json`),
    fetchJson(`${basePath}/neighbors.json`).catch(() => null),
    fetchBin(`${basePath}/proj_ego.bin`),
    fetchBin(`${basePath}/proj_exo.bin`),
    fetchBin(`${basePath}/proj_avg.bin`),
  ]);

  panel.dataset = dataset;
  panel.meta = metaPayload.meta || [];
  panel.labelMaps = metaPayload.label_maps || {};
  panel.projections = { ego: projEgo, exo: projExo, avg: projAvg };
  panel.neighbors = neighborsPayload ? neighborsPayload.neighbors : null;
  panel.searchIndex = panel.meta.map((m) =>
    [m.raw_text, m.verb, m.obj, m.scene, takeGroupB(m.take_name), m.body_part, m.take_name]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
  );
  panel.hoveredIndex = null;
  panel.hoveredView = null;
  panel.selectedView = null;
  panel.keyToIndex = new Map();
  panel.meta.forEach((m, idx) => {
    panel.keyToIndex.set(makeSampleKey(m), idx);
  });

  updateStatus(panelIndex, "Ready");
  updateDatasetSubtitle();
  if (panelIndex === 0) {
    buildTakeOptions();
    buildVerbOptions();
    const appliedDefault = applyDefaultFiltersAfterOptions();
    if (appliedDefault) {
      state.defaultsPending = false;
      state.panels.forEach((_, idx) => computeBase(idx));
      scheduleDrawAll();
      return;
    }
    updateMatchMask();
    state.defaultsPending = false;
  } else {
    updateMatchMask();
  }
  if (panel.meta.length > 0) {
    computeBase(panelIndex);
    if (!state.defaultsPending) {
      scheduleDraw(panelIndex);
    }
  }
}

function applyDefaultFiltersAfterOptions() {
  if (state.defaultApplied) return;
  const targetTake = "indiana_cooking";
  const takeOptions = elements.takeFilter?.options;
  if (!takeOptions || takeOptions.length === 0) return;

  const hasTarget = Array.from(takeOptions).some((opt) => opt.value === targetTake);
  if (!hasTarget) return;

  elements.takeFilter.value = targetTake;
  state.takeFilter = targetTake;
  state.showAll = false;
  if (elements.showAllToggle) {
    elements.showAllToggle.checked = false;
  }

  buildVerbOptions();

  const targetIndices = [6, 7, 10];
  state.selectedTopVerbs = new Set();
  targetIndices.forEach((idx) => {
    const verb = state.topVerbs[idx];
    if (verb) {
      state.selectedTopVerbs.add(verb);
    }
  });

  if (state.selectedTopVerbs.size > 0) {
    if (elements.verbFilter) {
      elements.verbFilter.value = "__all__";
    }
    state.verbFilter = "__all__";
  }

  buildTopVerbChips();
  updateVerbLegend();
  updateMatchMask();
  state.defaultApplied = true;
  return true;
}

async function loadManifest() {
  const candidates = ["data", "../data"];
  let manifest = null;
  for (const candidate of candidates) {
    try {
      manifest = await fetchJson(`${candidate}/manifest.json`);
      DATA_ROOT = candidate;
      break;
    } catch (err) {
      continue;
    }
  }
  state.datasets = manifest ? (manifest.datasets || []) : [];

  elements.datasetSelects.forEach((select) => {
    if (!select) return;
    clearNode(select);
    state.datasets.forEach((dataset) => {
      const option = document.createElement("option");
      option.value = dataset.id;
      option.textContent = dataset.name || dataset.id;
      select.appendChild(option);
    });
  });

  if (state.datasets.length === 0) {
    state.panels.forEach((_, idx) => {
      updateStatus(idx, "No datasets");
    });
    updateDatasetSubtitle();
    return;
  }

  const defaults = state.datasets.slice(0, state.panels.length);
  state.panels.forEach((panel, idx) => {
    const dataset = defaults[idx] || state.datasets[0];
    const select = elements.datasetSelects[idx];
    if (select && dataset) {
      select.value = dataset.id;
    }
    panel.dataset = dataset;
  });

  await Promise.all(
    state.panels.map((panel, idx) => loadDatasetForPanel(idx, panel.dataset))
  );
}

async function loadVideoGallery(config) {
  const candidates = [DATA_ROOT, "data", "../data"];
  const cacheBust = `v=${Date.now()}`;
  const fileName = config?.gallery || "video_gallery.json";
  for (const root of candidates) {
    try {
      const payload = await fetchJson(`${root}/${fileName}?${cacheBust}`);
      return { root, payload, fileName };
    } catch (err) {
      continue;
    }
  }
  return { root: DATA_ROOT || "data", payload: null, fileName };
}

async function loadVerbNameMap(root, config) {
  if (!config || !config.id || !config.id.startsWith("ntu")) {
    return null;
  }
  try {
    const payload = await fetchJson(`${root}/ntu_action_labels.json?v=${Date.now()}`);
    return payload || null;
  } catch (err) {
    return null;
  }
}

async function loadVideoRankings(root, config) {
  const fileName = config?.rankings || "video_rankings.json";
  try {
    const payload = await fetchJson(`${root}/${fileName}?v=${Date.now()}`);
    return payload.rankings || payload || {};
  } catch (err) {}
  try {
    const txtName = fileName.replace(/\\.json$/i, ".txt");
    const response = await fetch(`${root}/${txtName}?v=${Date.now()}`);
    if (!response.ok) return {};
    const text = await response.text();
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const ranking = {};
    lines.forEach((line) => {
      const cleaned = line.replace(/[,]+/g, " ");
      const parts = cleaned.split(/\s+/).filter(Boolean);
      if (parts.length < 2) return;
      const [query, ...rest] = parts;
      ranking[query] = rest;
    });
    return ranking;
  } catch (err) {
    return {};
  }
}

function buildPlaceholderVideos(count = 12) {
  return Array.from({ length: count }).map((_, idx) => ({
    id: `placeholder-${idx + 1}`,
    title: `Clip ${String(idx + 1).padStart(2, "0")}`,
    src: "",
    verb_label: "",
    atomic_text: "",
    start: 0,
    end: 0,
  }));
}

function pickRandomIds(ids, count) {
  const pool = ids.slice();
  const selected = [];
  while (pool.length && selected.length < count) {
    const idx = Math.floor(Math.random() * pool.length);
    selected.push(pool.splice(idx, 1)[0]);
  }
  return selected;
}

function sortQueryIds(ids) {
  return ids.slice().sort((a, b) => {
    const ma = String(a).match(/query_(\d+)/i);
    const mb = String(b).match(/query_(\d+)/i);
    if (ma && mb) {
      return Number(ma[1]) - Number(mb[1]);
    }
    return String(a).localeCompare(String(b));
  });
}

function clampQueryWindowStart(start) {
  const maxStart = Math.max(0, videoState.queryIds.length - 5);
  const step = 5;
  const snapped = Math.max(0, Math.min(maxStart, Math.floor(start / step) * step));
  return snapped;
}

function updateQueryWindow(start) {
  videoState.queryWindowStart = clampQueryWindowStart(start);
  videoState.visibleQueries = [];
  renderVideoGallery();
}

function updateQueryNavButtons() {
  if (!elements.videoPrevBtn && !elements.videoNextBtn) return;
  const maxStart = Math.max(0, videoState.queryIds.length - 5);
  const atStart = videoState.queryWindowStart <= 0;
  const atEnd = videoState.queryWindowStart >= maxStart;
  if (elements.videoPrevBtn) {
    elements.videoPrevBtn.disabled = atStart;
  }
  if (elements.videoNextBtn) {
    elements.videoNextBtn.disabled = atEnd;
  }
}

function shuffleVisibleQueries() {
  const ids = videoState.queryIds;
  if (!ids.length) return;
  const count = Math.min(5, ids.length);
  videoState.visibleQueries = pickRandomIds(ids, count);
  if (!videoState.visibleQueries.includes(videoState.activeQueryId)) {
    videoState.activeQueryId = videoState.visibleQueries[0];
  }
  renderVideoGallery();
}

function ensureQuerySelection() {
  const ids = videoState.queryIds;
  if (!ids.length) {
    videoState.visibleQueries = [];
    videoState.activeQueryId = null;
    return;
  }
  if (!videoState.visibleQueries.length) {
    const start = clampQueryWindowStart(videoState.queryWindowStart);
    videoState.queryWindowStart = start;
    videoState.visibleQueries = ids.slice(start, start + 5);
  }
  if (!videoState.activeQueryId || !videoState.visibleQueries.includes(videoState.activeQueryId)) {
    videoState.activeQueryId = videoState.visibleQueries[0];
  }
}

function formatVideoTitle(item) {
  if (!item) return "";
  const displayVerbLabel =
    (videoState.verbNameMap && item.verb_label && videoState.verbNameMap[item.verb_label]) ||
    item.verb_label ||
    "";
  if (item.atomic_text && displayVerbLabel) {
    const safeVerb = displayVerbLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${safeVerb}\\b`, "i");
    if (regex.test(item.atomic_text)) {
      return item.atomic_text.replace(regex, (match) => `<strong>${match}</strong>`);
    }
    return `<strong>${displayVerbLabel}</strong> ${item.atomic_text}`;
  }
  if (item.atomic_text) {
    return item.atomic_text;
  }
  if (displayVerbLabel) {
    return displayVerbLabel;
  }
  return item.title || item.id || "";
}

function formatQueryBadge(id) {
  if (!id) return "";
  const match = String(id).match(/query_(\d+)/i);
  if (match) {
    return `Q${match[1]}`;
  }
  return String(id);
}

function renderVideoGallery() {
  if (!elements.videoGallery || !elements.videoQueryRow || !elements.videoResultRow) return;
  clearNode(elements.videoQueryRow);
  clearNode(elements.videoResultRow);

  const overlay = elements.videoGalleryOverlay;
  const overlayLabel = overlay?.querySelector(".video-gallery-overlay-label");
  let pendingVideos = 0;
  let loadedVideos = 0;
  let totalVideos = 0;
  let overlayTimer = null;

  const showOverlay = () => {
    if (overlay) {
      overlay.classList.remove("hidden");
    }
  };
  const hideOverlay = () => {
    if (overlay) {
      overlay.classList.add("hidden");
    }
    if (overlayTimer) {
      clearTimeout(overlayTimer);
      overlayTimer = null;
    }
  };
  const showIntroText = !videoState.overlayIntroShown;
  if (overlayLabel) {
    overlayLabel.classList.toggle("hidden", !showIntroText);
    overlayLabel.textContent = "Loading videos…";
  }
  showOverlay();
  if (showIntroText) {
    videoState.overlayIntroShown = true;
  }

  const queryLookup = new Map(videoState.queries.map((item) => [item.id, item]));
  const itemLookup = new Map(videoState.items.map((item) => [item.id, item]));
  ensureQuerySelection();
  updateQueryNavButtons();

  const activeQuery = queryLookup.get(videoState.activeQueryId) || itemLookup.get(videoState.activeQueryId);
  const activeVerb = activeQuery?.verb_label || "";

  const registerVideo = (video, item) => {
    totalVideos += 1;
    let resolved = false;
    let loadTimer = null;
    const markLoaded = () => {
      if (resolved) return;
      resolved = true;
      if (loadTimer) {
        clearTimeout(loadTimer);
        loadTimer = null;
      }
      pendingVideos = Math.max(0, pendingVideos - 1);
      loadedVideos += 1;
      if (loadedVideos >= totalVideos) {
        hideOverlay();
      }
    };
    loadTimer = window.setTimeout(markLoaded, 6000);
      video.addEventListener("loadedmetadata", () => {
        let start = Number(video.dataset.start || 0);
        let end = Number(video.dataset.end || 0);
        const duration = Number(video.duration || 0);
        if (!Number.isFinite(duration) || duration <= 0) {
          return;
        }
        if (!Number.isFinite(start) || start < 0) {
          start = 0;
        }
        if (!Number.isFinite(end) || end <= 0 || end > duration) {
          end = duration;
        }
        if (end - start < 0.2) {
          start = 0;
          end = duration;
        }
        video.dataset.start = String(start);
        video.dataset.end = String(end);
        const safeStart = Math.min(Math.max(start, 0), Math.max(0, duration - 0.03));
        video.currentTime = safeStart;
      });
    video.addEventListener("loadeddata", markLoaded, { once: true });
    video.addEventListener("canplay", markLoaded, { once: true });
    video.addEventListener("error", markLoaded, { once: true });
    video.addEventListener("stalled", markLoaded, { once: true });
    requestAnimationFrame(() => {
      if (video.readyState >= 2) {
        markLoaded();
      }
    });
      video.addEventListener("timeupdate", () => {
        const duration = Number(video.duration || 0);
        if (!Number.isFinite(duration) || duration <= 0) {
          return;
        }
        const start = Number(video.dataset.start || 0);
        const end = Number(video.dataset.end || 0);
        if (Number.isFinite(end) && end > 0 && end - start >= 0.2 && video.currentTime > end) {
          video.currentTime = start;
        }
        if (Number.isFinite(start) && start >= 0 && video.currentTime < start) {
          video.currentTime = start;
        }
      });
  };

  const attachMedia = (card, item) => {
    if (item && item.src) {
      const video = document.createElement("video");
      video.className = "video-thumb";
      video.autoplay = true;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = "auto";
      if (item.start != null) {
        video.dataset.start = String(item.start);
      }
      if (item.end != null) {
        video.dataset.end = String(item.end);
      }
      pendingVideos += 1;
      registerVideo(video, item);
      const source = document.createElement("source");
      source.src = item.src;
      source.type = "video/mp4";
      video.appendChild(source);
      card.appendChild(video);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "video-thumb placeholder";
      placeholder.textContent = "Add video";
      card.appendChild(placeholder);
    }
  };

  videoState.visibleQueries.forEach((id) => {
    const item = queryLookup.get(id) || itemLookup.get(id);
    if (!item) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "video-card";
    if (videoState.activeQueryId === id) {
      button.classList.add("selected");
    }
    button.addEventListener("click", () => {
      if (videoState.activeQueryId === id) return;
      videoState.activeQueryId = id;
      renderVideoGallery();
    });

    const badge = document.createElement("span");
    badge.className = "video-card-rank video-card-query";
    badge.textContent = formatQueryBadge(id);
    button.appendChild(badge);

    attachMedia(button, item);
    const title = document.createElement("div");
    title.className = "video-card-title";
    title.innerHTML = formatVideoTitle(item);
    button.appendChild(title);
    elements.videoQueryRow.appendChild(button);
  });

  const rankingList = (videoState.ranking && videoState.ranking[videoState.activeQueryId]) || [];
  const topList = rankingList.slice(0, 5);

  if (activeQuery) {
    const queryCard = document.createElement("div");
    queryCard.className = "video-card selected";
    const badge = document.createElement("span");
    badge.className = "video-card-rank video-card-query";
    badge.textContent = formatQueryBadge(activeQuery.id);
    queryCard.appendChild(badge);
    attachMedia(queryCard, activeQuery);
    const title = document.createElement("div");
    title.className = "video-card-title";
    title.innerHTML = formatVideoTitle(activeQuery);
    queryCard.appendChild(title);
    elements.videoResultRow.appendChild(queryCard);
  }

  topList.forEach((id, index) => {
    const key = typeof id === "string" ? id : String(id);
    const item = itemLookup.get(key);
    if (!item) return;
    const card = document.createElement("div");
    card.className = "video-card";
    if (activeVerb && item.verb_label && activeVerb === item.verb_label) {
      card.classList.add("verb-match");
    }
    const rank = document.createElement("span");
    rank.className = "video-card-rank";
    rank.textContent = `#${index + 1}`;
    card.appendChild(rank);
    attachMedia(card, item);
    const title = document.createElement("div");
    title.className = "video-card-title";
    title.innerHTML = formatVideoTitle(item);
    card.appendChild(title);
    elements.videoResultRow.appendChild(card);
  });

  if (overlay && totalVideos === 0) {
    hideOverlay();
  } else if (overlay) {
    overlayTimer = window.setTimeout(() => {
      hideOverlay();
    }, 8000);
  }
  if (overlay && pendingVideos <= 0 && loadedVideos >= totalVideos) {
    hideOverlay();
  }
}

async function initVideoGallery() {
  if (!elements.videoGallery) return;
  videoState.configs = VIDEO_CONFIGS.slice();
  renderVideoConfigTabs();
  if (elements.videoShuffleBtn) {
    elements.videoShuffleBtn.addEventListener("click", () => {
      shuffleVisibleQueries();
    });
  }
  if (elements.videoPrevBtn) {
    elements.videoPrevBtn.addEventListener("click", () => {
      updateQueryWindow(videoState.queryWindowStart - 5);
    });
  }
  if (elements.videoNextBtn) {
    elements.videoNextBtn.addEventListener("click", () => {
      updateQueryWindow(videoState.queryWindowStart + 5);
    });
  }
  const initial = videoState.configs[0] || { id: "default" };
  await applyVideoConfig(initial.id);
  videoState.ready = true;
}

function renderVideoConfigTabs() {
  if (!elements.videoConfigTabs) return;
  clearNode(elements.videoConfigTabs);
  videoState.configs.forEach((config) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "video-config-btn";
    const labelSpan = document.createElement("span");
    labelSpan.textContent = config.label || config.id;
    btn.appendChild(labelSpan);
    if (config.tag) {
      const tag = document.createElement("span");
      tag.className = "config-tag";
      tag.textContent = `[${config.tag}]`;
      btn.appendChild(tag);
    }
    btn.dataset.config = config.id;
    if (videoState.currentConfig === config.id) {
      btn.classList.add("active");
    }
    btn.addEventListener("click", () => {
      if (videoState.currentConfig === config.id) return;
      applyVideoConfig(config.id);
    });
    elements.videoConfigTabs.appendChild(btn);
  });
}

async function applyVideoConfig(configId) {
  const config = videoState.configs.find((item) => item.id === configId) || null;
  videoState.currentConfig = config ? config.id : configId;
  renderVideoConfigTabs();
  const { root, payload, fileName } = await loadVideoGallery(config);
  videoState.dataRoot = root;
  videoState.verbNameMap = await loadVerbNameMap(root, config);
  if (!payload || !payload.videos || payload.videos.length === 0) {
    videoState.items = buildPlaceholderVideos(12);
    videoState.queries = videoState.items.slice();
    if (elements.videoGalleryStatus) {
      elements.videoGalleryStatus.textContent = `Add data/${fileName} to populate the video gallery.`;
      elements.videoGalleryStatus.classList.remove("hidden");
    }
  } else {
    videoState.items = payload.videos;
    videoState.queries = (payload.queries && payload.queries.length ? payload.queries : payload.videos);
    if (elements.videoGalleryStatus) {
      elements.videoGalleryStatus.classList.add("hidden");
    }
  }
  videoState.ranking = await loadVideoRankings(root, config);
  videoState.queryIds = sortQueryIds(videoState.queries.map((item) => item.id));
  videoState.queryWindowStart = 0;
  const defaultId = payload?.default_query || payload?.default || videoState.queryIds[0];
  const initialCount = Math.min(5, videoState.queryIds.length);
  if (initialCount > 0) {
    videoState.visibleQueries = pickRandomIds(videoState.queryIds, initialCount);
    videoState.activeQueryId = videoState.visibleQueries[0] || defaultId || null;
  } else {
    videoState.visibleQueries = [];
    videoState.activeQueryId = defaultId || null;
  }
  renderVideoGallery();
}

function bindControls() {
  elements.viewToggle.addEventListener("click", (event) => {
    const btn = event.target.closest("button");
    if (!btn) return;
    state.view = btn.dataset.view;
    setActiveViewButton(state.view);
    state.panels.forEach((_, idx) => computeBase(idx));
    updateStats();
    updateDetail();
    scheduleDrawAll();
  });

  if (elements.showAllToggle) {
    elements.showAllToggle.addEventListener("change", (event) => {
      state.showAll = event.target.checked;
      scheduleDrawAll();
    });
  }

  elements.colorBy.addEventListener("change", (event) => {
    state.colorBy = event.target.value;
    colorCache.clear();
    scheduleDrawAll();
  });

  if (elements.verbFilter) {
    elements.verbFilter.addEventListener("change", () => {
      state.verbFilter = elements.verbFilter.value;
      if (state.verbFilter !== "__all__") {
        state.showAll = false;
        if (elements.showAllToggle) {
          elements.showAllToggle.checked = false;
        }
      }
      updateVerbLegend();
      updateMatchMask();
    });
  }

  elements.takeFilter.addEventListener("change", () => {
    state.takeFilter = elements.takeFilter.value;
    if (state.takeFilter !== "__all__") {
      state.showAll = false;
      if (elements.showAllToggle) {
        elements.showAllToggle.checked = false;
      }
    }
    buildVerbOptions();
    updateMatchMask();
  });

  if (elements.searchInput) {
    elements.searchInput.addEventListener("input", () => {
      updateMatchMask();
    });
  }

  if (elements.pointSize) {
    elements.pointSize.addEventListener("input", (event) => {
      state.pointSize = Number(event.target.value);
      scheduleDrawAll();
    });
  }

  if (elements.pointAlpha) {
    elements.pointAlpha.addEventListener("input", (event) => {
      state.pointAlpha = Number(event.target.value);
      scheduleDrawAll();
    });
  }

  elements.resetView.addEventListener("click", () => {
    state.panels.forEach((_, idx) => computeBase(idx));
    scheduleDrawAll();
  });

  if (elements.reloadBtn) {
    elements.reloadBtn.addEventListener("click", async () => {
      await Promise.all(
        state.panels.map((panel, idx) => loadDatasetForPanel(idx, panel.dataset))
      );
    });
  }

  elements.datasetSelects.forEach((select, idx) => {
    if (!select) return;
    select.addEventListener("change", async (event) => {
      const dataset = state.datasets.find((d) => d.id === event.target.value);
      state.panels[idx].dataset = dataset || null;
      await loadDatasetForPanel(idx, dataset || null);
    });
  });

  if (elements.controlFab && elements.controlMenu) {
    elements.controlFab.addEventListener("click", () => {
      elements.controlMenu.classList.toggle("open");
    });
    document.addEventListener("click", (event) => {
      if (!elements.controlMenu.classList.contains("open")) return;
      const target = event.target;
      if (elements.controlMenu.contains(target) || elements.controlFab.contains(target)) {
        return;
      }
      elements.controlMenu.classList.remove("open");
    });
  }

}

function init() {
  const tryRenderMath = () => {
    if (!window.renderMathInElement) return false;
    window.renderMathInElement(document.body, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\(", right: "\\)", display: false },
      ],
      throwOnError: false,
    });
    return true;
  };

  bindControls();
  state.panels.forEach((_, idx) => bindCanvasEvents(idx));
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("focus", resizeCanvas);
  window.addEventListener("pageshow", resizeCanvas);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      resizeCanvas();
    }
  });
  loadManifest().then(() => initVideoGallery());

  if (!tryRenderMath()) {
    const start = Date.now();
    const timer = setInterval(() => {
      if (tryRenderMath() || Date.now() - start > 4000) {
        clearInterval(timer);
      }
    }, 200);
  }
}

init();
