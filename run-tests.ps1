# VNS Multi-Node E2E Test Runner
# Finds Docker and runs the test suite

Write-Host "🔍 Locating Docker..." -ForegroundColor Cyan

# Common Docker Desktop paths
$dockerPaths = @(
    "C:\Program Files\Docker\Docker\resources\bin\docker.exe",
    "C:\Program Files\Docker\Docker\resources\cli-plugins\docker-compose.exe",
    "$env:ProgramFiles\Docker\Docker\resources\bin\docker.exe",
    "$env:LOCALAPPDATA\Programs\Docker\Docker\resources\bin\docker.exe"
)

$dockerExe = $null
foreach ($path in $dockerPaths) {
    if (Test-Path $path) {
        $dockerExe = $path
        Write-Host "✅ Found Docker at: $path" -ForegroundColor Green
        break
    }
}

if (-not $dockerExe) {
    Write-Host "❌ Docker not found in standard locations." -ForegroundColor Red
    Write-Host ""
    Write-Host "📋 Please use VSCode Docker Extension instead:" -ForegroundColor Yellow
    Write-Host "   1. Open Docker extension (whale icon in sidebar)" -ForegroundColor Yellow
    Write-Host "   2. Find 'Compose' section" -ForegroundColor Yellow
    Write-Host "   3. Right-click 'docker-compose.yml'" -ForegroundColor Yellow
    Write-Host "   4. Select 'Compose Up'" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Or install Docker Desktop from: https://www.docker.com/products/docker-desktop" -ForegroundColor Cyan
    exit 1
}

# Add Docker to PATH for this session
$dockerDir = Split-Path $dockerExe -Parent
$env:Path = "$dockerDir;$env:Path"

Write-Host ""
Write-Host "🚀 Starting VNS Multi-Node Tests..." -ForegroundColor Cyan
Write-Host "   This will build 3 nodes + test runner..." -ForegroundColor Gray
Write-Host ""

# Check if Docker Desktop is running
try {
    & $dockerExe ps *>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "⚠️  Docker Desktop is not running!" -ForegroundColor Yellow
        Write-Host "   Please start Docker Desktop and try again." -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "⚠️  Cannot connect to Docker daemon!" -ForegroundColor Yellow
    Write-Host "   Please ensure Docker Desktop is running." -ForegroundColor Yellow
    exit 1
}

# Run docker compose
Write-Host "🏗️  Building images and starting containers..." -ForegroundColor Cyan
& $dockerExe compose up --build

Write-Host ""
Write-Host "✨ Tests completed!" -ForegroundColor Green
Write-Host ""
Write-Host "To cleanup:" -ForegroundColor Cyan
Write-Host "  docker compose down -v" -ForegroundColor Gray
