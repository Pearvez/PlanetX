
from pathlib import Path
from io import BytesIO
from datetime import datetime, timezone
from functools import lru_cache
import base64
import json
import os
import logging

import numpy as np
import requests

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from astropy.io import fits
from astropy.wcs import WCS
from astropy.nddata import Cutout2D
from astropy.coordinates import SkyCoord
from astropy.time import Time
from astropy_healpix import HEALPix
import astropy.units as u

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


# ============================================================
# CONFIGURATION
# ============================================================

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
CANDIDATES_FILE = DATA_DIR / "candidates.json"

HIPS_BASE = (
    "https://irsa.ipac.caltech.edu/data/hips/"
    "SPHEREx/spherex_allsky_cube"
)

NSIDE = 32
ORDER = 5
TOTAL_SKY_TILES = 12 * NSIDE * NSIDE

TOTAL_CHANNELS = 102
FIRST_CHANNEL = 1
LAST_CHANNEL = 102

app = Flask(__name__)
CORS(app)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("PlanetX")

DATA_DIR.mkdir(parents=True, exist_ok=True)

session = requests.Session()

session.headers.update({
    "User-Agent": "PlanetX-SPHEREx-Explorer/1.0"
})

healpix = HEALPix(
    nside=NSIDE,
    order="nested",
    frame="icrs"
)

_fits_metadata_cache = None


# ============================================================
# CORS
# ============================================================

@app.after_request
def add_cors(response):
    origin = request.headers.get("Origin", "")

    allowed = {
        item.strip()
        for item in os.getenv(
            "CORS_ORIGINS",
            "https://shravan50.github.io"
        ).split(",")
        if item.strip()
    }

    if (
        origin in allowed
        or origin.startswith("http://localhost:")
        or origin.startswith("http://127.0.0.1:")
    ):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = (
            "GET, POST, DELETE, OPTIONS"
        )
        response.headers["Vary"] = "Origin"

    return response


# ============================================================
# FULL SKY TILE GENERATION
# ============================================================

@lru_cache(maxsize=1)
def generate_all_sky_tiles():
    """
    Generate all 12,288 HEALPix tile centers.
    """

    pixels = np.arange(TOTAL_SKY_TILES)

    coordinates = healpix.healpix_to_skycoord(pixels)

    tiles = []

    for pixel, coordinate in zip(pixels, coordinates):
        tiles.append({
            "tile_id": int(pixel),
            "ra": round(float(coordinate.ra.deg), 6), # type: ignore
            "dec": round(float(coordinate.dec.deg), 6) # type: ignore
        })

    return tiles


# ============================================================
# FITS FILE SUPPORT
# ============================================================

def get_fits_files():
    patterns = ("*.fits", "*.fits.gz", "*.fit", "*.fts")
    files = []

    for pattern in patterns:
        files.extend(DATA_DIR.glob(pattern))

    return sorted(set(files))


def get_observation_date(hdul):
    for hdu in hdul:
        for key in ("DATE-OBS", "DATE-BEG", "DATE-AVG"):
            value = hdu.header.get(key)

            if value:
                return str(value)

        for key in ("MJD-OBS", "MJD-BEG", "MJD-AVG"):
            value = hdu.header.get(key)

            if value is not None:
                return Time(
                    float(value),
                    format="mjd"
                ).isot

    return "Date not recorded in FITS header"


def get_fits_metadata():
    global _fits_metadata_cache

    files = get_fits_files()

    cache_key = tuple(
        (path.name, path.stat().st_mtime_ns)
        for path in files
    )

    if (
        _fits_metadata_cache is not None
        and _fits_metadata_cache["key"] == cache_key
    ):
        return _fits_metadata_cache["items"]

    items = []

    for path in files:
        try:
            with fits.open(path, memmap=True) as hdul:

                hdu = (
                    hdul["IMAGE"]
                    if "IMAGE" in hdul
                    else hdul[0]
                )

                if hdu.data is None: # type: ignore
                    continue

                wcs = WCS(hdu.header) # type: ignore

                if not wcs.has_celestial:
                    continue

                items.append({
                    "path": path,
                    "wcs": wcs,
                    "shape": hdu.data.shape[-2:], # type: ignore
                    "date": get_observation_date(hdul)
                })

        except Exception as error:
            logger.warning(
                "Skipping %s: %s",
                path.name,
                error
            )

    _fits_metadata_cache = {
        "key": cache_key,
        "items": items
    }

    return items


def find_observations(ra, dec, edge_margin=0):
    target = SkyCoord(
        ra=ra * u.deg,
        dec=dec * u.deg
    )

    matches = []

    for item in get_fits_metadata():
        try:
            x, y = item["wcs"].world_to_pixel(target)

            height, width = item["shape"]

            if (
                edge_margin <= x < width - edge_margin
                and edge_margin <= y < height - edge_margin
            ):
                matches.append({
                    "file": item["path"].name,
                    "date": item["date"],
                    "pixel_x": round(float(x), 2),
                    "pixel_y": round(float(y), 2)
                })

        except Exception as error:
            logger.warning(
                "Observation lookup failed for %s: %s",
                item["path"].name,
                error
            )

    return matches


# ============================================================
# SPHEREX HIPS IMAGE DOWNLOAD
# ============================================================

@lru_cache(maxsize=128)
def download_hips_tile(tile_id, channel):
    """
    Download one SPHEREx HiPS PNG tile.

    Missing images are handled separately from invalid tile IDs.
    """

    directory = (tile_id // 10000) * 10000

    url = (
        f"{HIPS_BASE}/Norder{ORDER}/"
        f"Dir{directory}/"
        f"Npix{tile_id}_{channel}.png"
    )

    response = session.get(
        url,
        timeout=30
    )

    if response.status_code == 404:
        return None

    response.raise_for_status()

    content_type = response.headers.get(
        "Content-Type",
        ""
    )

    if "image" not in content_type.lower():
        raise ValueError(
            "HiPS returned a non-image response."
        )

    return response.content


# ============================================================
# FRONTEND FILES
# ============================================================

@app.get("/")
def home():
    return send_from_directory(
        ROOT,
        "index.html"
    )


@app.get("/app.js")
def javascript():
    return send_from_directory(
        ROOT,
        "app.js"
    )


@app.get("/styles.css")
def stylesheet():
    return send_from_directory(
        ROOT,
        "styles.css"
    )


# ============================================================
# HEALTH
# ============================================================

@app.get("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "project": "PlanetX",
        "sky_coverage": "full_sky",
        "total_tiles": TOTAL_SKY_TILES,
        "total_channels": TOTAL_CHANNELS,
        "fits_files_found": len(get_fits_files()),
        "timestamp": datetime.now(
            timezone.utc
        ).isoformat()
    })


# ============================================================
# SKY INFORMATION
# ============================================================

@app.get("/api/sky/info")
def sky_info():
    return jsonify({
        "status": "ok",
        "survey": "SPHEREx",
        "coverage": "full sky",
        "nside": NSIDE,
        "order": ORDER,
        "total_tiles": TOTAL_SKY_TILES,
        "total_channels": TOTAL_CHANNELS,
        "first_channel": FIRST_CHANNEL,
        "last_channel": LAST_CHANNEL,
        "hips_base": HIPS_BASE
    })


# ============================================================
# PAGINATED FULL SKY API
# ============================================================

@app.get("/api/sky/tiles")
def sky_tiles():
    try:
        offset = int(request.args.get("offset", 0))
        limit = int(request.args.get("limit", 1000))

        if offset < 0 or not 1 <= limit <= 5000:
            raise ValueError

    except ValueError:
        return jsonify({
            "status": "error",
            "error": "Invalid offset or limit."
        }), 400

    all_tiles = generate_all_sky_tiles()

    selected = all_tiles[
        offset:offset + limit
    ]

    return jsonify({
        "status": "ok",
        "total": TOTAL_SKY_TILES,
        "offset": offset,
        "limit": limit,
        "count": len(selected),
        "tiles": selected,
        "has_more": (
            offset + len(selected) < TOTAL_SKY_TILES
        )
    })


# ============================================================
# FIND TILE BY RA / DEC
# ============================================================

@app.get("/api/sky/locate")
def locate_tile():
    try:
        ra = float(request.args["ra"])
        dec = float(request.args["dec"])

        if not 0 <= ra < 360:
            raise ValueError

        if not -90 <= dec <= 90:
            raise ValueError

    except (KeyError, ValueError):
        return jsonify({
            "status": "error",
            "error": "Provide valid RA and Dec."
        }), 400

    coordinate = SkyCoord(
        ra=ra * u.deg,
        dec=dec * u.deg,
        frame="icrs"
    )

    tile_id = int(
        healpix.skycoord_to_healpix(coordinate) # type: ignore
    )

    return jsonify({
        "status": "ok",
        "tile_id": tile_id,
        "ra": ra,
        "dec": dec
    })


# ============================================================
# LOAD SPHEREX IMAGE TILE
# Supports tile ID AND RA/DEC requests.
# ============================================================

@app.get("/api/sky/tile")
def sky_tile():
    try:
        channel = int(
            request.args.get("channel", 1)
        )

        if not FIRST_CHANNEL <= channel <= LAST_CHANNEL:
            raise ValueError(
                "Channel must be between 1 and 102."
            )

        # Preferred: direct HEALPix tile ID.
        if "tile" in request.args:
            tile_id = int(
                request.args["tile"]
            )

            if not 0 <= tile_id < TOTAL_SKY_TILES:
                raise ValueError(
                    "Tile ID is outside the valid range."
                )

            coordinate = healpix.healpix_to_skycoord(
                tile_id
            )

        # Compatibility: convert RA/Dec into a tile ID.
        elif (
            "ra" in request.args
            and "dec" in request.args
        ):
            ra = float(request.args["ra"])
            dec = float(request.args["dec"])

            if not 0 <= ra < 360:
                raise ValueError("Invalid RA.")

            if not -90 <= dec <= 90:
                raise ValueError("Invalid Dec.")

            coordinate = SkyCoord(
                ra=ra * u.deg,
                dec=dec * u.deg,
                frame="icrs"
            )

            tile_id = int(
                healpix.skycoord_to_healpix(
                    coordinate
                ) # type: ignore
            )

        else:
            raise ValueError(
                "Provide tile or both ra and dec."
            )

    except (KeyError, TypeError, ValueError) as error:
        return jsonify({
            "status": "error",
            "error": str(error)
        }), 400

    try:
        image_bytes = download_hips_tile(
            tile_id,
            channel
        )

        if image_bytes is None:
            return jsonify({
                "status": "no_image",
                "tile_id": tile_id,
                "channel": channel,
                "message": (
                    "No image is available for this "
                    "tile and channel."
                )
            }), 404

        encoded = base64.b64encode(
            image_bytes
        ).decode("ascii")

        assert coordinate.dec is not None
        assert coordinate.ra is not None
        return jsonify({
            "status": "ok",
            "tile_id": tile_id,
            "channel": channel,
            "ra": float(coordinate.ra.deg), # type: ignore
            "dec": float(coordinate.dec.deg), # type: ignore
            "image": (
                "data:image/png;base64," + encoded
            )
        })

    except requests.RequestException as error:
        logger.exception(
            "HiPS download failed"
        )

        return jsonify({
            "status": "error",
            "error": "SPHEREx archive request failed.",
            "details": str(error)
        }), 502

    except Exception as error:
        logger.exception(
            "Tile processing failed"
        )

        return jsonify({
            "status": "error",
            "error": str(error)
        }), 500


# ============================================================
# FITS OBSERVATION API
# ============================================================

@app.get("/api/observations")
def observations():
    try:
        ra = float(request.args["ra"])
        dec = float(request.args["dec"])

        if not 0 <= ra < 360:
            raise ValueError

        if not -90 <= dec <= 90:
            raise ValueError

    except (KeyError, ValueError):
        return jsonify({
            "error": "Provide valid RA and Dec."
        }), 400

    matches = find_observations(
        ra,
        dec
    )

    return jsonify({
        "ra": ra,
        "dec": dec,
        "count": len(matches),
        "observations": matches
    })


# ============================================================
# IMAGE DATA URL GENERATION
# ============================================================

def make_image_data_url(data):
    data = np.asarray(
        data,
        dtype=float
    )

    valid = np.isfinite(data)

    if not np.any(valid):
        raise ValueError(
            "No valid pixels."
        )

    low, high = np.nanpercentile(
        data[valid],
        [2, 99.5]
    )

    if high <= low:
        high = low + 1

    normalized = np.clip(
        (data - low) / (high - low),
        0,
        1
    )

    fig, ax = plt.subplots(
        figsize=(5, 5)
    )

    try:
        ax.imshow(
            normalized,
            origin="lower",
            cmap="inferno"
        )

        ax.set_axis_off()

        buffer = BytesIO()

        fig.savefig(
            buffer,
            format="png",
            bbox_inches="tight",
            pad_inches=0,
            dpi=140
        )

        encoded = base64.b64encode(
            buffer.getvalue()
        ).decode("ascii")

        return (
            "data:image/png;base64," + encoded
        )

    finally:
        plt.close(fig)


# ============================================================
# FITS CUTOUT API
# ============================================================

@app.get("/api/cutout")
def cutout():
    try:
        ra = float(request.args["ra"])
        dec = float(request.args["dec"])

        size = float(
            request.args.get("size", "0.05")
        )

        if not 0 <= ra < 360:
            raise ValueError

        if not -90 <= dec <= 90:
            raise ValueError

        if not 0 < size <= 2:
            raise ValueError

    except (KeyError, ValueError):
        return jsonify({
            "error": "Provide valid ra, dec, and size."
        }), 400

    target = SkyCoord(
        ra=ra * u.deg,
        dec=dec * u.deg
    )

    for path in get_fits_files():
        try:
            with fits.open(
                path,
                memmap=True
            ) as hdul:

                hdu = (
                    hdul["IMAGE"]
                    if "IMAGE" in hdul
                    else hdul[0]
                )

                if (
                    hdu.data is None # type: ignore
                    or hdu.data.ndim != 2 # type: ignore
                ):
                    continue

                wcs = WCS(hdu.header) # type: ignore

                if not wcs.has_celestial:
                    continue

                x, y = wcs.world_to_pixel(
                    target
                )

                height, width = hdu.data.shape # type: ignore

                if not (
                    0 <= x < width # type: ignore
                    and 0 <= y < height # type: ignore
                ):
                    continue

                cutout_data = Cutout2D(
                    hdu.data, # type: ignore
                    target,
                    size=(
                        size * u.deg,
                        size * u.deg
                    ),
                    wcs=wcs,
                    mode="partial"
                )

                return jsonify({
                    "status": "real_data",
                    "file": path.name,
                    "date": get_observation_date(hdul),
                    "ra": ra,
                    "dec": dec,
                    "pixel_x": round(float(x), 2), # type: ignore
                    "pixel_y": round(float(y), 2), # type: ignore
                    "shape": list(
                        cutout_data.data.shape
                    ),
                    "image": make_image_data_url(
                        cutout_data.data
                    )
                })

        except Exception as error:
            logger.warning(
                "Cutout failed for %s: %s",
                path.name,
                error
            )

    return jsonify({
        "status": "no_coverage",
        "message": (
            "No local FITS image covers these coordinates."
        ),
        "ra": ra,
        "dec": dec
    }), 404


# ============================================================
# CANDIDATE ARCHIVE
# ============================================================

def read_candidates():
    if not CANDIDATES_FILE.exists():
        return []

    candidates = json.loads(
        CANDIDATES_FILE.read_text()
    )

    if not isinstance(candidates, list):
        raise ValueError(
            "Candidate archive must be a JSON array."
        )

    return candidates


@app.get("/api/candidates")
def list_candidates():
    try:
        return jsonify({
            "candidates": read_candidates()
        })

    except (
        OSError,
        json.JSONDecodeError,
        ValueError
    ) as error:
        return jsonify({
            "error": str(error)
        }), 500


@app.post("/api/candidates")
def save_candidate():
    candidate = request.get_json(
        silent=True
    )

    if not isinstance(candidate, dict):
        return jsonify({
            "error": "Expected a JSON candidate object."
        }), 400

    try:
        candidates = read_candidates()

        candidates.append(candidate)

        CANDIDATES_FILE.write_text(
            json.dumps(
                candidates,
                indent=2
            )
        )

        return jsonify({
            "status": "saved",
            "candidate": candidate,
            "total": len(candidates)
        }), 201

    except (
        OSError,
        json.JSONDecodeError,
        ValueError
    ) as error:
        return jsonify({
            "error": str(error)
        }), 500


@app.delete("/api/candidates")
def clear_candidates():
    try:
        if CANDIDATES_FILE.exists():
            CANDIDATES_FILE.unlink()

        return jsonify({
            "status": "cleared"
        })

    except OSError as error:
        return jsonify({
            "error": str(error)
        }), 500


# ============================================================
# START SERVER
# ============================================================

if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(
            os.getenv("PORT", "5001")
        ),
        debug=False
    )
