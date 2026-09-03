@echo off
title SubTick Curve Playground
cd /d c:\2SubTick\scripts
echo Starting Curve Playground server at http://localhost:3000/curve_playground.html ...
echo Keep this window open while testing.
echo.
npx serve -p 3000
pause
