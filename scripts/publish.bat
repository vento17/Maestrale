@echo off
rem Publishes the current folder to GitHub as a new version of Maestrale.
rem Usage: double-click, or "scripts\publish.bat 0.4.0"
rem
rem FIRST TIME ONLY: make the empty repository on GitHub, or this stops at the
rem push and tells you so. Open https://github.com/new , name it exactly
rem   Maestrale
rem leave "Add a README" and the other tick boxes OFF, and press Create.
cd /d "%~dp0.."
set VER=%1
if "%VER%"=="" set VER=0.4.0
set REPO=https://github.com/vento17/Maestrale.git
echo === Maestrale %VER% ===

rem Point at the Maestrale repository; the old LiveForge one is kept as
rem "liveforge" so nothing is lost.
for /f "delims=" %%u in ('git remote get-url origin 2^>nul') do set CURRENT=%%u
if "%CURRENT%"=="" (
  git remote add origin %REPO% || goto :err
) else if /i not "%CURRENT%"=="%REPO%" (
  echo Switching from %CURRENT% to %REPO%
  git remote rename origin liveforge 2>nul
  git remote remove origin 2>nul
  git remote add origin %REPO% || goto :err
)

git add -A || goto :err
git commit -F scripts\release-notes.txt || echo (nothing new to commit)
git tag -a v%VER% -m "Maestrale %VER%" || goto :err
git push -u origin HEAD || goto :pusherr
git push origin v%VER% || goto :err
echo.
echo Done: v%VER% is on GitHub - https://github.com/vento17/Maestrale
echo The exe and the dmg are built by Actions and land in Releases.
pause
exit /b 0

:pusherr
echo.
echo The push did not go through. Nine times out of ten the repository is not
echo there yet: open https://github.com/new , call it Maestrale, create it
echo empty, then run this file again.
pause
exit /b 1

:err
echo.
echo Something went wrong - nothing more was sent. Copy the text above to Claude.
pause
exit /b 1
