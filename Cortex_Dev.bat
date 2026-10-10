@echo off
title Cortex Core - Desktop Dev
color 0A
cls

echo.
echo  +===================================================+
echo  ^|        CORTEX CORE  --  Desktop Dev               ^|
echo  ^|          Tauri (Rust + Vite) Dev Mode             ^|
echo  +===================================================+
echo.
echo  ^> Launching Tauri Desktop (dev mode)...
echo  ^> Press Ctrl+C to stop
echo.

cd /d "%~dp0"
call pnpm desktop:dev

echo.
echo  ---------------------------------------------------
echo  Done. Press any key to close...
pause >nul
