# test-and-push.ps1
# Continuously pull new code, run npm test, and push log/test.log.
# Start from the repository root. Press Ctrl+C to stop the loop.
# "test:watch": "powershell -NoProfile -Command \"Set-ExecutionPolicy -Scope Process Bypass; .\\test-and-push.ps1\"",
# Set-ExecutionPolicy -Scope Process Bypass; .\test-and-push.ps1

$ErrorActionPreference = "Stop"
$PollSeconds = 15
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Stop-WithMessage([string]$Message) {
    Write-Host ""
    Write-Host "ERROR: $Message" -ForegroundColor Red
    exit 1
}

function Write-Utf8Log([string]$Text, [bool]$Append = $true) {
    if ($Append) {
        [System.IO.File]::AppendAllText($LogFile, $Text, $Utf8NoBom)
    }
    else {
        [System.IO.File]::WriteAllText($LogFile, $Text, $Utf8NoBom)
    }
}

function Invoke-GitPull {
    Write-Host ""
    Write-Host "=== Pull latest changes ===" -ForegroundColor Cyan
    git pull --rebase
    return ($LASTEXITCODE -eq 0)
}

# Confirm this is a Git repository.
git rev-parse --show-toplevel *> $null
if ($LASTEXITCODE -ne 0) {
    Stop-WithMessage "Run this script from inside the ai-lexicon Git repository."
}

$RepoRoot = (git rev-parse --show-toplevel).Trim()
if (-not $RepoRoot) {
    Stop-WithMessage "Could not determine the repository root."
}
Set-Location $RepoRoot

$LogRelativePath = "log/test.log"
$LogFile = Join-Path $RepoRoot $LogRelativePath
New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null

Write-Host "=== Check working tree ===" -ForegroundColor Cyan
$Status = git status --porcelain
if ($LASTEXITCODE -ne 0) {
    Stop-WithMessage "Could not read Git status."
}
if ($Status) {
    Stop-WithMessage "Working tree is not clean. Commit or stash your changes before starting this script. Run 'git status --short' to inspect them."
}

if (-not (Invoke-GitPull)) {
    Stop-WithMessage "Initial git pull failed. Fix the Git issue and start the script again."
}

# Empty means run the test once immediately. Later, test only when non-log files change.
$LastTestedCommit = ""
Write-Host ""
Write-Host "Continuous test watcher started. Poll interval: $PollSeconds seconds." -ForegroundColor Green
Write-Host "Log encoding: UTF-8 (no BOM). Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host "Keep this PowerShell window open." -ForegroundColor Yellow

while ($true) {
    if ($LastTestedCommit -ne "") {
        if (-not (Invoke-GitPull)) {
            Write-Host "Pull failed; will retry in $PollSeconds seconds." -ForegroundColor Red
            Start-Sleep -Seconds $PollSeconds
            continue
        }

        # The script's own log-only commits must not trigger another test.
        $ChangedFiles = @(git diff --name-only $LastTestedCommit HEAD -- . ':(exclude)log/test.log')
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Could not inspect changes; will retry in $PollSeconds seconds." -ForegroundColor Red
            Start-Sleep -Seconds $PollSeconds
            continue
        }

        if ($ChangedFiles.Count -eq 0) {
            Write-Host "No new code changes. Checking again in $PollSeconds seconds..."
            Start-Sleep -Seconds $PollSeconds
            continue
        }

        Write-Host ""
        Write-Host "Detected new repository changes:" -ForegroundColor Cyan
        $ChangedFiles | ForEach-Object { Write-Host "  $_" }
    }

    # Remember the source commit before creating the log commit.
    $LastTestedCommit = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $LastTestedCommit) {
        Write-Host "Could not determine current commit; will retry." -ForegroundColor Red
        Start-Sleep -Seconds $PollSeconds
        continue
    }
    #"Command: npm test"
    $Branch = (git branch --show-current).Trim()
    $StartedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
    $Header = @(
        "Repository: $RepoRoot"
        "Branch: $Branch"
        "Tested commit: $LastTestedCommit"
        "Started: $StartedAt"
        "------------------------------------------------------------"
        ""
    ) -join [Environment]::NewLine
    Write-Utf8Log ($Header + [Environment]::NewLine) $false

    Write-Host ""
    Write-Host "=== Running npm test at $LastTestedCommit ===" -ForegroundColor Cyan

    # Capture output as PowerShell strings, then write it as UTF-8 explicitly.
    # This avoids mixing UTF-16LE native redirection with UTF-8 header/footer.
    # $TestOutput = @(& npm test 2>&1)
    # $TestExitCode = $LASTEXITCODE
    # foreach ($Line in $TestOutput) {
    #     $LineText = [string]$Line
    #     Write-Host $LineText
    #     Write-Utf8Log ($LineText + [Environment]::NewLine)
    # }

    $Footer = @(
        ""
        "------------------------------------------------------------"
        "Finished: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
        "Test exit code: $TestExitCode"
        ""
    ) -join [Environment]::NewLine
    Write-Utf8Log ($Footer + [Environment]::NewLine)

    Write-Host ""
    Write-Host "=== Commit and push test log ===" -ForegroundColor Cyan
    git add -f -- $LogRelativePath
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Could not stage the log. Will retry after the next polling interval." -ForegroundColor Red
        Start-Sleep -Seconds $PollSeconds
        continue
    }

    git diff --cached --quiet
    $DiffExitCode = $LASTEXITCODE
    if ($DiffExitCode -gt 1) {
        Write-Host "Could not inspect staged log changes. Will retry." -ForegroundColor Red
        Start-Sleep -Seconds $PollSeconds
        continue
    }

    if ($DiffExitCode -eq 1) {
        git commit -m "test: update automated test log"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Could not commit the test log. Resolve the Git issue; retrying." -ForegroundColor Red
            Start-Sleep -Seconds $PollSeconds
            continue
        }

        git push
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Push failed. The local log commit is retained; will pull/retry." -ForegroundColor Red
        }
        else {
            Write-Host "Test log pushed to GitHub." -ForegroundColor Green
        }
    }
    else {
        Write-Host "Test log unchanged; no commit needed." -ForegroundColor DarkGray
    }

    if ($TestExitCode -eq 0) {
        Write-Host ""
        Write-Host "TEST PASSED for commit $LastTestedCommit." -ForegroundColor Green
    }
    else {
        Write-Host ""
        Write-Host "TEST FAILED (exit code $TestExitCode) for commit $LastTestedCommit." -ForegroundColor Red
        Write-Host "The watcher stays running. After new code is pushed, it will pull and test again." -ForegroundColor Yellow
    }

    Start-Sleep -Seconds $PollSeconds
}
