@echo off
setlocal
echo =======================================================
echo  Presenter OBS Plugin - Windows Installer
echo =======================================================
set "SCRIPT_DIR=%~dp0"
set "OBS_SCRIPTS_DIR=%APPDATA%\obs-studio\basic\scripts"

if not exist "%OBS_SCRIPTS_DIR%" (
    echo Creating OBS scripts folder: "%OBS_SCRIPTS_DIR%"
    mkdir "%OBS_SCRIPTS_DIR%" 2>nul
)

echo Copying presenter_obs.py to OBS scripts directory...
copy /Y "%SCRIPT_DIR%presenter_obs.py" "%OBS_SCRIPTS_DIR%\presenter_obs.py"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [SUCCESS] presenter_obs.py copied to:
    echo   "%OBS_SCRIPTS_DIR%\presenter_obs.py"
    echo.
    echo Next Steps in OBS Studio:
    echo   1. Open OBS Studio
    echo   2. Go to: Tools -^> Scripts
    echo   3. On the Scripts tab, click [+]
    echo   4. Select presenter_obs.py from:
    echo      %OBS_SCRIPTS_DIR%
    echo   5. Click 'Create / Update Presenter Scenes'
) else (
    echo [ERROR] Failed to copy plugin. You can load presenter_obs.py manually in OBS: Tools -^> Scripts -^> [+]
)
echo =======================================================
pause
