# FleetWorks OCR service (PaddleOCR PP-OCRv4)

Reads bill/invoice photos posted by fleet.html (Bill Capture) and the Android
app (same web code). The app falls back to on-device Tesseract when this
service is unreachable, so deploying it is an upgrade, never a dependency.

## Deploy free on Hugging Face Spaces (~5 minutes)
1. huggingface.co → New Space → SDK: **Docker** → name: `fleetworks-ocr`.
2. Upload `app.py`, `Dockerfile`, `requirements.txt` from this folder.
3. Wait for build (first build ~10 min — it pre-downloads the models).
4. Copy the Space URL, e.g. `https://<user>-fleetworks-ocr.hf.space`.
5. In `js/backend.js`, set `ocrUrl: "<that url>"` and push.

Test: `curl -F "file=@bill.jpg" https://<space>/ocr` → JSON with text,
gstin, date, amount. Health check: GET / → {"ok": true}.

Any VPS works too: `docker build -t fw-ocr . && docker run -p 7860:7860 fw-ocr`.
