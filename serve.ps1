# FleetFix - local web server (no Node/Python required)
# Usage:  powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8080] [-Lan]
#   -Lan  also serve to other devices on your network (needs Administrator once:
#         netsh http add urlacl url=http://+:8080/ user=Everyone)
param(
  [int]$Port = 8080,
  [switch]$Lan
)

$root = $PSScriptRoot
if ($Lan) { $prefix = "http://+:$Port/" } else { $prefix = "http://localhost:$Port/" }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
  $listener.Start()
} catch {
  Write-Host "Could not start on port $Port ($($_.Exception.Message))." -ForegroundColor Red
  Write-Host "Tip: the port may be in use - try: powershell -File serve.ps1 -Port 8090"
  exit 1
}

Write-Host ""
Write-Host "  FleetFix is running!" -ForegroundColor Green
Write-Host "  Open in your browser:  http://localhost:$Port/" -ForegroundColor Cyan
if ($Lan) {
  Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp,Manual -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Host "  On your network:       http://$($_.IPAddress):$Port/" -ForegroundColor Cyan }
}
Write-Host "  Press Ctrl+C (or close this window) to stop." -ForegroundColor DarkGray
Write-Host ""

$mime = @{
  ".html"="text/html; charset=utf-8"; ".css"="text/css"; ".js"="application/javascript";
  ".json"="application/json"; ".png"="image/png"; ".jpg"="image/jpeg"; ".jpeg"="image/jpeg";
  ".gif"="image/gif"; ".svg"="image/svg+xml"; ".ico"="image/x-icon";
  ".woff"="font/woff"; ".woff2"="font/woff2"; ".webp"="image/webp"; ".mp4"="video/mp4"
}

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path -eq "/") { $path = "/index.html" }
    $file = Join-Path $root ($path -replace "/", "\")
    if ((Test-Path $file -PathType Leaf) -and ((Resolve-Path $file).Path.StartsWith($root))) {
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      if ($mime[$ext]) { $ctx.Response.ContentType = $mime[$ext] } else { $ctx.Response.ContentType = "application/octet-stream" }
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
    }
    $ctx.Response.Close()
  } catch [System.Net.HttpListenerException] {
    break
  } catch {
    try { $ctx.Response.StatusCode = 500; $ctx.Response.Close() } catch {}
  }
}
