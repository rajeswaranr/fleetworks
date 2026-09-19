# Convert HTML to PDF using Microsoft Edge (Windows 11)
$htmlFile = "C:\Users\admin\AppData\Local\Temp\claude\C--Users-admin-go-mechanic\39dd1424-90e6-4cc8-8c35-a6e4f4eefca7\scratchpad\fleetworks-brochure.html"
$pdfFile = "C:\Users\admin\go_mechanic\fleetworks-brochure.pdf"
$htmlUri = "file:///$(($htmlFile -replace '\\', '/').Substring(2))"

# Use Edge in headless mode to convert to PDF
$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$chromePath = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

# Try Edge first, then Chrome
if (Test-Path $edgePath) {
  Write-Host "Converting HTML to PDF using Microsoft Edge..."
  & $edgePath --headless --disable-gpu --print-to-pdf=$pdfFile $htmlUri
} elseif (Test-Path $chromePath) {
  Write-Host "Converting HTML to PDF using Google Chrome..."
  & $chromePath --headless --disable-gpu --print-to-pdf=$pdfFile $htmlUri
} else {
  Write-Host "Error: Neither Microsoft Edge nor Google Chrome found."
  exit 1
}

# Wait for the file to be created
Start-Sleep -Seconds 3

if (Test-Path $pdfFile) {
  $fileSize = (Get-Item $pdfFile).Length / 1MB
  Write-Host "PDF generated successfully: $pdfFile"
  Write-Host "File size: $('{0:F2}' -f $fileSize) MB"
} else {
  Write-Host "Error: PDF file was not created."
  exit 1
}
