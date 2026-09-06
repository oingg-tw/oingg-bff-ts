<#
.SYNOPSIS
  Reliably stops whatever process is actually listening on given TCP port(s), then verifies it's gone.

.DESCRIPTION
  `taskkill /IM node.exe /T` is unreliable on this machine — some child processes report "the operation
  attempted is not supported" and survive, leaving a stray dev server bound to its port even after a
  "kill everything" attempt looked successful. This script instead looks up the actual owning process ID
  per port via Get-NetTCPConnection (not by image name, so it never touches an unrelated node.exe
  process that just happens to be running), kills that PID directly with Stop-Process -Force, and
  re-checks the port is actually free afterward — retrying a few times since a process can take a
  moment to release its socket after being killed.

.PARAMETER Ports
  One or more TCP ports to free. Defaults to 4000 (this service's own dev port) only — never touches
  other services' ports (3000 web-nuxt, 5000 analysis-ts, etc.) unless explicitly listed, since those
  belong to other sessions/teams.

.EXAMPLE
  ./scripts/kill-port.ps1
  Kills whatever is listening on port 4000 (this service's dev server) and confirms it's free.

.EXAMPLE
  ./scripts/kill-port.ps1 -Ports 4000,4001
  Kills whatever is listening on ports 4000 and 4001.
#>
param(
    [int[]]$Ports = @(4000),
    [int]$MaxAttempts = 5,
    [int]$RetryDelayMs = 500
)

foreach ($port in $Ports) {
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if (-not $connections) {
            break
        }

        $procIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($procId in $procIds) {
            $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
            $procName = if ($proc) { $proc.ProcessName } else { "unknown" }
            try {
                Stop-Process -Id $procId -Force -ErrorAction Stop
                Write-Host "Port ${port}: killed PID $procId ($procName)"
            } catch {
                Write-Host "Port ${port}: could not kill PID $procId ($procName) - $($_.Exception.Message)"
            }
        }

        Start-Sleep -Milliseconds $RetryDelayMs
    }

    $stillListening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($stillListening) {
        Write-Host "Port ${port}: STILL IN USE after $MaxAttempts attempts - manual check needed" -ForegroundColor Red
    } else {
        Write-Host "Port ${port}: free"
    }
}
