@echo off
rem Publishes the current folder to GitHub as a new version.
rem Usage: double-click, or "scripts\publish.bat 0.3.0"
cd /d "%~dp0.."
set VER=%1
if "%VER%"=="" set VER=0.3.0
echo === LiveForge %VER% ===
git add -A || goto :err
git commit -F scripts\release-notes.txt || echo (nothing new to commit)
git tag -a v%VER% -m "LiveForge %VER%" || goto :err
git push || goto :err
git push origin v%VER% || goto :err
echo.
echo Done: v%VER% is on GitHub.
pause
exit /b 0
:err
echo.
echo Something went wrong - nothing more was sent. Copy the text above to Claude.
pause
exit /b 1
