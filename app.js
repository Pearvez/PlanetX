
// ============================================================
// PLANETX — FULL-SKY SPHEREx EXPLORER
// SPHEREx DR1 HiPS PNG endpoint through Flask.
// Displays all 12,288 HEALPix tile centers.
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
let scannedSectors = new Set(
  loadLocalArray(SCANNED_KEY).map(String)
);

let backendConnected = false;

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
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(savedCandidates)
    );

    localStorage.setItem(
      SCANNED_KEY,
      JSON.stringify([...scannedSectors])
    );
  } catch (error) {
    console.warn('Could not save local state:', error);
  }
}

// ==========================================
// 4. BACKEND CONNECTION
// ==========================================

async function checkBackend() {
  try {
    const response = await fetch(`${API_BASE}/api/health`);

    if (!response.ok) {
      throw new Error(`Backend returned HTTP ${response.status}`);
    }

    const data = await response.json();

    backendConnected = data.status === 'ok';

    if (!backendConnected) {
      throw new Error('Backend health check was unsuccessful.');
    }

    console.log('PLANETX BACKEND:', data);

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
        throw new Error(
          `Tile endpoint returned HTTP ${response.status}`
        );
      }

      const data = await response.json();

      if (
        data.status !== 'ok' ||
        !Array.isArray(data.tiles)
      ) {
        throw new Error('Invalid tile list received.');
      }

      for (const tile of data.tiles) {

        // Backend returns tile_id, not tile.id.
        const tileId = Number(tile.tile_id);

        if (
          !Number.isInteger(tileId) ||
          tileId < 0 ||
          tileId >= TOTAL_SKY_TILES
        ) {
          console.warn('Skipping invalid tile:', tile);
          continue;
        }

        const ra = Number(tile.ra);
        const dec = Number(tile.dec);

        if (!Number.isFinite(ra) || !Number.isFinite(dec)) {
          console.warn('Skipping tile with invalid coordinates:', tile);
          continue;
        }

        SECTORS.push({
          id: `TILE-${String(tileId).padStart(5, '0')}`,
          tileId,
          index: tileId,
          ra,
          dec,
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

    // Ensure there are no duplicate tile IDs.
    const uniqueIds = new Set(
      SECTORS.map(tile => tile.tileId)
    );

    if (uniqueIds.size !== TOTAL_SKY_TILES) {
      throw new Error(
        `Received ${uniqueIds.size} unique tile IDs instead of ${TOTAL_SKY_TILES}.`
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

    tileDataStatus =
      `Could not load sky positions: ${error.message}`;

    console.error('FULL SKY LOAD ERROR:', error);

    renderAllSkyMap();
  }
}

// ==========================================
// 6. MODAL CONTROLS
// ==========================================

function openMissionModal() {
  missionModal?.classList.remove('hidden');
}

function closeMissionModal() {
  missionModal?.classList.add('hidden');
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
// Tile positions are based on their RA and Dec.

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
  if (!SECTORS.length || !canvas) return null;

  let closest = null;
  let closestDistance = Infinity;

  for (const sector of SECTORS) {
    const point = skyToScreen(
      sector.ra,
      sector.dec
    );

    let dx = Math.abs(x - point.x);

    // Handle RA wraparound.
    dx = Math.min(dx, canvas.width - dx);

    const dy = y - point.y;
    const distance = dx * dx + dy * dy;

    if (distance < closestDistance) {
      closestDistance = distance;
      closest = sector;
    }
  }

  return closest;
}

// ==========================================
// 9. FULL-SKY MAP RENDERER
// ==========================================

function renderAllSkyMap() {
  if (!canvas || !ctx) return;

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  // ----------------------------------------
  // Coordinate grid
  // ----------------------------------------

  ctx.strokeStyle = 'rgba(100, 116, 139, 0.12)';
  ctx.lineWidth = 0.7;

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

  // ----------------------------------------
  // Coordinate labels
  // ----------------------------------------

  ctx.fillStyle = 'rgba(148, 163, 184, 0.65)';
  ctx.font = '10px monospace';

  for (let ra = 0; ra < 360; ra += 60) {
    const x = (ra / 360) * canvas.width + 4;

    ctx.fillText(`${ra}° RA`, x, 14);
  }

  for (let dec = -60; dec <= 60; dec += 30) {
    const y = ((90 - dec) / 180) * canvas.height;

    ctx.fillText(`${dec}°`, 5, y - 4);
  }

  // ----------------------------------------
  // DRAW ALL 12,288 HEALPix TILE CENTERS
  // ----------------------------------------

  for (const sector of SECTORS) {
    const point = skyToScreen(
      sector.ra,
      sector.dec
    );

    const isHovered =
      hoveredSector?.tileId === sector.tileId;

    const isSelected =
      activeSector?.tileId === sector.tileId;

    const hasCandidate = savedCandidates.some(
      candidate =>
        Number(candidate.tileId ?? candidate.index) === sector.tileId
    );

    const isScanned = scannedSectors.has(
      String(sector.tileId)
    );

    // Candidate: orange
    // Scanned: green
    // Normal tile: blue
    // Hovered: bright cyan

    if (hasCandidate) {
      ctx.fillStyle = 'rgba(245, 158, 11, 0.95)';
    } else if (isScanned) {
      ctx.fillStyle = 'rgba(34, 197, 94, 0.95)';
    } else if (isHovered || isSelected) {
      ctx.fillStyle = 'rgba(56, 189, 248, 1)';
    } else {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.72)';
    }

    ctx.beginPath();

    ctx.arc(
      point.x,
      point.y,
      isHovered || isSelected ? 3.2 : 1.6,
      0,
      Math.PI * 2
    );

    ctx.fill();

    // Selected tile ring.
    if (isSelected) {
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.arc(
        point.x,
        point.y,
        8,
        0,
        Math.PI * 2
      );

      ctx.stroke();
    }
  }

  // ----------------------------------------
  // MAP STATUS
  // ----------------------------------------

  if (viewportModeTag) {
    viewportModeTag.textContent =
      `FULL SKY // ${SECTORS.length.toLocaleString()} HEALPIX TILES`;
  }

  if (hudReadout) {
    hudReadout.textContent = hoveredSector
      ? `TILE ${hoveredSector.tileId} | RA ${hoveredSector.ra.toFixed(3)}° | DEC ${hoveredSector.dec.toFixed(3)}°`
      : tileDataStatus;
  }
}

// ==========================================
// 10. RENDER SELECTED TILE
// ==========================================

function renderSectorView() {
  if (!canvas || !ctx) return;

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  ctx.fillStyle = '#020308';

  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  if (realObservation && epoch1Source) {
    ctx.drawImage(
      epoch1Source,
      0,
      0,
      canvas.width,
      canvas.height
    );

    if (viewportModeTag) {
      viewportModeTag.textContent =
        'REAL SPHEREx DR1 // HiPS PNG TILE';
    }

    if (hudReadout) {
      hudReadout.textContent =
        `HEALPix TILE ${activeSector.tileId} | CHANNEL ${bandSlider.value}`;
    }

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

  if (viewportModeTag) {
    viewportModeTag.textContent =
      'SPHEREx TILE // WAITING FOR IMAGE';
  }

  if (hudReadout) {
    hudReadout.textContent = tileDataStatus;
  }
}

function renderFrame() {
  if (viewportLevel === 'allsky') {
    renderAllSkyMap();
  } else {
    renderSectorView();
  }
}

// ==========================================
// 11. IMAGE URL NORMALIZATION
// ==========================================

function normalizeImageUrl(data) {
  if (data.data_url) {
    return data.data_url;
  }

  if (!data.image) {
    return null;
  }

  if (data.image.startsWith('data:image/')) {
    return data.image;
  }

  return `data:image/png;base64,${data.image}`;
}

// ==========================================
// 12. LOAD A REAL SPHEREx PNG TILE
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
    // Send the HEALPix tile ID directly.
    // The backend supports tile and channel parameters.

    const params = new URLSearchParams({
      tile: String(activeSector.tileId),
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

    const imageUrl = normalizeImageUrl(data);

    if (!imageUrl) {
      throw new Error(
        'No image was returned by the archive.'
      );
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

    if (targetCoordsEl) {
      targetCoordsEl.textContent =
        `RA ${activeSector.ra.toFixed(4)}° | DEC ${activeSector.dec.toFixed(4)}°`;
    }

    if (btnBlink) btnBlink.disabled = true;
    if (btnDipole) btnDipole.disabled = true;
    if (btnFlag) btnFlag.disabled = true;

    renderSectorView();

    console.log('REAL SPHEREx TILE LOADED:', {
      tile: data.tile_id,
      channel: frame,
      width: image.naturalWidth,
      height: image.naturalHeight,
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
// 13. ENTER A SKY TILE
// ==========================================

async function enterSector(sector) {
  if (!sector) return;

  activeSector = sector;
  hoveredSector = null;
  viewportLevel = 'sector';

  realObservation = false;
  epoch1Source = null;

  canvas?.classList.add('sector-mode');

  if (sectorTitleEl) {
    sectorTitleEl.textContent =
      `Sky Tile ${sector.tileId}`;
  }

  if (sectorBadge) {
    sectorBadge.textContent =
      `HEALPix NESTED | RA ${sector.ra.toFixed(4)}° | DEC ${sector.dec.toFixed(4)}°`;
  }

  if (targetCoordsEl) {
    targetCoordsEl.textContent =
      `RA ${sector.ra.toFixed(4)}° | DEC ${sector.dec.toFixed(4)}°`;
  }

  if (btnBackAllSky) btnBackAllSky.disabled = false;
  if (btnMarkClear) btnMarkClear.disabled = false;

  if (btnBlink) btnBlink.disabled = true;
  if (btnDipole) btnDipole.disabled = true;
  if (btnFlag) btnFlag.disabled = true;

  if (btnFlag) {
    btnFlag.textContent =
      'Candidate Detection Not Available';
  }

  if (spectrumChart) {
    spectrumChart.data.datasets[0].data =
      Array(TOTAL_CHANNELS).fill(0);

    spectrumChart.data.datasets[0].label =
      'No extracted spectrum';

    spectrumChart.update();
  }

  await loadSkyPatch(Number(bandSlider?.value || 1));
}

// ==========================================
// 14. RETURN TO FULL SKY
// ==========================================

function returnToAllSky() {
  tileRequestNumber++;

  viewportLevel = 'allsky';
  activeSector = null;

  realObservation = false;
  epoch1Source = null;

  canvas?.classList.remove('sector-mode');

  if (sectorTitleEl) {
    sectorTitleEl.textContent = 'Full-Sky Survey';
  }

  if (sectorBadge) {
    sectorBadge.textContent =
      `${TOTAL_SKY_TILES.toLocaleString()} HEALPix tile positions`;
  }

  if (targetCoordsEl) {
    targetCoordsEl.textContent =
      'Select a sky tile to retrieve its SPHEREx image.';
  }

  if (btnBackAllSky) btnBackAllSky.disabled = true;
  if (btnMarkClear) btnMarkClear.disabled = true;
  if (btnBlink) btnBlink.disabled = true;
  if (btnDipole) btnDipole.disabled = true;
  if (btnFlag) btnFlag.disabled = true;

  tileDataStatus =
    `${SECTORS.length.toLocaleString()} tile positions loaded.`;

  renderAllSkyMap();
}

// ==========================================
// 15. SPECTRUM CHART
// ==========================================

let spectrumChart = null;

if (typeof Chart !== 'undefined') {
  const spectrumCanvas =
    document.getElementById('spectrum-chart');

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
            legend: {
              display: false
            }
          },

          scales: {
            x: {
              ticks: {
                color: '#94a3b8',
                maxTicksLimit: 8
              },

              grid: {
                color: '#1f293d'
              },

              title: {
                display: true,
                text: 'SPHEREx spectral channel',
                color: '#94a3b8'
              }
            },

            y: {
              ticks: {
                color: '#94a3b8'
              },

              grid: {
                color: '#1f293d'
              }
            }
          }
        }
      }
    );
  }
}

// ==========================================
// 16. TAB NAVIGATION
// ==========================================

function switchTab(tabName) {
  const isExplorer = tabName === 'explorer';

  viewExplorer?.classList.toggle(
    'hidden',
    !isExplorer
  );

  viewCandidates?.classList.toggle(
    'hidden',
    isExplorer
  );

  tabExplorer?.classList.toggle(
    'active',
    isExplorer
  );

  tabCandidates?.classList.toggle(
    'active',
    !isExplorer
  );

  if (isExplorer) {
    renderFrame();
  }
}

// ==========================================
// 17. UPDATE COUNTERS AND MEMORY
// ==========================================

function syncMemory() {
  saveLocalState();

  if (candidateCountEl) {
    candidateCountEl.textContent =
      String(savedCandidates.length);
  }

  if (bannerScannedEl) {
    bannerScannedEl.textContent =
      `${String(scannedSectors.size).padStart(2, '0')}/${TOTAL_SKY_TILES}`;
  }

  if (bannerFlaggedEl) {
    bannerFlaggedEl.textContent =
      String(savedCandidates.length).padStart(2, '0');
  }

  renderCandidatesTable();

  if (viewportLevel === 'allsky') {
    renderAllSkyMap();
  }
}

// ==========================================
// 18. CANDIDATE TABLE
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

    const tileId = Number(
      item.tileId ?? item.index ?? 0
    );

    const cells = [
      `SPX-${String(index + 1).padStart(3, '0')}`,
      item.sectorId ||
        `TILE-${String(tileId).padStart(5, '0')}`,
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
        alert(
          'This tile is not currently available in the loaded map.'
        );
        return;
      }

      switchTab('explorer');

      if (bandSlider) {
        bandSlider.value = item.band || 1;
      }

      enterSector(target);
    });

    actionCell.appendChild(inspectButton);
    row.appendChild(actionCell);

    candidatesTbody.appendChild(row);
  });
}

// ==========================================
// 19. CANVAS COORDINATES
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
// 20. MAP HOVER
// ==========================================

canvas?.addEventListener('mousemove', event => {
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

canvas?.addEventListener('mouseleave', () => {
  if (viewportLevel === 'allsky') {
    hoveredSector = null;
    renderAllSkyMap();
  }
});

// ==========================================
// 21. MAP CLICK
// ==========================================

canvas?.addEventListener('click', event => {
  const { x, y } = getCanvasCoords(event);

  if (viewportLevel === 'allsky') {
    if (!tilesLoaded) {
      if (hudReadout) {
        hudReadout.textContent =
          'Sky tiles are still loading.';
      }
      return;
    }

    const clickedTile = findSectorAtPoint(x, y);

    if (clickedTile) {
      switchTab('explorer');
      enterSector(clickedTile);
    }
  }
});

// ==========================================
// 22. SEARCH SKY TILE
// ==========================================

sectorSearchInput?.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;

  if (!tilesLoaded) {
    if (hudReadout) {
      hudReadout.textContent =
        'Sky tile positions are still loading.';
    }
    return;
  }

  const raw = sectorSearchInput.value
    .trim()
    .toUpperCase();

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
  } else if (hudReadout) {
    hudReadout.textContent =
      'Tile not found. Enter a tile ID from 0 to 12287.';
  }
});

// ==========================================
// 23. NAVIGATION
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

btnBackAllSky?.addEventListener(
  'click',
  returnToAllSky
);

// ==========================================
// 24. MARK TILE AS SCANNED
// ==========================================

btnMarkClear?.addEventListener('click', () => {
  if (!activeSector) return;

  scannedSectors.add(
    String(activeSector.tileId)
  );

  syncMemory();
  returnToAllSky();
});

// ==========================================
// 25. CHANNEL SLIDER
// ==========================================

if (bandSlider) {
  bandSlider.min = 1;
  bandSlider.max = TOTAL_CHANNELS;
  bandSlider.step = 1;

  bandSlider.addEventListener('input', event => {
    const channel = Math.max(
      1,
      Math.min(
        TOTAL_CHANNELS,
        Number(event.target.value)
      )
    );

    if (bandLabel) {
      bandLabel.textContent =
        `Channel ${channel}`;
    }

    if (bannerBandEl) {
      bannerBandEl.textContent =
        String(channel).padStart(3, '0');
    }

    // Exact wavelength values are not calculated here.
    if (bannerWavelengthEl) {
      bannerWavelengthEl.textContent = 'SPHEREx';
    }

    if (
      viewportLevel === 'sector' &&
      activeSector
    ) {
      loadSkyPatch(channel);
    }
  });
}

// ==========================================
// 26. DISABLE UNSUPPORTED ANALYSIS CONTROLS
// ==========================================

if (btnBlink) btnBlink.disabled = true;
if (btnDipole) btnDipole.disabled = true;
if (btnFlag) btnFlag.disabled = true;

btnBlink?.addEventListener('click', () => {
  if (hudReadout) {
    hudReadout.textContent =
      'Blink comparison requires separate calibrated observations.';
  }
});

btnDipole?.addEventListener('click', () => {
  if (hudReadout) {
    hudReadout.textContent =
      'Difference imaging requires separate aligned observations.';
  }
});

// ==========================================
// 27. KEYBOARD CONTROLS
// ==========================================

window.addEventListener('keydown', event => {
  if (
    event.key === 'Escape' &&
    isModalOpen()
  ) {
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
// 28. EXPORT CANDIDATES
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
// 29. CLEAR CANDIDATES
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
// 30. INITIALIZE APPLICATION
// ==========================================

async function initializePlanetX() {
  syncMemory();

  if (bandSlider) {
    bandSlider.min = 1;
    bandSlider.max = TOTAL_CHANNELS;
    bandSlider.value = 1;
  }

  if (bandLabel) {
    bandLabel.textContent = 'Channel 1';
  }

  if (bannerBandEl) {
    bannerBandEl.textContent = '001';
  }

  if (bannerWavelengthEl) {
    bannerWavelengthEl.textContent = 'SPHEREx';
  }

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
