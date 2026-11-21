# Interior renderer (level-render)

Builds the room from `src/scenes/Hangar.js` (WALLS and STATIONS) in 3D and renders it
with the same camera as the game into image layers `assets/level/*.png` + `level.json` and `pack.json`.
Each station is a separate layer (long ones are sliced into half-tile strips) so the characters
go behind objects correctly. Overlaps between stations themselves are baked into the images.

## When to run
After any change to the map: WALLS, STATIONS, heights, camera (CAMERA_TILT, CAMERA_DIST).
Station appearance is defined in `level.html` → the `looks` object (the station's `look` field).

## How to run
```
cd tools/level-render
npm i three@0.170.0 playwright
npx playwright install chromium
node render_level.js ../../src/scenes/Hangar.js ../../assets/level
```
Astronaut models for the suit-locker capsules are in `models/`.
Image scale is set by the `LEVEL_SCALE` environment variable (default 2).
If the `assets/level` folder is missing, the game draws the map with simple boxes.

## Ship and landing scene (stages 2 and 3)
Same script, with the mode as the third argument:
```
node render_level.js ../../src/scenes/Hangar.js ../../assets/ship ship        # round ship (SHIP_STATIONS, SHIP)
node render_level.js ../../src/scenes/Hangar.js ../../assets/surface surface  # lander + surface (SURF_STATIONS, LANDER, SURF_ROCKS)
```
Ring stations are placed by angle and distance from the center (`at: [angle°, radius]`) and size (`size`).
New ship station models are in `level.html` (navconsole, powerpanel, engine, datastorage, antenna,
jettison, waterrecycler, airsystem, suitrack); the ring wall, porthole, airlock, ground and rocks are in `buildRingStage`.
