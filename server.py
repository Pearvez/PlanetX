
from pathlib import Path
from datetime import datetime, timezone
from functools import lru_cache
from io import BytesIO
import base64
import json
import logging

import numpy as np
import requests

from flask import Flask, jsonify, request, send_from_directory
from astropy_healpix import HEALPix
import astropy.units as u
from PIL import Image


# ==================================================
# CONFIGURATION
# ==================================================

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
CANDIDATES_FILE = Path("/tmp/planetx_candidates.json")

app = Flask(__name__)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("planetx")

# Verified SPHEREx DR1 All-Sky Cube HiPS PNG service
HIPS_BASE_URL = (
    "https://irsa.ipac.caltech.edu/data/hips/"
    "SPHEREx/spherex_allsky_cube"
)

HEALPIX_ORDER = 5
NSIDE = 2 ** HEALPIX_ORDER
TOTAL_SKY_TILES = 12 * NSIDE * NSIDE

TOTAL_CHANNELS = 102
FIRST_FRAME = 1
LAST_FRAME = 102

HEALPIX = HEALPix(
    nside=NSIDE,
    order="nested"
)

HTTP_TIMEOUT = (10, 30)

session = requests.Session()
session.headers.update({
    "User-Agent": "PlanetX-SPHEREx-Sky-Explorer/1.0"
})


# ==================================================
# HELPERS
# ==================================================

def error_response(message, status=400):
    return jsonify({
        "status": "error",
        "error": message
    }), status


def validate_coordinates(ra, dec):
    try:
        ra = float(ra)
        dec = float(dec)
    except (TypeError, ValueError):
        raise ValueError("RA and Dec must be numbers.")

    if not np.isfinite(ra) or not np.isfinite(dec):
        raise ValueError("Coordinates must be finite.")

    if not 0 <= ra < 360:
        raise ValueError("RA must be between 0 and 360.")

    if not -90 <= dec <= 90:
        raise ValueError("Dec must be between -90 and 90.")

    return ra, dec


def get_tile_index(ra, dec):
    ra, dec = validate_coordinates(ra, dec)

    index = HEALPIX.lonlat_to_healpix(
        ra * u.deg,
        dec * u.deg
    )

    return int(index) # type: ignore


def get_tile_center(tile_index):
    if not 0 <= tile_index < TOTAL_SKY_TILES:
        raise ValueError("Invalid HEALPix tile index.")

    lon, lat = HEALPIX.healpix_to_lonlat(tile_index)

    return {
        "ra": float(lon.deg), # type: ignore
        "dec": float(lat.deg) # type: ignore
    }


def get_tile_directory(tile_index):
    return (tile_index // 10000) * 10000


def get_png_url(tile_index, frame):
    """
    Construct the verified SPHEREx HiPS PNG URL.

    HiPS cube frames are numbered 1 through 102.
    """

    directory = get_tile_directory(tile_index)

    return (
        f"{HIPS_BASE_URL}/"
        f"Norder{HEALPIX_ORDER}/"
        f"Dir{directory}/"
        f"Npix{tile_index}_{frame}.png"
    )


# ==================================================
# DOWNLOAD AND CACHE PNG TILES
# ==================================================

@lru_cache(maxsize=128)
def download_hips_tile(tile_index, frame):
    """
    Download one lightweight SPHEREx PNG tile.

    The cache avoids downloading the same tile/frame
    repeatedly while the Python process remains alive.
    """

    url = get_png_url(tile_index, frame)

    logger.info(
        "Fetching SPHEREx PNG: tile=%s frame=%s",
        tile_index,
        frame
    )

    response = session.get(
        url,
        timeout=HTTP_TIMEOUT
    )

    if response.status_code == 404:
        raise FileNotFoundError(
            f"No PNG data available for tile {tile_index}, "
            f"frame {frame}."
        )

    response.raise_for_status()

    content = response.content

    # Verify that the archive actually returned an image.
    try:
        with Image.open(BytesIO(content)) as image:
            if image.format != "PNG":
                raise ValueError("Archive response is not a PNG.")

            image.verify()

    except Exception as error:
        raise ValueError(
            f"Invalid PNG returned by SPHEREx: {error}"
        )

    return content


def make_tile_response(ra, dec, frame):
    tile_index = get_tile_index(ra, dec)

    png_bytes = download_hips_tile(
        tile_index,
        frame
    )

    with Image.open(BytesIO(png_bytes)) as image:
        width, height = image.size

    encoded = base64.b64encode(
        png_bytes
    ).decode("ascii")

    return {
        "status": "ok",
        "real_data": True,
        "source": "SPHEREx DR1 All-Sky Cube HiPS",
        "projection": "HEALPix",
        "ordering": "NESTED",
        "order": HEALPIX_ORDER,
        "total_sky_tiles": TOTAL_SKY_TILES,
        "tile_id": tile_index,
        "tile_center": get_tile_center(tile_index),
        "ra": ra,
        "dec": dec,
        "channel": frame,
        "frame": frame,
        "total_channels": TOTAL_CHANNELS,
        "image": encoded,
        "image_base64": encoded,
        "data_url": "data:image/png;base64," + encoded,
        "image_width": width,
        "image_height": height,
        "fits_url": (
            "https://irsa.ipac.caltech.edu/ibe/data/spherex/"
            "dr1/hips5_cube/hips_20261026/"
            f"Norder5/Dir{get_tile_directory(tile_index)}/"
            f"Npix{tile_index}_cube.fits"
        ),
        "retrieved_at": datetime.now(
            timezone.utc
        ).isoformat()
    }


# ==================================================
# FULL SKY INFORMATION
# ==================================================

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "service": "PlanetX SPHEREx Sky Explorer",
        "archive": "IRSA",
        "archive_connection": "HiPS PNG",
        "all_sky_cube": True,
        "cube_release": "DR1",
        "healpix_order": HEALPIX_ORDER,
        "healpix_ordering": "NESTED",
        "total_sky_tiles": TOTAL_SKY_TILES,
        "spectral_channels": TOTAL_CHANNELS,
        "first_frame": FIRST_FRAME,
        "last_frame": LAST_FRAME,
        "timestamp": datetime.now(
            timezone.utc
        ).isoformat()
    })


@app.route("/api/sky/info", methods=["GET"])
def sky_info():
    return jsonify({
        "status": "ok",
        "name": "SPHEREx DR1 All-Sky Cube",
        "hips_url": HIPS_BASE_URL,
        "projection": "HEALPix",
        "ordering": "NESTED",
        "order": HEALPIX_ORDER,
        "nside": NSIDE,
        "total_tiles": TOTAL_SKY_TILES,
        "total_channels": TOTAL_CHANNELS,
        "first_frame": FIRST_FRAME,
        "last_frame": LAST_FRAME,
        "tile_width": 512
    })


# ==================================================
# ALL 12,288 SKY TILES
# ==================================================

@app.route("/api/sky/tiles", methods=["GET"])
def sky_tiles():
    """
    Return coordinates for every tile.

    Example:
    /api/sky/tiles?offset=0&limit=1000
    """

    try:
        offset = int(request.args.get("offset", 0))
        limit = int(request.args.get("limit", 1000))

        if offset < 0:
            return error_response(
                "Offset cannot be negative."
            )

        if limit < 1:
            return error_response(
                "Limit must be positive."
            )

        limit = min(limit, TOTAL_SKY_TILES)

        end = min(
            offset + limit,
            TOTAL_SKY_TILES
        )

        if offset >= TOTAL_SKY_TILES:
            return jsonify({
                "status": "ok",
                "tiles": [],
                "total_tiles": TOTAL_SKY_TILES,
                "returned": 0
            })

        indices = np.arange(offset, end)

        lon, lat = HEALPIX.healpix_to_lonlat(indices)

        tiles = []

        for i, index in enumerate(indices):
            tiles.append({
                "id": int(index),
                "ra": float(lon.deg[i]), # type: ignore
                "dec": float(lat.deg[i]), # type: ignore
                "status": "not_checked"
            })

        return jsonify({
            "status": "ok",
            "projection": "HEALPix",
            "ordering": "NESTED",
            "order": HEALPIX_ORDER,
            "total_tiles": TOTAL_SKY_TILES,
            "offset": offset,
            "returned": len(tiles),
            "tiles": tiles
        })

    except Exception as error:
        logger.exception("Tile generation failed")
        return error_response(str(error), 500)


# ==================================================
# REAL SPHEREX IMAGE FOR ANY SKY COORDINATE
# ==================================================

@app.route("/api/sky/tile", methods=["GET"])
def sky_tile():
    """
    Retrieve a real PNG tile for any RA/Dec.

    Example:
    /api/sky/tile?ra=133.795129&dec=-7.245147&channel=1
    """

    try:
        ra, dec = validate_coordinates(
            request.args.get("ra"),
            request.args.get("dec")
        )

        frame = int(
            request.args.get(
                "channel",
                request.args.get("frame", 1)
            )
        )

        if not FIRST_FRAME <= frame <= LAST_FRAME:
            return error_response(
                "Frame must be between 1 and 102."
            )

        result = make_tile_response(
            ra,
            dec,
            frame
        )

        return jsonify(result)

    except FileNotFoundError as error:
        return jsonify({
            "status": "no_data",
            "real_data": False,
            "error": str(error)
        }), 404

    except requests.RequestException as error:
        logger.exception("SPHEREx archive request failed")
        return error_response(
            f"SPHEREx archive request failed: {error}",
            502
        )

    except Exception as error:
        logger.exception("Sky tile request failed")
        return error_response(str(error), 500)


# ==================================================
# COMPATIBILITY: EXISTING FRONTEND
# ==================================================

@app.route("/api/cutout", methods=["GET"])
def cutout():
    """
    Compatibility endpoint for the old frontend.

    Returns a HiPS PNG tile, not a small angular cutout.
    """

    try:
        ra, dec = validate_coordinates(
            request.args.get("ra"),
            request.args.get("dec")
        )

        frame = int(
            request.args.get(
                "channel",
                request.args.get("band", 1)
            )
        )

        if not FIRST_FRAME <= frame <= LAST_FRAME:
            return error_response(
                "Frame must be between 1 and 102."
            )

        return jsonify(
            make_tile_response(ra, dec, frame)
        )

    except FileNotFoundError as error:
        return jsonify({
            "status": "no_data",
            "real_data": False,
            "error": str(error)
        }), 404

    except requests.RequestException as error:
        return error_response(
            f"SPHEREx archive request failed: {error}",
            502
        )

    except Exception as error:
        logger.exception("Cutout failed")
        return error_response(str(error), 500)


# ==================================================
# OBSERVATION / COORDINATE LOOKUP
# ==================================================

@app.route("/api/observations", methods=["GET"])
def observations():
    try:
        ra, dec = validate_coordinates(
            request.args.get("ra"),
            request.args.get("dec")
        )

        tile_index = get_tile_index(ra, dec)

        return jsonify({
            "status": "ok",
            "source": "SPHEREx DR1 All-Sky Cube",
            "ra": ra,
            "dec": dec,
            "tile_id": tile_index,
            "tile_center": get_tile_center(tile_index),
            "ordering": "NESTED",
            "channels": TOTAL_CHANNELS,
            "hips_url_frame_1": get_png_url(
                tile_index,
                1
            )
        })

    except Exception as error:
        return error_response(str(error), 400)


# ==================================================
# CANDIDATE STORAGE
# ==================================================

@app.route("/api/candidates", methods=["GET", "POST"])
def candidates():

    if request.method == "POST":
        candidate = request.get_json(silent=True)

        if candidate is None:
            return error_response(
                "A valid JSON candidate is required."
            )

        try:
            if CANDIDATES_FILE.exists():
                with open(
                    CANDIDATES_FILE,
                    "r",
                    encoding="utf-8"
                ) as file:
                    saved = json.load(file)
            else:
                saved = []

            if not isinstance(saved, list):
                saved = []

            saved.append(candidate)

            with open(
                CANDIDATES_FILE,
                "w",
                encoding="utf-8"
            ) as file:
                json.dump(saved, file, indent=2)

            return jsonify({
                "status": "ok",
                "saved": True,
                "total_candidates": len(saved)
            })

        except Exception as error:
            return error_response(str(error), 500)

    try:
        if CANDIDATES_FILE.exists():
            with open(
                CANDIDATES_FILE,
                "r",
                encoding="utf-8"
            ) as file:
                saved = json.load(file)
        else:
            saved = []

        return jsonify({
            "status": "ok",
            "candidates": saved
        })

    except Exception as error:
        return error_response(str(error), 500)


# ==================================================
# FRONTEND ROUTES
# ==================================================

@app.route("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.route("/app.js")
def app_js():
    return send_from_directory(ROOT, "app.js")


@app.route("/styles.css")
def styles():
    return send_from_directory(ROOT, "styles.css")


@app.route("/data/<path:filename>")
def data_files(filename):
    return send_from_directory(DATA_DIR, filename)


# ==================================================
# START SERVER
# ==================================================

if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=False
    )
