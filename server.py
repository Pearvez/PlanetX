
from pathlib import Path
from functools import lru_cache
from io import BytesIO
import base64
import os

import requests
import numpy as np
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS # type: ignore
from astropy.coordinates import SkyCoord
from astropy_healpix import HEALPix
import astropy.units as u


# ============================================================
# PLANETX — FULL-SKY SPHEREx EXPLORER
# ============================================================

app = Flask(__name__, static_folder=".")
CORS(app)

BASE_DIR = Path(__file__).resolve().parent

# Official SPHEREx HiPS source
HIPS_BASE = (
    "https://irsa.ipac.caltech.edu/data/hips/"
    "SPHEREx/spherex_allsky_cube"
)

# Full-sky HEALPix configuration
NSIDE = 32
TOTAL_SKY_TILES = 12 * NSIDE * NSIDE
TOTAL_CHANNELS = 102

# SPHEREx HiPS uses nested HEALPix ordering
healpix = HEALPix(
    nside=NSIDE,
    order="nested",
    frame="icrs"
)

session = requests.Session()
session.headers.update({
    "User-Agent": "PlanetX-SPHEREx-Explorer/1.0"
})


# ============================================================
# HEALTH
# ============================================================

@app.route("/api/health")
def health():
    return jsonify({
        "status": "online",
        "project": "PlanetX",
        "data_source": "NASA/IPAC SPHEREx HiPS",
        "nside": NSIDE,
        "total_tiles": TOTAL_SKY_TILES,
        "total_channels": TOTAL_CHANNELS
    })


# ============================================================
# SKY INFORMATION
# ============================================================

@app.route("/api/sky/info")
def sky_info():
    return jsonify({
        "status": "ok",
        "nside": NSIDE,
        "total_tiles": TOTAL_SKY_TILES,
        "total_channels": TOTAL_CHANNELS,
        "first_channel": 1,
        "last_channel": TOTAL_CHANNELS,
        "hips_url": HIPS_BASE
    })


# ============================================================
# TILE COORDINATES
# ============================================================

def get_tile_coordinates(tile_id):
    if not 0 <= tile_id < TOTAL_SKY_TILES:
        raise ValueError("Invalid tile ID")

    coordinate = healpix.healpix_to_skycoord(tile_id)

    assert coordinate.icrs is not None
    assert coordinate.icrs.ra is not None
    assert coordinate.icrs.dec is not None
    return {
        "tile_id": int(tile_id),
        "ra": float(coordinate.icrs.ra.deg), # type: ignore
        "dec": float(coordinate.icrs.dec.deg) # type: ignore
    }


@app.route("/api/sky/tiles")
def get_all_sky_tiles():
    try:
        offset = int(request.args.get("offset", 0))
        limit = int(request.args.get("limit", 1000))

        if offset < 0:
            raise ValueError()

        limit = max(1, min(limit, 2000))

    except ValueError:
        return jsonify({
            "status": "error",
            "message": "Invalid offset or limit"
        }), 400

    end = min(offset + limit, TOTAL_SKY_TILES)

    tiles = [
        get_tile_coordinates(tile_id)
        for tile_id in range(offset, end)
    ]

    return jsonify({
        "status": "ok",
        "total_tiles": TOTAL_SKY_TILES,
        "offset": offset,
        "count": len(tiles),
        "has_more": end < TOTAL_SKY_TILES,
        "tiles": tiles
    })


# ============================================================
# FIND TILE FROM SKY COORDINATES
# ============================================================

@app.route("/api/sky/locate")
def locate_tile():
    try:
        ra = float(request.args["ra"])
        dec = float(request.args["dec"])

        if not 0 <= ra < 360 or not -90 <= dec <= 90:
            raise ValueError()

        coordinate = SkyCoord(
            ra=ra * u.deg,
            dec=dec * u.deg,
            frame="icrs"
        )

        tile_id = int(healpix.skycoord_to_healpix(coordinate)) # type: ignore

        return jsonify({
            "status": "ok",
            **get_tile_coordinates(tile_id)
        })

    except (KeyError, ValueError):
        return jsonify({
            "status": "error",
            "message": "Provide valid RA and Dec coordinates"
        }), 400


# ============================================================
# DOWNLOAD SPHEREx HiPS TILE
# ============================================================

@lru_cache(maxsize=256)
def download_hips_tile(tile_id, channel):
    """
    Download one SPHEREx HiPS image.

    Images are retrieved only when requested.
    The cache avoids repeatedly downloading the same tile.
    """

    directory = (tile_id // 10000) * 10000

    url = (
        f"{HIPS_BASE}/Norder5/"
        f"Dir{directory}/"
        f"Npix{tile_id}_{channel}.png"
    )

    try:
        response = session.get(url, timeout=30)

        if response.status_code != 200:
            return None

        content_type = response.headers.get(
            "Content-Type", ""
        ).lower()

        if "image/png" not in content_type:
            return None

        return response.content

    except requests.RequestException:
        return None


# ============================================================
# GET ONE SKY TILE IMAGE
# ============================================================

@app.route("/api/sky/tile")
def get_sky_tile():
    try:
        tile_id = int(request.args["tile"])
        channel = int(request.args.get("channel", 1))

        if not 0 <= tile_id < TOTAL_SKY_TILES:
            raise ValueError()

        if not 1 <= channel <= TOTAL_CHANNELS:
            raise ValueError()

    except (KeyError, ValueError):
        return jsonify({
            "status": "error",
            "message": "Invalid tile or channel"
        }), 400

    image_bytes = download_hips_tile(tile_id, channel)

    if image_bytes is None:
        return jsonify({
            "status": "unavailable",
            "tile_id": tile_id,
            "channel": channel,
            "message": "No image available for this tile/channel"
        }), 404

    image_data = base64.b64encode(
        image_bytes
    ).decode("utf-8")

    coordinates = get_tile_coordinates(tile_id)

    return jsonify({
        "status": "ok",
        **coordinates,
        "channel": channel,
        "source": "SPHEREx HiPS",
        "image": f"data:image/png;base64,{image_data}"
    })


# ============================================================
# FRONTEND
# ============================================================

@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/<path:filename>")
def frontend_files(filename):
    allowed = {"app.js", "styles.css"}

    if filename in allowed:
        return send_from_directory(BASE_DIR, filename)

    return jsonify({"error": "Not found"}), 404


# ============================================================
# START SERVER
# ============================================================

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))

    app.run(
        host="0.0.0.0",
        port=port,
        debug=False
    )
