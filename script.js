const FACTOR_ORDER = ['GTI', 'Crime', 'GPI', 'CPI', 'FSI', 'HCI', 'EPI'];

const FACTOR_LABELS = {
  GTI: 'Терроризм',
  Crime: 'Преступность',
  GPI: 'Социально-политическая обстановка',
  CPI: 'Коррупция',
  FSI: 'Политическая нестабильность',
  HCI: 'Здравоохранение',
  EPI: 'Экология'
};

const NAME_TO_ISO = {
  France: 'FRA',
  Norway: 'NOR',
  Kosovo: 'XKX'
};

const NO_DATA_COLOR = '#cccccc';
const RUSSIA_NAMES = new Set(['Russia', 'Россия']);

const FLOW_K = 34 / Math.sqrt(4610000);
const FLOW_MIN_RADIUS = 4;

const state = {
  map: null,
  countriesLayer: null,
  flowLayer: null,
  flowMarkers: {},
  flowEnabled: false,
  safety: null,
  layersByIso: {},
  layersByName: {},
  nameToIso: { ...NAME_TO_ISO },
  namesRu: { byIso: {}, byName: {} },
  searchItems: [],
  rfOverlay: null,
  activeLevels: new Set([1, 2, 3, 4, 5]),
  selectedIso: null,
  clicksEnabled: true
};

function $(id) {
  return document.getElementById(id);
}

function showPage(pageId) {
  const pages = {
    'welcome-page': 'flex',
    'map-page': 'flex',
    'sources-page': 'block',
    'recommendations-page': 'block'
  };
  Object.keys(pages).forEach((id) => {
    const el = $(id);
    const visible = id === pageId;
    el.hidden = !visible;
    el.style.display = visible ? pages[id] : 'none';
  });
}

function formatNumber(value, digits) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '—';
  }
  return Number(value).toFixed(digits).replace('.', ',');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function getFeatureName(feature) {
  return (feature.properties && feature.properties.name) || '';
}

function getDisplayName(iso, featureName) {
  const data = iso && state.safety && state.safety.countries[iso];
  if (data && data.name_ru) return data.name_ru;
  if (iso && state.namesRu.byIso[iso]) return state.namesRu.byIso[iso];
  if (featureName && state.namesRu.byName[featureName]) return state.namesRu.byName[featureName];
  return featureName || iso || 'Страна';
}

function getFeatureIso(feature) {
  const raw = feature.properties && feature.properties['ISO3166-1-Alpha-3'];
  if (raw && raw !== '-99') {
    return raw;
  }
  const name = getFeatureName(feature);
  return state.nameToIso[name] || '';
}

function isRussia(iso, name) {
  return iso === 'RUS' || RUSSIA_NAMES.has(name);
}

function getLevelMeta(level) {
  const levels = state.safety && state.safety.meta && state.safety.meta.levels;
  return levels && levels[String(level)] ? levels[String(level)] : null;
}

function getLevelColor(level) {
  const meta = getLevelMeta(level);
  return meta ? meta.color : NO_DATA_COLOR;
}

function isLevelVisible(level) {
  return state.activeLevels.has(Number(level));
}

function countryStyle(feature) {
  const name = getFeatureName(feature);
  const iso = getFeatureIso(feature);
  if (isRussia(iso, name)) {
    return {
      fillColor: 'transparent',
      weight: 1,
      color: '#999',
      fillOpacity: 0
    };
  }
  const data = iso ? state.safety.countries[iso] : null;
  if (!data) {
    return {
      fillColor: NO_DATA_COLOR,
      weight: 1,
      color: '#666',
      fillOpacity: 0.6
    };
  }
  const hidden = !isLevelVisible(data.level);
  const selected = iso && iso === state.selectedIso;
  return {
    fillColor: getLevelColor(data.level),
    weight: selected ? 2 : 1,
    color: selected ? '#14181f' : '#666',
    fillOpacity: hidden ? 0.05 : selected ? 0.78 : 0.62
  };
}

function setLayerInteractive(layer, enabled) {
  if (enabled) {
    if (layer._path) {
      layer._path.style.pointerEvents = '';
    }
    layer.options.interactive = true;
  } else {
    if (layer._path) {
      layer._path.style.pointerEvents = 'none';
    }
    layer.options.interactive = false;
  }
}

function applyFilters() {
  if (!state.countriesLayer) return;
  let visible = 0;
  const sampleSize = Object.keys(state.safety.countries).length;

  state.countriesLayer.eachLayer((layer) => {
    const feature = layer.feature;
    const name = getFeatureName(feature);
    const iso = layer.featureIso || getFeatureIso(feature);
    if (isRussia(iso, name)) {
      layer.setStyle(countryStyle(feature));
      setLayerInteractive(layer, false);
      return;
    }
    const data = iso ? state.safety.countries[iso] : null;
    layer.setStyle(countryStyle(feature));
    if (data) {
      const shown = isLevelVisible(data.level);
      if (shown) visible += 1;
      setLayerInteractive(layer, shown);
    } else {
      setLayerInteractive(layer, true);
    }
  });

  $('filter-count').textContent = `показано ${visible} из ${sampleSize}`;
  applyFlowFilter();
  if (state.rfOverlay) {
    state.rfOverlay.bringToFront();
  }
}

function refreshMapSize() {
  if (state.map) {
    state.map.invalidateSize();
  }
}

function openSidePanel() {
  $('side-panel').classList.add('open');
  $('map').classList.add('panel-open');
  $('side-panel').style.transform = '';
  window.setTimeout(refreshMapSize, 280);
}

function closeSidePanel() {
  $('side-panel').classList.remove('open');
  $('map').classList.remove('panel-open');
  $('side-panel').style.transform = '';
  state.selectedIso = null;
  window.setTimeout(refreshMapSize, 280);
}

function renderEmptyPanel(name, iso) {
  $('panel-content').innerHTML = `
    <div class="country-header">
      <h2>${escapeHtml(name || 'Страна')}</h2>
      <span class="country-code">${escapeHtml(iso || '')}</span>
    </div>
    <div class="info-section">
      <p class="empty-sample">Страна не входит в выборку исследования</p>
    </div>
  `;
}

function renderFactorBars(data) {
  const weights = state.safety.meta.weights;
  const imputed = new Set(data.imputed || []);
  return FACTOR_ORDER.map((key) => {
    const normalized = Number(data.normalized[key] || 0);
    const weightPct = Number(weights[key] || 0) * 100;
    const contribution = Number(data.contribution[key] || 0);
    const imputedMark = imputed.has(key)
      ? `<span class="imputed-flag" title="Значение восстановлено импутацией, потому что исходный индекс для этой страны отсутствовал в источнике">данные восстановлены</span>`
      : '';
    return `
      <div class="factor-row">
        <div class="factor-head">
          <span class="factor-name">${FACTOR_LABELS[key]} ${imputedMark}</span>
          <span class="factor-score">${formatNumber(contribution, 2)}</span>
        </div>
        <div class="factor-track" aria-hidden="true">
          <div class="factor-bar" style="width: ${Math.max(0, Math.min(100, normalized))}%"></div>
        </div>
        <p class="factor-meta">нормализ. ${formatNumber(normalized, 1)} · вес ${formatNumber(weightPct, 0)}%</p>
      </div>
    `;
  }).join('');
}

function renderSourcesFooter(updated) {
  const date = updated ? `Данные на ${escapeHtml(updated)}` : '';
  return `
    <div class="panel-footer">
      <p>${date}</p>
      <p>Полный список индексов — на странице «Источники»</p>
    </div>
  `;
}

function renderCountryPanel(iso, data) {
  const level = getLevelMeta(data.level);
  const levelName = (level && level.name) || data.level_name;
  const levelColor = getLevelColor(data.level);
  const title = getDisplayName(iso, data.name_en || data.name_ru);
  const stopRule = data.stop_rule_applied
    ? `<div class="stop-rule-warning">Уровень повышен до критического по стоп-критерию: нормализованное значение GTI или GPI ниже 20</div>`
    : '';

  const extraSections = [
    ['visa', 'Визовый режим', 'visa-info'],
    ['description', 'Описание ситуации', ''],
    ['recommendations', 'Рекомендации', 'recommendations']
  ].map(([field, titleText, extraClass]) => {
    if (isBlank(data[field])) return '';
    return `
      <div class="info-section ${extraClass}">
        <h3>${titleText}</h3>
        <p>${escapeHtml(data[field])}</p>
      </div>
    `;
  }).join('');

  $('panel-content').innerHTML = `
    <div class="country-header">
      <h2>${escapeHtml(title)}</h2>
      <span class="country-code">${escapeHtml(iso)}</span>
    </div>
    <div class="score-block">
      <p class="score-value">${formatNumber(data.score, 1)} <span>/ 100</span></p>
      <span class="level-badge" style="background-color: ${levelColor}">${escapeHtml(levelName)}</span>
    </div>
    ${stopRule}
    <div class="factors">
      <h3>Вклад факторов</h3>
      ${renderFactorBars(data)}
    </div>
    ${extraSections}
    ${renderSourcesFooter(data.updated)}
  `;
}

function openCountry(iso, layer) {
  const data = iso ? state.safety.countries[iso] : null;
  const featureName = layer ? getFeatureName(layer.feature) : '';
  const name = getDisplayName(iso, featureName);
  state.selectedIso = iso;
  if (data) {
    renderCountryPanel(iso, data);
  } else {
    renderEmptyPanel(name, iso);
  }
  openSidePanel();
  if (layer && state.map) {
    const bounds = layer.getBounds();
    if (bounds && bounds.isValid()) {
      state.map.fitBounds(bounds, { padding: [24, 24], maxZoom: 5 });
    }
  }
}

function onEachFeature(feature, layer) {
  const name = getFeatureName(feature);
  const iso = getFeatureIso(feature);
  layer.featureIso = iso;
  layer.displayName = getDisplayName(iso, name);

  if (iso && !state.layersByIso[iso]) {
    state.layersByIso[iso] = layer;
  }
  if (!state.layersByName[layer.displayName]) {
    state.layersByName[layer.displayName] = layer;
  }

  layer.bindTooltip(layer.displayName, {
    sticky: true,
    direction: 'top',
    opacity: 0.92
  });

  if (isRussia(iso, name)) {
    setLayerInteractive(layer, false);
    return;
  }

  layer.on({
    click() {
      const data = iso ? state.safety.countries[iso] : null;
      if (data && !isLevelVisible(data.level)) return;
      openCountry(iso, layer);
    },
    mouseover(event) {
      const data = iso ? state.safety.countries[iso] : null;
      if (data && !isLevelVisible(data.level)) return;
      event.target.setStyle({ fillOpacity: 0.9 });
    },
    mouseout(event) {
      event.target.setStyle(countryStyle(feature));
    }
  });
}

function flowRadius(trips) {
  return Math.max(FLOW_MIN_RADIUS, FLOW_K * Math.sqrt(Number(trips) || 0));
}

function formatTrips(trips) {
  const value = Number(trips);
  if (!Number.isFinite(value)) return '—';
  if (value >= 1000000) {
    return `${formatNumber(value / 1000000, 2)} млн`;
  }
  if (value >= 1000) {
    return `${formatNumber(value / 1000, 1)} тыс.`;
  }
  return String(Math.round(value));
}

function buildLegend() {
  const legend = $('legend');
  const levels = state.safety.meta.levels;
  const items = Object.keys(levels)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => {
      const level = levels[key];
      return `<div><span style="background: ${level.color}"></span> ${escapeHtml(level.name)}</div>`;
    })
    .join('');
  legend.innerHTML = `<p class="hud-label">Уровень опасности</p>${items}<div><span style="background: ${NO_DATA_COLOR}"></span> Нет данных</div>`;
}

function applyFlowFilter() {
  if (!state.flowLayer) return;
  Object.entries(state.flowMarkers).forEach(([iso, marker]) => {
    const data = state.safety.countries[iso];
    const shown = Boolean(state.flowEnabled && data && isLevelVisible(data.level));
    const onMap = state.flowLayer.hasLayer(marker);
    if (shown && !onMap) state.flowLayer.addLayer(marker);
    if (!shown && onMap) state.flowLayer.removeLayer(marker);
  });
  if (state.flowEnabled) {
    state.flowLayer.bringToFront();
  }
}

function setFlowVisible(enabled) {
  state.flowEnabled = Boolean(enabled);
  if (state.map && state.flowLayer) {
    if (state.flowEnabled) {
      state.flowLayer.addTo(state.map);
    } else if (state.map.hasLayer(state.flowLayer)) {
      state.map.removeLayer(state.flowLayer);
    }
  }
  applyFlowFilter();
  buildLegend();
}

function buildFlowLayer() {
  if (!state.map) return;
  if (!state.map.getPane('flowPane')) {
    state.map.createPane('flowPane');
    state.map.getPane('flowPane').style.zIndex = 450;
  }
  if (state.flowLayer) {
    state.flowLayer.remove();
  }
  state.flowLayer = L.layerGroup();
  state.flowMarkers = {};

  Object.entries(state.safety.countries).forEach(([iso, data]) => {
    if (data.ru_trips_2025 == null) return;
    const countryLayer = state.layersByIso[iso];
    if (!countryLayer || !countryLayer.getBounds) return;
    const bounds = countryLayer.getBounds();
    if (!bounds || !bounds.isValid()) return;
    const name = getDisplayName(iso, data.name_en || data.name_ru);
    const levelName = ((getLevelMeta(data.level) || {}).name) || data.level_name || '';
    const marker = L.circleMarker(bounds.getCenter(), {
      pane: 'flowPane',
      radius: flowRadius(data.ru_trips_2025),
      color: '#ffffff',
      weight: 1.5,
      fillColor: '#2f5d8a',
      fillOpacity: 0.42,
      interactive: true
    });
    marker.bindTooltip(
      `${name}: ${formatTrips(data.ru_trips_2025)} поездок · балл ${formatNumber(data.score, 1)} · ${levelName}`,
      { sticky: true, direction: 'top', opacity: 0.92 }
    );
    marker.on('click', () => {
      if (!isLevelVisible(data.level)) return;
      openCountry(iso, countryLayer);
    });
    state.flowMarkers[iso] = marker;
  });
}

function buildFilters() {
  const root = $('level-filters');
  const levels = state.safety.meta.levels;
  root.innerHTML = Object.keys(levels)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => {
      const level = levels[key];
      return `
        <label class="filter-chip">
          <input type="checkbox" value="${key}" checked>
          <span class="filter-swatch" style="background: ${level.color}"></span>
          ${escapeHtml(level.name)}
        </label>
      `;
    })
    .join('');

  root.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => {
      state.activeLevels = new Set(
        Array.from(root.querySelectorAll('input[type="checkbox"]:checked'))
          .map((el) => Number(el.value))
      );
      applyFilters();
    });
  });
}

function buildSearchList() {
  const seen = new Set();
  const items = [];
  if (state.countriesLayer) {
    state.countriesLayer.eachLayer((layer) => {
      const iso = layer.featureIso || getFeatureIso(layer.feature);
      const name = layer.displayName || getDisplayName(iso, getFeatureName(layer.feature));
      if (isRussia(iso, getFeatureName(layer.feature))) return;
      const key = iso || name;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({ iso, name, layer });
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  state.searchItems = items;
  $('country-list').innerHTML = items
    .map((item) => `<option value="${escapeHtml(item.name)}"></option>`)
    .join('');
}

function findCountryByQuery(query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const exact = state.searchItems.find((item) => item.name.toLowerCase() === q);
  if (exact) return exact;
  const starts = state.searchItems.filter((item) => item.name.toLowerCase().startsWith(q));
  if (starts.length === 1) return starts[0];
  const contains = state.searchItems.filter((item) => item.name.toLowerCase().includes(q));
  if (contains.length === 1) return contains[0];
  return null;
}

function selectCountryFromSearch() {
  const match = findCountryByQuery($('country-search').value);
  if (!match) return;
  openCountry(match.iso, match.layer);
}

function setLoading(visible, message) {
  const el = $('map-loading');
  el.hidden = !visible;
  if (message) {
    el.querySelector('.map-loading-card').textContent = message;
  }
}

function logUnmatched(unmatched) {
  if (unmatched.length) {
    console.log('Несопоставленные страны:', unmatched);
  }
}

function buildNameDictionary() {
  state.nameToIso = { ...NAME_TO_ISO };
  Object.entries(state.namesRu.byIso || {}).forEach(([iso, name]) => {
    state.nameToIso[name] = iso;
  });
  Object.entries(state.namesRu.byName || {}).forEach(([en, ru]) => {
    if (state.nameToIso[en]) state.nameToIso[ru] = state.nameToIso[en];
  });
  Object.entries(state.safety.countries).forEach(([iso, country]) => {
    if (country.name_en) state.nameToIso[country.name_en] = iso;
    if (country.name_ru) state.nameToIso[country.name_ru] = iso;
  });
}

async function loadMapData() {
  setLoading(true, 'Загрузка карты…');
  try {
    const [safetyRes, geoRes, namesRes] = await Promise.all([
      fetch('data/safety.json'),
      fetch('countries.simplified.geojson'),
      fetch('data/country-names-ru.json')
    ]);
    if (!safetyRes.ok || !geoRes.ok || !namesRes.ok) {
      throw new Error('Не удалось загрузить данные карты');
    }
    const [safety, geojson, namesRu] = await Promise.all([
      safetyRes.json(),
      geoRes.json(),
      namesRes.json()
    ]);
    state.safety = safety;
    state.namesRu = namesRu;
    buildNameDictionary();
    return geojson;
  } catch (error) {
    setLoading(true, 'Не удалось загрузить карту. Обновите страницу.');
    throw error;
  }
}

function addOfficialRfTerritories() {
  if (state.rfOverlay || !state.map) return;
  fetch('data/rf-official-territories.geojson')
    .then((res) => {
      if (!res.ok) throw new Error('overlay');
      return res.json();
    })
    .then((geojson) => {
      state.rfOverlay = L.geoJSON(geojson, {
        style: {
          fillColor: '#ddd',
          fillOpacity: 1,
          color: '#ddd',
          weight: 3,
          opacity: 1
        },
        onEachFeature(_feature, layer) {
          layer.on({
            click(event) {
              L.DomEvent.stopPropagation(event);
            }
          });
        }
      }).addTo(state.map);
      state.rfOverlay.bringToFront();
    })
    .catch(() => {});
}

function renderCountries(geojson) {
  state.layersByIso = {};
  state.layersByName = {};
  state.countriesLayer = L.geoJSON(geojson, {
    style: countryStyle,
    onEachFeature
  }).addTo(state.map);
  state.countriesLayer.bringToFront();

  const unmatched = Object.keys(state.safety.countries).filter((iso) => !state.layersByIso[iso]);
  logUnmatched(unmatched);
  buildSearchList();
  buildFlowLayer();
  applyFilters();
  addOfficialRfTerritories();
}

async function initMap() {
  if (state.map) return;

  state.map = L.map('map', {
    attributionControl: false,
    zoomControl: false,
    minZoom: 2,
    maxZoom: 5,
    worldCopyJump: false
  }).setView([20, 0], 2);

  L.control.zoom({ position: 'bottomright' }).addTo(state.map);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
    attribution: '',
    noWrap: true,
    minZoom: 2,
    maxZoom: 5,
    opacity: 0.85
  }).addTo(state.map);

  window.setTimeout(refreshMapSize, 100);

  const geojson = await loadMapData();
  buildLegend();
  buildFilters();
  renderCountries(geojson);
  setLoading(false);
  applyDemoHash();
}

function applyDemoHash() {
  const hash = (window.location.hash || '').replace('#', '');
  if (hash === 'flow') {
    const toggle = $('flow-toggle');
    if (toggle) toggle.checked = true;
    setFlowVisible(true);
  }
  if (hash === 'egypt') {
    const match = findCountryByQuery('Египет');
    if (match) openCountry(match.iso, match.layer);
  }
}

function bindNavigation() {
  $('start-button').addEventListener('click', async () => {
    showPage('map-page');
    if (!state.map) {
      setLoading(true, 'Загрузка карты…');
      window.setTimeout(() => {
        initMap();
      }, 80);
    } else {
      window.setTimeout(refreshMapSize, 100);
    }
  });

  $('back-button').addEventListener('click', () => {
    closeSidePanel();
    showPage('welcome-page');
  });

  $('sources-from-welcome').addEventListener('click', () => {
    showPage('sources-page');
  });

  $('sources-button').addEventListener('click', () => {
    closeSidePanel();
    showPage('sources-page');
  });

  $('back-from-sources').addEventListener('click', () => {
    showPage('welcome-page');
  });

  $('recommendations-button').addEventListener('click', () => {
    closeSidePanel();
    showPage('recommendations-page');
  });

  $('back-from-recommendations').addEventListener('click', () => {
    showPage('map-page');
    window.setTimeout(refreshMapSize, 100);
  });
}

function bindPanelControls() {
  $('close-panel').addEventListener('click', closeSidePanel);

  const panel = $('side-panel');
  const handle = $('sheet-handle');
  let startY = 0;
  let dragging = false;

  handle.addEventListener('touchstart', (event) => {
    if (!panel.classList.contains('open')) return;
    dragging = true;
    startY = event.touches[0].clientY;
  }, { passive: true });

  handle.addEventListener('touchmove', (event) => {
    if (!dragging) return;
    const dy = event.touches[0].clientY - startY;
    if (dy > 0) {
      panel.style.transform = `translateY(${dy}px)`;
    }
  }, { passive: true });

  handle.addEventListener('touchend', (event) => {
    if (!dragging) return;
    const dy = event.changedTouches[0].clientY - startY;
    dragging = false;
    if (dy > 80) {
      closeSidePanel();
    } else {
      panel.style.transform = '';
    }
  });

  $('country-search').addEventListener('change', selectCountryFromSearch);
  $('country-search').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      selectCountryFromSearch();
    }
  });

  const flowToggle = $('flow-toggle');
  if (flowToggle) {
    flowToggle.addEventListener('change', () => {
      setFlowVisible(flowToggle.checked);
    });
  }
}

function bindLayout() {
  window.addEventListener('resize', () => {
    window.setTimeout(refreshMapSize, 100);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindNavigation();
  bindPanelControls();
  bindLayout();
  const hash = (window.location.hash || '').replace('#', '');
  if (hash === 'map' || hash === 'flow' || hash === 'egypt') {
    showPage('map-page');
    window.setTimeout(() => {
      initMap();
    }, 80);
  }
});
