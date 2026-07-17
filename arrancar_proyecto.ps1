# 1. Abre el editor de código JCode / VS Code en la carpeta actual
Write-Host "Abriendo el editor de código..." -ForegroundColor Cyan
jcode .

# 2. Si existe la nota de recordatorio, la muestra en pantalla
if (Test-Path "TODO_RETOMAR.txt") {
    Write-Host "`n=========================================" -ForegroundColor Yellow
    Write-Host "RECORDATORIO DE LA ÚLTIMA SESIÓN:" -ForegroundColor Yellow
    Get-Content "TODO_RETOMAR.txt" -Raw
    Write-Host "=========================================`n" -ForegroundColor Yellow
}

# 3. Borra el archivo de texto temporal si no lo habías borrado ya
if (Test-Path "bgout.txt") {
    Write-Host "Limpiando archivo temporal pesado (bgout.txt)..." -ForegroundColor Maroon
    Remove-Item "bgout.txt" -Force
}

# 4. Te deja la consola lista en la ruta para que lances el comando que necesites
Write-Host "Entorno listo. Puedes iniciar Firebase o el entorno de desarrollo." -ForegroundColor Green