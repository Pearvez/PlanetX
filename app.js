
const USE_MOCK_DATA = true;
const STORAGE_KEY = 'spherex_candidates';
const SCANNED_KEY = 'spherex_scanned_sectors';

// Real SPHEREx demonstration target: WISE 0855
const DEMO_TARGET = {
  ra: 133.795129,
  dec: -7.245147
};

const REAL_DEMO_SECTOR = 'SEC-19';
const STATIC_IMAGE_PATH = '/data/target_cutout.png';
const STATIC_OBSERVATION_DATE = '2025-05-05';

// 1. Grab DOM elements
const canvas = document.getElementById('sky-canvas');
const ctx = canvas.getContext('2d');
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

// 2. Mission Briefing & AI Disclosure Modal Controls
function openMissionModal() {
  missionModal.classList.remove('hidden');
}

function closeMissionModal() {
  missionModal.classList.add('hidden');
}

function isModalOpen() {
  return !missionModal.classList.contains('hidden');
}

btnCloseModal.addEventListener('click', closeMissionModal);
btnStartExploring.addEventListener('click', closeMissionModal);
btnOpenGuide.addEventListener('click', openMissionModal);
exploreTrigger.addEventListener('click', openMissionModal);

missionModal.addEventListener('click', (e) => {
  if (e.target === missionModal) {
    closeMissionModal();
  }
});

// 3. Build 32 All-Sky Demonstration Sectors
const GRID_COLS = 8;
const GRID_ROWS = 4;
const SECTORS = [];

for (let r = 0; r < GRID_ROWS; r++) {
  for (let c = 0; c < GRID_COLS; c++) {
    const idx = r * GRID_COLS + c + 1;
    const id = `SEC-${String(idx).padStart(2, '0')}`;

    const ra = Number(((c + 0.5) * (360 / GRID_COLS)).toFixed(1));
    const dec = Number((67.5 - r * 45).toFixed(1));

    SECTORS.push({
      id,
      index: idx,
      col: c,
      row: r,
      ra,
      dec
    });
  }
}

// 4. Application State
let viewportLevel = 'allsky';
let activeSector = null;
let hoveredSector = null;

let epoch1Source = null;
let epoch2Source = null;

let activeEpoch = 1;
let viewMode = 'blink';
let selectedTarget = null;

let realObservation = false;
let realObservationDate = null;
let realObservationFile = null;
let staticRealImage = false;

let savedCandidates = JSON.parse(
  localStorage.getItem(STORAGE_KEY) || '[]'
);

let scannedSectors = new Set(
  JSON.parse(localStorage.getItem(SCANNED_KEY) || '[]')
);

// Deterministic random generator
function createSeededRng(seed) {
  let s = seed * 2654435761;

  return function () {
    s = (s ^ (s >>> 15)) * 2246822519;
    s = (s ^ (s >>> 13)) * 3266489917;

    return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
  };
}

// Generate simulated sector objects
function getSectorData(sector) {
  const rng = createSeededRng(sector.index * 137);

  const stars = Array.from({ length: 65 }, () => ({
    x: Math.floor(rng() * (canvas.width - 32)) + 16,
    y: Math.floor(rng() * (canvas.height - 32)) + 16,
    brightness: Math.floor(110 + rng() * 145),
    radius: 1.2 + rng() * 1.2
  }));

  const hasMover = sector.index % 4 !== 0;
  const isSlowColdObject = sector.index % 2 === 1;

  const mover = hasMover
    ? {
        e1x: Math.floor(120 + rng() * (canvas.width - 240)),
        e1y: Math.floor(80 + rng() * (canvas.height - 160)),
        dx: isSlowColdObject
          ? Math.floor(18 + rng() * 16)
          : Math.floor(45 + rng() * 35),
        dy: isSlowColdObject
          ? Math.floor(-12 + rng() * 24)
          : Math.floor(-30 + rng() * 60),
        type: isSlowColdObject ? 'cold_ir' : 'asteroid'
      }
    : null;

  return { stars, mover };
}

// 5. All-Sky Map Renderer
const MAP_CX = canvas.width / 2;
const MAP_CY = canvas.height / 2;
const MAP_RX = 296;
const MAP_RY = 156;

function getSectorScreenBox(sector) {
  const gridLeft = MAP_CX - MAP_RX;
  const gridTop = MAP_CY - MAP_RY;

  const cellW = (MAP_RX * 2) / GRID_COLS;
  const cellH = (MAP_RY * 2) / GRID_ROWS;

  return {
    x: gridLeft + sector.col * cellW,
    y: gridTop + sector.row * cellH,
    w: cellW,
    h: cellH
  };
}

function renderAllSkyMap() {
  const band = Number(bandSlider.value);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#020308';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();

  ctx.beginPath();
  ctx.ellipse(
    MAP_CX,
    MAP_CY,
    MAP_RX,
    MAP_RY,
    0,
    0,
    Math.PI * 2
  );
  ctx.clip();

  ctx.fillStyle = '#080d1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const irIntensity = 0.08 + (band / 102) * 0.16;

  ctx.strokeStyle = `rgba(225, 29, 72, ${irIntensity})`;
  ctx.lineWidth = 34;
  ctx.beginPath();

  for (
    let x = MAP_CX - MAP_RX;
    x <= MAP_CX + MAP_RX;
    x += 8
  ) {
    const normX = (x - MAP_CX) / MAP_RX;
    const galY = MAP_CY + Math.sin(normX * Math.PI) * 65;

    if (x === MAP_CX - MAP_RX) {
      ctx.moveTo(x, galY);
    } else {
      ctx.lineTo(x, galY);
    }
  }

  ctx.stroke();

  const skyRng = createSeededRng(999);

  for (let i = 0; i < 220; i++) {
    const sx = MAP_CX - MAP_RX + skyRng() * MAP_RX * 2;
    const sy = MAP_CY - MAP_RY + skyRng() * MAP_RY * 2;

    ctx.fillStyle = `rgba(248, 250, 252, ${0.25 + skyRng() * 0.6})`;
    ctx.fillRect(sx, sy, 1.3, 1.3);
  }

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
  ctx.lineWidth = 1;

  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();

    ctx.ellipse(
      MAP_CX,
      MAP_CY,
      Math.abs(i) * (MAP_RX / 3) || 2,
      MAP_RY,
      0,
      0,
      Math.PI * 2
    );

    ctx.stroke();
  }

  for (let r = 1; r < GRID_ROWS; r++) {
    const y = MAP_CY - MAP_RY + (r * MAP_RY * 2) / GRID_ROWS;

    ctx.beginPath();
    ctx.moveTo(MAP_CX - MAP_RX, y);
    ctx.lineTo(MAP_CX + MAP_RX, y);
    ctx.stroke();
  }

  SECTORS.forEach(sector => {
    const box = getSectorScreenBox(sector);

    const hasCandidate = savedCandidates.some(
      c => (c.sectorId || 'SEC-01') === sector.id
    );

    const isScanned = scannedSectors.has(sector.id);
    const isHovered = hoveredSector && hoveredSector.id === sector.id;

    if (hasCandidate) {
      ctx.fillStyle = 'rgba(245, 158, 11, 0.18)';
      ctx.fillRect(box.x, box.y, box.w, box.h);
    } else if (isScanned) {
      ctx.fillStyle = 'rgba(16, 185, 129, 0.14)';
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }

    if (isHovered) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.28)';
      ctx.fillRect(box.x, box.y, box.w, box.h);

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        box.x + 1,
        box.y + 1,
        box.w - 2,
        box.h - 2
      );
    } else {
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.65)';
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
    }

    ctx.fillStyle = isHovered
      ? '#f8fafc'
      : 'rgba(148, 163, 184, 0.7)';

    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillText(sector.id, box.x + 5, box.y + 13);

    if (hasCandidate) {
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(
        box.x + box.w - 10,
        box.y + box.h - 10,
        3.5,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    if (sector.id === REAL_DEMO_SECTOR) {
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        box.x + 3,
        box.y + 3,
        box.w - 6,
        box.h - 6
      );
    }
  });

  ctx.restore();

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.8;
  ctx.beginPath();

  ctx.ellipse(
    MAP_CX,
    MAP_CY,
    MAP_RX,
    MAP_RY,
    0,
    0,
    Math.PI * 2
  );

  ctx.stroke();

  viewportModeTag.textContent =
    'ALL-SKY DEMONSTRATION PROJECTION';

  if (hoveredSector) {
    hudReadout.textContent =
      `${hoveredSector.id} // RA ${hoveredSector.ra}° DEC ${hoveredSector.dec}°`;
  } else {
    hudReadout.textContent =
      'GREEN OUTLINE = REAL-DATA DEMO SECTOR | CLICK TO INSPECT';
  }
}

// 6. Simulated Epoch Canvas Generator
function buildMockEpochCanvas(sector, epochNum, band) {
  const offscreen = document.createElement('canvas');

  offscreen.width = canvas.width;
  offscreen.height = canvas.height;

  const octx = offscreen.getContext('2d');

  octx.fillStyle = '#020308';
  octx.fillRect(0, 0, canvas.width, canvas.height);

  const { stars, mover } = getSectorData(sector);

  stars.forEach(star => {
    octx.fillStyle =
      `rgb(${star.brightness}, ${star.brightness}, ${star.brightness})`;

    octx.beginPath();
    octx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
    octx.fill();
  });

  if (mover) {
    const targetX = epochNum === 1
      ? mover.e1x
      : mover.e1x + mover.dx;

    const targetY = epochNum === 1
      ? mover.e1y
      : mover.e1y + mover.dy;

    const irGlow = mover.type === 'cold_ir'
      ? Math.min(255, Math.floor(40 + (band / 102) * 215))
      : Math.min(255, Math.floor(220 - (band / 102) * 110));

    octx.fillStyle = `rgb(${irGlow}, ${irGlow}, ${irGlow})`;

    octx.beginPath();
    octx.arc(targetX, targetY, 3, 0, Math.PI * 2);
    octx.fill();
  }

  return offscreen;
}

// Draw selected-object reticle
function drawReticle(x, y) {
  const size = 14;
  const gap = 5;

  ctx.strokeStyle = '#e11d48';
  ctx.lineWidth = 2;

  ctx.beginPath();

  ctx.moveTo(x - size, y - gap);
  ctx.lineTo(x - size, y - size);
  ctx.lineTo(x - gap, y - size);

  ctx.moveTo(x + gap, y - size);
  ctx.lineTo(x + size, y - size);
  ctx.lineTo(x + size, y - gap);

  ctx.moveTo(x - size, y + gap);
  ctx.lineTo(x - size, y + size);
  ctx.lineTo(x - gap, y + size);

  ctx.moveTo(x + gap, y + size);
  ctx.lineTo(x + size, y + size);
  ctx.lineTo(x + size, y + gap);

  ctx.stroke();
}

// 7. Sector Renderer
function renderSectorView() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (realObservation && epoch1Source) {
    ctx.drawImage(
      epoch1Source,
      0,
      0,
      canvas.width,
      canvas.height
    );

    viewportModeTag.textContent = staticRealImage
      ? 'REAL SPHEREx — STATIC PREGENERATED OBSERVATION'
      : `SECTOR ${activeSector.id} // REAL SPHEREx DATA`;

    hudReadout.textContent =
      `${realObservationFile} | ${realObservationDate}`;

    return;
  }

  if (viewMode === 'blink') {
    const src = activeEpoch === 1
      ? epoch1Source
      : epoch2Source;

    if (src) {
      ctx.drawImage(src, 0, 0);
    }

    viewportModeTag.textContent =
      `SECTOR ${activeSector.id} // SIMULATED BLINK`;

    hudReadout.textContent =
      `SIMULATED EPOCH ${activeEpoch} — NOT REAL OBSERVATION DATA`;

  } else if (viewMode === 'dipole') {
    if (!epoch1Source || !epoch2Source) return;

    ctx.drawImage(epoch1Source, 0, 0);

    const e1 = ctx.getImageData(
      0, 0, canvas.width, canvas.height
    );

    ctx.drawImage(epoch2Source, 0, 0);

    const e2 = ctx.getImageData(
      0, 0, canvas.width, canvas.height
    );

    const out = ctx.createImageData(
      canvas.width, canvas.height
    );

    for (let i = 0; i < e1.data.length; i += 4) {
      const diff = e2.data[i] - e1.data[i];

      out.data[i] = diff > 15 ? diff * 2 : 0;
      out.data[i + 1] = 0;
      out.data[i + 2] = diff < -15 ? -diff * 2 : 0;
      out.data[i + 3] = 255;
    }

    ctx.putImageData(out, 0, 0);

    viewportModeTag.textContent =
      `SECTOR ${activeSector.id} // SIMULATED DIFFERENCE`;

    hudReadout.textContent =
      'SIMULATION ONLY — RED/BLUE SHOW MOCK PIXEL DIFFERENCES';
  }

  if (selectedTarget) {
    drawReticle(selectedTarget.x, selectedTarget.y);
  }
}

// 8. Render Frame
function renderFrame() {
  if (viewportLevel === 'allsky') {
    renderAllSkyMap();
  } else {
    renderSectorView();
  }
}

// 9. Enter Sector
function enterSector(sector) {
  activeSector = sector;
  viewportLevel = 'sector';

  viewMode = 'blink';
  activeEpoch = 1;
  selectedTarget = null;

  realObservation = false;
  realObservationDate = null;
  realObservationFile = null;
  staticRealImage = false;

  epoch1Source = null;
  epoch2Source = null;

  canvas.classList.add('sector-mode');

  sectorTitleEl.textContent = `Sector ${sector.id}`;
  sectorBadge.textContent =
    `Grid Coordinates: RA ${sector.ra}°, Dec ${sector.dec}°`;

  targetCoordsEl.textContent =
    'Click an object in this sector...';

  btnBackAllSky.disabled = false;
  btnMarkClear.disabled = false;

  btnBlink.disabled = false;
  btnDipole.disabled = false;

  btnFlag.disabled = true;
  btnFlag.textContent = 'Flag Moving Candidate';

  if (spectrumChart) {
    spectrumChart.data.datasets[0].data = Array(102).fill(0);
    spectrumChart.update();
  }

  loadSkyPatch(Number(bandSlider.value));
}

// 10. Return to All-Sky
function returnToAllSky() {
  viewportLevel = 'allsky';
  activeSector = null;
  selectedTarget = null;

  realObservation = false;
  realObservationDate = null;
  realObservationFile = null;
  staticRealImage = false;

  epoch1Source = null;
  epoch2Source = null;

  canvas.classList.remove('sector-mode');

  sectorTitleEl.textContent = 'All-Sky Survey';

  sectorBadge.textContent =
    '32 demonstration sectors across 360° RA.';

  targetCoordsEl.textContent =
    'Select a sector and click an object...';

  btnBackAllSky.disabled = true;
  btnMarkClear.disabled = true;
  btnBlink.disabled = true;
  btnDipole.disabled = true;
  btnFlag.disabled = true;

  renderFrame();
}

// 11. Static SPHEREx image loader
function loadStaticRealImage() {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => resolve(img);

    img.onerror = () => reject(
      new Error(`Could not load ${STATIC_IMAGE_PATH}`)
    );

    img.src = STATIC_IMAGE_PATH;
  });
}

// 12. Load Real or Simulated Sky Patch
async function loadSkyPatch(band) {
  if (viewportLevel === 'allsky') {
    renderAllSkyMap();
    return;
  }

  if (!activeSector) return;

  if (activeSector.id === REAL_DEMO_SECTOR) {
    // First try the live Flask API.
    try {
      hudReadout.textContent =
        'CONNECTING TO SPHEREx DATA API...';

      const url =
        `/api/cutout?ra=${DEMO_TARGET.ra}` +
        `&dec=${DEMO_TARGET.dec}&size=0.05`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `API request failed with HTTP ${response.status}`
        );
      }

      const data = await response.json();

      if (data.status !== 'real_data' || !data.image) {
        throw new Error('No real FITS image was returned.');
      }

      const img = new Image();

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(
          new Error('Browser could not decode the FITS image.')
        );

        img.src = data.image;
      });

      epoch1Source = img;
      epoch2Source = null;

      realObservation = true;
      realObservationDate = data.date;
      realObservationFile = data.file;
      staticRealImage = false;

      btnBlink.disabled = true;
      btnDipole.disabled = true;
      btnFlag.disabled = true;

      targetCoordsEl.textContent =
        `WISE 0855 | RA ${data.ra}° | DEC ${data.dec}°`;

      viewportModeTag.textContent =
        'REAL SPHEREx OBSERVATION';

      renderSectorView();

      console.log('Real SPHEREx API image loaded:', data);

      return;

    } catch (apiError) {
      console.warn(
        'SPHEREx API unavailable. Trying static image:',
        apiError
      );
    }

    // If the API is unavailable, load the genuine pre-generated PNG.
    try {
      hudReadout.textContent =
        'LOADING PREGENERATED SPHEREx OBSERVATION...';

      const img = await loadStaticRealImage();

      epoch1Source = img;
      epoch2Source = null;

      realObservation = true;
      realObservationDate = STATIC_OBSERVATION_DATE;
      realObservationFile = 'sample_spherex.fits';
      staticRealImage = true;

      btnBlink.disabled = true;
      btnDipole.disabled = true;
      btnFlag.disabled = true;

      targetCoordsEl.textContent =
        `WISE 0855 | RA ${DEMO_TARGET.ra}° | DEC ${DEMO_TARGET.dec}°`;

      viewportModeTag.textContent =
        'REAL SPHEREx — STATIC OBSERVATION';

      hudReadout.textContent =
        `PREGENERATED FITS CUTOUT | ${STATIC_OBSERVATION_DATE}`;

      renderSectorView();

      console.log(
        'Loaded static genuine SPHEREx cutout:',
        STATIC_IMAGE_PATH
      );

      return;

    } catch (imageError) {
      console.error(
        'Static SPHEREx image unavailable:',
        imageError
      );

      hudReadout.textContent =
        'REAL IMAGE UNAVAILABLE — USING SIMULATION';
    }
  }

  // Clearly simulated fallback for other sectors or unavailable images.
  realObservation = false;
  realObservationDate = null;
  realObservationFile = null;
  staticRealImage = false;

  epoch1Source = buildMockEpochCanvas(
    activeSector,
    1,
    band
  );

  epoch2Source = buildMockEpochCanvas(
    activeSector,
    2,
    band
  );

  btnBlink.disabled = false;
  btnDipole.disabled = false;
  btnFlag.disabled = true;

  renderSectorView();
}

// 13. Initialize 102-Band Demonstration Chart
const WAVELENGTHS = Array.from(
  { length: 102 },
  (_, i) => (0.75 + (i / 101) * 4.25).toFixed(2)
);

let spectrumChart = null;

if (typeof Chart !== 'undefined') {
  const spectrumCanvas = document.getElementById('spectrum-chart');

  if (spectrumCanvas) {
    const spectrumCtx = spectrumCanvas.getContext('2d');

    spectrumChart = new Chart(spectrumCtx, {
      type: 'line',

      data: {
        labels: WAVELENGTHS,

        datasets: [{
          label: 'Simulated IR Flux',
          data: Array(102).fill(0),

          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.18)',

          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.25
        }]
      },

      options: {
        responsive: true,
        maintainAspectRatio: false,

        animation: {
          duration: 200
        },

        plugins: {
          legend: {
            display: false
          }
        },

        scales: {
          x: {
            ticks: {
              color: '#94a3b8',
              maxTicksLimit: 6
            },

            grid: {
              color: '#1f293d'
            },

            title: {
              display: true,
              text: 'Wavelength (µm)',
              color: '#94a3b8'
            }
          },

          y: {
            ticks: {
              color: '#94a3b8'
            },

            grid: {
              color: '#1f293d'
            },

            min: 0,
            max: 120
          }
        }
      }
    });
  }
}

// 14. Simulated Spectrum Generator
function getMockSpectrum(sector, x, y) {
  const { mover } = getSectorData(sector);

  let moverType = null;

  if (mover) {
    const distE1 = Math.hypot(
      x - mover.e1x,
      y - mover.e1y
    );

    const distE2 = Math.hypot(
      x - (mover.e1x + mover.dx),
      y - (mover.e1y + mover.dy)
    );

    if (distE1 < 14 || distE2 < 14) {
      moverType = mover.type;
    }
  }

  return WAVELENGTHS.map((wlStr, idx) => {
    const wl = Number(wlStr);
    const noise = (Math.random() - 0.5) * 4;

    if (moverType === 'cold_ir') {
      const methaneDip =
        Math.exp(-Math.pow((wl - 3.3) / 0.22, 2)) * 55;

      return Math.max(
        5,
        25 + idx * 0.7 - methaneDip + noise
      );
    }

    if (moverType === 'asteroid') {
      const iceDip =
        Math.exp(-Math.pow((wl - 3.0) / 0.25, 2)) * 35;

      return Math.max(
        5,
        75 - idx * 0.25 - iceDip + noise
      );
    }

    return Math.max(
      5,
      85 - idx * 0.55 + noise
    );
  });
}

// 15. Tab Navigation
function switchTab(tabName) {
  const isExplorer = tabName === 'explorer';

  viewExplorer.classList.toggle('hidden', !isExplorer);
  viewCandidates.classList.toggle('hidden', isExplorer);

  tabExplorer.classList.toggle('active', isExplorer);
  tabCandidates.classList.toggle('active', !isExplorer);
}

// 16. Save Application State
function syncMemory() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(savedCandidates)
  );

  localStorage.setItem(
    SCANNED_KEY,
    JSON.stringify([...scannedSectors])
  );

  candidateCountEl.textContent = savedCandidates.length;

  bannerScannedEl.textContent =
    `${String(scannedSectors.size).padStart(2, '0')}/32`;

  bannerFlaggedEl.textContent =
    String(savedCandidates.length).padStart(2, '0');

  renderCandidatesTable();
}

// 17. Candidate Table
function renderCandidatesTable() {
  candidatesTbody.innerHTML = '';

  if (savedCandidates.length === 0) {
    const emptyRow = document.createElement('tr');
    const cell = document.createElement('td');

    cell.colSpan = 7;

    cell.textContent =
      'No candidates archived yet. Select a sector to begin.';

    emptyRow.appendChild(cell);
    candidatesTbody.appendChild(emptyRow);

    return;
  }

  savedCandidates.forEach((item, index) => {
    const row = document.createElement('tr');

    const wavelength = (
      0.75 + ((item.band - 1) / 101) * 4.25
    ).toFixed(2);

    const sectorCode = item.sectorId || 'SEC-01';

    const cells = [
      `SPX-${String(index + 1).padStart(3, '0')}`,
      sectorCode,
      `${Number(item.ra).toFixed(4)}°, ${Number(item.dec).toFixed(4)}°`,
      `(${item.pixel_x}, ${item.pixel_y})`,
      `Band ${item.band} (${wavelength} µm)`,
      new Date(item.flagged_at).toLocaleTimeString()
    ];

    cells.forEach(text => {
      const td = document.createElement('td');
      td.textContent = text;
      row.appendChild(td);
    });

    const actionTd = document.createElement('td');
    const inspectBtn = document.createElement('button');

    inspectBtn.className = 'spx-btn secondary';
    inspectBtn.style.padding = '5px 10px';
    inspectBtn.textContent = 'Inspect';

    inspectBtn.addEventListener('click', () => {
      const targetSector =
        SECTORS.find(s => s.id === sectorCode) || SECTORS[0];

      switchTab('explorer');
      enterSector(targetSector);

      bandSlider.value = item.band;

      bandLabel.textContent =
        `${item.band} (${wavelength} µm)`;

      bannerBandEl.textContent =
        String(item.band).padStart(3, '0');

      bannerWavelengthEl.textContent = wavelength;

      activeEpoch = item.epoch || 1;

      selectedTarget = {
        x: item.pixel_x,
        y: item.pixel_y,
        ra: item.ra.toFixed(4),
        dec: item.dec.toFixed(4)
      };

      targetCoordsEl.textContent =
        `RA ${selectedTarget.ra}° | DEC ${selectedTarget.dec}°`;

      loadSkyPatch(item.band);
    });

    actionTd.appendChild(inspectBtn);
    row.appendChild(actionTd);
    candidatesTbody.appendChild(row);
  });
}

// 18. Canvas Mouse Interaction
function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();

  return {
    x: Math.round(
      (e.clientX - rect.left) * (canvas.width / rect.width)
    ),

    y: Math.round(
      (e.clientY - rect.top) * (canvas.height / rect.height)
    )
  };
}

function findSectorAtPoint(x, y) {
  const normX = (x - MAP_CX) / MAP_RX;
  const normY = (y - MAP_CY) / MAP_RY;

  if (normX * normX + normY * normY > 1) {
    return null;
  }

  return (
    SECTORS.find(s => {
      const box = getSectorScreenBox(s);

      return (
        x >= box.x &&
        x <= box.x + box.w &&
        y >= box.y &&
        y <= box.y + box.h
      );
    }) || null
  );
}

canvas.addEventListener('mousemove', (e) => {
  if (viewportLevel !== 'allsky') return;

  const { x, y } = getCanvasCoords(e);
  const sector = findSectorAtPoint(x, y);

  if (sector !== hoveredSector) {
    hoveredSector = sector;
    renderAllSkyMap();
  }
});

canvas.addEventListener('click', async (e) => {
  const { x, y } = getCanvasCoords(e);

  if (viewportLevel === 'allsky') {
    const clickedSector = findSectorAtPoint(x, y);

    if (clickedSector) {
      enterSector(clickedSector);
    }

    return;
  }

  if (realObservation) {
    return;
  }

  const ra = (
    activeSector.ra +
    (x - canvas.width / 2) * 0.002
  ).toFixed(4);

  const dec = (
    activeSector.dec -
    (y - canvas.height / 2) * 0.002
  ).toFixed(4);

  selectedTarget = {
    x,
    y,
    ra,
    dec
  };

  targetCoordsEl.textContent =
    `SIMULATED POSITION: RA ${ra}° | DEC ${dec}°`;

  renderSectorView();

  const fluxData = getMockSpectrum(
    activeSector,
    x,
    y
  );

  if (spectrumChart) {
    spectrumChart.data.datasets[0].data = fluxData;
    spectrumChart.update();
  }

  btnFlag.disabled = false;
  btnFlag.textContent = 'Log Simulated Candidate';
});

// 19. Search Bar
sectorSearchInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;

  const raw = sectorSearchInput.value.trim().toUpperCase();

  const num = parseInt(
    raw.replace(/[^0-9]/g, ''),
    10
  );

  const match =
    SECTORS.find(s => s.id === raw) ||
    (!Number.isNaN(num)
      ? SECTORS.find(s => s.index === num)
      : null);

  if (match) {
    switchTab('explorer');
    enterSector(match);
    sectorSearchInput.value = '';
  }
});

// 20. Navigation Buttons
logoHome.addEventListener('click', (e) => {
  e.preventDefault();

  switchTab('explorer');
  returnToAllSky();
});

tabExplorer.addEventListener('click', () => {
  switchTab('explorer');
});

tabCandidates.addEventListener('click', () => {
  renderCandidatesTable();
  switchTab('candidates');
});

btnBackAllSky.addEventListener('click', returnToAllSky);

btnMarkClear.addEventListener('click', () => {
  if (!activeSector) return;

  scannedSectors.add(activeSector.id);

  syncMemory();
  returnToAllSky();
});

// 21. Blink Button
btnBlink.addEventListener('click', () => {
  if (viewportLevel !== 'sector' || realObservation) {
    return;
  }

  viewMode = 'blink';
  activeEpoch = activeEpoch === 1 ? 2 : 1;

  renderSectorView();
});

// 22. Dipole Button
btnDipole.addEventListener('click', () => {
  if (viewportLevel !== 'sector' || realObservation) {
    return;
  }

  viewMode = 'dipole';

  renderSectorView();
});

// 23. Band Slider
bandSlider.addEventListener('input', (e) => {
  const band = Number(e.target.value);

  const wavelength = (
    0.75 + ((band - 1) / 101) * 4.25
  ).toFixed(2);

  bandLabel.textContent =
    `${band} (${wavelength} µm)`;

  bannerBandEl.textContent =
    String(band).padStart(3, '0');

  bannerWavelengthEl.textContent = wavelength;

  loadSkyPatch(band);
});

// 24. Keyboard Controls
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isModalOpen()) {
    closeMissionModal();
    return;
  }

  if (
    e.code === 'Space' &&
    !isModalOpen() &&
    document.activeElement !== sectorSearchInput &&
    viewportLevel === 'sector' &&
    !realObservation &&
    !viewExplorer.classList.contains('hidden')
  ) {
    e.preventDefault();

    viewMode = 'blink';
    activeEpoch = activeEpoch === 1 ? 2 : 1;

    renderSectorView();
  }
});

// 25. Flag Candidate
btnFlag.addEventListener('click', async () => {
  if (!selectedTarget || !activeSector || realObservation) {
    return;
  }

  const payload = {
    sectorId: activeSector.id,

    ra: Number(selectedTarget.ra),
    dec: Number(selectedTarget.dec),

    pixel_x: selectedTarget.x,
    pixel_y: selectedTarget.y,

    epoch: activeEpoch,
    band: Number(bandSlider.value),

    data_type: 'simulated',
    flagged_at: new Date().toISOString()
  };

  savedCandidates.push(payload);
  scannedSectors.add(activeSector.id);

  syncMemory();

  btnFlag.textContent = 'Simulated Candidate Logged ✓';
  btnFlag.disabled = true;
});

// 26. Export Candidates
btnExportJson.addEventListener('click', () => {
  const blob = new Blob(
    [JSON.stringify(savedCandidates, null, 2)],
    { type: 'application/json' }
  );

  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'spherex_candidates.json';

  a.click();

  URL.revokeObjectURL(url);
});

// 27. Clear Candidate Log
btnClearLog.addEventListener('click', () => {
  savedCandidates = [];
  scannedSectors.clear();

  syncMemory();

  if (viewportLevel === 'allsky') {
    renderAllSkyMap();
  }
});

// 28. Initialize App
syncMemory();
renderAllSkyMap();

console.log('SPHEREx Explorer initialized.');
console.log('Real-data demonstration sector:', REAL_DEMO_SECTOR);
console.log('Demo coordinates:', DEMO_TARGET);
