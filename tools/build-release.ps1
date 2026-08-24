[CmdletBinding()]
param(
    [string] $OutputDirectory = ".release"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$resolvedOutputDirectory = if (
    [System.IO.Path]::IsPathRooted($OutputDirectory)
) {
    $OutputDirectory
}
else {
    Join-Path $projectRoot $OutputDirectory
}

$module = Get-Content -Raw -LiteralPath (
    Join-Path $projectRoot "module.json"
) | ConvertFrom-Json
$package = Get-Content -Raw -LiteralPath (
    Join-Path $projectRoot "package.json"
) | ConvertFrom-Json

if ($module.version -ne $package.version) {
    throw "module.json and package.json versions do not match."
}

$expectedTag = "v$($module.version)"
$expectedDownload =
    "https://github.com/kaindanin/compendium-curator/releases/download/$expectedTag/compendium-curator.zip"

if ($module.download -ne $expectedDownload) {
    throw "module.json download URL does not match $expectedTag."
}

$releaseEntries = @(
    "lang",
    "scripts",
    "styles",
    "templates",
    "module.json",
    "README.md",
    "README.es.md",
    "CHANGELOG.md",
    "LICENSE"
)

foreach ($entry in $releaseEntries) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $entry))) {
        throw "Missing release entry: $entry"
    }
}

New-Item -ItemType Directory -Force -Path $resolvedOutputDirectory |
    Out-Null

$archivePath = Join-Path $resolvedOutputDirectory "compendium-curator.zip"
$checksumPath = "$archivePath.sha256"

Remove-Item -LiteralPath $archivePath, $checksumPath -Force -ErrorAction SilentlyContinue

Push-Location $projectRoot

try {
    Compress-Archive -Path $releaseEntries -DestinationPath $archivePath -CompressionLevel Optimal
}
finally {
    Pop-Location
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)

try {
    $archiveEntries = @(
        $archive.Entries |
            ForEach-Object {
                $_.FullName.Replace([char] 92, [char] 47)
            }
    )

    foreach ($requiredFile in @(
        "module.json",
        "scripts/main.js",
        "styles/compendium-curator.css",
        "templates/table-manager.hbs"
    )) {
        if ($requiredFile -notin $archiveEntries) {
            throw "Release archive is missing $requiredFile."
        }
    }

    $forbiddenRoots = @(
        ".git/",
        ".github/",
        "node_modules/",
        "tests/",
        "tools/"
    )

    foreach ($entry in $archiveEntries) {
        if (
            $forbiddenRoots.Where({
                $entry.StartsWith(
                    $_,
                    [System.StringComparison]::OrdinalIgnoreCase
                )
            }).Count -gt 0 -or
            $entry -in @("package.json", "package-lock.json")
        ) {
            throw "Forbidden release entry: $entry"
        }
    }
}
finally {
    $archive.Dispose()
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()

Set-Content -LiteralPath $checksumPath -Value "$hash  compendium-curator.zip" -Encoding utf8NoBOM

Write-Output "Built Compendium Curator $($module.version)"
Write-Output "Archive: $archivePath"
Write-Output "SHA256: $hash"
