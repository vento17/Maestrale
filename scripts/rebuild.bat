@echo off
rem Makes GitHub build the exe and the dmgs again and publish the Release,
rem without changing a line of code.
rem Usage: double-click, or "scripts\rebuild.bat 0.4.0"
cd /d "%~dp0.."
set VER=%1
if "%VER%"=="" set VER=0.4.0
echo === Maestrale %VER%: build again on GitHub ===

rem Anything edited on github.com itself (the web editor) comes down first,
rem or the build would run with an older workflow file.
echo Picking up what is on GitHub...
git pull --ff-only || goto :pullerr

rem Actions builds the files AS THEY WERE AT THE TAG, so the tag is moved onto
rem the commit you are on now. Without this, a tag left behind on an old commit
rem quietly rebuilds the old code.
git tag -f -a v%VER% -m "Maestrale %VER%" || goto :err

echo Removing the old tag from GitHub...
git push origin :refs/tags/v%VER%
echo Sending it again...
git push origin v%VER% --force || goto :err
echo.
echo Done. The build starts in a few seconds:
echo   https://github.com/vento17/Maestrale/actions
echo When it finishes, the exe and the dmgs are in Releases, under v%VER%.
echo.
echo NOTE: the Release notes are rewritten by the build, so anything typed into
echo them by hand on the website is replaced.
pause
exit /b 0

:pullerr
echo.
echo Could not pull. If it says you have local changes, commit them first with
echo   scripts\publish.bat
echo or copy them somewhere safe, then run this again.
pause
exit /b 1

:err
echo.
echo Something went wrong - copy the text above to Claude.
pause
exit /b 1
