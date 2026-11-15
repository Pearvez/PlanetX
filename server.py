
from pathlib import Path
from io import BytesIO
from datetime import datetime, timezone
import base64
import json
import os 

import numpy as np
from flask import Flask, jsonify, request, send_from_directory
from astropy.io import fits
from astropy.wcs import WCS
from astropy.nddata import Cutout2D
from astropy.coordinates import SkyCoord
from astropy.time import Time
import astropy.units as u

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"

# Vercel functions have temporary writable storage.
CANDIDATES_FILE = Path("/tmp/planetx_candidates.json")

app = Flask(__name__)


def get_fits_files():
    """Find FITS files stored in the project's data directory."""
    patterns = ("*.fits", "*.fits.gz", "*.fit", "*.fts")
    files = []

    if not DATA_DIR.exists():
        return files

    for pattern in patterns:
        files.extend(DATA_DIR.glob(pattern))

    return sorted(set(files))


def get_observation_date(hdul):
    """Read an observation date from common SPHEREx FITS headers."""
    for hdu in hdul:
        for key in ("DATE-OBS", "DATE-BEG", "DATE-AVG"):
            value = hdu.header.get(key)
            if value:
                return str(value)

        for key in ("MJD-OBS", "MJD-BEG", "MJD-AVG"):
            value = hdu.header.get(key)
            if value is not None:
                return Time(float(value), format="mjd").isot

    return "Date not recorded in FITS header"


def make_image_data_url(data):
    """Convert a science-image array into a PNG data URL."""
    data = np.asarray(data, dtype=float)
    valid = np.isfinite(data)

    if not np.any(valid):
        raise ValueError("The FITS cutout contains no valid pixels.")

    low, high = np.nanpercentile(data[valid], [2, 99.5])

    if high <= low:
        high = low + 1

    normalized = np.clip((data - low) / (high - low), 0, 1)

    fig, ax = plt.subplots(figsize=(5, 5))
    ax.imshow(normalized, origin="lower", cmap="inferno")
    ax.set_axis_off()

    buffer = BytesIO()

    fig.savefig(
        buffer,
        format="png",
        bbox_inches="tight",
        pad_inches=0,
        dpi=140
    )

    plt.close(fig)

    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return "data:image/png;base64," + encoded


@app.get("/")
def home():
    return send_from_directory(ROOT, "index.html")


@app.get("/app.js")
def javascript():
    return send_from_directory(ROOT, "app.js")


@app.get("/styles.css")
def stylesheet():
    return send_from_directory(ROOT, "styles.css")


@app.get("/data/<path:filename>")
def serve_data(filename):
    """Serve files from the project's data directory."""
    return send_from_directory(DATA_DIR, filename)


@app.get("/api/health")
def health():
    """Check whether the deployed Flask backend can find FITS data."""
    files = get_fits_files()

    return jsonify({
        "status": "ok",
        "backend": "Flask",
        "project": "PlanetX",
        "fits_files_found": len(files),
        "files": [file.name for file in files]
    })


@app.get("/api/observations")
def observations():
    """Find FITS observations covering the requested coordinates."""
    try:
        ra = float(request.args["ra"])
        dec = float(request.args["dec"])

        if not 0 <= ra < 360 or not -90 <= dec <= 90:
            raise ValueError("Invalid coordinates.")

    except (KeyError, ValueError):
        return jsonify({
            "error": "Provide valid ra and dec query parameters."
        }), 400

    target = SkyCoord(ra=ra * u.deg, dec=dec * u.deg)
    matches = []

    for path in get_fits_files():
        try:
            with fits.open(path, memmap=True) as hdul:
                hdu = hdul["IMAGE"] if "IMAGE" in hdul else hdul[0]

                if hdu.data is None: # type: ignore
                    continue

                wcs = WCS(hdu.header) # type: ignore

                if not wcs.has_celestial:
                    continue

                x, y = wcs.world_to_pixel(target)
                height, width = hdu.data.shape[-2:] # type: ignore

                if 0 <= x < width and 0 <= y < height: # type: ignore
                    matches.append({
                        "file": path.name,
                        "date": get_observation_date(hdul),
                        "pixel_x": round(float(x), 2), # type: ignore
                        "pixel_y": round(float(y), 2) # type: ignore
                    })

        except Exception as error:
            print(f"Skipping {path.name}: {error}")

    return jsonify({
        "ra": ra,
        "dec": dec,
        "count": len(matches),
        "observations": matches
    })


@app.get("/api/cutout")
def cutout():
    """Return a real SPHEREx image cutout for the requested coordinates."""
    try:
        ra = float(request.args["ra"])
        dec = float(request.args["dec"])
        size = float(request.args.get("size", "0.05"))

        if not 0 <= ra < 360 or not -90 <= dec <= 90:
            raise ValueError("Invalid coordinates.")

        if not 0 < size <= 2:
            raise ValueError("Invalid cutout size.")

    except (KeyError, ValueError):
        return jsonify({
            "error": "Provide valid ra, dec, and size parameters."
        }), 400

    target = SkyCoord(ra=ra * u.deg, dec=dec * u.deg)

    for path in get_fits_files():
        try:
            with fits.open(path, memmap=True) as hdul:
                hdu = hdul["IMAGE"] if "IMAGE" in hdul else hdul[0]

                if hdu.data is None or hdu.data.ndim != 2: # type: ignore
                    continue

                wcs = WCS(hdu.header) # type: ignore

                if not wcs.has_celestial:
                    continue

                x, y = wcs.world_to_pixel(target)
                height, width = hdu.data.shape # type: ignore

                if not (0 <= x < width and 0 <= y < height): # type: ignore
                    continue

                cutout_data = Cutout2D(
                    hdu.data, # type: ignore
                    target,
                    size=(size * u.deg, size * u.deg),
                    wcs=wcs,
                    mode="partial"
                )

                image_url = make_image_data_url(cutout_data.data)

                return jsonify({
                    "status": "real_data",
                    "file": path.name,
                    "date": get_observation_date(hdul),
                    "ra": ra,
                    "dec": dec,
                    "pixel_x": round(float(x), 2), # type: ignore
                    "pixel_y": round(float(y), 2), # type: ignore
                    "shape": list(cutout_data.data.shape),
                    "image": image_url
                })

        except Exception as error:
            print(f"Could not process {path.name}: {error}")

    return jsonify({
        "status": "no_coverage",
        "message": "No local FITS image currently covers these coordinates.",
        "ra": ra,
        "dec": dec
    }), 404


@app.post("/api/candidates")
def save_candidate():
    """Save a candidate submitted by the frontend."""
    candidate = request.get_json(silent=True)

    if not isinstance(candidate, dict):
        return jsonify({
            "error": "Expected a JSON candidate object."
        }), 400

    try:
        if CANDIDATES_FILE.exists():
            candidates = json.loads(CANDIDATES_FILE.read_text())
        else:
            candidates = []

        if not isinstance(candidates, list):
            candidates = []

        candidates.append(candidate)
        CANDIDATES_FILE.write_text(
            json.dumps(candidates, indent=2)
        )

        return jsonify({
            "status": "saved",
            "total": len(candidates)
        }), 201

    except (OSError, json.JSONDecodeError) as error:
        return jsonify({"error": str(error)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
