# Stop only Side Note dev processes. Does NOT kill other apps by port.
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$projectPattern = [regex]::Escape($projectRoot)

Write-Host "Stopping Side Note processes under: $projectRoot"

Get-Process -Name "side-note" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "  stop side-note.exe pid=$($_.Id)"
    Stop-Process -Id $_.Id -Force
}

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match $projectPattern } |
    ForEach-Object {
        Write-Host "  stop node.exe pid=$($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

Write-Host "Done."
