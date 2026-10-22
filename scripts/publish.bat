@echo off
rem Publishes the current folder to GitHub as a new version of Maestrale.
rem Usage: double-click, or "scripts\publish.bat 0.4.3"
cd /d "%~dp0.."
set VER=%1
if "%VER%"=="" set VER=0.4.3
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

rem Anything edited on github.com itself comes down first, or the push is
rem rejected for being behind.
echo Picking up what is already on GitHub...
git pull --ff-only origin main || goto :pullerr

git add -A || goto :err
git commit -F scripts\release-notes.txt || echo (nothing new to commit)
git tag -f -a v%VER% -m "Maestrale %VER%" || goto :err
git push -u origin HEAD || goto :pusherr
git push origin v%VER% --force || goto :err
echo.
echo Done: v%VER% is on GitHub - https://github.com/vento17/Maestrale
echo The exe and the dmgs are built by Actions and land in Releases in about
echo fifteen minutes: https://github.com/vento17/Maestrale/actions
pause
exit /b 0

:pullerr
echo.
echo Could not pull. If it complains about local changes to a file that also
echo changed on GitHub, tell Claude which file it named.
pause
exit /b 1

:pusherr
echo.
echo The push did not go through. Copy the text above to Claude.
pause
exit /b 1

:err
echo.
echo Something went wrong - nothing more was sent. Copy the text above to Claude.
pause
exit /b 1
