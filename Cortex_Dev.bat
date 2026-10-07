@echo off
chcp 65001 >nul
title Cortex Core - Dev Launcher
color 0A
cls

echo.
echo  +===================================================+
echo  ^|        CORTEX CORE  --  Dev Launcher             ^|
echo  ^|      Foundation + Motherboard Explorer            ^|
echo  +===================================================+
echo.
echo  Choose an option:
echo.
echo  [1]  Web Dev Server    ^(pnpm dev^)          -- Browser on :5173
echo  [2]  Desktop Dev       ^(pnpm desktop:dev^)  -- Tauri window
echo  [3]  Build Web         ^(pnpm build^)
echo  [4]  Build Desktop Pkg ^(pnpm desktop:package^)
echo  [5]  Run All Tests     ^(typecheck + lint + test^)
echo  [6]  E2E Tests         ^(Playwright^)
echo  [7]  Preview Built Web ^(pnpm preview^)  -- Browser on :4173
echo  [8]  Format Code       ^(prettier^)
echo  [0]  Exit
echo.
echo  ---------------------------------------------------
set /p CHOICE=" Enter choice [0-8]: "
echo.

cd /d "%~dp0"

if "%CHOICE%"=="1" goto WEB_DEV
if "%CHOICE%"=="2" goto DESKTOP_DEV
if "%CHOICE%"=="3" goto BUILD_WEB
if "%CHOICE%"=="4" goto BUILD_DESKTOP
if "%CHOICE%"=="5" goto RUN_TESTS
if "%CHOICE%"=="6" goto E2E_TESTS
if "%CHOICE%"=="7" goto PREVIEW
if "%CHOICE%"=="8" goto FORMAT
if "%CHOICE%"=="0" goto END

echo  [!] Invalid choice.
timeout /t 2 >nul
goto :eof

:WEB_DEV
echo  ^> Starting Web Dev Server ... http://127.0.0.1:5173
echo  ^> Press Ctrl+C to stop
echo.
call pnpm dev
goto DONE

:DESKTOP_DEV
echo  ^> Launching Tauri Desktop ^(dev mode^)
echo  ^> First run compiles Rust -- may take a few minutes
echo.
call pnpm desktop:dev
goto DONE

:BUILD_WEB
echo  ^> Building Web ^(Vite production bundle^)...
echo.
call pnpm build
goto DONE

:BUILD_DESKTOP
echo  ^> Building + Packaging Desktop -- output: release/
echo.
call pnpm desktop:package
goto DONE

:RUN_TESTS
echo  ^> typecheck + lint + vitest + build check
echo.
call pnpm check
goto DONE

:E2E_TESTS
echo  ^> Playwright E2E tests
echo  ^> Tip: run once -- pnpm exec playwright install
echo.
call pnpm test:e2e
goto DONE

:PREVIEW
echo  ^> Previewing production build ... http://127.0.0.1:4173
echo.
call pnpm preview
goto DONE

:FORMAT
echo  ^> Prettier formatting...
echo.
call pnpm format
goto DONE

:DONE
echo.
echo  ---------------------------------------------------
echo  Done. Press any key to close...
pause >nul
goto :eof

:END
echo  Bye!
exit /b 0