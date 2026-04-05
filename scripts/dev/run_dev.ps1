# run_dev.ps1
# Starts the Flask backend and the frontend dev server (Windows PowerShell helper).

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host "Starting Flask backend (app.py) in a new PowerShell window..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectRoot'; python app.py"

# Check for npm
$npm = Get-Command npm -ErrorAction SilentlyContinue
if ($npm) {
    Write-Host "npm detected — starting frontend dev server in a new PowerShell window..."
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectRoot\frontend'; npm install; npm run dev"
} else {
    Write-Host "npm not found. To run the frontend, install Node.js then run these commands in a separate terminal:"
    Write-Host "  cd frontend"
    Write-Host "  npm install"
    Write-Host "  npm run dev"
}

Write-Host "Done. Backend should be starting; check the new terminal windows for logs."
