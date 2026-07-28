# Local Testing Guide

Test the scraper API before deploying to Cloud Run.

## Quick Start

### 1. Add Your Supabase Credentials

Edit `server/scraper/.env` and replace:

```env
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_ANON_KEY=YOUR_ANON_KEY_HERE
```

You can find these in Supabase dashboard → Settings → API. Copy the **Project URL** and **Anon Key**.

### 2. Install Dependencies

```bash
cd server/scraper
npm install
```

### 3. Start the Service

```bash
npm run dev
```

You should see:
```
⚠️  Running in TEST MODE — using mock scraper data
Scraper service running on port 3000
```

### 4. Run Tests

In another terminal:

**PowerShell:**
```powershell
cd server/scraper
.\test.ps1
```

**Bash/Git Bash:**
```bash
cd server/scraper
bash test.sh
```

### 5. Verify Results

The test script:
1. ✅ Checks service health
2. ✅ Lists existing configs
3. ✅ Creates a new config (mechanic, Chennai)
4. ✅ Triggers a scrape (returns runId)
5. ✅ Polls scrape status
6. ✅ Shows records found/new/duped

Then check Supabase:
- Go to **Supabase Dashboard** → **vendor_leads** table
- Look for records with `place_id` starting with `mock_`
- Verify fields populated: business_name, phone, city, rating, etc.

## What TEST_MODE Does

When `TEST_MODE=true`:
- Scraper generates 5-15 mock records instead of calling gosom
- Records have realistic structure matching Google Maps output
- No need for gosom binary installed locally
- Perfect for testing the full pipeline: API → database → UI

## Manual API Testing

### Health Check
```bash
curl http://localhost:3000/health
```

### Create Config
```bash
curl -X POST http://localhost:3000/api/configs \
  -H "Content-Type: application/json" \
  -d '{
    "vendorType": "battery",
    "city": "Coimbatore"
  }'
```

### List Configs
```bash
curl http://localhost:3000/api/configs
```

### Trigger Scrape
```bash
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "vendorType": "electrician",
    "city": "Madurai"
  }'
```

Returns:
```json
{
  "runId": "uuid-here",
  "query": "electrician near Madurai",
  "pollUrl": "/api/scrape/uuid-here"
}
```

### Poll Status
```bash
curl http://localhost:3000/api/scrape/uuid-here
```

Returns:
```json
{
  "status": "completed",
  "records_found": 12,
  "records_new": 11,
  "records_duped": 1,
  "error_message": null
}
```

## Troubleshooting

### Error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY"
- Make sure `.env` file exists and has both values
- Check they're not empty strings
- Restart `npm run dev`

### "Connection refused" on curl
- Service not running? Start it with `npm run dev`
- Wrong port? Default is 3000
- Check console for errors

### "Could not insert into vendor_leads"
- Supabase credentials wrong?
- Database table doesn't exist? Run `supabase db push` first
- RLS policy blocking inserts? Check policy is `for all` with `admin` role

### Records not appearing in Supabase
- Wait a few seconds (async processing)
- Refresh the Supabase dashboard
- Check the `scraper_runs` table for errors
- Look at console output from the service

## Next: Admin UI Testing

After verifying the API works:

1. Update `admin.html` line ~450:
   ```javascript
   const SCRAPER_URL = sessionStorage.getItem("fw_scraper_url") || "http://localhost:3000";
   ```

2. Open admin console locally
3. Go to **Scraper Configurations** section
4. Add a config, click **Scrape Now**
5. Watch real-time polling and results

## Deploy Checklist

Before `gcloud run deploy`:

- [ ] Service runs locally without errors
- [ ] Scrape completes and returns records
- [ ] Records appear in Supabase vendor_leads table
- [ ] Admin UI connects and triggers scrapes
- [ ] gosom binary will be available in Cloud Run (in Dockerfile)
- [ ] Change `TEST_MODE=false` or remove it for production
