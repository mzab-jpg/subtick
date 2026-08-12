@echo off
title SubTick Matrix Server
cd /d c:\2SubTick\scripts
echo Starting Matrix server at http://localhost:3000 ...
echo Keep this window open while testing.
echo.
npx serve -p 3000
pause