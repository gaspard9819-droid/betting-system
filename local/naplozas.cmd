@echo off
REM A napi naplozas inditoja a Windows Feladatutemezonek.
REM
REM MIERT KELL NAPONTA: a 96 oras ablakba folyamatosan lepnek be uj meccsek,
REM es egy kihagyott nap meccsei VEGLEGESEN kimaradnak a kalibraciobol. A
REM minta fordulonkent ~520 piaccal no (merve 2026-09-19), tehat minden
REM kihagyott fordulo hetekkel tolja el az elso hasznalhato eredmenyt.
REM
REM A node teljes eleresi uttal hivodik: a Feladatutemezo kornyezete nem
REM feltetlenul ugyanazt a PATH-t latja, mint egy interaktiv shell. Ha a node
REM koltozik, EZT a sort kell javitani.
REM
REM A kimenet a naplozas.log-ba megy (a .gitignore *.log mintaja kizarja).
REM Hiba eseten ott latszik, nem tunik el.

REM UTF-8 kodlap: a node ekezetes kimenetet ir, es enelkul a log
REM olvashatatlan mojibake lesz. A log az EGYETLEN hely, ahol egy utemezett
REM futas hibaja latszik - ott nem mindegy.
chcp 65001 >nul

cd /d "%~dp0.."

echo.>> "%~dp0naplozas.log"
echo ==== %DATE% %TIME% ====>> "%~dp0naplozas.log"

"C:\Program Files\nodejs\node.exe" local\log.js >> "%~dp0naplozas.log" 2>&1

if errorlevel 1 (
  echo HIBA: a naplozas nem futott le, reszletek a naplozas.log-ban.
  exit /b 1
)
exit /b 0
