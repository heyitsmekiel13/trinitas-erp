@echo off
REM Trinitas ERP - build the Hostinger upload package. Double-click this file.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-for-hosting.ps1"
