# Рендер интерьера (level-render)

Строит комнату из `src/scenes/Hangar.js` (WALLS и STATIONS) в 3D и рендерит её
под ту же камеру, что и игра, в слои-картинки `assets/level/*.png` + `level.json` и `pack.json`.
Каждая станция — отдельный слой (длинные — ломтиками по полклетки), чтобы герои
правильно заходили за предметы. Перекрытия между самими станциями «запечены» в картинки.

## Когда запускать
После любых изменений карты: WALLS, STATIONS, высот, камеры (CAMERA_TILT, CAMERA_DIST).
Внешний вид станций задаётся в `level.html` → объект `looks` (поле `look` у станции).

## Как запустить
```
cd tools/level-render
npm i three@0.170.0 playwright
npx playwright install chromium
node render_level.js ../../src/scenes/Hangar.js ../../assets/level
```
Модели астронавтов для капсул шкафа скафандров лежат в `models/`.
Масштаб картинок — переменная окружения `LEVEL_SCALE` (по умолчанию 2).
Если папки `assets/level` нет, игра рисует карту простыми коробками.

## Корабль и посадочная сцена (этапы 2 и 3)
Тот же скрипт, третьим аргументом — режим:
```
node render_level.js ../../src/scenes/Hangar.js ../../assets/ship ship        # круглый корабль (SHIP_STATIONS, SHIP)
node render_level.js ../../src/scenes/Hangar.js ../../assets/surface surface  # лендер + поверхность (SURF_STATIONS, LANDER, SURF_ROCKS)
```
Станции на кольце задаются углом и расстоянием от центра (`at: [угол°, радиус]`) и размером (`size`).
Новые модели станций корабля — в `level.html` (navconsole, powerpanel, engine, datastorage, antenna,
jettison, waterrecycler, airsystem, suitrack); стена-кольцо, иллюминатор, шлюз, грунт и камни — `buildRingStage`.
