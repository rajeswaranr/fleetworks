# FleetWorks Google Maps Scraper Service

Cloud Run service for on-demand vendor sourcing via Google Maps using Outscrapper API.

## Deployment to Google Cloud Run

### Prerequisites
- Google Cloud account with billing enabled
- `gcloud` CLI installed
- Project ID from GCP

### Deploy

```bash
cd server/scraper

# Set your GCP project
export GCP_PROJECT=your-project-id

# Build and deploy to Cloud Run
gcloud run deploy fleetworks-scraper \
  --source . \
  --region asia-south1 \
  --memory 512Mi \
  --timeout 600 \
  --set-env-vars SUPABASE_URL=your-supabase-url,SUPABASE_ANON_KEY=your-supabase-anon-key,OUTSCRAPPER_API_KEY=your-outscrapper-key \
  --allow-unauthenticated \
  --project $GCP_PROJECT
```

The deploy returns a service URL like `https://fleetworks-scraper-xxxxx.a.run.app`.

### Environment Variables

Set these in Cloud Run (or via the deploy command above):

- `SUPABASE_URL` — Your Supabase project URL
- `SUPABASE_ANON_KEY` — Supabase anon key (from Settings → API)
- `OUTSCRAPPER_API_KEY` — Your Outscrapper API key (from https://outscrapper.com)

### API Endpoints

**POST /api/scrape** — Trigger a scrape
```json
{
  "vendorType": "mechanic",
  "city": "Chennai",
  "searchQuery": "(optional) custom search query"
}
```

Returns:
```json
{
  "runId": "uuid",
  "pollUrl": "/api/scrape/{runId}"
}
```

**GET /api/scrape/:runId** — Poll scrape status
```json
{
  "id": "uuid",
  "status": "pending|running|completed|failed",
  "records_found": 42,
  "records_new": 35,
  "records_duped": 7,
  "error_message": null
}
```

**GET /api/configs** — List scraper configurations

**POST /api/configs** — Create configuration
```json
{
  "vendorType": "mechanic",
  "city": "Chennai"
}
```

### Local Testing

```bash
npm install
SUPABASE_URL=... SUPABASE_ANON_KEY=... npm run dev
```

Then:
```bash
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"vendorType":"mechanic","city":"Chennai"}'
```
