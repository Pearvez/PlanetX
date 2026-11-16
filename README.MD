
# 🌌 PlanetX — SPHEREx Full-Sky Explorer

**Explore the universe through infrared astronomy.**

PlanetX is an interactive astronomy exploration platform built around NASA's SPHEREx mission. It uses the SPHEREx All-Sky Infrared Survey data to help users explore the sky, inspect HEALPix regions, track scanned areas, and save interesting regions as candidates for further investigation.

## 🚀 Project Overview

SPHEREx (Spectro-Photometer for the History of the Universe, Epoch of Reionization, and Ices Explorer) is a NASA space telescope designed to survey the entire sky in 102 infrared wavelength bands.

PlanetX aims to make this data more accessible through an interactive full-sky explorer.

The project currently focuses on:
- Visualizing the full sky using HEALPix tile positions.
- Exploring individual sky regions.
- Loading available SPHEREx HiPS image tiles.
- Tracking scanned regions.
- Saving and managing interesting candidate regions.
- Inspecting sky coordinates and infrared channels.

## ✨ Features

### 🌍 Full-Sky Explorer
- Displays the 12,288 HEALPix tile positions.
- Uses the SPHEREx order-5 sky partition.
- Supports selecting and inspecting individual regions.
- Tracks scanned and selected regions.

### 🔭 SPHEREx Data Integration
- Connects to the official SPHEREx All-Sky HiPS dataset.
- Requests image tiles by tile ID and channel.
- Supports 102 infrared channels.
- Displays available image data through the backend.

### 📍 Candidate Tracking
- Save interesting sky regions.
- Review saved candidates.
- Export candidate data as JSON.
- Store candidate information locally in the browser.

### 📊 Exploration Tools
- Select infrared channels.
- Inspect tile coordinates.
- Track scanned regions.
- View exploration statistics.

## 🛰️ Data Source

The project uses the official SPHEREx All-Sky HiPS dataset hosted by NASA/IPAC.

**Dataset:**
https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube

Important dataset properties:

| Property | Value |
|---|---|
| Sky coverage | All-sky |
| HEALPix order | 5 |
| Number of tiles | 12,288 |
| Channels | 102 |
| Tile width | 512 pixels |
| Coordinate frame | Equatorial |
| Wavelength coverage | Approximately 0.753–4.988 μm |

Not every tile is necessarily available in every channel.

## 🛠️ Technologies Used

### Frontend
- HTML5
- CSS3
- JavaScript
- Chart.js

### Backend
- Python
- Flask
- NumPy
- Astropy
- Astropy-Healpix
- Requests

### Astronomy Data
- NASA/IPAC SPHEREx
- HiPS (Hierarchical Progressive Survey)
- HEALPix

## 📁 Project Structure

```text
PlanetX/
│
├── index.html
├── styles.css
├── app.js
├── server.py
├── requirements.txt
└── README.md
```

## ⚙️ Installation and Setup

### 1. Clone the repository

```bash
git clone https://github.com/Pearvez/PlanetX.git
cd PlanetX
```

### 2. Install dependencies

```bash
python -m pip install -r requirements.txt
```

If dependencies are not listed in requirements.txt, install the backend packages:

```bash
python -m pip install flask flask-cors requests numpy astropy astropy-healpix matplotlib
```

### 3. Start the backend

```bash
python server.py
```

The Flask backend should start on its configured local port.

### 4. Open the frontend

Open `index.html` in a browser or use a local development server.

If the frontend and backend are hosted separately, configure the frontend API address and backend CORS settings to allow communication between them.

## 🔌 Backend API

The Flask backend provides endpoints for interacting with sky data.

| Endpoint | Purpose |
|---|---|
| `/api/health` | Check backend availability |
| `/api/sky/info` | Retrieve sky dataset information |
| `/api/sky/tiles` | Retrieve HEALPix tile positions |
| `/api/sky/locate` | Find the tile containing given coordinates |
| `/api/sky/tile` | Retrieve an individual HiPS image tile |
| `/api/observations` | Access observation information |
| `/api/cutout` | Request a sky cutout |
| `/api/candidates` | Access candidate information |

## 🔬 Scientific Approach

PlanetX uses HEALPix to organize the celestial sphere into equal-area regions.

At HEALPix order 5:

- NSIDE = 32
- Total tiles = 12 × 32²
- Total sky regions = 12,288

Each tile represents a region of the sky and can be associated with celestial coordinates.

The explorer uses these tile positions to create a full-sky navigation interface.

**Important scientific distinction:** Displaying a tile or marking it as a candidate does not establish that an astronomical object or transient event has been detected. Candidate regions require additional scientific analysis and validation.

## 🎯 Project Goals

PlanetX aims to:

1. Make SPHEREx data easier to explore.
2. Create an accessible interface for infrared astronomy.
3. Encourage exploration of unusual astronomical regions.
4. Build a foundation for future data-analysis and candidate-identification tools.
5. Support educational engagement with NASA astronomy missions.

## 🔮 Future Improvements

Potential future developments include:

- Full-sky infrared image mosaics.
- Multi-channel spectral visualization.
- Better sky-coordinate navigation.
- Comparison of multiple observations.
- Automated identification of unusual regions.
- Candidate prioritization and validation tools.
- Integration with additional astronomical datasets.

## ⚠️ Limitations

- Some HiPS tile images may be unavailable for particular channels.
- Tile positions are navigation markers, not astronomical detections.
- The current interface does not establish that a candidate is a real transient or previously unknown object.
- Scientific conclusions require calibrated data, appropriate analysis, and independent verification.

## 📚 References

- [NASA SPHEREx Mission](https://science.nasa.gov/mission/spherex/)
- [NASA/IPAC Infrared Science Archive](https://irsa.ipac.caltech.edu/)
- [SPHEREx All-Sky HiPS Dataset](https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube)
- [HEALPix Documentation](https://healpix.sourceforge.io/)

## 👨‍💻 Developer

**PlanetX** is an group astronomy and data-exploration project developed for the NASA Space Apps Challenge.

GitHub: https://github.com/Pearvez/PlanetX

---

*Exploring the sky, one infrared region at a time. 🌌*
