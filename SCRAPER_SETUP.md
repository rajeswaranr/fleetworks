# Google Maps Scraper Setup Guide

Complete setup for on-demand vendor sourcing via Google Maps using Outscrapper API, deployed to Google Cloud Run.

## Overview

The system has three parts:
1. **Database tables** (`scraper_configs`, `scraper_runs`) — track configurations and execution history
2. **Cloud Run service** (`server/scraper/`) — Node.js API that calls Outscrapper for scraping
3. **Admin UI** (`admin.html`) — UI to manage configs and trigger scrapes

## Quick Setup

### 1. Get Your Credentials

**Supabase** (in Supabase dashboard → Settings → API):
- Copy your **Project URL** (e.g., `https://xxxx.supabase.co`)
- Copy your **Anon Key** (the one starting with `eyJ...` or `sb_publishable_...`)

**Outscrapper** (in Outscrapper dashboard → API):
- Copy your **API Key** (available from https://outscrapper.com)

### 2. Deploy to Google Cloud Run

Requires: GCP account with billing enabled, `gcloud` CLI installed.

```bash
cd server/scraper

# Set your credentials
export GCP_PROJECT_ID=your-gcp-project-id
export SUPABASE_URL=https://xxxx.supabase.co
export SUPABASE_ANON_KEY=your-anon-key
export OUTSCRAPPER_KEY=your-outscrapper-api-key

# Build and deploy
gcloud run deploy fleetworks-scraper \
  --source . \
  --region asia-south1 \
  --memory 512Mi \
  --timeout 600 \
  --set-env-vars SUPABASE_URL=$SUPABASE_URL,SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY,OUTSCRAPPER_API_KEY=$OUTSCRAPPER_KEY \
  --allow-unauthenticated \
  --project $GCP_PROJECT_ID
```

**After deploy, copy the service URL** (looks like `https://fleetworks-scraper-xxxxx.a.run.app`).

### 3. Update Admin Console

In `admin.html`, find the line:
```javascript
const SCRAPER_URL = sessionStorage.getItem("fw_scraper_url") || "https://fleetworks-scraper-xxxxx.a.run.app";
```

Replace `https://fleetworks-scraper-xxxxx.a.run.app` with your actual Cloud Run URL.

Alternatively, add this to your browser console to set it per-session:
```javascript
sessionStorage.setItem("fw_scraper_url", "https://YOUR-URL.a.run.app");
```

### 4. Add Scraper Configs

1. Go to **Admin Console** → **Scraper Configurations**
2. Add vendor type + city combinations:
   - Mechanic + Chennai
   - Battery + Coimbatore
   - Tyre + Madurai
   - etc.
3. Click **+ Add Config** for each

### 5. Trigger a Scrape

1. In **Scraper Configurations**, click **Scrape Now** next to any config
2. Confirm the dialog
3. The scraper starts running (1-5 min depending on results)
4. Browser polls status every 2 seconds
5. Alert shows results: records found, new leads added, duplicates skipped

Results auto-appear in **Vendor Leads** table.

## How It Works

```
Admin clicks "Scrape Now" (mechanic, Chennai)
         ↓
POST /api/scrape {vendorType: "mechanic", city: "Chennai"}
         ↓
Cloud Run service creates scraper_runs record (status: "running")
         ↓
Calls Outscrapper API: POST /api/google-maps {queries: ["mechanic near Chennai"]}
         ↓
Outscrapper scrapes Google Maps, returns JSON with place_id, name, phone, rating, etc.
         ↓
Maps to vendor_leads schema (source: "outscrapper")
         ↓
INSERT into vendor_leads (dedup on place_id)
         ↓
Updates scraper_runs record (status: "completed", records_new: 42)
         ↓
Admin polls GET /api/scrape/{runId} every 2s
         ↓
Alert shows results, vendor_leads table refreshes
```

## API Reference

### POST /api/scrape
Trigger a scrape.

**Request:**
```json
{
  "configId": "uuid (optional)",
  "vendorType": "mechanic|electrician|battery|tyre|puncture",
  "city": "Chennai",
  "searchQuery": "(optional) custom query e.g. 'auto repair near Chennai'"
}
```

**Response:**
```json
{
  "runId": "uuid",
  "query": "mechanic near Chennai",
  "pollUrl": "/api/scrape/{runId}"
}
```

### GET /api/scrape/:runId
Poll scrape status.

**Response:**
```json
{
  "id": "uuid",
  "config_id": "uuid or null",
  "vendor_type": "mechanic",
  "city": "Chennai",
  "status": "pending|running|completed|failed",
  "records_found": 42,
  "records_new": 35,
  "records_duped": 7,
  "error_message": null,
  "started_at": "2026-07-26T10:30:00Z",
  "completed_at": "2026-07-26T10:35:00Z",
  "created_at": "2026-07-26T10:30:00Z"
}
```

### GET /api/configs
List all scraper configurations.

### POST /api/configs
Create a scraper configuration.

**Request:**
```json
{
  "vendorType": "mechanic",
  "city": "Chennai",
  "searchQuery": "(optional) custom query"
}
```

## Troubleshooting

### "Service URL incorrect"
- Check the Cloud Run service is deployed and running
- Verify the URL in `admin.html` matches your actual Cloud Run URL

### "Could not load scraper configs"
- Cloud Run service may be down
- Check Cloud Run logs: `gcloud run logs read fleetworks-scraper --region=asia-south1`

### Scrape failed with error
- Check Cloud Run logs for details
- Common issues:
  - Wrong Supabase credentials (check env vars)
  - Google Maps may have changed HTML structure (gosom update needed)
  - Network timeout (increase timeout in Cloud Run → Memory settings)

### No results found
- Try a different search query (edit config or pass custom `searchQuery`)
- Some vendor types may have limited results in certain cities

## Local Testing (before deploy)

```bash
cd server/scraper
npm install

# Start service locally
SUPABASE_URL=https://xxxx.supabase.co \
SUPABASE_ANON_KEY=YOUR_KEY \
npm run dev

# In another terminal, test the API
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"vendorType":"mechanic","city":"Chennai"}'
```

## Cost Estimate

**Google Cloud Run pricing** (asia-south1, 512MB memory):
- **CPU**: $0.000024/vCPU-second (~$0.02 per 10-second run)
- **Memory**: $0.0000025/GB-second (~$0.01 per 10-second run)
- **Requests**: First 2M free per month, then $0.40/M requests

**Outscrapper pricing** (pay-per-use):
- Varies by plan; typically $0.01-0.05 per successful scrape
- Check https://outscrapper.com/pricing for your plan

**Per scrape cost (typical):**
- Cloud Run: ~$0.03 per 10-second scrape
- Outscrapper: ~$0.02-0.05 per place
- Total: ~$0.05-0.10 per scrape for 10-20 results

**Monthly estimate (10 manual scrapes/month):**
- Cloud Run: free tier covers it
- Outscrapper: $0.20-0.50
- **Total: <$1/month**

## Next Steps

- **Automated scheduling**: Add a Cloud Scheduler cron job to scrape nightly
- **Email notifications**: Alert BDMs when new leads arrive
- **Smart deduplication**: Merge duplicate vendors across multiple scrape runs
- **Lead scoring**: Rank leads by rating, review count, distance from fleet locations
