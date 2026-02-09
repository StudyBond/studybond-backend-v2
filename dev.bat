@echo off
REM Quick start script for Windows
REM This bypasses PowerShell execution policy issues

echo.
echo ========================================
echo   StudyBond Backend - Dev Server
echo ========================================
echo.

REM Check if node_modules exists
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
    echo.
)

echo Starting development server...
echo.

call npx ts-node-dev --respawn --transpile-only src/server.ts
