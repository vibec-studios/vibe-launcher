param(
    [switch]$Uninstall,
    [switch]$Purge,
    [string]$Version = $env:VIBE_AGENT_VERSION,
    [int]$Port = 0,
    [switch]$NoPair,
    [switch]$DryRun,
    [switch]$Elevated
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$script:Repo = if ($env:VIBE_AGENT_REPO) { $env:VIBE_AGENT_REPO } else { 'vibec-studios/vibe-launcher' }
$script:ApiUrl = if ($env:VIBE_AGENT_API_URL) { $env:VIBE_AGENT_API_URL } else { "https://api.github.com/repos/$($script:Repo)/releases?per_page=100" }
$script:DownloadUrl = if ($env:VIBE_AGENT_DOWNLOAD_URL) { $env:VIBE_AGENT_DOWNLOAD_URL } else { "https://github.com/$($script:Repo)/releases/download" }
$script:ScriptUrl = if ($env:VIBE_AGENT_SCRIPT_URL) { $env:VIBE_AGENT_SCRIPT_URL } else { 'https://vibe.axolite.app/agent/install.ps1' }
$script:DocsUrl = "https://github.com/$($script:Repo)/blob/main/docs/REMOTE-AGENT-INSTALL.md"
$script:ServiceName = 'VibeAgent'
$script:ServiceAccount = 'NT SERVICE\VibeAgent'
$script:Asset = 'vibe-agent-x86_64-pc-windows-msvc.exe'
$script:DefaultPort = 25580
$script:McPort = 25565

if ($env:VIBE_AGENT_UNINSTALL -eq '1') { $Uninstall = [switch]::Present }
if ($env:VIBE_AGENT_PURGE -eq '1') { $Purge = [switch]::Present }
if ($env:VIBE_AGENT_DRY_RUN -eq '1') { $DryRun = [switch]::Present }
if ($env:VIBE_AGENT_NO_PAIR -eq '1') { $NoPair = [switch]::Present }
if ($Port -eq 0 -and $env:VIBE_AGENT_PORT) { $Port = [int]$env:VIBE_AGENT_PORT }

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "[OK] $Text" -ForegroundColor Green }
function Write-Hint([string]$Text) { Write-Host "[!] $Text" -ForegroundColor Yellow }

function Invoke-System {
    param([string]$Label, [scriptblock]$Action)
    if ($script:IsDry) {
        Write-Host "[Probelauf] $Label" -ForegroundColor DarkGray
        return
    }
    & $Action
}

function Invoke-Native {
    param([string]$FilePath, [string[]]$Arguments)
    Invoke-System "$FilePath $($Arguments -join ' ')" {
        $out = & $FilePath @Arguments 2>&1
        if ($LASTEXITCODE -ne 0) { throw "$FilePath $($Arguments -join ' ') fehlgeschlagen: $out" }
    }
}

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-ForwardArgument {
    $list = @()
    if ($Uninstall) { $list += '-Uninstall' }
    if ($Purge) { $list += '-Purge' }
    if ($NoPair) { $list += '-NoPair' }
    if ($Version) { $list += @('-Version', $Version) }
    if ($Port -gt 0) { $list += @('-Port', "$Port") }
    $list
}

function Start-Elevated {
    $path = $PSCommandPath
    if (-not $path) {
        $path = Join-Path $env:TEMP 'vibe-agent-install.ps1'
        Invoke-WebRequest -UseBasicParsing -Uri $script:ScriptUrl -OutFile $path
        $text = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
        [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding $true))
    }
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$path`"", '-Elevated') + (Get-ForwardArgument)
    Write-Host 'Für die Einrichtung des Windows-Dienstes werden Administratorrechte gebraucht.'
    Write-Host 'Bestätige gleich die Windows-Abfrage – die Installation läuft dann in einem neuen Fenster weiter.'
    try {
        Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList -Wait
    } catch {
        throw 'Ohne Administratorrechte geht es nicht. Starte PowerShell mit Rechtsklick > "Als Administrator ausführen".'
    }
}

function Initialize-Path {
    $script:IsDry = [bool]$DryRun
    if ($script:IsDry) {
        $root = if ($env:VIBE_AGENT_ROOT) { $env:VIBE_AGENT_ROOT } else { Join-Path $env:TEMP ("vibe-agent-dryrun-" + [guid]::NewGuid().ToString('N').Substring(0, 8)) }
        $script:InstallDir = Join-Path $root 'Program Files\Vibe Agent'
        $script:DataDir = Join-Path $root 'ProgramData\VibeAgent'
        Write-Host "Probelauf: Es wird nichts am System geändert. Dateien landen in $root" -ForegroundColor Yellow
    } else {
        $script:InstallDir = Join-Path $env:ProgramFiles 'Vibe Agent'
        $script:DataDir = Join-Path $env:ProgramData 'VibeAgent'
    }
    $script:Exe = Join-Path $script:InstallDir 'vibe-agent.exe'
}

function Assert-Platform {
    $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    if ($arch -eq 'ARM64') {
        Write-Hint 'Windows auf ARM: Der Agent läuft über die x64-Emulation.'
    } elseif ($arch -ne 'AMD64') {
        throw "Nicht unterstützte Architektur: $arch (unterstützt: 64-Bit-Windows)."
    }
    if ([Environment]::OSVersion.Version.Major -lt 10) {
        throw 'Windows 10, 11 oder Windows Server 2016+ wird benötigt.'
    }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}

function Get-ReleaseTag {
    if ($Version) {
        $v = $Version -replace '^agent-', '' -replace '^v', ''
        return "agent-v$v"
    }
    Write-Step 'Suche die neueste Agent-Version …'
    try {
        $releases = Invoke-RestMethod -UseBasicParsing -Uri $script:ApiUrl -Headers @{ 'User-Agent' = 'vibe-agent-installer' }
    } catch {
        throw "Release-Liste nicht erreichbar ($($script:ApiUrl)). Internetverbindung prüfen."
    }
    $tag = $releases | Where-Object { $_.tag_name -like 'agent-v*' } | Select-Object -First 1 -ExpandProperty tag_name
    if (-not $tag) { throw 'Noch kein Agent-Release (Tag agent-v…) gefunden.' }
    $tag
}

function Get-FileSha256([string]$Path) {
    (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Get-VerifiedBinary([string]$Tag, [string]$Temp) {
    Write-Step "Lade $($script:Asset) ($Tag) …"
    $sums = Join-Path $Temp 'SHA256SUMS'
    $bin = Join-Path $Temp $script:Asset
    try { Invoke-WebRequest -UseBasicParsing -Uri "$($script:DownloadUrl)/$Tag/SHA256SUMS" -OutFile $sums } catch { throw "SHA256SUMS für $Tag nicht gefunden." }
    try { Invoke-WebRequest -UseBasicParsing -Uri "$($script:DownloadUrl)/$Tag/$($script:Asset)" -OutFile $bin } catch { throw "$($script:Asset) für $Tag nicht gefunden." }
    $expected = $null
    foreach ($line in Get-Content -LiteralPath $sums) {
        $parts = $line.Trim() -split '\s+', 2
        if ($parts.Count -eq 2 -and $parts[1].TrimStart('*') -eq $script:Asset) { $expected = $parts[0].ToLowerInvariant(); break }
    }
    if (-not $expected) { throw "$($script:Asset) fehlt in SHA256SUMS." }
    $actual = Get-FileSha256 $bin
    if ($expected -ne $actual) { throw "Prüfsumme stimmt nicht (erwartet $expected, erhalten $actual). Download abgebrochen." }
    Write-Ok 'Prüfsumme (SHA256) stimmt'
    Unblock-File -LiteralPath $bin -ErrorAction SilentlyContinue
    $ver = $null
    try { $ver = (& $bin --version 2>$null | Select-Object -First 1) } catch { $ver = $null }
    if (-not $ver) { throw 'Das heruntergeladene Programm startet nicht auf diesem System.' }
    [pscustomobject]@{ Path = $bin; Hash = $actual; Version = "$ver".Trim() }
}

function Get-ServiceInfo {
    if ($script:IsDry) { return $null }
    Get-CimInstance -ClassName Win32_Service -Filter "Name='$($script:ServiceName)'" -ErrorAction SilentlyContinue
}

function Resolve-Port($Service) {
    if ($Port -gt 0) {
        if ($Port -gt 65535) { throw "Ungültiger Port: $Port" }
        return $Port
    }
    if ($Service -and $Service.PathName -match '--port\s+(\d+)') { return [int]$Matches[1] }
    $script:DefaultPort
}

function Get-ServiceCommand([int]$AgentPort) {
    "`"$($script:Exe)`" run --service --data-dir `"$($script:DataDir)`" --port $AgentPort"
}

function Set-DataAcl {
    $grants = @('*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', "$($script:ServiceAccount):(OI)(CI)M")
    Invoke-Native 'icacls.exe' (@($script:DataDir, '/inheritance:r', '/grant:r') + $grants + @('/Q'))
}

function Register-AgentService([int]$AgentPort, $Existing) {
    $cmd = Get-ServiceCommand $AgentPort
    if ($Existing) {
        if ($Existing.PathName -ne $cmd) {
            Invoke-System "Dienst $($script:ServiceName): Startbefehl aktualisieren" {
                $r = Invoke-CimMethod -InputObject $Existing -MethodName Change -Arguments @{ PathName = $cmd }
                if ($r.ReturnValue -ne 0) { throw "Dienst konnte nicht geändert werden (Code $($r.ReturnValue))." }
            }
        }
    } else {
        Write-Step "Richte den Windows-Dienst $($script:ServiceName) ein …"
        Invoke-System "New-Service $($script:ServiceName) $cmd" {
            New-Service -Name $script:ServiceName -BinaryPathName $cmd -DisplayName 'Vibe Server Agent' -Description 'Verwaltet Minecraft-Server für den Vibe Launcher und das Vibe Panel.' -StartupType Automatic | Out-Null
        }
    }
    Invoke-Native 'sc.exe' @('config', $script:ServiceName, 'obj=', $script:ServiceAccount, 'start=', 'delayed-auto')
    Invoke-Native 'sc.exe' @('sidtype', $script:ServiceName, 'unrestricted')
    Invoke-Native 'sc.exe' @('failure', $script:ServiceName, 'reset=', '86400', 'actions=', 'restart/5000/restart/10000/restart/30000')
    Invoke-Native 'sc.exe' @('failureflag', $script:ServiceName, '1')
}

function Invoke-Agent([int]$AgentPort, [string[]]$Arguments) {
    $all = @($Arguments) + @('--data-dir', $script:DataDir, '--port', "$AgentPort")
    $out = & $script:Exe @all 2>&1
    [pscustomobject]@{ Ok = ($LASTEXITCODE -eq 0); Output = (($out | ForEach-Object { "$_" }) -join [Environment]::NewLine) }
}

function Wait-AgentReady([int]$AgentPort) {
    for ($i = 0; $i -lt 30; $i++) {
        if ((Invoke-Agent $AgentPort @('status')).Ok) {
            Write-Ok 'Agent läuft'
            return $true
        }
        Start-Sleep -Seconds 1
    }
    Write-Hint "Der Agent antwortet noch nicht. Ereignisanzeige oder Log in $($script:DataDir) prüfen."
    $false
}

function Get-LocalAddress {
    try {
        $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop | Sort-Object RouteMetric | Select-Object -First 1
        $ip = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex -ErrorAction Stop | Select-Object -First 1 -ExpandProperty IPAddress
        if ($ip) { return $ip }
    } catch {
        $null = $_
    }
    '<PC-IP>'
}

function Show-FirewallHint([int]$AgentPort) {
    Write-Host ''
    Write-Host 'Firewall (es wurde nichts geöffnet):' -ForegroundColor White
    Write-Host '  Über die Vibe-Verbindung brauchst du keine Portfreigabe.'
    Write-Host '  Für die direkte Verbindung (Launcher/Panel) und Spieler ohne Vibe-Tunnel, in PowerShell als Administrator:'
    Write-Host "    New-NetFirewallRule -DisplayName 'Vibe Agent' -Direction Inbound -Protocol TCP -LocalPort $AgentPort,$($script:McPort) -Action Allow"
    Write-Host '  Bei Routern/Cloud-Anbietern zusätzlich die Portweiterleitung bzw. Firewall im Webinterface prüfen.'
}

function Show-Summary([string]$AgentVersion, [bool]$IsUpdate, [int]$AgentPort, [string]$PairText) {
    $addr = Get-LocalAddress
    $line = '-' * 64
    Write-Host ''
    Write-Host $line -ForegroundColor Green
    if ($IsUpdate) { Write-Host "  Vibe Agent aktualisiert: $AgentVersion" } else { Write-Host "  Vibe Agent installiert: $AgentVersion" }
    Write-Host ''
    if ($PairText) {
        Write-Host '  Kopplungscode:' -ForegroundColor White
        foreach ($l in ($PairText -split "`r?`n")) { Write-Host "    $l" -ForegroundColor White }
        Write-Host ''
    } elseif (-not $NoPair) {
        Write-Host "  Kopplungscode erzeugen:  & '$($script:Exe)' pair --data-dir '$($script:DataDir)'"
        Write-Host ''
    }
    Write-Host "  Panel:        https://${addr}:$AgentPort"
    Write-Host "  Im Launcher:  Server > Remote-Server hinzufügen > Adresse ${addr}:$AgentPort + Code"
    Write-Host '  Der Browser warnt beim ersten Öffnen (eigenes Zertifikat) – vergleiche den Fingerprint.' -ForegroundColor DarkGray
    Write-Host ''
    Write-Host "  Dienst:       Get-Service $($script:ServiceName)   (Neustart: Restart-Service $($script:ServiceName))"
    Write-Host '  Update:       Befehl von eben erneut ausführen'
    Write-Host "  Entfernen:    & ([scriptblock]::Create((irm $($script:ScriptUrl)))) -Uninstall"
    Write-Host "  Server-Daten: $($script:DataDir)"
    Write-Host $line -ForegroundColor Green
}

function Install-Agent {
    $temp = Join-Path $env:TEMP ("vibe-agent-install-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Force -Path $temp | Out-Null
    try {
        $tag = Get-ReleaseTag
        $bin = Get-VerifiedBinary $tag $temp
        $existing = Get-ServiceInfo
        $isUpdate = Test-Path -LiteralPath $script:Exe
        $changed = (-not $isUpdate) -or ((Get-FileSha256 $script:Exe) -ne $bin.Hash)
        $agentPort = Resolve-Port $existing
        New-Item -ItemType Directory -Force -Path $script:InstallDir, $script:DataDir | Out-Null
        $wasRunning = $existing -and $existing.State -eq 'Running'
        if ($changed) {
            if ($wasRunning) {
                Write-Step 'Stoppe den laufenden Agent (Minecraft-Server werden sauber beendet) …'
                Invoke-System "Stop-Service $($script:ServiceName)" { Stop-Service -Name $script:ServiceName -Force }
            }
            Copy-Item -LiteralPath $bin.Path -Destination "$($script:Exe).new" -Force
            Move-Item -LiteralPath "$($script:Exe).new" -Destination $script:Exe -Force
            Write-Ok "Programm: $($script:Exe)"
        } else {
            Write-Ok "Programm ist schon aktuell ($($bin.Version))"
        }
        Register-AgentService $agentPort $existing
        Set-DataAcl
        if ($changed -or -not $wasRunning -or ($existing -and $existing.PathName -ne (Get-ServiceCommand $agentPort))) {
            Write-Step "Starte den Dienst $($script:ServiceName) …"
            Invoke-System "Restart-Service $($script:ServiceName)" { Restart-Service -Name $script:ServiceName -Force }
        }
        $pairText = $null
        if (Wait-AgentReady $agentPort) {
            if (-not $NoPair) {
                $pair = Invoke-Agent $agentPort @('pair')
                if ($pair.Ok) { $pairText = $pair.Output } else { Write-Hint "Kopplungscode konnte nicht erzeugt werden: $($pair.Output)" }
            }
        }
        Show-FirewallHint $agentPort
        Show-Summary -AgentVersion $bin.Version -IsUpdate $isUpdate -AgentPort $agentPort -PairText $pairText
    } finally {
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath "$($script:Exe).new" -Force -ErrorAction SilentlyContinue
    }
}

function Uninstall-Agent {
    Write-Step 'Entferne den Vibe Agent …'
    $existing = Get-ServiceInfo
    if ($existing -or $script:IsDry) {
        Invoke-System "Stop-Service $($script:ServiceName)" { Stop-Service -Name $script:ServiceName -Force -ErrorAction SilentlyContinue }
        Invoke-Native 'sc.exe' @('delete', $script:ServiceName)
    }
    Remove-Item -LiteralPath $script:InstallDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Ok 'Dienst und Programm entfernt'
    if ($Purge) {
        Remove-Item -LiteralPath $script:DataDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Ok "Daten gelöscht ($($script:DataDir))"
    } else {
        Write-Host "Server-Daten bleiben erhalten: $($script:DataDir)"
        Write-Host "Alles löschen: & ([scriptblock]::Create((irm $($script:ScriptUrl)))) -Uninstall -Purge"
    }
}

function Invoke-VibeAgentSetup {
    if ($Purge -and -not $Uninstall) { throw '-Purge geht nur zusammen mit -Uninstall.' }
    if ($Port -lt 0 -or $Port -gt 65535) { throw "Ungültiger Port: $Port" }
    Assert-Platform
    if (-not $DryRun -and -not (Test-Admin)) {
        Start-Elevated
        return
    }
    Initialize-Path
    if ($Uninstall) { Uninstall-Agent } else { Install-Agent }
}

$script:Failed = $false
try {
    Invoke-VibeAgentSetup
} catch {
    $script:Failed = $true
    Write-Host "Fehler: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Hilfe: $($script:DocsUrl)"
}
if ($Elevated) {
    Read-Host 'Fertig – Enter drücken zum Schließen' | Out-Null
}
if ($script:Failed -and $PSCommandPath) {
    exit 1
}
