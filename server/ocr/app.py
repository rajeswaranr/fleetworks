# FleetWorks OCR microservice — PaddleOCR (PP-OCRv4)
# Deploy free on Hugging Face Spaces (Docker) or any VPS. The web/mobile app
# posts a bill photo to /ocr and gets back the recognised text + parsed hints;
# the app falls back to on-device Tesseract when this service is unreachable.

import io
import re

import numpy as np
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from paddleocr import PaddleOCR
from PIL import Image

app = FastAPI(title="FleetWorks OCR (PaddleOCR)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://fleetworks.in", "https://www.fleetworks.in",
                   "http://localhost:8642", "http://127.0.0.1:8642"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# English + rotated-text handling; models download once at build/start.
ocr_engine = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)

GSTIN_RE = re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b", re.I)
DATE_RE = re.compile(r"\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b")
AMT_RE = re.compile(r"(\d[\d,]{2,9}(?:\.\d{1,2})?)")


@app.get("/")
def health():
    return {"ok": True, "engine": "PaddleOCR PP-OCRv4"}


@app.post("/ocr")
async def do_ocr(file: UploadFile = File(...)):
    img = np.array(Image.open(io.BytesIO(await file.read())).convert("RGB"))
    result = ocr_engine.ocr(img, cls=True)
    lines = [ln[1][0] for page in (result or []) if page for ln in page]
    text = "\n".join(lines)

    gstin = GSTIN_RE.search(text)
    date = DATE_RE.search(text)
    amounts = [float(m.replace(",", "")) for m in AMT_RE.findall(text)]
    amounts = [a for a in amounts if 100 <= a <= 2_000_000]

    return {
        "text": text,
        "lines": lines,
        "gstin": gstin.group(0).upper() if gstin else None,
        "date": date.group(0) if date else None,
        "amount": max(amounts) if amounts else None,
    }
