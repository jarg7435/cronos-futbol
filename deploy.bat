@echo off
REM deploy.bat - Sincroniza GitHub y despliega en Firebase Hosting en un solo paso.
REM Uso: haz doble clic o ejecuta desde CMD en la carpeta del proyecto.

git push origin main && firebase deploy --only hosting
