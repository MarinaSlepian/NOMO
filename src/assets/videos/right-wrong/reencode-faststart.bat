@echo off
setlocal enabledelayedexpansion

:: Set source and output folders
set "SOURCE_DIR=D:\Path\To\Your\Videos"
set "OUTPUT_DIR=%SOURCE_DIR%\converted"

:: Create output directory if it doesn't exist
if not exist "%OUTPUT_DIR%" (
    mkdir "%OUTPUT_DIR%"
)

echo Re-encoding MP4 files with faststart...

for /R "%SOURCE_DIR%" %%F in (*.mp4) do (
    set "INPUT=%%F"
    
    :: Preserve subfolder structure
    set "REL_PATH=%%~dpF"
    set "REL_PATH=!REL_PATH:%SOURCE_DIR%=!"
    set "REL_PATH=!REL_PATH:~0,-1!"  :: remove trailing backslash
    set "DEST_FOLDER=%OUTPUT_DIR%!REL_PATH!"

    if not exist "!DEST_FOLDER!" (
        mkdir "!DEST_FOLDER!"
    )

    echo Processing: %%~nxF
    ffmpeg -i "%%F" -c copy -movflags +faststart "!DEST_FOLDER!\%%~nxF"
)

echo All videos processed.
pause
