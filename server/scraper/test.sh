#!/bin/bash

# Test script for the scraper API

BASE_URL="http://localhost:3000"

echo "🧪 Testing Scraper API"
echo "====================="
echo ""

# Test 1: Health check
echo "1️⃣  Health check..."
curl -s $BASE_URL/health | jq .
echo ""

# Test 2: List configs
echo "2️⃣  List configs..."
curl -s $BASE_URL/api/configs | jq .
echo ""

# Test 3: Create a config
echo "3️⃣  Create a config..."
CONFIG=$(curl -s -X POST $BASE_URL/api/configs \
  -H "Content-Type: application/json" \
  -d '{"vendorType":"mechanic","city":"Chennai"}' | jq .)
echo $CONFIG
CONFIG_ID=$(echo $CONFIG | jq -r '.id')
echo "Config ID: $CONFIG_ID"
echo ""

# Test 4: Trigger a scrape
echo "4️⃣  Trigger a scrape..."
SCRAPE=$(curl -s -X POST $BASE_URL/api/scrape \
  -H "Content-Type: application/json" \
  -d "{\"configId\":\"$CONFIG_ID\",\"vendorType\":\"mechanic\",\"city\":\"Chennai\"}" | jq .)
echo $SCRAPE
RUN_ID=$(echo $SCRAPE | jq -r '.runId')
echo "Run ID: $RUN_ID"
echo ""

# Test 5: Poll status (wait a bit first)
echo "5️⃣  Waiting 3 seconds for scrape to complete..."
sleep 3

echo "Polling scrape status..."
curl -s $BASE_URL/api/scrape/$RUN_ID | jq .
echo ""

echo "✅ Test complete!"
echo ""
echo "Check Supabase to see if records were inserted:"
echo "  - Go to Supabase → Vendor Leads table"
echo "  - Look for records with place_id starting with 'mock_'"
