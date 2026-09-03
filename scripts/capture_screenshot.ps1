param(
    [string]$Url,
    [string]$OutPath,
    [int]$Width = 1440,
    [int]$Height = 960
)

$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chromePath)) {
    $chromePath = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
}
$browserPath = $chromePath

$tempDir = Join-Path $env:TEMP ("edge_shot_" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

$args = @(
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-extensions",
    "--hide-scrollbars",
    "--user-data-dir=$tempDir",
    "--window-size=$Width,$Height",
    "--screenshot=$OutPath",
    $Url
)

Start-Process -FilePath $browserPath -ArgumentList $args -Wait -NoNewWindow
Start-Sleep -Milliseconds 1500

Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue

if (Test-Path $OutPath) {
    Write-Output "SUCCESS: $OutPath"
} else {
    Write-Output "FAIL"
}
