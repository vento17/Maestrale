@echo off
rem Doppio click: prova la ricezione Art-Net (LiveForge deve essere CHIUSO, MadMapper acceso).
cd /d "%~dp0.."
echo Ascolto Art-Net per 15 secondi...
node scripts\artnet-probe.cjs > artnet-probe.txt 2>&1
type artnet-probe.txt
echo.
echo Risultato salvato in artnet-probe.txt nella cartella LiveForge.
pause
