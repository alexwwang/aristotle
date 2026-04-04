# aristotle-reflector.ps1 — Lightweight Stop hook for Aristotle (Windows)
# Installed at: ~/.config/opencode/skills/aristotle/hooks/aristotle-reflector.ps1
#
# IMPORTANT: This hook does NOT trigger Aristotle automatically.
# It only suggests. The user must confirm by typing /aristotle.
# This prevents unwanted context consumption in the current session.

$ErrorActionPreference = 'SilentlyContinue'

# Read stdin
$inputJson = [Console]::In.ReadToEnd()

if ([string]::IsNullOrWhiteSpace($inputJson)) {
    $inputJson = @($input) -join ''
}

if ([string]::IsNullOrWhiteSpace($inputJson)) {
    exit 0
}

try {
    $data = $inputJson | ConvertFrom-Json
} catch {
    exit 0
}

$transcriptPath = $data.transcript_path
$transcript = ''

if ($transcriptPath -and (Test-Path $transcriptPath)) {
    $transcript = Get-Content $transcriptPath -Raw -ErrorAction SilentlyContinue
}

if ([string]::IsNullOrWhiteSpace($transcript)) {
    exit 0
}

# Quick scan for error-correction patterns
$errorScore = 0

$patterns = @(
    # User correction (English)
    'wrong', 'incorrect', 'not right', 'no, that', 'actually,',
    # User correction (Chinese)
    '不对', '错了', '搞错', '不是这样',
    # Model apology
    'sorry', 'apologize', "you're right", 'I was wrong', '我的错', '你说得对',
    # Explicit learning
    'remember this', 'learn from this', '记住', '以后别'
)

foreach ($pattern in $patterns) {
    $matches = [regex]::Matches($transcript, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $errorScore += $matches.Count
}

# Threshold: need at least 2 matches to suggest (avoid noise)
if ($errorScore -lt 2) {
    exit 0
}

# Inject a ONE-LINE suggestion only
$output = @{
    decision = "continue"
    inject_prompt = "🦉 Aristotle: Error-correction patterns detected. Type /aristotle to launch an isolated reflection subagent, or ignore to skip."
} | ConvertTo-Json -Compress

Write-Output $output
