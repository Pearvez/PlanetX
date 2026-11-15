
// ============================================================
// PLANETX — FULL-SKY SPHEREx EXPLORER
// Uses the SPHEREx DR1 HiPS PNG endpoint through Flask.
// ============================================================

// ==========================================
// 1. CONFIGURATION
// ==========================================

const API_BASE = '';

const STORAGE_KEY = 'spherex_candidates';
const SCANNED_KEY = 'spherex_scanned_sectors';

const TOTAL_SKY_TILES = 12288;
const TOTAL_CHANNELS = 102;
const TILE_PAGE_SIZE = 1000;

let SECTORS = [];
let tilesLoaded = false;
let hoveredSector = null;
let activeSector = null;
let viewportLevel = 'allsky';

let realObservation = false;
let epoch1Source = null;

let tileRequestNumber = 0;
let tileDataStatus = 'Connecting to SPHEREx...';

let savedCandidates = loadLocalArray(STORAGE_KEY);
let scannedSectors = new Set(loadLocalArray(SCANNED_KEY));

// ==========================================
// 2. DOM ELEMENTS
// ==========================================

const canvas = document.getElementById('sky-canvas');
const ctx = canvas ? canvas.getContext('2d') : null;

const sectorSearchInput = document.getElementById('sector-search');
const logoHome = document.getElementById('logo-home');

const missionModal = document.getElementById('mission-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnStartExploring = document.getElementById('btn-start-exploring');
const btnOpenGuide = document.getElementById('btn-open-guide');
const exploreTrigger = document.getElementById('explore-trigger');

const bannerBandEl = document.getElementById('banner-band');
const bannerWavelengthEl = document.getElementById('banner-wavelength');
const bannerScannedEl = document.getElementById('banner-scanned');
const bannerFlaggedEl = document.getElementById('banner-flagged');

const sectorTitleEl = document.getElementById('sector-title');
const sectorBadge = document.getElementById('sector-badge');
const btnBackAllSky = document.getElementById('btn-back-allsky');
const btnMarkClear = document.getElementById('btn-mark-clear');
const bandSlider = document.getElementById('band-slider');
const bandLabel = document.getElementById('band-label');
const viewportModeTag = document.getElementById('viewport-mode-tag');
const hudReadout = document.getElementById('hud-readout');
const btnBlink = document.getElementById('btn-blink');
const btnDipole = document.getElementById('btn-dipole');
const targetCoordsEl = document.getElementById('target-coords');
const btnFlag = document.getElementById('btn-flag');

const tabExplorer = document.getElementById('tab-explorer');
const tabCandidates = document.getElementById('tab-candidates');
const viewExplorer = document.getElementById('view-explorer');
const viewCandidates = document.getElementById('view-candidates');

const candidateCountEl = document.getElementById('candidate-count');
const candidatesTbody = document.getElementById('candidates-tbody');

const btnExportJson = document.getElementById('btn-export-json');
const btnClearLog = document.getElementById('btn-clear-log');

// ==========================================
// 3. LOCAL STORAGE
// ==========================================

function loadLocalArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch (error) {
    console.warn(`Could not load ${key}:`, error);
    return [];
  }
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedCandidates));
  localStorage.setItem(SCANNED_KEY, JSON.stringify([...scannedSectors]));
}

// ==========================================
// 4. BACKEND CONNECTION
// ==========================================

let backendConnected = false;

async function checkBackend() {
  try {
    const response = await fetch(`${API_BASE}/api/health`);

    if (!response.ok) {
      throw new Error(`Backend returned HTTP ${response.status}`);
    }

    const data = await response.json();

    backendConnected = data.status === 'ok';

    console.log('PLANETX BACKEND:', data);

    if (!backendConnected) {
      throw new Error('Backend health check was unsuccessful.');
    }

    return true;

  } catch (error) {
    backendConnected = false;
    console.error('BACKEND CONNECTION FAILED:', error);
    return false;
  }
}

// ==========================================
// 5. LOAD ALL 12,288 SKY TILE POSITIONS
// ==========================================

async function loadAllSkyTiles() {
  try {
    SECTORS = [];
    tilesLoaded = false;

    tileDataStatus = 'Loading HEALPix sky positions...';
    renderAllSkyMap();

    for (
      let offset = 0;
      offset < TOTAL_SKY_TILES;
      offset += TILE_PAGE_SIZE
    ) {
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(TILE_PAGE_SIZE)
      });

      const response = await fetch(
        `${API_BASE}/api/sky/tiles?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error(`Tile endpoint returned HTTP ${response.status}`);
      }

      const data = await response.json();

      if (
        data.status !== 'ok' ||
        !Array.isArray(data.tiles)
      ) {
        throw new Error('Invalid tile list received.');
      }

      for (const tile of data.tiles) {
        SECTORS.push({
          id: `TILE-${String(tile.id).padStart(5, '0')}`,
          tileId: Number(tile.id),
          index: Number(tile.id),
          ra: Number(tile.ra),
          dec: Number(tile.dec),
          status: tile.status || 'not_checked'
        });
      }

      tileDataStatus =
        `Loading tile positions: ${SECTORS.length.toLocaleString()} / ${TOTAL_SKY_TILES.toLocaleString()}`;

      renderAllSkyMap();
    }

    if (SECTORS.length !== TOTAL_SKY_TILES) {
      throw new Error(
        `Expected ${TOTAL_SKY_TILES} tiles but received ${SECTORS.length}.`
      );
    }

    tilesLoaded = true;

    tileDataStatus =
      `${SECTORS.length.toLocaleString()} HEALPix tile positions loaded.`;

    console.log('FULL SKY LOADED:', SECTORS.length);

    syncMemory();
    renderAllSkyMap();

  } catch (error) {
    tilesLoaded = false;

    tileDataStatus = `Could not load sky positions: ${error.message}`;

    console.error('FULL SKY LOAD ERROR:', error);

    renderAllSkyMap();
  }
}

// ==========================================
// 6. MODAL CONTROLS
// ==========================================

function openMissionModal() {
  if (missionModal) missionModal.classList.remove('hidden');
}

function closeMissionModal() {
  if (missionModal) missionModal.classList.add('hidden');
}

function isModalOpen() {
  return missionModal &&
    !missionModal.classList.contains('hidden');
}

btnCloseModal?.addEventListener('click', closeMissionModal);
btnStartExploring?.addEventListener('click', closeMissionModal);
btnOpenGuide?.addEventListener('click', openMissionModal);
exploreTrigger?.addEventListener('click', openMissionModal);

missionModal?.addEventListener('click', event => {
  if (event.target === missionModal) {
    closeMissionModal();
  }
});

// ==========================================
// 7. SKY COORDINATE PROJECTION
// ==========================================

// Equirectangular display projection.
// HEALPix tile centers are converted to screen positions.

function skyToScreen(ra, dec) {
  return {
    x: (ra / 360) * canvas.width,
    y: ((90 - dec) / 180) * canvas.height
  };
}

function screenToSky(x, y) {
  return {
    ra: Math.max(
      0,
      Math.min(359.999999, (x / canvas.width) * 360)
    ),

    dec: Math.max(
      -90,
      Math.min(90, 90 - (y / canvas.height) * 180)
    )
  };
}

// ==========================================
// 8. FIND CLOSEST SKY TILE
// ==========================================

function findSectorAtPoint(x, y) {
  if (!SECTORS.length) return null;

  let closest = null;
  let closestDistance = Infinity;

  for (const sector of SECTORS) {
    const point = skyToScreen(sector.ra, sector.dec);

    let dx = Math.abs(x - point.x);

    // RA wraps around at 0° and 360°.
    dx = Math.min(dx, canvas.width - dx);

    const dy = y - point.y;
    const distance = dx * dx + dy * dy;

    if (distance < closestDistance) {
      closestDistance = distance;
      closest = sector;
    }
  }

  // Choose the closest tile center.
  // This allows users to select the nearest tile
  // even when tile centers are close together.

  return closest;
}

// ==========================================
// 9. FULL-SKY MAP RENDERER
// ==========================================

function renderAllSkyMap() {
  if (!canvas || !ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#020308';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Coordinate grid.

  ctx.strokeStyle = 'rgba(100, 116, 139, 0.25)';
  ctx.lineWidth = 1;

  for (let ra = 0; ra <= 360; ra += 30) {
    const x = (ra / 360) * canvas.width;

    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }

  for (let dec = -60; dec <= 60; dec += 30) {
    const y = ((90 - dec) / 180) * canvas.height;

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // Coordinate labels.

  ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
  ctx.font = '10px monospace';

  for (let ra = 0; ra < 360; ra += 60) {
    const x = (ra / 360) * canvas.width + 4;
    ctx.fillText(`${ra}° RA`, x, 14);
  }

  for (let dec = -60; dec <= 60; dec += 30) {
    const y = ((90 - dec) / 180) * canvas.height;
    ctx.fillText(`${dec}°`, 5, y - 4);
  }

  // Plot every HEALPix tile center.

  for (const sector of SECTORS) {
    const point = skyToScreen(sector.ra, sector.dec);

    const isHovered =
      hoveredSector &&
      hoveredSector.tileId === sector.tileId;

    const hasCandidate = savedCandidates.some(
      candidate => Number(candidate.tileId) === sector.tileId
    );

    const isScanned = scannedSectors.has(
      String(sector.tileId)
    );

    if (hasCandidate) {
      ctx.fillStyle = '#f59e0b';
    } else if (isHovered) {
      ctx.fillStyle = '#38bdf8';
    } else if (isScanned) {
      ctx.fillStyle = '#22c55e';
    } else {
      ctx.fillStyle = 'rgba(125, 211, 252, 0.65)';
    }

    ctx.beginPath();

    ctx.arc(
      point.x,
      point.y,
      isHovered ? 4 : 1.5,
      0,
      Math.PI * 2
    );

    ctx.fill();
  }

  // Highlight selected tile.

  if (activeSector) {
    const point = skyToScreen(
      activeSector.ra,
      activeSector.dec
    );

    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  viewportModeTag.textContent =
    'FULL SKY // HEALPIX NESTED // 12,288 TILE POSITIONS';

  hudReadout.textContent = hoveredSector
    ? `TILE ${hoveredSector.tileId} | RA ${hoveredSector.ra.toFixed(3)}° | DEC ${hoveredSector.dec.toFixed(3)}°`
    : tileDataStatus;
}

// ==========================================
// 10. RENDER SELECTED TILE
// ==========================================

function renderSectorView() {
  if (!canvas || !ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#020308';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (realObservation && epoch1Source) {
    ctx.drawImage(
      epoch1Source,
      0,
      0,
      canvas.width,
      canvas.height
    );

    viewportModeTag.textContent =
      'REAL SPHEREx DR1 // HiPS PNG TILE';

    hudReadout.textContent =
      `HEALPix TILE ${activeSector.tileId} | CHANNEL ${bandSlider.value}`;

    return;
  }

  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px monospace';
  ctx.textAlign = 'center';

  const lines = tileDataStatus.split('\n');

  lines.forEach((line, index) => {
    ctx.fillText(
      line,
      canvas.width / 2,
      canvas.height / 2 + index * 22
    );
  });

  ctx.textAlign = 'start';

  viewportModeTag.textContent =
    'SPHEREx TILE // WAITING FOR IMAGE';

  hudReadout.textContent = tileDataStatus;
}

function renderFrame() {
  if (viewportLevel === 'allsky') {
    renderAllSkyMap();
  } else {
    renderSectorView();
  }
}

// ==========================================
// 11. LOAD A REAL SPHEREx PNG TILE
// ==========================================

async function loadSkyPatch(channel) {
  if (!activeSector || viewportLevel !== 'sector') {
    return;
  }

  const thisRequest = ++tileRequestNumber;

  const frame = Math.max(
    1,
    Math.min(TOTAL_CHANNELS, Number(channel))
  );

  realObservation = false;
  epoch1Source = null;

  tileDataStatus =
    `Requesting tile ${activeSector.tileId}, channel ${frame}...`;

  renderSectorView();

  try {
    const params = new URLSearchParams({
      ra: String(activeSector.ra),
      dec: String(activeSector.dec),
      channel: String(frame)
    });

    const response = await fetch(
      `${API_BASE}/api/sky/tile?${params.toString()}`
    );

    const data = await response.json();

    if (thisRequest !== tileRequestNumber) {
      return;
    }

    if (!response.ok || data.status !== 'ok') {
      throw new Error(
        data.error || `SPHEREx returned HTTP ${response.status}`
      );
    }

    const imageUrl = data.data_url ||
      (data.image
        ? `data:image/png;base64,${data.image}`
        : null);

    if (!imageUrl) {
      throw new Error('No image was returned by the archive.');
    }

    const image = new Image();

    await new Promise((resolve, reject) => {
      image.onload = resolve;

      image.onerror = () => reject(
        new Error('Could not decode the SPHEREx PNG image.')
      );

      image.src = imageUrl;
    });

    if (thisRequest !== tileRequestNumber) {
      return;
    }

    epoch1Source = image;
    realObservation = true;

    tileDataStatus =
      `REAL SPHEREx DATA | Tile ${data.tile_id} | Channel ${frame}`;

    targetCoordsEl.textContent =
      `RA ${activeSector.ra.toFixed(4)}° | DEC ${activeSector.dec.toFixed(4)}°`;

    btnBlink.disabled = true;
    btnDipole.disabled = true;
    btnFlag.disabled = true;

    renderSectorView();

    console.log('REAL SPHEREx TILE LOADED:', {
      tile: data.tile_id,
      channel: frame,
      width: data.image_width,
      height: data.image_height,
      source: data.source
    });

  } catch (error) {
    if (thisRequest !== tileRequestNumber) {
      return;
    }

    realObservation = false;
    epoch1Source = null;

    tileDataStatus =
      `No image available for this tile/channel.\n${error.message}`;

    console.error('SPHEREx TILE ERROR:', error);

    renderSectorView();
  }
}

// ==========================================
// 12. ENTER A SKY TILE
// ==========================================

async function enterSector(sector) {
  if (!sector) return;

  activeSector = sector;
  viewportLevel = 'sector';

  realObservation = false;
  epoch1Source = null;

  canvas.classList.add('sector-mode');

  sectorTitleEl.textContent =
    `Sky Tile ${sector.tileId}`;

  sectorBadge.textContent =
    `HEALPix NESTED | RA ${sector.ra.toFixed(4)}° | DEC ${sector.dec.toFixed(4)}°`;

  targetCoordsEl.textContent =
    `RA ${sector.ra.toFixed(4)}° | DEC ${sector.dec.toFixed(4)}°`;

  btnBackAllSky.disabled = false;
  btnMarkClear.disabled = false;

  // These controls are disabled because a single PNG
  // does not provide two epochs or a calibrated spectrum.

  btnBlink.disabled = true;
  btnDipole.disabled = true;
  btnFlag.disabled = true;

  btnFlag.textContent = 'Candidate Detection Not Available';

  if (spectrumChart) {
    spectrumChart.data.datasets[0].data = Array(TOTAL_CHANNELS).fill(0);
    spectrumChart.data.datasets[0].label = 'No extracted spectrum';
    spectrumChart.update();
  }

  await loadSkyPatch(Number(bandSlider.value));
}

// ==========================================
// 13. RETURN TO FULL SKY
// ==========================================

function returnToAllSky() {
  // Invalidate any outstanding image request.
  tileRequestNumber++;

  viewportLevel = 'allsky';
  activeSector = null;

  realObservation = false;
  epoch1Source = null;

  canvas.classList.remove('sector-mode');

  sectorTitleEl.textContent = 'Full-Sky Survey';

  sectorBadge.textContent =
    `${TOTAL_SKY_TILES.toLocaleString()} HEALPix tile positions`;

  targetCoordsEl.textContent =
    'Select a sky tile to retrieve its SPHEREx image.';

  btnBackAllSky.disabled = true;
  btnMarkClear.disabled = true;
  btnBlink.disabled = true;
  btnDipole.disabled = true;
  btnFlag.disabled = true;

  tileDataStatus =
    `${SECTORS.length.toLocaleString()} tile positions loaded.`;

  renderAllSkyMap();
}

// ==========================================
// 14. SPECTRUM CHART
// ==========================================

let spectrumChart = null;

if (typeof Chart !== 'undefined') {
  const spectrumCanvas = document.getElementById('spectrum-chart');

  if (spectrumCanvas) {
    spectrumChart = new Chart(
      spectrumCanvas.getContext('2d'),
      {
        type: 'line',

        data: {
          labels: Array.from(
            { length: TOTAL_CHANNELS },
            (_, i) => String(i + 1)
          ),

          datasets: [{
            label: 'No extracted spectrum',
            data: Array(TOTAL_CHANNELS).fill(0),
            borderColor: '#38bdf8',
            backgroundColor: 'rgba(56, 189, 248, 0.18)',
            borderWidth: 2,
            pointRadius: 0,
            fill: true
          }]
        },

        options: {
          responsive: true,
          maintainAspectRatio: false,

          plugins: {
            legend: { display: false }
          },

          scales: {
            x: {
              ticks: {
                color: '#94a3b8',
                maxTicksLimit: 8
              },

              grid: { color: '#1f293d' },

              title: {
                display: true,
                text: 'SPHEREx spectral channel',
                color: '#94a3b8'
              }
            },

            y: {
              ticks: { color: '#94a3b8' },
              grid: { color: '#1f293d' }
            }
          }
        }
      }
    );
  }
}

// ==========================================
// 15. TAB NAVIGATION
// ==========================================

function switchTab(tabName) {
  const isExplorer = tabName === 'explorer';

  viewExplorer.classList.toggle('hidden', !isExplorer);
  viewCandidates.classList.toggle('hidden', isExplorer);

  tabExplorer.classList.toggle('active', isExplorer);
  tabCandidates.classList.toggle('active', !isExplorer);

  if (isExplorer) {
    renderFrame();
  }
}

// ==========================================
// 16. UPDATE COUNTERS AND MEMORY
// ==========================================

function syncMemory() {
  saveLocalState();

  candidateCountEl.textContent =
    String(savedCandidates.length);

  bannerScannedEl.textContent =
    `${String(scannedSectors.size).padStart(2, '0')}/${TOTAL_SKY_TILES}`;

  bannerFlaggedEl.textContent =
    String(savedCandidates.length).padStart(2, '0');

  renderCandidatesTable();
}

// ==========================================
// 17. CANDIDATE TABLE
// ==========================================

function renderCandidatesTable() {
  if (!candidatesTbody) return;

  candidatesTbody.innerHTML = '';

  if (savedCandidates.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');

    cell.colSpan = 7;
    cell.textContent = 'No candidates archived yet.';

    row.appendChild(cell);
    candidatesTbody.appendChild(row);

    return;
  }

  savedCandidates.forEach((item, index) => {
    const row = document.createElement('tr');

    const tileId = Number(item.tileId ?? item.index ?? 0);

    const cells = [
      `SPX-${String(index + 1).padStart(3, '0')}`,
      item.sectorId || `TILE-${String(tileId).padStart(5, '0')}`,
      `${Number(item.ra).toFixed(4)}°, ${Number(item.dec).toFixed(4)}°`,
      `(${item.pixel_x ?? '-'}, ${item.pixel_y ?? '-'})`,
      `Channel ${item.band ?? '-'}`,
      item.flagged_at
        ? new Date(item.flagged_at).toLocaleString()
        : 'Unknown'
    ];

    cells.forEach(value => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    });

    const actionCell = document.createElement('td');
    const inspectButton = document.createElement('button');

    inspectButton.className = 'spx-btn secondary';
    inspectButton.style.padding = '5px 10px';
    inspectButton.textContent = 'Inspect';

    inspectButton.addEventListener('click', () => {
      const target = SECTORS.find(
        tile => tile.tileId === tileId
      );

      if (!target) {
        alert('This tile is not currently available in the loaded map.');
        return;
      }

      switchTab('explorer');

      bandSlider.value = item.band || 1;
      enterSector(target);
    });

    actionCell.appendChild(inspectButton);
    row.appendChild(actionCell);

    candidatesTbody.appendChild(row);
  });
}

// ==========================================
// 18. CANVAS COORDINATES
// ==========================================

function getCanvasCoords(event) {
  const rect = canvas.getBoundingClientRect();

  return {
    x: Math.round(
      (event.clientX - rect.left) *
      (canvas.width / rect.width)
    ),

    y: Math.round(
      (event.clientY - rect.top) *
      (canvas.height / rect.height)
    )
  };
}

// ==========================================
// 19. MAP HOVER
// ==========================================

canvas.addEventListener('mousemove', event => {
  if (viewportLevel !== 'allsky' || !tilesLoaded) {
    return;
  }

  const { x, y } = getCanvasCoords(event);
  const sector = findSectorAtPoint(x, y);

  const oldId = hoveredSector?.tileId;
  const newId = sector?.tileId;

  if (oldId !== newId) {
    hoveredSector = sector;
    renderAllSkyMap();
  }
});

// ==========================================
// 20. MAP CLICK
// ==========================================

canvas.addEventListener('click', event => {
  const { x, y } = getCanvasCoords(event);

  if (viewportLevel === 'allsky') {
    if (!tilesLoaded) {
      hudReadout.textContent = 'Sky tiles are still loading.';
      return;
    }

    const clickedTile = findSectorAtPoint(x, y);

    if (clickedTile) {
      switchTab('explorer');
      enterSector(clickedTile);
    }

    return;
  }
});

// ==========================================
// 21. SEARCH SKY TILE
// ==========================================

sectorSearchInput.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;

  if (!tilesLoaded) {
    hudReadout.textContent = 'Sky tile positions are still loading.';
    return;
  }

  const raw = sectorSearchInput.value.trim().toUpperCase();

  const number = parseInt(
    raw.replace(/[^0-9]/g, ''),
    10
  );

  const match = SECTORS.find(tile =>
    tile.id === raw ||
    (!Number.isNaN(number) && tile.tileId === number)
  );

  if (match) {
    switchTab('explorer');
    enterSector(match);
    sectorSearchInput.value = '';
  } else {
    hudReadout.textContent =
      'Tile not found. Enter a tile ID from 0 to 12287.';
  }
});

// ==========================================
// 22. NAVIGATION
// ==========================================

logoHome?.addEventListener('click', event => {
  event.preventDefault();

  switchTab('explorer');
  returnToAllSky();
});

tabExplorer?.addEventListener('click', () => {
  switchTab('explorer');
});

tabCandidates?.addEventListener('click', () => {
  renderCandidatesTable();
  switchTab('candidates');
});

btnBackAllSky?.addEventListener('click', returnToAllSky);

// ==========================================
// 23. MARK TILE AS SCANNED
// ==========================================

btnMarkClear?.addEventListener('click', () => {
  if (!activeSector) return;

  scannedSectors.add(String(activeSector.tileId));

  syncMemory();
  returnToAllSky();
});

// ==========================================
// 24. CHANNEL SLIDER
// ==========================================

if (bandSlider) {
  bandSlider.min = 1;
  bandSlider.max = TOTAL_CHANNELS;
  bandSlider.step = 1;

  bandSlider.addEventListener('input', event => {
    const channel = Math.max(
      1,
      Math.min(TOTAL_CHANNELS, Number(event.target.value))
    );

    bandLabel.textContent = `Channel ${channel}`;

    bannerBandEl.textContent =
      String(channel).padStart(3, '0');

    // The actual wavelength values are non-uniform.
    // This frontend does not invent wavelength values.

    bannerWavelengthEl.textContent = 'SPHEREx';

    if (viewportLevel === 'sector' && activeSector) {
      loadSkyPatch(channel);
    }
  });
}

// ==========================================
// 25. DISABLE UNSUPPORTED ANALYSIS CONTROLS
// ==========================================

btnBlink.disabled = true;
btnDipole.disabled = true;
btnFlag.disabled = true;

btnBlink?.addEventListener('click', () => {
  hudReadout.textContent =
    'Blink comparison requires separate calibrated observations.';
});

btnDipole?.addEventListener('click', () => {
  hudReadout.textContent =
    'Difference imaging requires separate aligned observations.';
});

// ==========================================
// 26. KEYBOARD CONTROLS
// ==========================================

window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && isModalOpen()) {
    closeMissionModal();
    return;
  }

  if (
    event.key === 'Escape' &&
    viewportLevel === 'sector'
  ) {
    returnToAllSky();
  }
});

// ==========================================
// 27. EXPORT CANDIDATES
// ==========================================

btnExportJson?.addEventListener('click', () => {
  const blob = new Blob(
    [JSON.stringify(savedCandidates, null, 2)],
    { type: 'application/json' }
  );

  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = 'planetx_candidates.json';

  link.click();

  URL.revokeObjectURL(url);
});

// ==========================================
// 28. CLEAR CANDIDATES
// ==========================================

btnClearLog?.addEventListener('click', () => {
  savedCandidates = [];
  scannedSectors.clear();

  syncMemory();

  if (viewportLevel === 'allsky') {
    renderAllSkyMap();
  }
});

// ==========================================
// 29. INITIALIZE APPLICATION
// ==========================================

async function initializePlanetX() {
  syncMemory();

  bandSlider.min = 1;
  bandSlider.max = TOTAL_CHANNELS;
  bandSlider.value = 1;

  bandLabel.textContent = 'Channel 1';

  bannerBandEl.textContent = '001';
  bannerWavelengthEl.textContent = 'SPHEREx';

  renderAllSkyMap();

  backendConnected = await checkBackend();

  if (!backendConnected) {
    tileDataStatus =
      'Backend unavailable. Start Flask and refresh the page.';

    renderAllSkyMap();
    return;
  }

  await loadAllSkyTiles();

  console.log('PlanetX initialized.');
  console.log('Backend:', `${API_BASE}/api/health`);
  console.log('HEALPix tiles:', SECTORS.length);
  console.log('SPHEREx channels:', TOTAL_CHANNELS);
}

initializePlanetX();
