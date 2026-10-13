<#
.SYNOPSIS
    Cross-session mutex for the resources this machine only has one of.

.DESCRIPTION
    Several agent sessions work this repository at once, sharing one working tree. Two resources
    contend badly:

      tests  - two concurrent vitest runs produce failures that look like regressions and are
               not (learned in TomeVTT, where this script comes from).
      ports  - unused in this repository (TomeVTT's dev-server ports); kept so the script
               stays identical in behaviour to its origin.
      merge  - there is one `development` branch and one main working tree, and a merge moves
               both. N subagents finishing worktrees at once would otherwise interleave
               `switch` / `merge` / `worktree remove` against a shared index, which fails on
               index.lock at best and merges into the wrong branch at worst. Held across the
               whole merge-and-clean-up sequence, not around a single git call.

    The lock is a file under the repository's .claude/locks/, resolved through
    `git rev-parse --git-common-dir` (TOME_LOCK_DIR overrides it, for the tests).

    Three rules keep a live holder from being broken:

    - Creation is atomic. [File]::Open with CreateNew fails if the file exists.
    - A holder is alive exactly while its owner process is. The owner is the long-lived agent
      process ($env:CLAUDE_PID, or the nearest non-shell ancestor), never this script's own
      short-lived pwsh - `acquire` returns immediately, so its PID is dead before anyone looks.
      The owner's start time is recorded beside its PID, so a recycled PID reads as dead.
      There is no age limit: a forty-five-minute suite is a live holder.
    - A lock file that cannot be read is held, not free. It is either being written this
      instant or was stranded by a crash between create and write; only the second is broken,
      and only once it has stayed unreadable for two minutes.

    Breaking and releasing both re-read the file under a named system mutex and delete only
    what they judged, so two contenders breaking the same dead lock cannot delete the fresh
    one the first of them just created.

    Holds are counted. `acquire` from a session that already holds the lock adds one and
    `release` gives one back, so an inner release cannot drop a lock its caller still needs.
    `break`, `release -Force` and a session ending take every hold at once.

    Exit codes: 0 success, 3 acquire timed out, 4 release refused (not ours), 5 -OwnerPid is
    not a running process, 1 anything unexpected. `run` exits with its command's own code, so
    a suite that ran and failed never looks like a lock that was never taken.

.EXAMPLE
    # The recommended shape. The lock is always released, including on a failing command.
    .claude/scripts/lock.ps1 run tests -Command 'npm test'

.EXAMPLE
    .claude/scripts/lock.ps1 status
    .claude/scripts/lock.ps1 acquire ports
    .claude/scripts/lock.ps1 release ports
    .claude/scripts/lock.ps1 break tests      # only after status shows it stale
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateSet('acquire', 'release', 'status', 'break', 'run', 'release-session')]
    [string]$Action,

    [Parameter(Position = 1)]
    [ValidateSet('tests', 'ports', 'merge')]
    [string]$Name,

    # For `run`: the command line to execute while holding the lock.
    [string]$Command,

    # How long `acquire` waits for a live holder before giving up.
    [double]$WaitMinutes = 60,

    # How often a waiting `acquire` looks again.
    [int]$PollSeconds = 15,

    # The process whose life the lock is tied to. Defaults to the agent process.
    [int]$OwnerPid,

    # Release a lock this session does not own.
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# `run` reads $LASTEXITCODE itself to pass the command's code through. With this preference on - a
# $PROFILE or an enclosing scope can set it, and agents call this from their own shell - a non-zero
# native exit becomes a terminating error under $ErrorActionPreference, and "the tests failed with
# 3" would reach the caller as "lock.ps1 blew up".
$PSNativeCommandUseErrorActionPreference = $false

$LockNames = @('tests', 'ports', 'merge')

# Writing the payload takes microseconds, so a file unreadable for this long was stranded.
$UnreadableGraceSeconds = 120

# Process start times read back with sub-millisecond jitter; a recycled PID differs by far more.
$StartToleranceSeconds = 2

# A live process stuck inside the delete guard would otherwise block every lock.ps1 on the machine,
# including the SessionEnd release, whose hook timeout is 30s.
$GuardWaitMs = 15000

# The caller is a hook or an agent branching on the exit status, so a lock that was never taken and
# a suite that ran and failed must not look alike. Anything else is the wrapped command's own code.
$ExitUnexpected = 1
$ExitTimeout = 3
$ExitRefused = 4
$ExitNoOwner = 5
$script:FailureCode = $ExitUnexpected

# Fails with $script:FailureCode rather than the bare 1 an uncaught throw exits with.
function Stop-Lock([int]$code, [string]$message) {
    $script:FailureCode = $code
    throw $message
}

trap {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit $script:FailureCode
}

# Nothing can move the repository mid-run, and the poll loop asks per turn. Unmemoized this shells
# out to git every time - 287ms measured here, which is what turned a failed break into a spin.
$script:LockDir = $null

function Get-LockDirectory {
    if ($script:LockDir) { return $script:LockDir }
    if ($env:TOME_LOCK_DIR) {
        $dir = $env:TOME_LOCK_DIR
    }
    else {
        # --git-common-dir is the repository's .git, wherever this is called from. A per-checkout
        # lock directory would be worse than none: every session would take its own copy.
        $common = (& git rev-parse --git-common-dir 2>$null)
        if ($LASTEXITCODE -ne 0 -or -not $common) { throw 'lock.ps1 must run inside a git repository.' }
        $dir = Join-Path (Split-Path -Parent (Resolve-Path -LiteralPath $common)) '.claude/locks'
    }
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    return ($script:LockDir = (Resolve-Path -LiteralPath $dir).Path)
}

function Get-LockPath([string]$lockName) { Join-Path (Get-LockDirectory) "$lockName.lock" }

function Get-ProcessInfo([int]$id) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if (-not $p) { return $null }
    $start = $null
    try { $start = $p.StartTime.ToUniversalTime() } catch { }   # access denied: exists, start unknown
    return [pscustomobject]@{ Id = $p.Id; Name = $p.ProcessName; StartUtc = $start }
}

# The process a lock lives and dies with. Every command an agent runs is a short-lived shell, so
# the owner is found above the shells rather than at $PID.
function Get-Owner {
    if ($OwnerPid) {
        $info = Get-ProcessInfo $OwnerPid
        if (-not $info) { Stop-Lock $ExitNoOwner "-OwnerPid $OwnerPid is not a running process." }
        return $info
    }
    if ($env:CLAUDE_PID) {
        $info = Get-ProcessInfo ([int]$env:CLAUDE_PID)
        if ($info) { return $info }
    }
    $shells = @('pwsh', 'powershell', 'cmd', 'bash', 'sh', 'zsh', 'dash', 'conhost', 'wsl', 'env', 'timeout')
    $cur = (Get-Process -Id $PID).Parent
    while ($cur) {
        if ($shells -notcontains $cur.ProcessName.ToLowerInvariant()) { return Get-ProcessInfo $cur.Id }
        $cur = $cur.Parent
    }
    Write-Warning 'no long-lived owner process found; the lock will read as dead once this script exits. Use `run`, or pass -OwnerPid.'
    return Get-ProcessInfo $PID
}

# Which agent session this is. The working tree is shared, so a directory identifies nobody.
function Get-Session {
    if ($env:TOME_AGENT_MARKER) { return $env:TOME_AGENT_MARKER }
    if ($env:CLAUDE_CODE_SESSION_ID) { return $env:CLAUDE_CODE_SESSION_ID }
    $owner = Get-Owner
    return "pid:$($owner.Id)"
}

# Absent, Unreadable (being written, or stranded) or Held. Never null: a read that fails is not
# evidence that nobody holds the lock.
function Read-Lock([string]$path) {
    if (-not [System.IO.File]::Exists($path)) { return [pscustomobject]@{ State = 'Absent' } }
    $write = [System.IO.File]::GetLastWriteTimeUtc($path)
    try {
        $raw = [System.IO.File]::ReadAllText($path)
    }
    catch [System.IO.FileNotFoundException], [System.IO.DirectoryNotFoundException] {
        return [pscustomobject]@{ State = 'Absent' }
    }
    catch [System.IO.IOException], [System.UnauthorizedAccessException] {
        if (-not [System.IO.File]::Exists($path)) { return [pscustomobject]@{ State = 'Absent' } }
        return [pscustomobject]@{ State = 'Unreadable'; WriteUtc = $write; Raw = $null }
    }
    $lock = $null
    try { $lock = $raw | ConvertFrom-Json -ErrorAction Stop } catch { }
    if (-not $lock -or -not $lock.OwnerPid -or -not $lock.Session) {
        return [pscustomobject]@{ State = 'Unreadable'; WriteUtc = $write; Raw = $raw }
    }
    return [pscustomobject]@{ State = 'Held'; Lock = $lock; WriteUtc = $write; Raw = $raw }
}

# free | held | writing | dead | stranded. Only the last two may be broken.
function Get-Verdict($read) {
    switch ($read.State) {
        'Absent' { return 'free' }
        'Unreadable' {
            $age = ([datetime]::UtcNow - $read.WriteUtc).TotalSeconds
            if ($age -gt $UnreadableGraceSeconds) { return 'stranded' } else { return 'writing' }
        }
        'Held' {
            $proc = Get-ProcessInfo ([int]$read.Lock.OwnerPid)
            if (-not $proc) { return 'dead' }
            # A name that no longer matches is a recycled PID whatever the clock says, and it costs
            # nothing: the payload already records it.
            if ($read.Lock.OwnerName -and $proc.Name -and $read.Lock.OwnerName -ne $proc.Name) { return 'dead' }
            if ($read.Lock.OwnerStartUtc) {
                # An unreadable start time is evidence against a match, not neutral. Process.StartTime
                # throws for a process this user cannot open, and PowerShell hands back $null rather
                # than raising - so skipping the comparison made such a lock unbreakable for good.
                if (-not $proc.StartUtc) { return 'dead' }
                $recorded = ConvertTo-Utc $read.Lock.OwnerStartUtc
                if ([math]::Abs(($proc.StartUtc - $recorded).TotalSeconds) -gt $StartToleranceSeconds) { return 'dead' }
            }
            return 'held'
        }
    }
}

# ConvertFrom-Json turns ISO strings into local DateTimes; a string that survived is round-trip.
# Invariant, not the current culture: the string is an 'o' this script wrote itself, and a
# non-Gregorian calendar culture is not the right reader for one.
function ConvertTo-Utc($value) {
    if ($value -is [datetime]) { return $value.ToUniversalTime() }
    return [datetime]::Parse([string]$value, [cultureinfo]::InvariantCulture, 'RoundtripKind').ToUniversalTime()
}

# The one writer of a lock payload, so the create path and a depth rewrite cannot disagree about
# its shape - or about the format of the two timestamps, which a round trip through
# ConvertFrom-Json has by then turned into local DateTimes.
function New-LockPayload($lock, $depth) {
    if ($null -eq $depth) { $depth = $lock.Depth }
    return [ordered]@{
        OwnerPid      = $lock.OwnerPid
        OwnerName     = $lock.OwnerName
        OwnerStartUtc = if ($lock.OwnerStartUtc) { (ConvertTo-Utc $lock.OwnerStartUtc).ToString('o') } else { $null }
        Session       = $lock.Session
        AcquiredUtc   = (ConvertTo-Utc $lock.AcquiredUtc).ToString('o')
        # A payload written before this field existed reads back as one hold, not none.
        Depth         = [Math]::Max([int]$depth, 1)
    } | ConvertTo-Json -Compress
}

function Test-Breakable([string]$verdict) { $verdict -in @('dead', 'stranded') }

function Format-Lock($read) {
    $verdict = Get-Verdict $read
    switch ($read.State) {
        'Absent' { return 'free' }
        'Unreadable' {
            $age = [int]([datetime]::UtcNow - $read.WriteUtc).TotalSeconds
            $label = if ($verdict -eq 'stranded') { 'STALE (unreadable)' } else { 'being written' }
            return "$label - ${age}s old"
        }
        'Held' {
            $l = $read.Lock
            $age = [int]([datetime]::UtcNow - (ConvertTo-Utc $l.AcquiredUtc)).TotalMinutes
            $label = if ($verdict -eq 'held') { 'held' } else { 'STALE' }
            # The recorded name, plus the live one when they differ - which is a recycled PID, and
            # exactly what somebody running `status` is trying to see.
            $live = (Get-ProcessInfo ([int]$l.OwnerPid)).Name
            $who = if ($live -and $live -ne $l.OwnerName) { "$($l.OwnerName) PID $($l.OwnerPid) (now $live)" } else { "$($l.OwnerName) PID $($l.OwnerPid)" }
            $depth = if ([int]$l.Depth -gt 1) { " x$([int]$l.Depth)" } else { '' }
            return "$label by $who, session $($l.Session)$depth - ${age}m ago"
        }
    }
}

# Serialises every delete of a lock file across processes. Held for milliseconds, and a crashed
# holder abandons it to the OS rather than stranding it.
function Invoke-Guarded([string]$lockName, [scriptblock]$body) {
    $key = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData(
            [System.Text.Encoding]::UTF8.GetBytes((Get-LockDirectory).ToLowerInvariant()))).Substring(0, 16)
    # A named mutex is open to every user on the machine by default. NamedWaitHandleOptions narrows
    # it to this one while CurrentSessionOnly = $false keeps the machine-wide scope the `Global\`
    # prefix gave - agents can run in different login sessions. The prefix comes off when options
    # carry the scope; the fallback is for a host on .NET 8, where the type does not exist.
    $name = "TomeVTT-lock-$key-$lockName"
    if ('System.Threading.NamedWaitHandleOptions' -as [type]) {
        $opts = [System.Threading.NamedWaitHandleOptions]::new()
        $opts.CurrentUserOnly = $true
        $opts.CurrentSessionOnly = $false
        $mutex = [System.Threading.Mutex]::new($false, $name, $opts)
    }
    else {
        $mutex = [System.Threading.Mutex]::new($false, "Global\$name")
    }
    try {
        # An abandoned mutex hands ownership to the next waiter, so that catch really does own it.
        # A timeout does not, and a waiter that timed out must never call ReleaseMutex.
        $owned = $false
        try { $owned = $mutex.WaitOne($GuardWaitMs) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
        if (-not $owned) { throw "could not take the delete guard for '$lockName' within $([int]($GuardWaitMs / 1000))s" }
        try { return (& $body) } finally { $mutex.ReleaseMutex() }
    }
    finally { $mutex.Dispose() }
}

# Deletes the lock only if it is still exactly what was judged breakable.
function Invoke-Break([string]$lockName, $judged) {
    $path = Get-LockPath $lockName
    Invoke-Guarded $lockName {
        $now = Read-Lock $path
        if ($now.State -eq 'Absent') { return }
        if (-not (Test-Breakable (Get-Verdict $now))) { return }
        if ($now.Raw -ne $judged.Raw -or $now.WriteUtc -ne $judged.WriteUtc) { return }
        # A delete that fails is said out loud. Swallowed, it looked to the caller exactly like a
        # break that worked, and the caller's answer to that is to try again immediately.
        try { Remove-Item -LiteralPath $path -Force -ErrorAction Stop }
        catch { Write-Warning "could not remove '$path': $($_.Exception.Message)" }
    }
}

# Returns $true when this call took the lock, $false when this session already held it.
function Invoke-Acquire([string]$lockName, $owner) {
    $path = Get-LockPath $lockName
    $session = Get-Session
    # Stopwatch rather than an arithmetic deadline on Get-Date: local time is not monotonic, so a
    # DST fall-back turns a 60-minute wait into 120 and spring forward ends it early.
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    $limit = [timespan]::FromMinutes($WaitMinutes)
    $announced = $false
    $breakAnnounced = $false
    $last = $null

    while ($true) {
        # Every turn, not only the one that waited. A lock judged breakable that then will not
        # delete - a reader holding it open, an ACL denying it - used to loop between "breakable"
        # and "the break did nothing" with nothing to stop it, spinning a core until the agent
        # was killed and ignoring -WaitMinutes entirely.
        if ($clock.Elapsed -gt $limit) {
            $detail = if ($last) { ": $(Format-Lock $last)" } else { '' }
            Stop-Lock $ExitTimeout "timed out after $WaitMinutes minutes waiting for '$lockName'$detail"
        }
        try {
            $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
            try {
                $payload = New-LockPayload ([pscustomobject]@{
                        OwnerPid      = $owner.Id
                        OwnerName     = $owner.Name
                        OwnerStartUtc = $owner.StartUtc
                        Session       = $session
                        AcquiredUtc   = [datetime]::UtcNow
                        Depth         = 1
                    })
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
                $stream.Write($bytes, 0, $bytes.Length)
            }
            finally { $stream.Dispose() }
            Write-Host "acquired '$lockName' for $($owner.Name) PID $($owner.Id)"
            return $true
        }
        catch [System.IO.IOException] {
            $read = Read-Lock $path
            $last = $read
            $verdict = Get-Verdict $read
            if ($verdict -eq 'free') { continue }
            if ($verdict -eq 'held' -and $read.Lock.Session -eq $session) {
                # Count the hold rather than ignore it. `acquire` twice then `release` once used to
                # delete a lock the outer holder still believed it had - and the two-step shape is
                # the one this script's help and the hook's refusal message both recommend.
                $depth = Invoke-Guarded $lockName {
                    $now = Read-Lock $path
                    if ($now.State -ne 'Held' -or $now.Lock.Session -ne $session) { return 0 }
                    $next = [Math]::Max([int]$now.Lock.Depth, 1) + 1
                    [System.IO.File]::WriteAllText($path, (New-LockPayload $now.Lock $next))
                    return $next
                }
                if ($depth -eq 0) { continue }   # released underneath us: go take it properly
                Write-Host "'$lockName' is already held by this session (hold $depth)"
                return $false
            }
            if (Test-Breakable $verdict) {
                if (-not $breakAnnounced) {
                    Write-Host "breaking stale '$lockName' lock: $(Format-Lock $read)"
                    $breakAnnounced = $true
                }
                Invoke-Break $lockName $read
                # A break that left the file behind is a break that failed. Back off rather than
                # retrying at once, so this stays a wait.
                if ([System.IO.File]::Exists($path)) { Start-Sleep -Seconds $PollSeconds }
                continue
            }
            if (-not $announced) {
                Write-Host "waiting for '$lockName': $(Format-Lock $read)"
                $announced = $true
            }
            Start-Sleep -Seconds $PollSeconds
        }
    }
}

function Invoke-Release([string]$lockName, [bool]$forced) {
    $path = Get-LockPath $lockName
    $session = Get-Session
    $outcome = Invoke-Guarded $lockName {
        $read = Read-Lock $path
        if ($read.State -eq 'Absent') { return 'free' }
        $verdict = Get-Verdict $read
        $mine = $read.State -eq 'Held' -and $read.Lock.Session -eq $session
        # Give back one hold, not the lock. `break` and `release -Force` are the ways to end it
        # outright, and a session ending takes every hold with it.
        if ($mine -and -not $forced -and [int]$read.Lock.Depth -gt 1) {
            $next = [int]$read.Lock.Depth - 1
            [System.IO.File]::WriteAllText($path, (New-LockPayload $read.Lock $next))
            return "nested:$next"
        }
        if ($forced -or $mine -or (Test-Breakable $verdict)) {
            Remove-Item -LiteralPath $path -Force
            return 'released'
        }
        return "refused:$(Format-Lock $read)"
    }
    switch -Wildcard ($outcome) {
        'free' { Write-Host "'$lockName' was already free" }
        'released' { Write-Host "released '$lockName'" }
        'nested:*' { Write-Host "gave back one hold on '$lockName' - $($outcome.Substring(7)) still held by this session" }
        'refused:*' { Stop-Lock $ExitRefused "'$lockName' is $($outcome.Substring(8)) - not ours. Use ``break`` only if you are certain." }
    }
}

switch ($Action) {
    'status' {
        foreach ($n in $LockNames) { "{0,-6} {1}" -f $n, (Format-Lock (Read-Lock (Get-LockPath $n))) }
    }
    'acquire' {
        if (-not $Name) { throw "acquire needs a lock name: $($LockNames -join ', ')" }
        [void](Invoke-Acquire $Name (Get-Owner))
    }
    'release' {
        if (-not $Name) { throw "release needs a lock name: $($LockNames -join ', ')" }
        Invoke-Release $Name ([bool]$Force)
    }
    'break' {
        if (-not $Name) { throw "break needs a lock name: $($LockNames -join ', ')" }
        Invoke-Release $Name $true
    }
    'release-session' {
        # Called from the SessionEnd hook, so an agent killed mid-run does not strand a lock on a
        # process that happens to outlive it. The hook hands the session id on stdin as well.
        $sessions = @(Get-Session)
        if ([Console]::IsInputRedirected) {
            try {
                $hook = [Console]::In.ReadToEnd() | ConvertFrom-Json -ErrorAction Stop
                if ($hook.session_id) { $sessions += [string]$hook.session_id }
            }
            catch { }
        }
        foreach ($n in $LockNames) {
            $path = Get-LockPath $n
            $released = Invoke-Guarded $n {
                $read = Read-Lock $path
                if ($read.State -eq 'Held' -and $sessions -contains $read.Lock.Session) {
                    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
                    return $true
                }
                return $false
            }
            if ($released) { Write-Host "released '$n' held by this session" }
        }
    }
    'run' {
        if (-not $Name) { throw "run needs a lock name: $($LockNames -join ', ')" }
        if (-not $Command) { throw 'run needs -Command' }
        # This script is the owner for the length of the command, so killing it frees the lock.
        # An acquire this session already held counts a hold instead, and the release below gives
        # that one hold back rather than the lock.
        [void](Invoke-Acquire $Name (Get-ProcessInfo $PID))
        $global:LASTEXITCODE = 0
        try {
            # Invoke-Expression so the caller can pass a full pipeline, exactly as they would type it.
            Invoke-Expression $Command
            $code = $LASTEXITCODE
        }
        finally {
            # Runs on a failing command, on Ctrl-C, and on a terminating error inside $Command.
            # A lock this session already held before `run` stays held, one hold lighter.
            Invoke-Release $Name $false
        }
        if ($null -ne $code -and $code -ne 0) {
            Write-Host "command exited $code"
            exit $code
        }
    }
}
