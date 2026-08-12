@echo off
title SubTick Emulators
cd /d c:\2SubTick\firebase
echo Starting Firebase emulators (auth, firestore, functions)...
echo Keep this window open while testing.
echo.
firebase emulators:start --only auth,firestore,functions
pause