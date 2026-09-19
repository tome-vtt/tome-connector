<#
.SYNOPSIS
    Behaviour tests for lock.ps1. Runs against a temporary lock directory, never the real one.

.EXAMPLE
    pwsh -NoProfile -File .claude/scripts/lock.test.ps1
#>
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'lock.ps1'
$dir = Join-Path ([System.IO.Path]::GetTempPath()) "tome-lock-test-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $dir | Out-Null
$lockFile = Join-Path $dir 'tests.lock'
$failures = 0
$sleepers = @()

function New-Sleeper { $p = Start-Process pwsh -ArgumentList '-NoProfile', '-Command', 'Start-Sleep 600' -PassThru -WindowStyle Hidden; $script:sleepers += $p; $p }

# Runs lock.ps1 in a fresh process as the given session. Returns exit code and output.
function Invoke-Lock([string]$session, [string[]]$arguments) {
    $saved = $env:TOME_AGENT_MARKER, $env:TOME_LOCK_DIR, $env:CLAUDE_PID
    $env:TOME_AGENT_MARKER = $session; $env:TOME_LOCK_DIR = $dir; $env:CLAUDE_PID = $null
    try {
        $out = & pwsh -NoProfile -File $script @arguments 2>&1 | Out-String
        return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
    }
    finally { $env:TOME_AGENT_MARKER, $env:TOME_LOCK_DIR, $env:CLAUDE_PID = $saved }
}

function Assert([bool]$condition, [string]$label, $result) {
    if ($condition) { Write-Host "  ok   $label" }
    else { Write-Host "  FAIL $label`n$($result.Out)" -ForegroundColor Red; $script:failures++ }
}

$quick = @('-WaitMinutes', '0.03', '-PollSeconds', '1')   # ~2s wait

try {
    Write-Host 'acquire ties the lock to the owner process, not to lock.ps1'
    $a = New-Sleeper
    $r = Invoke-Lock 'A' @('acquire', 'tests', '-OwnerPid', $a.Id)
    Assert ($r.Code -eq 0) 'A acquires' $r
    $r = Invoke-Lock 'B' (@('acquire', 'tests', '-OwnerPid', $a.Id) + $quick)
    Assert ($r.Code -eq 3 -and $r.Out -match 'timed out') 'B waits and times out while A''s owner lives' $r

    Write-Host 'a live holder never expires on age'
    $lock = Get-Content $lockFile -Raw | ConvertFrom-Json
    $lock.AcquiredUtc = '2020-01-01T00:00:00.0000000Z'
    Set-Content $lockFile ($lock | ConvertTo-Json -Compress) -NoNewline
    $r = Invoke-Lock 'B' (@('acquire', 'tests', '-OwnerPid', $a.Id) + $quick)
    Assert ($r.Code -ne 0) 'B still times out on a six-year-old live lock' $r

    Write-Host 'release is refused to another session, allowed to the holder'
    $r = Invoke-Lock 'B' @('release', 'tests')
    Assert ($r.Code -eq 4 -and (Test-Path $lockFile)) 'B cannot release A''s lock' $r
    Write-Host 'holds are counted, so an inner release cannot drop the outer holder''s lock'
    $r = Invoke-Lock 'A' @('acquire', 'tests', '-OwnerPid', $a.Id)
    Assert ($r.Code -eq 0 -and $r.Out -match 'hold 2') 'A re-acquiring counts a second hold' $r
    $r = Invoke-Lock 'A' @('release', 'tests')
    Assert ($r.Code -eq 0 -and (Test-Path $lockFile)) 'A''s inner release gives one hold back, not the lock' $r
    $r = Invoke-Lock 'A' @('release', 'tests')
    Assert ($r.Code -eq 0 -and -not (Test-Path $lockFile)) 'A releases' $r

    Write-Host 'break takes every hold at once'
    [void](Invoke-Lock 'A' @('acquire', 'tests', '-OwnerPid', $a.Id))
    [void](Invoke-Lock 'A' @('acquire', 'tests', '-OwnerPid', $a.Id))
    $r = Invoke-Lock 'B' @('break', 'tests')
    Assert ($r.Code -eq 0 -and -not (Test-Path $lockFile)) 'break clears a lock held twice' $r

    Write-Host 'a dead owner is broken'
    $b = New-Sleeper
    [void](Invoke-Lock 'A' @('acquire', 'tests', '-OwnerPid', $b.Id))
    Stop-Process -Id $b.Id -Force; $b.WaitForExit()
    $r = Invoke-Lock 'B' (@('acquire', 'tests', '-OwnerPid', $a.Id) + $quick)
    Assert ($r.Code -eq 0 -and $r.Out -match 'breaking stale') 'B breaks and acquires' $r
    [void](Invoke-Lock 'B' @('release', 'tests'))

    Write-Host 'a recycled PID reads as dead'
    $payload = @{ OwnerPid = $a.Id; OwnerName = 'x'; OwnerStartUtc = '2020-01-01T00:00:00.0000000Z'; Session = 'A'; AcquiredUtc = [datetime]::UtcNow.ToString('o') }
    Set-Content $lockFile ($payload | ConvertTo-Json -Compress) -NoNewline
    $r = Invoke-Lock 'B' (@('acquire', 'tests', '-OwnerPid', $a.Id) + $quick)
    Assert ($r.Code -eq 0) 'B breaks a lock whose PID now belongs to a later process' $r
    [void](Invoke-Lock 'B' @('release', 'tests'))

    Write-Host 'a PID whose start time cannot be read is not confirmation that the owner lives'
    $system = Get-Process -Id 4 -ErrorAction SilentlyContinue
    # Not a try/catch: PowerShell answers $null for an unreadable property rather than raising,
    # which is the whole reason the guard in Get-Verdict stood down silently.
    $startReadable = $system -and $null -ne $system.StartTime
    if (-not $system -or $startReadable) {
        Write-Host '  skip PID 4 is absent, or its start time is readable here'
    }
    else {
        # Same name, so the name check passes and the start time is what decides. It is unreadable,
        # which used to skip the comparison and leave the lock held for good.
        $payload = @{ OwnerPid = 4; OwnerName = $system.ProcessName; OwnerStartUtc = '2020-01-01T00:00:00.0000000Z'; Session = 'A'; AcquiredUtc = [datetime]::UtcNow.ToString('o') }
        Set-Content $lockFile ($payload | ConvertTo-Json -Compress) -NoNewline
        $r = Invoke-Lock 'B' (@('acquire', 'tests', '-OwnerPid', $a.Id) + $quick)
        Assert ($r.Code -eq 0) 'B breaks a lock whose owner it cannot confirm' $r
        [void](Invoke-Lock 'B' @('release', 'tests'))
    }

    Write-Host 'a stale lock that will not delete times out instead of spinning'
    $payload = @{ OwnerPid = $b.Id; OwnerName = 'pwsh'; OwnerStartUtc = $null; Session = 'A'; AcquiredUtc = [datetime]::UtcNow.ToString('o') }
    Set-Content $lockFile ($payload | ConvertTo-Json -Compress) -NoNewline
    # Readable, so the verdict is 'dead' - but shared for reading only, so the delete is denied.
    $pinned = [System.IO.File]::Open($lockFile, 'Open', 'Read', 'Read')
    try {
        $r = Invoke-Lock 'B' (@('acquire', 'tests', '-OwnerPid', $a.Id) + $quick)
        Assert ($r.Code -eq 3 -and $r.Out -match 'timed out') 'B gives up on a lock it may break but cannot remove' $r
    }
    finally { $pinned.Dispose() }
    Remove-Item -LiteralPath $lockFile -Force

    Write-Host 'an unreadable lock is held, not free'
    Set-Content $lockFile '{"OwnerPid":' -NoNewline
    $r = Invoke-Lock 'B' (@('acquire', 'tests', '-OwnerPid', $a.Id) + $quick)
    Assert ($r.Code -ne 0 -and (Test-Path $lockFile)) 'B does not break a freshly written partial file' $r

    $stream = [System.IO.File]::Open($lockFile, 'Open', 'ReadWrite', 'None')
    try {
        $r = Invoke-Lock 'B' (@('acquire', 'tests', '-OwnerPid', $a.Id) + $quick)
        Assert ($r.Code -ne 0) 'B does not break a file still open for writing' $r
    }
    finally { $stream.Dispose() }

    (Get-Item $lockFile).LastWriteTimeUtc = [datetime]::UtcNow.AddMinutes(-10)
    $r = Invoke-Lock 'B' (@('acquire', 'tests', '-OwnerPid', $a.Id) + $quick)
    Assert ($r.Code -eq 0 -and $r.Out -match 'breaking stale') 'B breaks a file unreadable for ten minutes' $r
    [void](Invoke-Lock 'B' @('release', 'tests'))

    Write-Host 'break forces; release-session only takes its own'
    [void](Invoke-Lock 'A' @('acquire', 'tests', '-OwnerPid', $a.Id))
    [void](Invoke-Lock 'A' @('acquire', 'tests', '-OwnerPid', $a.Id))   # a session ending owes nothing
    $r = Invoke-Lock 'B' @('release-session')
    Assert (Test-Path $lockFile) 'B''s session end leaves A''s lock' $r
    $r = Invoke-Lock 'A' @('release-session')
    Assert (-not (Test-Path $lockFile)) 'A''s session end releases it' $r
    [void](Invoke-Lock 'A' @('acquire', 'tests', '-OwnerPid', $a.Id))
    $r = Invoke-Lock 'B' @('break', 'tests')
    Assert ($r.Code -eq 0 -and -not (Test-Path $lockFile)) 'break removes a live lock' $r

    Write-Host 'run holds for the command and releases after, passing the exit code through'
    $r = Invoke-Lock 'A' @('run', 'tests', '-Command', "if (Test-Path '$lockFile') { 'HELD' }; exit 3")
    Assert ($r.Code -eq 3 -and $r.Out -match 'HELD' -and -not (Test-Path $lockFile)) 'run' $r
    [void](Invoke-Lock 'A' @('acquire', 'tests', '-OwnerPid', $a.Id))
    $r = Invoke-Lock 'A' @('run', 'tests', '-Command', "'inner'")
    Assert ($r.Code -eq 0 -and (Test-Path $lockFile)) 'run inside a held lock leaves it held' $r
    $r = Invoke-Lock 'A' @('release', 'tests')
    Assert ($r.Code -eq 0 -and -not (Test-Path $lockFile)) 'and leaves it holding exactly one hold' $r

    Write-Host 'a lock that was never taken does not look like a suite that ran and failed'
    $dead = New-Sleeper
    Stop-Process -Id $dead.Id -Force; $dead.WaitForExit()
    $r = Invoke-Lock 'A' @('acquire', 'tests', '-OwnerPid', $dead.Id)
    Assert ($r.Code -eq 5 -and -not (Test-Path $lockFile)) 'a dead -OwnerPid exits 5' $r
    $r = Invoke-Lock 'A' @('run', 'tests', '-Command', 'exit 1')
    Assert ($r.Code -eq 1 -and -not (Test-Path $lockFile)) 'a command exiting 1 passes 1 through' $r
}
finally {
    $sleepers | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
}

if ($failures) { Write-Host "$failures failed" -ForegroundColor Red; exit 1 }
Write-Host 'all passed'
