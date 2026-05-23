# =========================================================
# NGA Mirror Station v4.9 - Management Script
# Usage:
#   powershell -Exec Bypass -File scripts/manage.ps1 setup
#   powershell -Exec Bypass -File scripts/manage.ps1 start [--dev]
#   powershell -Exec Bypass -File scripts/manage.ps1 stop
#   powershell -Exec Bypass -File scripts/manage.ps1 restart
#   powershell -Exec Bypass -File scripts/manage.ps1 status
#   powershell -Exec Bypass -File scripts/manage.ps1 update
#
# Or via npm:
#   npm run setup           (= setup)
#   npm run manage status   (= status)
#   npm run manage update   (= update)
# =========================================================

param(
    [Parameter(Position=0)]
    [ValidateSet("setup","start","stop","restart","status","update")]
    [string]$Command = "status",
    [switch]$Dev,
    [switch]$Full,
    [switch]$Force
)

$ErrorActionPreference = "Continue"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$DataDir = Join-Path $ProjectRoot "data"
$DBPath = Join-Path $DataDir "nga-cache.db"
$EnvFile = Join-Path $ProjectRoot ".env.local"
$NodeModules = Join-Path $ProjectRoot "node_modules"
$NodeDir = "C:\Program Files\nodejs"
$NodeExe = Join-Path $NodeDir "node.exe"
$NpmCmd = Join-Path $NodeDir "npm.cmd"
$NpxCmd = Join-Path $NodeDir "npx.cmd"
$NodeMinMajor = 22
$NpmMirror = "https://registry.npmmirror.com"
$NodeMirror = "https://npmmirror.com/mirrors/node"
$Port = 3000

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  NGA Mirror Station v4.9 - Management Script" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# ---- helpers ----

function Write-Step { Write-Host ">> $args" -ForegroundColor Yellow }
function Write-OK   { Write-Host "   OK: $args" -ForegroundColor Green }
function Write-Warn { Write-Host "  WARN: $args" -ForegroundColor Magenta }
function Write-Fail { Write-Host "  FAIL: $args" -ForegroundColor Red }
function Write-Info { Write-Host "   $args" }

function Invoke-NpmScript([string]$ScriptName) {
    $env:Path = "$NodeDir;$env:Path"
    $output = cmd /c "$NpxCmd npm run $ScriptName 2>&1"
    Write-Host $output
    return $LASTEXITCODE
}

function Test-NodeInstalled {
    if (Test-Path $NodeExe) {
        $ver = & $NodeExe --version 2>$null
        if ($ver -match "v(\d+)") { return [int]$Matches[1] }
    }
    return 0
}

function Test-ServerRunning {
    try {
        $conn = netstat -ano 2>$null | Select-String ":$Port\s" | Select-String "LISTENING"
        return ($conn -ne $null)
    } catch { return $false }
}

function Get-ServerPid {
    try {
        $line = netstat -ano 2>$null | Select-String ":$Port\s" | Select-String "LISTENING" | Select-Object -First 1
        if ($line) {
            $parts = $line.ToString().Trim() -split '\s+'
            $last = $parts[-1]
            if ($last -match '^\d+$') { return $last }
        }
    } catch {}
    return $null
}

function Test-ChromeInstalled {
    $paths = @(
        "C:\Program Files\Google\Chrome\Application\chrome.exe",
        "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    foreach ($p in $paths) { if (Test-Path $p) { return $p } }
    return $null
}

# ---- setup ----

function Invoke-Setup {
    Write-Host ""
    Write-Host "=== [1/6] Checking Node.js ===" -ForegroundColor Cyan

    $nodeMajor = Test-NodeInstalled
    if ($nodeMajor -ge $NodeMinMajor) {
        Write-OK "Node.js v$nodeMajor.x is installed"
    }
    else {
        Write-Warn "Node.js not found or version too old (need >= v$NodeMinMajor)"
        Write-Step "Downloading Node.js v22.13.0 LTS from mirror..."

        $nodeUrl = "$NodeMirror/v22.13.0/node-v22.13.0-x64.msi"
        $nodeInstaller = "$env:TEMP\node-v22.13.0-x64.msi"

        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeInstaller -UseBasicParsing -TimeoutSec 120
            $sizeMB = [math]::Round((Get-Item $nodeInstaller).Length / 1048576, 1)
            Write-OK "Downloaded ($sizeMB MB)"

            Write-Step "Installing Node.js..."
            Start-Process -FilePath "msiexec.exe" -ArgumentList "/i `"$nodeInstaller`" /quiet /norestart" -Wait
            Start-Sleep 3

            $nodeMajor = Test-NodeInstalled
            if ($nodeMajor -ge $NodeMinMajor) {
                Write-OK "Node.js v$nodeMajor.x installed successfully"
            } else {
                Write-Fail "Installation failed. Please install manually from https://nodejs.org"
                return
            }
        } catch {
            Write-Fail "Download failed: $_"
            Write-Info "Please download Node.js 22+ from https://nodejs.org manually"
            return
        }
    }

    Write-Host ""
    Write-Host "=== [2/6] Checking Chrome ===" -ForegroundColor Cyan
    $chromePath = Test-ChromeInstalled
    if ($chromePath) {
        Write-OK "Chrome found: $chromePath"
    } else {
        Write-Warn "Chrome not found. Playwright requires Chrome for scraping."
        Write-Info "Please install Google Chrome, then re-run setup."
    }

    Write-Host ""
    Write-Host "=== [3/6] Configuring npm mirror ===" -ForegroundColor Cyan
    try {
        & $NpmCmd config set registry $NpmMirror 2>$null
        Write-OK "npm registry set to npmmirror.com"
    } catch {
        Write-Warn "Failed to set npm mirror, using default registry"
    }

    Write-Host ""
    Write-Host "=== [4/6] Installing dependencies ===" -ForegroundColor Cyan
    if (Test-Path $NodeModules) {
        Write-OK "node_modules exists, skipping npm install"
        if ($Force) {
            Write-Info "--force: removing and re-installing..."
            Remove-Item -LiteralPath $NodeModules -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    if (-not (Test-Path $NodeModules)) {
        Write-Step "Running npm install..."
        try {
            $env:Path = "$NodeDir;$env:Path"
            $proc = Start-Process -FilePath $NpmCmd -ArgumentList "install" -WorkingDirectory $ProjectRoot -Wait -PassThru -NoNewWindow
            if ($proc.ExitCode -eq 0) { Write-OK "Dependencies installed" }
            else { Write-Fail "npm install failed (exit code: $($proc.ExitCode))" }
        } catch { Write-Fail "npm install failed: $_" }
    }

    Write-Host ""
    Write-Host "=== [5/6] Configuring environment ===" -ForegroundColor Cyan
    if (-not (Test-Path $EnvFile)) {
Set-Content -LiteralPath $EnvFile -Value @"
# NGA Mirror Station v4.11 - Environment Variables
NGA_MOBILE_UA=Nga_Official/9.9.9
SCRAPE_MAX_THREAD_PAGES=2
SCRAPE_MAX_DETAIL_THREADS=100
RATE_LIMIT_MAX_CONCURRENT=3
RATE_LIMIT_WINDOW_MS=1000
RATE_LIMIT_MAX_PER_WINDOW=10
CACHE_TTL_SECONDS=300
CACHE_MAX_ENTRIES=500
ENABLE_AUTO_REFRESH=0
REFRESH_INTERVAL_MIN=30
IMAGE_PROXY_MAX_AGE=86400

# Authentication
# AUTH_ENCRYPT_KEY=your-secret-key-here
LOGIN_TIMEOUT_MS=300000
LOGIN_NAV_TIMEOUT=15000
LOGIN_ELEMENT_TIMEOUT=5000
AUTH_RENEW_JITTER_HOURS=2
"@ -Encoding UTF8
        Write-OK ".env.local created"
    } else {
        Write-OK ".env.local already exists"
    }

    if (-not (Test-Path $DataDir)) {
        New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    }

    Write-Host ""
    Write-Host "=== [6/6] Initializing data ===" -ForegroundColor Cyan
    if (-not (Test-Path $DBPath) -or $Full) {
        if ($Full) {
            Write-Step "Scraping board tree (366 forums)..."
            Invoke-NpmScript "scrape-boards"
            Write-Step "Scraping forum data (~5 minutes)..."
            Write-Info "Scraping Car Club + Music Film..."
            Invoke-NpmScript "scrape-all"
            Write-OK "Data scrape complete"
        } else {
            Write-Step "Scraping board tree (366 forums)..."
            Invoke-NpmScript "scrape-boards"
            Write-OK "Board tree cached"
            Write-Info "Tip: run 'manage.ps1 update' or 'npm run scrape-all' to fetch thread data"
        }
    } else {
        $dbSizeKB = [math]::Round((Get-Item $DBPath).Length / 1024, 1)
        Write-OK "Database exists ($dbSizeKB KB), skipping data init"
        Write-Info "Run 'manage.ps1 update' to incrementally refresh data"
    }

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "  Setup complete! Running tests..." -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green

    Invoke-NpmScript "test"

    Write-Host ""
    Write-Host "  Next steps:" -ForegroundColor Yellow
    Write-Host "    manage.ps1 start        <- Start server" -ForegroundColor White
    Write-Host "    manage.ps1 update       <- Scrape latest data" -ForegroundColor White
    Write-Host "    manage.ps1 start --dev   <- Dev mode (hot reload)" -ForegroundColor White
    Write-Host ""
}

# ---- start ----

function Invoke-Start {
    if (Test-ServerRunning) {
        $svrPid = Get-ServerPid
        Write-Warn "Server already running (PID: $svrPid, port $Port)"
        Write-Info "Run stop first, or use restart"
        return
    }

    if ((Test-NodeInstalled) -eq 0) { Write-Fail "Node.js not installed. Run setup first."; return }
    if (-not (Test-Path $NodeModules)) { Write-Fail "Dependencies not installed. Run setup first."; return }

    $env:Path = "$NodeDir;$env:Path"

    if ($Dev) {
        Write-Step "Starting dev server (next dev)..."
        Write-Info "Access: http://localhost:$Port"
        Write-Info "Press Ctrl+C to stop"
        Write-Host ""
        & $NpmCmd run dev
    }
    else {
        $nextDir = Join-Path $ProjectRoot ".next"
        if (-not (Test-Path $nextDir) -or $Force) {
            Write-Step "Building production bundle (next build)..."
            & $NpmCmd run build
            if ($LASTEXITCODE -ne 0) { Write-Fail "Build failed"; return }
        }

        Write-Step "Starting production server (next start)..."
        Write-Info "Access: http://localhost:$Port"
        Write-Info "Running in background. Use 'manage.ps1 stop' to stop."
        Write-Host ""

        Start-Process -FilePath $NpmCmd -ArgumentList "run start" -WorkingDirectory $ProjectRoot -WindowStyle Normal

        Start-Sleep 5
        if (Test-ServerRunning) {
            Write-OK "Server started (PID: $(Get-ServerPid), port $Port)"
        } else {
            Start-Sleep 5
            if (Test-ServerRunning) {
                Write-OK "Server started (PID: $(Get-ServerPid))"
            } else {
                Write-Warn "Server may still be starting. Check status or wait a moment."
            }
        }
    }
}

# ---- stop ----

function Invoke-Stop {
    if (-not (Test-ServerRunning)) {
        Write-Info "Server is not running (port $Port)"
        return
    }

    $svrPid = Get-ServerPid
    Write-Step "Stopping server (PID: $svrPid)..."

    try {
        taskkill /PID $svrPid /F 2>$null
        Start-Sleep 2
        if (-not (Test-ServerRunning)) {
            Write-OK "Server stopped"
        } else {
            Write-Warn "Server may not have fully stopped, force killing..."
            taskkill /F /IM node.exe 2>$null
            Start-Sleep 1
            if (-not (Test-ServerRunning)) {
                Write-OK "Server stopped"
            } else {
                Write-Fail "Unable to stop server on port $Port"
            }
        }
    } catch {
        Write-Fail "Stop failed: $_"
    }

    # Cleanup orphan Chrome processes
    try { taskkill /F /IM chrome.exe 2>$null } catch {}
}

# ---- restart ----

function Invoke-Restart {
    Invoke-Stop
    Start-Sleep 2
    Invoke-Start
}

# ---- status ----

function Invoke-Status {
    Write-Host ""
    Write-Host "=== Environment ===" -ForegroundColor Cyan
    $nodeMajor = Test-NodeInstalled
    if ($nodeMajor -gt 0) { Write-OK "Node.js v$nodeMajor.x" } else { Write-Fail "Node.js not installed" }

    $chromePath = Test-ChromeInstalled
    if ($chromePath) { Write-OK "Chrome: $chromePath" } else { Write-Fail "Chrome not installed" }

    if (Test-Path $NodeModules) {
        Write-OK "node_modules: installed"
    } else { Write-Warn "node_modules: not installed (run setup)" }

    if (Test-Path $DBPath) {
        $dbSizeKB = [math]::Round((Get-Item $DBPath).Length / 1024, 1)
        Write-OK "Database: $dbSizeKB KB"
    } else { Write-Warn "Database: not initialized (run setup --full)" }

    Write-Host ""
    Write-Host "=== Server ===" -ForegroundColor Cyan
    if (Test-ServerRunning) {
        $svrPid = Get-ServerPid
        Write-OK "Server running - PID: $svrPid, Port: $Port"
        try {
            $health = Invoke-RestMethod "http://localhost:$Port/api/v1/health" -TimeoutSec 3
            Write-Info "  Uptime: $([math]::Round($health.uptime, 1))s"
            Write-Info "  Memory: RSS $($health.memory.rss)MB, Heap $($health.memory.heapUsed)MB"
        } catch { Write-Warn "Health endpoint unreachable" }
    } else {
        Write-Info "Server not running - Port: $Port"
    }

    Write-Host ""
}

# ---- update ----

function Invoke-Update {
    if ((Test-NodeInstalled) -eq 0) { Write-Fail "Node.js not installed"; return }

    Write-Host ""
    Write-Step "Updating board tree..."
    Invoke-NpmScript "scrape-boards"

    Write-Step "Incrementally scraping new threads..."
    Invoke-NpmScript "scrape-incremental"

    Write-Info "Run 'manage.ps1 restart' to reload data into the running server"
}

# ---- dispatch ----

switch ($Command) {
    "setup"   { Invoke-Setup }
    "start"   { Invoke-Start }
    "stop"    { Invoke-Stop }
    "restart" { Invoke-Restart }
    "status"  { Invoke-Status }
    "update"  { Invoke-Update }
}
