@echo off
setlocal
node "%~dp0cli\bin.js" %*
exit /b %errorlevel%

