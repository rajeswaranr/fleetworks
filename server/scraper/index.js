import express from "express";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { OutscrapeClient } from "outscraper";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const OUTSCRAPPER_API_KEY = process.env.OUTSCRAPPER_API_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
}

if (!OUTSCRAPPER_API_KEY) {
  throw new Error("Missing OUTSCRAPPER_API_KEY");
}

const outscraper = new OutscrapeClient({ apiKey: OUTSCRAPPER_API_KEY });

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TN_CITIES = [
  "Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Trichy", "Salem",
  "Tirunelveli", "Erode", "Vellore", "Thoothukudi", "Tuticorin", "Dindigul", "Namakkal",
  "Karur", "Hosur", "Krishnagiri", "Thanjavur", "Nagercoil", "Cuddalore", "Kanchipuram"
];

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Trigger a scrape by config ID or inline vendor_type + city
app.post("/api/scrape", async (req, res) => {
  try {
    const { configId, vendorType, city, searchQuery } = req.body;

    if (!vendorType || !city) {
      return res.status(400).json({ error: "vendorType and city required" });
    }

    const query = searchQuery || `${vendorType} near ${city}`;

    // Create run record
    const { data: run, error: runError } = await supabase
      .from("scraper_runs")
      .insert({
        config_id: configId,
        vendor_type: vendorType,
        city,
        status: "running",
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (runError) throw runError;
    const runId = run.id;

    res.json({
      message: "Scrape started",
      runId,
      query,
      pollUrl: `/api/scrape/${runId}`
    });

    // Run scraper async (don't wait for completion)
    scrapeAndIngest(runId, configId, vendorType, city, query).catch(err => {
      console.error(`Scrape ${runId} failed:`, err);
    });

  } catch (err) {
    console.error("Scrape request error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Poll scrape status
app.get("/api/scrape/:runId", async (req, res) => {
  try {
    const { data: run, error } = await supabase
      .from("scraper_runs")
      .select("*")
      .eq("id", req.params.runId)
      .single();

    if (error) throw error;
    res.json(run);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all scraper configs
app.get("/api/configs", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("scraper_configs")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create scraper config
app.post("/api/configs", async (req, res) => {
  try {
    const { vendorType, city, searchQuery } = req.body;

    if (!vendorType || !city) {
      return res.status(400).json({ error: "vendorType and city required" });
    }

    const { data, error } = await supabase
      .from("scraper_configs")
      .insert({ vendor_type: vendorType, city, search_query: searchQuery })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function scrapeAndIngest(runId, configId, vendorType, city, query) {
  try {
    console.log(`[${runId}] Scraping via Outscrapper: ${query}`);

    // Call Outscrapper API
    const results = await outscraper.googleMaps({
      queries: [query],
      reviewsLimit: 0, // We don't need reviews, just basic info
      limit: 100 // Max results per query
    });

    if (!results || results.length === 0 || !results[0].data) {
      throw new Error("Outscrapper returned no results");
    }

    const records = results[0].data;
    console.log(`[${runId}] Found ${records.length} records`);

    // Map to vendor_leads schema
    const rows = records.map(rec => ({
      source: "outscrapper",
      service_category: vendorType,
      place_id: rec.place_id || rec.review_url?.match(/\/place\/([^/]+)/)?.[1] || null,
      business_name: rec.title || rec.name || "Unnamed",
      google_category: rec.type || null,
      phone: rec.phone || null,
      website: rec.website || null,
      address: rec.full_address || null,
      city: detectCity(rec.full_address || "", city),
      latitude: rec.latitude != null ? parseFloat(rec.latitude) : null,
      longitude: rec.longitude != null ? parseFloat(rec.longitude) : null,
      rating: rec.rating != null ? parseFloat(rec.rating) : null,
      review_count: rec.review_count != null ? parseInt(rec.review_count) : null,
      emails: rec.email ? [rec.email] : null,
      maps_link: rec.review_url || null,
      raw: rec
    }));

    // Insert with deduplication on place_id
    const { data: inserted, error: insertError } = await supabase
      .from("vendor_leads")
      .insert(rows)
      .select();

    if (insertError && insertError.code !== "23505") throw insertError; // 23505 = unique violation (expected)

    const newCount = inserted?.length || 0;
    const dupCount = records.length - newCount;

    console.log(`[${runId}] Inserted ${newCount}, skipped ${dupCount} duplicates`);

    // Update run record
    await supabase
      .from("scraper_runs")
      .update({
        status: "completed",
        records_found: records.length,
        records_new: newCount,
        records_duped: dupCount,
        completed_at: new Date().toISOString()
      })
      .eq("id", runId);

  } catch (err) {
    console.error(`[${runId}] Error:`, err.message);

    await supabase
      .from("scraper_runs")
      .update({
        status: "failed",
        error_message: err.message,
        completed_at: new Date().toISOString()
      })
      .eq("id", runId)
      .catch(e => console.error("Failed to update run status:", e));
  }
}

function detectCity(address, fallback) {
  if (address) {
    for (const c of TN_CITIES) {
      if (address.toLowerCase().includes(c.toLowerCase())) return c;
    }
  }
  return fallback || null;
}


app.listen(PORT, () => {
  console.log(`Scraper service running on port ${PORT}`);
});
