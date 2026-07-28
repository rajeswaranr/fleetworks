# Test script for the scraper API (PowerShell)

$BASE_URL = "http://localhost:3000"

Write-Host "🧪 Testing Scraper API" -ForegroundColor Cyan
Write-Host "=====================" -ForegroundColor Cyan
Write-Host ""

# Test 1: Health check
Write-Host "1️⃣  Health check..." -ForegroundColor Yellow
$response = Invoke-WebRequest -Uri "$BASE_URL/health" -Method Get
Write-Host ($response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 2)
Write-Host ""

# Test 2: List configs
Write-Host "2️⃣  List configs..." -ForegroundColor Yellow
$response = Invoke-WebRequest -Uri "$BASE_URL/api/configs" -Method Get
Write-Host ($response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 2)
Write-Host ""

# Test 3: Create a config
Write-Host "3️⃣  Create a config..." -ForegroundColor Yellow
$body = @{
  vendorType = "mechanic"
  city = "Chennai"
} | ConvertTo-Json

$response = Invoke-WebRequest -Uri "$BASE_URL/api/configs" -Method Post `
  -ContentType "application/json" `
  -Body $body
$configJson = $response.Content | ConvertFrom-Json
Write-Host ($configJson | ConvertTo-Json -Depth 2)
$CONFIG_ID = $configJson.id
Write-Host "Config ID: $CONFIG_ID" -ForegroundColor Green
Write-Host ""

# Test 4: Trigger a scrape
Write-Host "4️⃣  Trigger a scrape..." -ForegroundColor Yellow
$body = @{
  configId = $CONFIG_ID
  vendorType = "mechanic"
  city = "Chennai"
} | ConvertTo-Json

$response = Invoke-WebRequest -Uri "$BASE_URL/api/scrape" -Method Post `
  -ContentType "application/json" `
  -Body $body
$scrapeJson = $response.Content | ConvertFrom-Json
Write-Host ($scrapeJson | ConvertTo-Json -Depth 2)
$RUN_ID = $scrapeJson.runId
Write-Host "Run ID: $RUN_ID" -ForegroundColor Green
Write-Host ""

# Test 5: Poll status
Write-Host "5️⃣  Waiting 3 seconds for scrape to complete..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

Write-Host "Polling scrape status..." -ForegroundColor Yellow
$response = Invoke-WebRequest -Uri "$BASE_URL/api/scrape/$RUN_ID" -Method Get
Write-Host ($response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 2)
Write-Host ""

Write-Host "✅ Test complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Check Supabase to see if records were inserted:" -ForegroundColor Cyan
Write-Host "  - Go to Supabase → Vendor Leads table" -ForegroundColor Gray
Write-Host "  - Look for records with place_id starting with 'mock_'" -ForegroundColor Gray
