@echo off
setlocal
set "RALPHY_INVOCATION=%~f0 %*"
node "%~dp0cli\bin.js" %*
exit /b %errorlevel%
