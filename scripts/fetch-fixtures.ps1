# Downloads the PDF bake-off fixture set (Sprint 0).
# All sources are public / open-licence. Re-runnable: skips files already present.
#
# Note on hosts: raw.githubusercontent.com and cdn.jsdelivr.net are rate-limited or
# unreachable from some networks. api.github.com is not, so pdf.js corpus files are
# pulled via the Git blobs API instead of a raw URL.

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$dest = Join-Path $PSScriptRoot "..\fixtures"
if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest | Out-Null }

$ua = @{ "User-Agent" = "pdf2html-bakeoff" }

# name = local filename | src = pdf.js corpus filename OR a direct https URL
$fixtures = @(
    @{ name = "01-book-typography.pdf"; src = "freeculture.pdf"
       note = "Full book: typography, chapters, footnotes" }
    @{ name = "02-vector-heavy.pdf"; src = "22060_A1_01_Plans.pdf"
       note = "Architectural plans: heavy vector graphics" }
    @{ name = "03-rtl-arabic.pdf"; src = "ArabicCIDTrueType.pdf"
       note = "RTL with CID TrueType font: bidi test" }
    @{ name = "04-scanned-ccitt.pdf"; src = "ccitt_EndOfBlock_false.pdf"
       note = "CCITT (fax/scan) encoding: no text layer" }
    @{ name = "05-image-heavy.pdf"; src = "images.pdf"
       note = "Image heavy" }
    @{ name = "06-annotations.pdf"; src = "comments.pdf"
       note = "Comments and annotations" }
    @{ name = "07-academic-tables.pdf"; src = "https://arxiv.org/pdf/1706.03762"
       note = "Academic paper: tables, formulas, figures" }
    @{ name = "08-hebrew-doc.pdf"; src = "https://lib.biu.ac.il/sites/lib/files/shared/pby_as_research_infrastructure.pdf"
       note = "Real Hebrew document: RTL" }
)

# Resolve pdf.js corpus filenames to blob SHAs, but only if we actually need any.
$needCorpus = $fixtures | Where-Object {
    -not $_.src.StartsWith("https://") -and -not (Test-Path (Join-Path $dest $_.name))
}
$shas = @{}
if ($needCorpus) {
    Write-Host "Resolving pdf.js corpus index..." -ForegroundColor Cyan
    try {
        $listing = Invoke-RestMethod -Headers $ua -TimeoutSec 60 -ErrorAction Stop `
            -Uri "https://api.github.com/repos/mozilla/pdf.js/contents/test/pdfs"
        foreach ($e in $listing) { $shas[$e.name] = $e.sha }
        Write-Host "  indexed $($shas.Count) entries" -ForegroundColor DarkGray
    }
    catch {
        Write-Host "  index FAILED: $($_.Exception.Message)" -ForegroundColor Red
    }
}

function Get-File {
    param($Uri, $OutFile, $Headers)
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing `
                -TimeoutSec 120 -Headers $Headers -ErrorAction Stop
            return $null
        }
        catch {
            $err = $_.Exception.Message
            if (Test-Path $OutFile) { Remove-Item $OutFile -Force }
            if ($attempt -lt 3) { Start-Sleep -Seconds (4 * $attempt) } else { return $err }
        }
    }
}

$ok = 0; $fail = 0

foreach ($f in $fixtures) {
    $out = Join-Path $dest $f.name

    if (Test-Path $out) {
        Write-Host ("SKIP  {0,-26} (already present)" -f $f.name) -ForegroundColor DarkGray
        $ok++
        continue
    }

    if ($f.src.StartsWith("https://")) {
        $err = Get-File -Uri $f.src -OutFile $out -Headers $ua
    }
    elseif ($shas.ContainsKey($f.src)) {
        # Git blobs API returns raw bytes with this Accept header, and is not rate-limited
        # the way raw.githubusercontent.com is.
        $h = $ua.Clone()
        $h["Accept"] = "application/vnd.github.raw"
        $err = Get-File -Uri "https://api.github.com/repos/mozilla/pdf.js/git/blobs/$($shas[$f.src])" -OutFile $out -Headers $h
    }
    else {
        $err = "not found in pdf.js corpus index"
    }

    if ($err) {
        Write-Host ("FAIL  {0,-26} {1}" -f $f.name, $err) -ForegroundColor Red
        $fail++
        continue
    }

    # Verify it is actually a PDF and not an error page.
    $fs = [System.IO.File]::OpenRead($out)
    $buf = New-Object byte[] 5
    $fs.Read($buf, 0, 5) | Out-Null
    $fs.Close()

    if ([System.Text.Encoding]::ASCII.GetString($buf) -ne "%PDF-") {
        Write-Host ("FAIL  {0,-26} downloaded file is not a PDF" -f $f.name) -ForegroundColor Red
        Remove-Item $out -Force
        $fail++
        continue
    }

    $kb = [math]::Round((Get-Item $out).Length / 1KB)
    Write-Host ("OK    {0,-26} {1,7} KB   {2}" -f $f.name, $kb, $f.note) -ForegroundColor Green
    $ok++
}

Write-Host ""
Write-Host "$ok succeeded, $fail failed  ->  $((Resolve-Path $dest).Path)"
