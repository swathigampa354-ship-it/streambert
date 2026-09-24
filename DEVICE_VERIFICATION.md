# Streambert — Hardware Verification (physical Android device)

Everything below **REQUIRES PHYSICAL ANDROID DEVICE** and cannot be verified from
the development environment. Run in order; mark results.

## Setup
- [ ] APK installed from EAS (preview profile) on Android 10+ device
- [ ] VLC and/or mpv and/or MX Player installed

## 1. Boot & production shell
- [ ] App opens directly into the Streambert UI (no dev menu / no "Streambert Android" banner)
- [ ] No debug header, no VLC/MPV/Chooser/Proxy buttons row, no log panel visible
- [ ] Sidebar is on the left; no horizontal overflow; text readable

## 2. Phone mode (portrait)
- [ ] Home feed loads (TMDB key prompt on first launch → enter or skip)
- [ ] Cards grid adapts (no clipped cards); hero fills width
- [ ] Search opens, keyboard works, results tappable
- [ ] Movie/TV/Anime pages all reachable; Settings usable
- [ ] Hardware back walks back correctly; at root → app exits (no re-open loop)

## 3. TV Mode
- [ ] TV Mode button visible in sidebar (bottom section, TV icon)
- [ ] Dialog appears: "Rotate your phone horizontally for the best experience." [Continue]/[Cancel]
- [ ] Cancel → nothing changes
- [ ] Continue → **landscape enforced**, desktop-style layout renders, cards larger
- [ ] Sidebar remains accessible; every page still usable in landscape
- [ ] EXIT TV MODE → **portrait restored**, layout back to phone mode
- [ ] Reload/cold start while in TV mode → app resumes in TV mode (landscape locked)

## 4. Orientation lifecycle
- [ ] TV mode ON → home-screen (app backgrounded) → return → still landscape (lock re-asserted)
- [ ] TV mode ON → play in VLC → return → still landscape
- [ ] TV mode OFF (portrait) → background → return → still portrait
- [ ] After TV-mode exit + process death: fresh launch boots portrait-normal

## 5. Stream resolution + external player (core milestone)
- [ ] movie → source picker → videasy → `native capture:` appears in logcat + external player launches
- [ ] HLS stream plays; seeking works (Range through proxy)
- [ ] Repeat for: VLC / mpv / MX Player; chooser fallback works
- [ ] No players installed → message "No compatible external player installed" (no crash)
- [ ] Cookie-header provider plays through proxy (headers present in logcat)

## 6. Subtitles
- [ ] Subtitle downloads land in `/storage/emulated/0/Download/StreambertSubs/`
- [ ] Player (VLC/MX) picks up the subtitle track via extras

## 7. Gamepad (Bluetooth controller / Android TV remote)
- [ ] `Controller connected` toast when pad pairs
- [ ] D-pad moves focus ring across cards (`.gamepad-focused` visible)
- [ ] A = open card, B = back/close modal, Start = search
- [ ] Focus also works in TV-mode landscape

## 8. Offline / error handling
- [ ] Airplane mode → banners/errors, no white screen, no crash
- [ ] Provider down (choose vidking.net) → clean error, not a silent spinner

## 9. Storage & permissions
- [ ] No legacy-external-storage permission prompt on Android 13+
- [ ] App-data persists across force-stop/reboot (watchlist, history, settings)

Command for logs during tests:
```
adb logcat | grep -iE "streambert|streambertproxy|externalplayer|expo"
```
