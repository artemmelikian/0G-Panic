const VIEW_ANGLE = Phaser.Math.DegToRad(90); // ширина конуса обзора
const VIEW_RANGE = 90;                        // дальность взаимодействия, px

const MAX_SPEED = 280;   // максимальная скорость, px/с
const ACCEL     = 1100;  // разгон и «сцепление» при смене направления, px/с²
const FRICTION  = 700;   // торможение без ввода (моментум), px/с²
const TURN_SPEED = Phaser.Math.DegToRad(540); // скорость поворота, рад/с

const PLAYER_RADIUS = 20; // радиус героя, px
const HOLD_DIST = PLAYER_RADIUS + 12; // как далеко перед лицом герой держит предмет, px
const ITEM_RADIUS = 17; // радиус столкновения предмета в руках, px
const ITEM_MASS = 0.25;       // масса лежащего предмета относительно героя (меньше — легче толкать)
const ITEM_FRICTION = 900;    // как быстро толкнутый предмет останавливается, px/с²
const IDLE_MASS = 1.5;     // насколько стоящий герой «тяжелее» идущего (больше — труднее сдвинуть)

const KC =Phaser.Input.Keyboard.KeyCodes;

// ── Модели героев ───────────────────────────────────────────────────────
// Спрайт-листы отрендерены из assets/crew/*.glb (Astronaut Crew) под нашу камеру:
// 32 строки — направления (0 = вправо, по часовой).
// 34 колонки: 16 кадров Walk + 1 кадр покоя, затем то же самое «с предметом в руках»
// (руки вытянуты вперёд). В кадрах с предметом на месте куба «вырез»: сам куб рисует игра
// позади спрайта, поэтому руки перед кубом лежат поверх него, а тело за кубом скрыто.
// Покой «дышит» программно (лёгкое покачивание), чтобы не было рваной покадровой анимации.
const SPRITE = {
  frame: 96,                 // ширина кадра, px
  frameH: 112,               // высота кадра, px
  dirs: 32, walk: 16, idle: 1,
  footX: 48, footY: 82,      // где в кадре точка между ступнями
  pxPerUnit: 24,             // пикселей кадра на единицу модели
  walkTime: 0.6,             // длина цикла Walk, с
};
const MODEL_UNIT = 25;       // мировых px на единицу модели (модель ≈ 2.6 ед. ростом)

// ── Уровень ─────────────────────────────────────────────────────────────
// Всё задаётся в клетках сетки 30×15 (клетка TILE px), можно с шагом 0.5.
const TILE = 40;
const GRID_W = 30, GRID_H = 15;
const OX = 40, OY = 80;      // где на экране начинается сетка
const WALL = 14;             // толщина стены, px
const tx = (t) => OX + t * TILE;
const ty = (t) => OY + t * TILE;

// ── Камера ──────────────────────────────────────────────────────────────
// Логика и физика работают на плоском виде сверху (мировые координаты x, y; z — высота).
// На экран всё проецируется настоящей перспективой: камера стоит «к югу» от комнаты,
// наклонена на CAMERA_TILT от вертикали и находится на расстоянии CAMERA_DIST от центра карты.
// Дальняя (верхняя) часть комнаты получается уже ближней — форма /‾\.
const CAMERA_TILT = Phaser.Math.DegToRad(30); // 0 — строго сверху, 15–30 — «условный объём»
const CAMERA_DIST = 1500;    // меньше — сильнее перспектива, больше — почти без неё
const SCREEN_BOX = { l: 20, t: 50, r: 1260, b: 712 }; // куда вписать карту на экране

// Высоты, px
const WALL_H = 60;           // стены
const FRONT_WALL_H = 14;     // нижняя (ближняя к камере) стена — низкая, чтобы не закрывать героев
const LOW_H = 36;            // низкие препятствия (столы/станции)
const HIGH_H = 70;           // высокие препятствия
const PLAYER_H = 40;         // рост героя
const ITEM_SIZE = 28;        // ребро куба-предмета
const HOLD_Z = 12;           // на какой высоте герой держит предмет

// Камера в мировых координатах
const PITCH = Math.PI / 2 - CAMERA_TILT;     // наклон взгляда от горизонта
const CAM_TX = OX + (GRID_W * TILE) / 2, CAM_TY = OY + (GRID_H * TILE) / 2; // куда смотрит
const CAM_Y = CAM_TY + Math.cos(PITCH) * CAMERA_DIST;
const CAM_Z = Math.sin(PITCH) * CAMERA_DIST;

// Сырая перспективная проекция (без масштаба экрана)
const rawProj = (x, y, z) => {
  const ry = y - CAM_Y, rz = z - CAM_Z;
  const depth = -ry * Math.cos(PITCH) - rz * Math.sin(PITCH);
  const up = -ry * Math.sin(PITCH) + rz * Math.cos(PITCH);
  return { u: (x - CAM_TX) / depth, v: -up / depth };
};

// Подгоняем масштаб так, чтобы вся комната со стенами влезла в SCREEN_BOX
const FIT = (() => {
  const pts = [];
  for (const [gx, gy] of [[0, 0], [GRID_W, 0], [0, GRID_H], [GRID_W, GRID_H]])
    for (const z of [0, WALL_H]) pts.push(rawProj(OX + gx * TILE, OY + gy * TILE, z));
  const us = pts.map((p) => p.u), vs = pts.map((p) => p.v);
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  const k = Math.min((SCREEN_BOX.r - SCREEN_BOX.l) / (u1 - u0), (SCREEN_BOX.b - SCREEN_BOX.t) / (v1 - v0));
  return {
    k,
    ox: (SCREEN_BOX.l + SCREEN_BOX.r) / 2 - k * (u0 + u1) / 2,
    oy: (SCREEN_BOX.t + SCREEN_BOX.b) / 2 - k * (v0 + v1) / 2,
  };
})();

// Мировая точка (x, y) на высоте z → экран
const proj = (x, y, z = 0) => {
  const r = rawProj(x, y, z);
  return { x: FIT.ox + r.u * FIT.k, y: FIT.oy + r.v * FIT.k };
};
window.__proj = proj; // для отладочных скриптов

// Площадь многоугольника на экране: > 0 — грань смотрит на камеру
const screenArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a;
};

// Окружность на полу (по часовой стрелке в мировых координатах)
const circlePts = (cx, cy, r, n = 20) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });

const shadeColor = (color, k) => {
  const c = Phaser.Display.Color.IntegerToColor(color);
  return Phaser.Display.Color.GetColor(Math.min(255, c.red * k), Math.min(255, c.green * k), Math.min(255, c.blue * k));
};

// Призма: многоугольник основания (мир, по часовой) от высоты z0 до z1.
// Рисуются только грани, повёрнутые к камере, затем верх.
// skip — номера рёбер основания, грани которых не рисуем (внутренние стыки ломтиков)
const drawPrism = (g, base, z0, z1, color, topColor, edge = null, skip = null) => {
  const n = base.length;
  for (let i = 0; i < n; i++) {
    if (skip && skip.includes(i)) continue;
    const p = base[i], q = base[(i + 1) % n];
    const quad = [proj(p.x, p.y, z0), proj(q.x, q.y, z0), proj(q.x, q.y, z1), proj(p.x, p.y, z1)];
    if (screenArea(quad) <= 0) continue;
    // освещение: южные грани темнее, боковые чуть светлее
    const nx = q.y - p.y, ny = -(q.x - p.x), len = Math.hypot(nx, ny) || 1;
    const k = 0.9 + 0.12 * (nx / len) - 0.1 * (ny / len);
    g.fillStyle(shadeColor(color, k), 1).fillPoints(quad, true);
  }
  const top = base.map((p) => proj(p.x, p.y, z1));
  g.fillStyle(topColor, 1).fillPoints(top, true);
  if (edge !== null) g.lineStyle(1, edge, 0.6).strokePoints(top, true);
  return top;
};

// ── Роли ────────────────────────────────────────────────────────────────
// Станции окрашены в цвет роли: пользоваться ими может только астронавт этой роли.
// Серые (ANY) — общие. Класть предметы на любую станцию может кто угодно.
const ROLES = {
  S: { name: 'Scientist', color: 0xa25bd6 },
  E: { name: 'Engineer', color: 0xe05a5a },
  L: { name: 'Life Support', color: 0x7cc04a },
  N: { name: 'Navigator', color: 0x3fa7e0 },
  ANY: { name: 'anyone', color: 0x9aa3cf },
};
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

// ── Карта ───────────────────────────────────────────────────────────────
// Стены — отрезки по линиям сетки: [x1, y1, x2, y2, высота?]
const WALLS = [
  [0, 0, 30, 0],                  // верх
  [0, 15, 30, 15, FRONT_WALL_H],  // низ
  [0, 0, 0, 15],                  // лево
  [30, 0, 30, 15],                // право
  [10.5, 0, 10.5, 6],             // перегородка Storage | Cargo (дверь 6..10)
  [10.5, 10, 10.5, 15],
  [20, 0, 20, 6],                 // перегородка Cargo | Launch bay (дверь 6..10)
  [20, 10, 20, 15],
];

// Названия отсеков на полу (в 3D-рендере они нарисованы на полу; здесь — для запасной отрисовки)
const ROOMS = [
  { text: 'STORAGE', x: 7.2, y: 7.5 },
  { text: 'LAUNCH BAY', x: 24.5, y: 8.8 },
];

// Станции: прямоугольник в клетках [x, y, ширина, высота], роль, высокая ли, тип:
//   source — выдаёт предмет груза; order / scale / fuel / engine — окна задач;
//   decor  — просто часть интерьера (с ней нельзя взаимодействовать).
// look — какую 3D-модель рисует рендер интерьера (tools/level-render).
const STATIONS = [
  // ── Storage
  { id: 'shelf',     name: 'Instrument Shelf', rect: [0, 2.5, 3, 6],        role: 'S', high: true, look: 'shelf', kind: 'catalog' },
  { id: 'analyzer',  name: 'Analyzer',         rect: [3.6, 0, 3.2, 2.2],    role: 'S', look: 'analyzer', kind: 'calibrate' },
  { id: 'labconsole', name: 'Lab Console',     rect: [7, 0, 3.2, 1.8],      role: 'S', look: 'labconsole', kind: 'science' },
  { id: 'workbench', name: 'Workbench',        rect: [0, 11.6, 4.3, 3.4],   role: 'E', look: 'workbench', kind: 'workbench' },
  { id: 'o2',        name: 'O2 Storage',       rect: [4.5, 11.8, 2.6, 3.2], role: 'L', look: 'o2', kind: 'o2' },
  { id: 'supply',    name: 'Supply Rack',      rect: [7.3, 11.8, 2.9, 3.2], role: 'L', look: 'supply', kind: 'supply' },
  // ── Cargo
  { id: 'order',     name: 'Order Screen',     rect: [11.2, 0, 8.1, 0.8],   role: 'ANY', look: 'orderscreen', kind: 'order' },
  // Весы — не препятствие, а зона на полу: на неё кладут груз и встают сами
  { id: 'scale',     name: 'Scale',            rect: [11.5, 4.6, 7.5, 7.4], role: 'E', look: 'scale', kind: 'scale', zone: true },
  { id: 'launch',    name: 'Launch Control',   rect: [10.9, 12.6, 4.3, 2.4], role: 'N', look: 'launchcontrol', kind: 'engine' },
  { id: 'planning',  name: 'Mission Planning', rect: [15.4, 12.6, 4.4, 2.4], role: 'N', look: 'planning', kind: 'planning' },
  // ── Launch bay
  { id: 'hangar',    name: 'Hangar Door',      rect: [20.4, 0, 5.8, 1.1],   role: 'ANY', look: 'hangar', kind: 'decor' },
  { id: 'hatch',     name: 'Boarding Hatch',   rect: [26.4, 0, 1.7, 1.2],   role: 'L', look: 'hatch', kind: 'hatch' },
  { id: 'fuelport',  name: 'Fuel Port',        rect: [28.2, 0, 1.8, 1.3],   role: 'N', look: 'fuelport', kind: 'fuel' },
  { id: 'fuelcells', name: 'Fuel Cells',       rect: [24.6, 6.2, 2.3, 1.7], role: 'E', look: 'fuelcells', kind: 'power' },
  { id: 'fueltanks', name: 'Fuel Tanks',       rect: [28, 3.6, 2, 7.4], role: 'N', high: true, look: 'fueltanks', kind: 'decor' },
  { id: 'suits',     name: 'Suit Locker',      rect: [21.4, 12.3, 8.6, 2.7], role: 'L', look: 'suits', kind: 'suits' },
];

// ── Физика миссии ───────────────────────────────────────────────────────
// Формула Циолковского: сколько топлива нужно, чтобы разогнать груз массой m на Δv.
// m_т = m · (e^(Δv / vₑ) − 1). Упрощение: учитываем только массу груза.
const DELTA_V = 3.6;   // км/с — перелёт с околоземной орбиты к Марсу
const V_EXHAUST = 4.4; // км/с — скорость истечения (водород + кислород)
const FUEL_FACTOR = Math.exp(DELTA_V / V_EXHAUST) - 1;

// ── Игроки ──────────────────────────────────────────────────────────────
const PLAYERS = [
  { x: tx(23.5), y: ty(9.5), role: 'N', model: 'robotdog', label: 'WASD, E', useName: 'E',
    up: [KC.W], left: [KC.A], down: [KC.S], right: [KC.D], use: [KC.E] },
  { x: tx(6), y: ty(10), role: 'E', model: 'bunny', label: 'arrows, Enter', useName: 'Enter',
    up: [KC.UP], left: [KC.LEFT], down: [KC.DOWN], right: [KC.RIGHT], use: [KC.ENTER] },
  { x: tx(6), y: ty(4.5), role: 'S', model: 'cat', label: "P L ; ', O", useName: 'O',
    up: [KC.P], left: [KC.L], down: [KC.SEMICOLON, KC.SEMICOLON_FIREFOX], right: [KC.QUOTES], use: [KC.O] },
  { x: tx(15.2), y: ty(3.2), role: 'L', model: 'bear', label: '8 4 5 6, 7', useName: '7',
    up: [KC.NUMPAD_EIGHT, KC.EIGHT], left: [KC.NUMPAD_FOUR, KC.FOUR],
    down: [KC.NUMPAD_FIVE, KC.FIVE], right: [KC.NUMPAD_SIX, KC.SIX],
    use: [KC.NUMPAD_SEVEN, KC.SEVEN] },
];
// Все герои появляются в одном месте — у ворот ангара, «квадратом» 2×2
const SPAWN = { x: tx(23.3), y: ty(3.3) };
const SPAWN_OFFSETS = [[-26, -22], [26, -22], [-26, 24], [26, 24]];
PLAYERS.forEach((p, i) => { p.x = SPAWN.x + SPAWN_OFFSETS[i][0]; p.y = SPAWN.y + SPAWN_OFFSETS[i][1]; });
for (const p of PLAYERS) p.color = ROLES[p.role].color;

// Шаг 1 — только комната. Задачи (выдача груза, окна, миссия) уже описаны ниже,
// но выключены, пока не дойдём до них. true — включить.
const TASKS_ENABLED = true;

// ── Доска заказов (Экран заказа) ───────────────────────────────────────
// Кастомный заказ миссии: тип, цель, длительность, сложность.
// Δv — примерно, от околоземной орбиты до цели; перелёт — в одну сторону.
const MISSION_TYPES = [
  { id: 'soil',  name: 'Soil sample',  desc: 'Land, drill and return samples', cargo: ['Drill', 'Sample containers'], returnTrip: true },
  { id: 'photo', name: 'Photo survey', desc: 'Image the surface from orbit',   cargo: ['High-res camera'] },
];
const TARGETS = [
  { name: 'Moon',   dv: 4.0, travel: 3 },
  { name: 'Mars',   dv: 3.6, travel: 210 },
  { name: 'Phobos',  dv: 4.5, travel: 210 },
  { name: 'Venus', dv: 3.5, travel: 150 },
  { name: 'Ceres', dv: 6.5, travel: 600 },
];
const DURATIONS = [30, 90, 180, 365, 540, 730, 1460]; // дней
// Очки: идеальная миссия на Easy = BASE_SCORE, на сложностях выше — с множителем.
// Множители растут быстрее, чем линейно: каждый уровень убирает целый слой помощи.
const BASE_SCORE = 1000;
const DIFFICULTIES = [
  { name: 'Easy', mult: 1,
    desc: 'Hints everywhere. Formulas come with the numbers already plugged in — you just do the math. ' +
          'Warnings pop up when something is wrong.' },
  { name: 'Normal', mult: 1.5,
    desc: 'Formulas are pinned on a sticky note next to each task window — plug the numbers in yourself. ' +
          'Warnings pop up when something is wrong.' },
  { name: 'Hard', mult: 2.5,
    desc: 'No warnings. The formulas you may need are shown only once, before the mission starts. ' +
          'Entering numbers and picking items is all on you.' },
  { name: 'Extreme', mult: 4,
    desc: '💀💀💀 Nothing is shown. No formulas, no hints, no warnings. One mistake and the mission is over.' },
];
const BOARD_W = 430;

// ── Вес героев ──────────────────────────────────────────────────────────
// Каждый от 55 до 80 кг, а средний по экипажу — в пределах 65–70 кг.
const HERO_MASS_MIN = 55, HERO_MASS_MAX = 80;
const HERO_MEAN_MIN = 65, HERO_MEAN_MAX = 70;
const rollCrewMasses = (n) => {
  for (;;) {
    const m = Array.from({ length: n }, () =>
      Math.round((HERO_MASS_MIN + Math.random() * (HERO_MASS_MAX - HERO_MASS_MIN)) * 10) / 10);
    const mean = m.reduce((a, b) => a + b, 0) / n;
    if (mean >= HERO_MEAN_MIN && mean <= HERO_MEAN_MAX) return m;
  }
};

// ── Каталог Instrument Shelf (Launch_Rush_Instrument_Shelf_Catalog.pdf) ──
// [id, название, категория, масса (ед.), мощность (ед.), роли, назначение]
// Масса — реальная, кг: по настоящему прибору-аналогу (последнее поле; «est.» — оценка по классу приборов).
// Мощность — игровые единицы каталога.
const INSTRUMENTS = [
  ['S01', 'Stereo panorama camera', 'CORE', 4.0, 1, 'Scientist', 'Stereo photos of rocks and landscape for terrain context and site selection.', 'Mastcam-Z (Perseverance)'],
  ['S02', 'Visible/near-IR spectrometer', 'CORE', 8.3, 2, 'Scientist', 'Reflected light by wavelength → surface/atmosphere composition during a flyby.', 'Moon Mineralogy Mapper (Chandrayaan-1)'],
  ['S03', 'Crew radiation dosimeter', 'CORE', 1.6, 1, 'Scientist / Life Support', 'Tracks radiation dose and particle events; space-weather science packet.', 'RAD (Curiosity)'],
  ['S04', 'Coring drill + sealed sample kit', 'CORE', 25.0, 2, 'Scientist', 'Extracts rock cores and seals them for laboratory analysis.', 'Perseverance coring drill + bits + tubes (est.)'],
  ['S05', 'X-ray fluorescence analyzer (XRF)', 'CORE', 4.3, 3, 'Scientist', 'Detects elements in rock or soil samples.', 'PIXL (Perseverance)'],
  ['S06', 'Mars weather sensor suite', 'CORE', 5.5, 1, 'Scientist / Life Support', 'Air temperature, pressure, wind and dust for weather science and EVA planning.', 'MEDA (Perseverance)'],
  ['S07', 'Raman / fluorescence spectrometer', 'CONDITIONAL', 4.7, 3, 'Scientist', 'Laser-induced spectra of minerals and possible organic compounds.', 'SHERLOC (Perseverance)'],
  ['S08', 'Ground-penetrating radar', 'CONDITIONAL', 3.3, 3, 'Scientist / Navigator', 'Maps layering and structures under the soil.', 'RIMFAX (Perseverance)'],
  ['S09', 'Thermal infrared radiometer', 'CONDITIONAL', 2.4, 2, 'Scientist', 'Emitted IR → surface temperatures and thermal properties.', 'Mini-TES (Spirit/Opportunity)'],
  ['S10', 'Magnetometer boom', 'CONDITIONAL', 2.5, 1, 'Scientist / Engineer', 'Magnetic-field strength and direction during cruise or at the surface.', 'MAVEN MAG + boom (est.)'],
  ['S11', 'Energetic particle detector', 'CONDITIONAL', 1.8, 2, 'Scientist / Life Support', 'Counts high-energy charged particles.', 'MAVEN SEP-class detector (est.)'],
  ['S12', 'Atmospheric mass spectrometer', 'CONDITIONAL', 12.0, 4, 'Scientist', 'Identifies gases by mass-to-charge signatures.', 'quadrupole mass spectrometer (est.)'],
  ['S13', 'Neutron spectrometer', 'CONDITIONAL', 2.1, 2, 'Scientist', 'Neutron signatures of hydrogen-rich material beneath the surface.', 'DAN (Curiosity)'],
  ['S14', 'Microscopic imager', 'CONDITIONAL', 0.8, 2, 'Scientist', 'Close-up textures and grain structures of rocks and cores.', 'MAHLI (Curiosity)'],
  ['S15', 'Laser-induced breakdown spectrometer', 'CONDITIONAL', 10.6, 4, 'Scientist', 'Laser pulses → elemental emission from a remote rock target.', 'SuperCam (Perseverance)'],
  ['S16', 'Seismometer package', 'CONDITIONAL', 29.0, 1, 'Scientist / Engineer', 'Ground vibrations and marsquakes.', 'SEIS (InSight)'],
  ['S17', 'UV spectrograph', 'CONDITIONAL', 22.0, 2, 'Scientist', 'Ultraviolet spectra of the (upper) atmosphere.', 'IUVS (MAVEN)'],
  ['S18', 'Wide-angle context camera', 'CONDITIONAL', 0.5, 1, 'Scientist / Navigator', 'Broad-view imagery of clouds, dust, horizon and terrain.', 'MARCI (MRO)'],
  ['S19', 'Dust particle counter', 'CONDITIONAL', 1.2, 1, 'Scientist / Life Support', 'Airborne dust abundance and particle sizes.', 'optical dust counter (est.)'],
  ['S20', 'Soil moisture / dielectric probe', 'CONDITIONAL', 0.5, 1, 'Scientist', 'Soil dielectric properties.', 'TECP-class probe (Phoenix, est.)'],
  ['S21', 'Trace-gas sensor', 'CONDITIONAL', 4.0, 3, 'Scientist', 'Tiny concentrations of a selected gas.', 'tunable laser spectrometer (est.)'],
  ['S22', 'Sample oven / evolved-gas analyzer', 'CONDITIONAL', 40.0, 4, 'Scientist', 'Heats tiny samples and measures released gases.', 'SAM (Curiosity)'],
  ['S23', 'Lidar unit', 'CONDITIONAL', 6.5, 3, 'Navigator / Scientist', 'Laser ranging of terrain elevations or dust layers.', 'Phoenix lidar (est.)'],
  ['S24', 'Optical mineral microscope', 'CONDITIONAL', 2.0, 2, 'Scientist', 'Inspects grains under magnification and controlled light.', 'optical microscope (est.)'],
  ['S25', 'Biological culture incubator', 'DISTRACTOR', 25.0, 4, 'Scientist / Life Support', 'Cultures organisms under controlled conditions.', 'lab incubator'],
  ['S26', 'Ocean salinity / conductivity probe', 'DISTRACTOR', 2.5, 1, 'Scientist', 'Conductivity of liquid water.', 'CTD salinity probe'],
  ['S27', 'Underwater sonar transducer', 'DISTRACTOR', 6.0, 3, 'Navigator / Scientist', 'Sound pulses through liquid water for depth mapping.', 'sonar transducer'],
  ['S28', 'Ocean-plankton net', 'DISTRACTOR', 1.5, 0, 'Scientist', 'Collects plankton from a body of water.', 'plankton net'],
  ['S29', 'Earth GPS handheld receiver', 'DISTRACTOR', 0.2, 1, 'Navigator', 'Receives Earth satellite navigation signals.', 'handheld GPS'],
  ['S30', 'Terrestrial rain gauge', 'DISTRACTOR', 1.0, 0, 'Scientist', 'Measures liquid rainfall over time.', 'rain gauge'],
  ['S31', 'Deep-sea pressure logger', 'DISTRACTOR', 1.8, 1, 'Scientist / Engineer', 'Measures high pressures at ocean depth.', 'deep-sea pressure logger'],
  ['S32', 'Botanical leaf chlorophyll meter', 'DISTRACTOR', 0.2, 1, 'Life Support / Scientist', 'Leaf optical response in a greenhouse.', 'chlorophyll meter'],
].map(([id, name, cat, mass, power, roles, purpose, analog]) => ({ id, name, cat, mass, power, roles, purpose, analog }));
const INSTRUMENT_BY_ID = Object.fromEntries(INSTRUMENTS.map((i) => [i.id, i]));
const SCIENCE_CAPACITY = 60; // кг научного груза (у Perseverance семь приборов весят 59 кг)
const POWER_BUDGET = 8;      // ед. мощности, которые одновременно тянут Fuel Cells

// Научные заказы (тикеты) каталога: какие приборы нужны. phase: F — в полёте, L — после посадки.
const TICKETS = [
  ['O01', 'Map Mars geology', ['S01', 'S05'], 'L', 170], ['O02', 'Cruise radiation log', ['S03'], 'F', 80],
  ['O03', 'Atmospheric flyby spectrum', ['S02'], 'F', 120], ['O04', 'Return a documented rock core', ['S04', 'S01'], 'L', 150],
  ['O05', 'Mars surface weather report', ['S06'], 'L', 90], ['O06', 'Search for organic signatures', ['S07', 'S04'], 'L', 180],
  ['O07', 'Map buried layers', ['S08'], 'L', 150], ['O08', 'Investigate heat patterns', ['S09'], 'F', 110],
  ['O09', 'Characterize magnetic environment', ['S10'], 'F', 100], ['O10', 'Measure upper-atmosphere UV', ['S17'], 'F', 110],
  ['O11', 'Marsquake watch', ['S16'], 'L', 140], ['O12', 'Trace gas investigation', ['S12', 'S21'], 'L', 160],
  ['O13', 'Track charged particles', ['S11'], 'F', 105], ['O14', 'Search for buried hydrogen', ['S13'], 'L', 140],
  ['O15', 'Inspect rock grains', ['S14', 'S24'], 'L', 115], ['O16', 'Remote elemental rock scan', ['S15'], 'L', 145],
  ['O17', 'Cloud and dust overview', ['S18'], 'F', 65], ['O18', 'Measure airborne dust', ['S19'], 'L', 100],
  ['O19', 'Soil dielectric survey', ['S20'], 'L', 110], ['O20', 'Measure released volatiles', ['S22', 'S04'], 'L', 175],
  ['O21', 'High-resolution terrain relief', ['S23'], 'L', 130],
].map(([id, name, needs, phase, pts]) => ({ id, name, needs, phase, pts }));

// ── Этап 1 «Preparations» (Station & Mini-Game Design Bible, задачи P01–P10) ──
// Значения — игровые (не реальная физика), как и в библии.
// ── Сложность: что видит игрок ──────────────────────────────────────────
// Easy    — стикер-подсказка у каждого окна (шаги задачи + формулы с подставленными числами), предупреждения.
// Normal  — у окон с расчётами стикер с формулами (числа подставляешь сам), предупреждения.
// Hard    — никаких подсказок и предупреждений; формулы показываются один раз перед стартом миссии.
// Extreme — ничего не показывается; первая ошибка — провал миссии.
const HINTS = {
  catalog: ['1. Read the tickets on the Lab Console', '2. ★ = instrument a ticket needs', '3. Calibrate it at the Analyzer', '4. Put it inside the Scale zone'],
  calibrate: ['1. Pick the reference for this instrument class', '2. Align until the reading = target', '3. VERIFY: quality ≥ 50 passes, 80+ = full score'],
  science: ['A ticket is READY when all its instruments', 'lie inside the Scale zone.', 'Distractors only waste cargo mass.'],
  workbench: ['1. Choose the job ticket', '2. Tick only the parts on the ticket', '3. Right tool (+ torque for seals)', '4. Assemble + INSPECT, pack kit on the Scale'],
  power: ['Switch in order: MASTER → AVIONICS → LIFE SUPPORT', 'Keep PAYLOAD off: budget 8 u', 'Then SELF-TEST'],
  scale: ['Everything that flies goes in the zone', 'Remove dead mass, stay ≤ 600 kg', 'Changed cargo? APPROVE again', 'Crew: step on one by one to learn your weight'],
  planning: ['FAST: shorter, more Δv → more fuel', 'EFFICIENT: longer, needs more O2/water/food', 'CONFIRM the route'],
  fuel: ['1. Pick the LOX/LH2 cartridge, couple it', '2. Dial the mass from the formula', '3. Open valve + pump', '4. Close valve + VERIFY'],
  o2: ['Take FULL cylinders only', 'Count needed: see the route', 'Put them into the Scale zone'],
  supply: ['Potable water + fresh food only', 'Counts: see the route', 'All in the Scale zone → FINALIZE'],
  hatch: ['1. Clean the gasket first', '2. Wheel → CLOSED', '3. Latches in the shown order', '4. PRESSURE CHECK'],
  suits: ['For 2 suits: fill O2, charged battery,', 'approved CO2 cartridge, then LEAK TEST'],
  engine: ['✗ items block the launch', '• items only cost points'],
};

const MAX_CARGO_KG = 600;            // P03: допустимая масса груза (без экипажа и корабля)

// P02: какой эталон нужен приборам разных классов
const CAL_REFS = ['Alignment / flat-field target', 'Wavelength lamp / reflectance tile', 'Electronics self-test', 'Pressure / temperature zero fixture'];
const CAL_CLASS = (id) => (['S01', 'S14', 'S18', 'S24'].includes(id) ? 0
  : ['S02', 'S05', 'S07', 'S09', 'S12', 'S15', 'S17', 'S21', 'S22'].includes(id) ? 1
  : ['S06', 'S19', 'S26', 'S30', 'S31'].includes(id) ? 3 : 2);

// P04: рецепты ремкомплектов на верстаке
const KIT_RECIPES = [
  { id: 'ELEC', name: 'Electrical spare kit', mass: 12, tool: 'Insulated screwdriver',
    parts: ['28 V rated fuse', 'Avionics module', 'Connector harness'],
    bins: ['28 V rated fuse', '120 V fuse', 'Avionics module', 'Connector harness', 'Arbitrary glue bottle', 'Painter brush'] },
  { id: 'SEAL', name: 'Pressure-seal kit', mass: 6, tool: 'Torque wrench', torque: [18, 22],
    parts: ['O-ring 42 mm', 'Patch plate', 'Clamp', 'Sealant-approved patch stock'],
    bins: ['O-ring 42 mm', 'O-ring 38 mm', 'Patch plate', 'Clamp', 'Sealant-approved patch stock', 'Arbitrary glue bottle'] },
];
const KIT_TOOLS = ['Insulated screwdriver', 'Torque wrench', 'Digital multimeter', 'Soft-jaw pliers', 'Kitchen wrench'];

// P05: автоматы распределения питания (бюджет 8 ед.)
const BREAKERS = [
  { id: 'MASTER', name: 'BATTERY MASTER', load: 0 },
  { id: 'AVI', name: 'AVIONICS', load: 2 },
  { id: 'LS', name: 'LIFE SUPPORT', load: 3 },
  { id: 'PAY', name: 'PAYLOAD (science)', load: 4 },
  { id: 'AUX', name: 'AUX', load: 1 },
];
const POWER_AVAILABLE = 8;
const POWER_ORDER = ['MASTER', 'AVI', 'LS'];

// P06: два маршрута. Δv и длительность — от цели заказа.
const ROUTES = [
  { id: 'FAST', name: 'FAST transfer', dvMul: 1.25, timeMul: 0.7, need: { o2: 2, water: 1, food: 1 } },
  { id: 'EFFICIENT', name: 'EFFICIENT transfer', dvMul: 1.0, timeMul: 1.0, need: { o2: 3, water: 2, food: 2 } },
];

// P07: что можно подключить к топливному порту
const FUEL_CARTRIDGES = [
  { name: 'Propellant cartridge (LOX/LH2)', ok: true },
  { name: 'Battery pack', ok: false, why: 'A battery is not rocket propellant' },
  { name: 'Unrated transfer hose', ok: false, why: 'Unrated hose fails the type check' },
];

// P08: расходники. bad — приманка (пустой баллон, техническая вода, просрочка).
const CONSUMABLES = {
  o2: [
    // композитный баллон высокого давления: ~25 кг сам баллон + 20 кг кислорода
    { id: 'O2', name: 'O2 cylinder (full)', mass: 45, kind: 'o2', stock: 4 },
    { id: 'O2E', name: 'O2 cylinder — EMPTY', mass: 25, kind: 'o2', bad: 'empty cylinder', stock: 2 },
  ],
  supply: [
    // мягкий контейнер воды как на МКС (~44 л): ~46 кг вместе с водой
    { id: 'H2O', name: 'Potable water bag (44 L)', mass: 46, kind: 'water', stock: 3 },
    { id: 'WW', name: 'Wastewater bag (44 L)', mass: 46, kind: 'water', bad: 'non-potable water', stock: 1 },
    // ящик еды: 4 человека × 7 дней × ~1.8 кг в упаковке ≈ 51 кг
    { id: 'FD', name: 'Crew food box (4 crew × 7 d)', mass: 51, kind: 'food', stock: 3 },
    { id: 'XFD', name: 'Food box — EXPIRED', mass: 51, kind: 'food', bad: 'expired, not flight-ready', stock: 1 },
  ],
};

// P10: скафандры (для EVA нужно минимум два готовых)
const SUIT_IDS = ['EVA-1', 'EVA-2', 'EVA-3', 'EVA-4'];
const SUITS_NEEDED = 2;

const CAT_COLORS = { CORE: '#46a35a', CONDITIONAL: '#d08a1a', DISTRACTOR: '#c0392b' };

const WIN_W = 250;          // ширина окна задачи, px
const STATION_REACH = 30;   // насколько близко (от края хитбокса) надо подойти к станции, px
const FUEL_DIGITS = 4;

export class HangarScene extends Phaser.Scene {
  constructor() { super('Hangar'); }

  preload() {
    const v = window.BUILD || Date.now();
    // Интерьер, отрендеренный в 3D (tools/level-render): слои-картинки + их положение и глубина.
    // Если файлов нет — карта рисуется простыми коробками, как раньше.
    this.load.json('levelmeta', `assets/level/level.json?v=${v}`);
    this.load.pack('levelpack', `assets/level/pack.json?v=${v}`);
    for (const name of ['robotdog', 'bunny', 'cat', 'bear']) {
      this.load.spritesheet(name, `assets/crew/${name}.png?v=${v}`,
        { frameWidth: SPRITE.frame, frameHeight: SPRITE.frameH });
    }
  }

  create() {
    // Чёткость: игра рисуется во внутреннем разрешении 1280×720 × RES (см. main.js),
    // а вся логика остаётся в координатах 1280×720 — камера просто увеличена.
    const RES = window.RES || 1;
    this.cameras.main.setZoom(RES).centerOn(640, 360);
    this.physics.world.setBounds(0, 0, 1280, 720);
    // Весь текст — в том же разрешении и нормальным шрифтом (по умолчанию у Phaser тонкий Courier)
    const addText = this.add.text.bind(this.add);
    this.add.text = (x, y, str, style = {}) => addText(x, y, str, {
      fontFamily: '"Segoe UI", Roboto, Arial, sans-serif', resolution: RES, ...style,
    });

    this.buildLevel();
    this.items = [];
    this.mission = { fuelOk: false, fuelValue: null, launched: false, failed: false };
    this.tickets = null; this.mistakes = 0;
    // запасы станций на старте
    for (const ins of INSTRUMENTS) ins.stock = 1;
    for (const list of Object.values(CONSUMABLES)) for (const s2 of list) s2.stock = s2.stock0 ?? (s2.stock0 = s2.stock);
    this.uidSeq = 0;
    this.initPrep();
    this.hl = this.add.graphics().setDepth(9000); // подсветка станций
    // Пока задачи выключены — один тестовый ящик в грузовом отсеке, чтобы проверять переноску

    const kb = this.input.keyboard;
    const bind = (codes) => codes.map((c) => kb.addKey(c, true));

    const crewMasses = rollCrewMasses(PLAYERS.length);
    this.players = PLAYERS.map((cfg, idx) => {
      // Физическое тело — невидимый круг на плоскости; рисуем героя отдельно
      const body = this.add.circle(cfg.x, cfg.y, PLAYER_RADIUS, cfg.color).setVisible(false);
      this.physics.add.existing(body);
      body.body.setCircle(PLAYER_RADIUS);
      body.body.setCollideWorldBounds(true);
      return {
        cfg,
        role: cfg.role,
        body,
        facing: Math.PI / 2,                         // направление взгляда, 0 = вправо
        cone: this.add.graphics().setDepth(-500),    // конус обзора (лежит на полу)
        gfx: this.add.graphics().setDepth(-400),     // тень и цветное кольцо на полу
        sprite: this.add.image(cfg.x, cfg.y, cfg.model, 0)
          .setOrigin(SPRITE.footX / SPRITE.frame, SPRITE.footY / SPRITE.frameH),
        walkPhase: 0,
        keys: {
          up: bind(cfg.up), left: bind(cfg.left), down: bind(cfg.down),
          right: bind(cfg.right), use: bind(cfg.use),
        },
        carrying: null,
        win: null,      // открытое окно задачи
        mass: crewMasses[idx], // вес героя, кг (узнать можно только на весах)
      };
    });

    this.physics.world.on('worldstep', (delta) => {
      this.stepItems(delta);
      this.resolvePushes();
    });

    const help = this.players.map((pl, i) =>
      `${i + 1}: ${ROLES[pl.role].name} (${pl.cfg.label})`).join('   ');
    this.add.text(16, 10, help, { color: '#ffffff', fontSize: '13px' }).setDepth(10000);
    this.add.text(16, 28, 'Action key — pick up / put down / use stations of your color (gray — anyone)',
      { color: '#9aa3cf', fontSize: '12px' }).setDepth(10000);
    this.banner = this.add.text(640, 360, '', {
      color: '#ffffff', fontSize: '34px', fontStyle: 'bold', backgroundColor: '#0f1430cc',
      padding: { x: 24, y: 14 }, align: 'center',
    }).setOrigin(0.5).setDepth(30000).setVisible(false);
  }

  // ── Уровень ────────────────────────────────────────────────────────────
  buildLevel() {
    const meta = this.cache.json.get('levelmeta');
    this.textured = !!meta && meta.layers.every((L) => this.textures.exists(L.key));
    if (this.textured) {
      for (const L of meta.layers) {
        this.add.image(L.x, L.y, L.key).setOrigin(0).setScale(1 / meta.scale).setDepth(L.depth);
      }
    }
    const g = this.add.graphics().setDepth(-1000).setVisible(!this.textured);
    const corner = (gx, gy) => proj(tx(gx), ty(gy));
    g.fillStyle(0x141a35, 1).fillPoints(
      [corner(0, 0), corner(GRID_W, 0), corner(GRID_W, GRID_H), corner(0, GRID_H)], true);
    g.lineStyle(1, 0xffffff, 0.05);
    for (let i = 0; i <= GRID_W; i++) {
      const a = corner(i, 0), b = corner(i, GRID_H);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    for (let j = 0; j <= GRID_H; j++) {
      const a = corner(0, j), b = corner(GRID_W, j);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    // Названия отсеков на полу
    for (const r of this.textured ? [] : ROOMS) {
      const p = proj(tx(r.x), ty(r.y));
      this.add.text(p.x, p.y, r.text, { color: '#5c6699', fontSize: '18px' }).setOrigin(0.5).setDepth(-900);
    }

    this.solids = []; // { l, t, r, b, high, h, station? } в мировых px
    this.boxes = [];

    // Станции
    this.stations = STATIONS.map((def) => {
      const [x, y, w, h] = def.rect;
      // станции у внешних стен прижимаем к их внутренней грани, чтобы не залезали в стену
      const l = Math.max(tx(x), tx(0) + WALL / 2), t = Math.max(ty(y), ty(0) + WALL / 2);
      const r = Math.min(tx(x + w), tx(GRID_W) - WALL / 2), b = Math.min(ty(y + h), ty(GRID_H) - WALL / 2);
      if (def.zone) return this.buildScaleZone(def, l, t, r, b);
      const hgt = def.high ? HIGH_H : LOW_H;
      const role = ROLES[def.role];
      if (this.textured) {
        // подпись — «пузырёк» над станцией (см. makeBubbles)
        const st = { ...def, l, t, r, b, h: hgt, label: null, given: false, anchor: proj((l + r) / 2, (t + b) / 2, hgt + 10) };
        st.solid = { l, t, r, b, high: !!def.high, h: hgt, station: st };
        this.solids.push(st.solid);
        return st;
      }
      const box = def.high
        ? this.addBox(l, t, r, b, hgt, 0x3a4170, 0x5a6394, 0xe0e6ff)
        : this.addBox(l, t, r, b, hgt, 0x353c66, 0x47507c, 0x8c96c8);
      // цветная полоса роли у переднего края крышки
      const stripe = [proj(l, b - 7, hgt), proj(r, b - 7, hgt), proj(r, b, hgt), proj(l, b, hgt)];
      box.g.fillStyle(role.color, 1).fillPoints(stripe, true);
      const c = proj((l + r) / 2, (t + b) / 2 - 4, hgt);
      const label = this.add.text(c.x, c.y, def.name, {
        color: '#e6e9ff', fontSize: '12px', align: 'center',
        wordWrap: { width: Math.max(40, proj(r, b, hgt).x - proj(l, b, hgt).x - 6) },
      }).setOrigin(0.5).setDepth(b + 0.01);
      const st = { ...def, l, t, r, b, h: hgt, box, label, given: false };
      const solid = { l, t, r, b, high: !!def.high, h: hgt, station: st };
      st.solid = solid;
      this.solids.push(solid);
      return st;
    });

    // Стены
    for (const [x1, y1, x2, y2, hgt = WALL_H] of WALLS) {
      const l = Math.min(tx(x1), tx(x2)) - WALL / 2;
      const t = Math.min(ty(y1), ty(y2)) - WALL / 2;
      const r = Math.max(tx(x1), tx(x2)) + WALL / 2;
      const b = Math.max(ty(y1), ty(y2)) + WALL / 2;
      // Внешние боковые стены: за ними ничего нет, поэтому рисуем их раньше всего, что в комнате.
      // Остальные стены чуть «позади» станций той же глубины — станции у стен рисуются поверх.
      const outerSide = x1 === x2 && (x1 === 0 || x1 === GRID_W);
      if (!this.textured) this.addBox(l, t, r, b, hgt, 0x9aa3cf, 0xe0e6ff, 0xffffff, -0.5, outerSide ? -480 : null);
      this.solids.push({ l, t, r, b, high: true, h: hgt });
    }
    if (this.textured) this.makeBubbles();
    // Дверные проёмы — пунктир на полу
    const dg = this.add.graphics().setDepth(-950).setVisible(!this.textured);
    for (const x of [10.5, 20]) {
      for (let y = 6; y < 10; y += 0.5) {
        const a = proj(tx(x), ty(y)), b = proj(tx(x), ty(y + 0.25));
        dg.lineStyle(4, 0x7cc04a, 0.7).lineBetween(a.x, a.y, b.x, b.y);
      }
    }
  }

  // Пузырьки-подписи над станциями: название + подчёркивание цветом роли, которая с ней работает
  makeBubbles() {
    const placed = [];
    const list = [...this.stations].sort((a, b) => a.anchor.y - b.anchor.y);
    for (const st of list) {
      const roleColor = st.role === 'ANY' ? 0x9aa3b8 : ROLES[st.role].color;
      const text = this.add.text(0, 0, st.name, {
        color: '#1d2b4a', fontSize: '12px', fontStyle: 'bold', align: 'center',
      }).setOrigin(0.5, 0);
      const padX = 9, padY = 4, lineH = 3, w = Math.ceil(text.width) + padX * 2, h = Math.ceil(text.height) + padY * 2 + lineH + 2, tail = 6;
      // позиция: хвостик указывает на станцию; если наезжает на другой пузырёк — поднимаем
      let x = Phaser.Math.Clamp(st.anchor.x, w / 2 + 4, 1280 - w / 2 - 4), y = st.anchor.y - tail - h;
      const hit = (px, py) => placed.find((q) => px - w / 2 < q.x + q.w / 2 + 3 && px + w / 2 > q.x - q.w / 2 - 3 && py < q.y + q.h + 3 && py + h > q.y - 3);
      for (let guard = 0, q; (q = hit(x, y)) && guard < 10; guard++) y = q.y - h - 4;
      placed.push({ x, y, w, h });
      const g = this.add.graphics();
      g.fillStyle(0x0b1630, 0.18).fillRoundedRect(-w / 2 + 1, 2, w, h, 8);           // тень
      g.fillStyle(0xffffff, 0.96).fillRoundedRect(-w / 2, 0, w, h, 8);
      g.lineStyle(1.5, 0xc9d3e3, 1).strokeRoundedRect(-w / 2, 0, w, h, 8);
      const tx0 = Phaser.Math.Clamp(st.anchor.x - x, -w / 2 + 10, w / 2 - 10), ty0 = st.anchor.y - y;
      g.fillStyle(0xffffff, 0.96).fillTriangle(tx0 - 6, h - 1, tx0 + 6, h - 1, tx0, Math.max(h + tail, Math.min(ty0, h + 40)));
      g.fillStyle(roleColor, 1).fillRoundedRect(-w / 2 + 8, h - padY - lineH + 1, w - 16, lineH, 1.5); // подчёркивание роли
      text.setPosition(0, padY);
      st.bubble = this.add.container(x, y, [g, text]).setDepth(15000);
    }
  }

  // Объёмный блок. Длинные по глубине блоки (стены по бокам, высокие шкафы) режем на
  // ломтики по полклетки: каждый сортируется по своей Y, иначе такой блок целиком
  // перекрывал бы всё, что стоит рядом с ним.
  // Весы-зона: жёлто-чёрная разметка и платформа на полу + табло на стойке у дальнего края
  buildScaleZone(def, l, t, r, b) {
    const g = this.add.graphics().setDepth(-940).setVisible(!this.textured);
    const P = (x, y) => proj(x, y, 0);
    // платформа
    g.fillStyle(0x1f2750, 1).fillPoints([P(l, t), P(r, t), P(r, b), P(l, b)], true);
    g.lineStyle(1, 0x3a4680, 0.6);
    for (let x = l + 20; x < r; x += 20) { const a = P(x, t), c = P(x, b); g.lineBetween(a.x, a.y, c.x, c.y); }
    for (let y = t + 20; y < b; y += 20) { const a = P(l, y), c = P(r, y); g.lineBetween(a.x, a.y, c.x, c.y); }
    // разметка по периметру: полосы 12 px, чередуем жёлтый и чёрный
    const band = 8, seg = 12;
    const edge = (x0, y0, x1, y1, nx, ny) => {
      const len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len;
      for (let d = 0, i = 0; d < len; d += seg, i++) {
        const e = Math.min(len, d + seg);
        const a = { x: x0 + ux * d, y: y0 + uy * d }, c = { x: x0 + ux * e, y: y0 + uy * e };
        g.fillStyle(i % 2 ? 0x111111 : 0xf2c230, 1).fillPoints([
          P(a.x, a.y), P(c.x, c.y), P(c.x + nx * band, c.y + ny * band), P(a.x + nx * band, a.y + ny * band)], true);
      }
    };
    edge(l, t, r, t, 0, 1); edge(r, t, r, b, -1, 0); edge(r, b, l, b, 0, -1); edge(l, b, l, t, 1, 0);
    // надпись на полу
    const lp = P((l + r) / 2, b - 22);
    if (!this.textured) this.add.text(lp.x, lp.y, 'CARGO SCALE', { color: '#5c6699', fontSize: '13px', fontStyle: 'bold' })
      .setOrigin(0.5).setDepth(-930);

    // табло на стойке за дальним краем зоны (сама стойка — препятствие)
    const cx = (l + r) / 2, sw = 64, sl = cx - sw / 2, sr = cx + sw / 2, sb = t - 2, stt = sb - 10, sh = 56;
    if (!this.textured) this.addBox(sl, stt, sr, sb, sh, 0x2a3266, 0x3a4170, 0x8c96c8);
    const scaleAnchor = proj(cx, (stt + sb) / 2, sh + 8);
    this.solids.push({ l: sl, t: stt, r: sr, b: sb, high: false, h: sh });
    const f0 = proj(sl + 4, sb, sh - 4), f1 = proj(sr - 4, sb, 20); // как экран стойки в 3D-рендере
    const dg = this.add.graphics().setDepth(sb + 0.01);
    dg.fillStyle(0x07090f, 1).fillRoundedRect(f0.x, f0.y, f1.x - f0.x, f1.y - f0.y, 4);
    dg.lineStyle(1, 0x3a4170, 1).strokeRoundedRect(f0.x, f0.y, f1.x - f0.x, f1.y - f0.y, 4);
    const tc = { x: (f0.x + f1.x) / 2, y: (f0.y + f1.y) / 2 };
    const digital = { fontFamily: 'Consolas, "Courier New", monospace', fontSize: '14px', fontStyle: 'bold' };
    // «призрачные» нули под цифрами, как на настоящем табло
    this.scaleGhost = this.add.text(tc.x - 5, tc.y, '8888.8', { ...digital, color: '#2a2410' }).setOrigin(0.5).setDepth(sb + 0.02);
    this.scaleText = this.add.text(tc.x - 5, tc.y, '', { ...digital, color: '#ffb020' }).setOrigin(0.5).setDepth(sb + 0.03);
    this.add.text(tc.x + this.scaleGhost.width / 2 - 4, tc.y + 3, 'kg', { color: '#ffb020', fontSize: '8px', fontStyle: 'bold' })
      .setOrigin(0, 0.5).setDepth(sb + 0.03);
    this.scaleShown = 0;

    const st = { ...def, l, t, r, b, h: 0, label: null, given: false, anchor: scaleAnchor,
      hit: { l: sl - 6, t: stt, r: sr + 6, b: sb + 4, h: sh } }; // взаимодействуем со стойкой табло
    st.solid = null;
    this.scaleZone = st;
    return st;
  }

  inScaleZone(x, y) {
    const z = this.scaleZone;
    return !!z && x >= z.l && x <= z.r && y >= z.t && y <= z.b;
  }

  // Сколько сейчас показывают весы: всё, что лежит в зоне, и герои, стоящие в ней (с тем, что в руках)
  scaleReading() {
    let m = 0;
    for (const it of this.items) if (!it.carrier && !it.support && this.inScaleZone(it.x, it.y)) m += it.mass;
    for (const pl of this.players) {
      if (!this.inScaleZone(pl.body.x, pl.body.y)) continue;
      m += pl.mass + (pl.carrying ? pl.carrying.mass : 0);
    }
    return m;
  }

  updateScaleDisplay(dt) {
    if (!this.scaleText) return;
    const target = this.scaleReading();
    // табло «доезжает» до значения за доли секунды, как настоящие весы
    this.scaleShown += (target - this.scaleShown) * Math.min(1, dt * 8);
    if (Math.abs(target - this.scaleShown) < 0.05) this.scaleShown = target;
    const v = Math.min(9999.9, Math.max(0, this.scaleShown));
    const str = v.toFixed(1).padStart(6, '0');
    // ведущие нули оставляем «призрачными», яркими рисуем только значащие цифры
    const lead = str.match(/^0*(?=\d+\.)/)[0].length;
    this.scaleText.setText(' '.repeat(lead) + str.slice(lead));
  }

  addBox(l, t, r, b, h, sideColor, topColor, edgeColor, depthBias = 0, fixedDepth = null) {
    const SLICE = TILE / 2;
    const parts = [];
    if (b - t > TILE * 2 && fixedDepth === null) {
      for (let y0 = t; y0 < b - 0.01; y0 += SLICE) parts.push([y0, Math.min(b, y0 + SLICE)]);
    } else {
      parts.push([t, b]);
    }
    let g;
    parts.forEach(([y0, y1], i) => {
      g = this.add.graphics().setDepth(fixedDepth !== null ? fixedDepth : y1 + depthBias);
      const base = [{ x: l, y: y0 }, { x: r, y: y0 }, { x: r, y: y1 }, { x: l, y: y1 }];
      // внутренние стыки между ломтиками не рисуем (ребро 0 — север, 2 — юг)
      const skip = [];
      if (i > 0) skip.push(0);
      if (i < parts.length - 1) skip.push(2);
      drawPrism(g, base, 0, h, sideColor, topColor, parts.length > 1 ? null : edgeColor, skip);
    });
    // g — самый ближний к камере ломтик: на нём рисуем полосу роли
    const box = { g, l, t, r, b, h };
    this.boxes.push(box);
    return box;
  }

  // ── Предметы ───────────────────────────────────────────────────────────
  createItem(def, color, x, y) {
    const it = {
      x, y, rotation: 0, z: 0, support: null, carrier: null, vx: 0, vy: 0,
      name: def.name, mass: def.mass, color,
      gfx: this.add.graphics(),
      label: this.add.text(0, 0, `${def.code ? def.code + ' · ' : ''}${def.mass} kg`, {
        color: '#ffffff', fontSize: '11px', backgroundColor: '#0f1430aa', padding: { x: 3, y: 1 },
      }).setOrigin(0.5, 1),
    };
    this.items.push(it);
    return it;
  }

  drawItem(it, highlight) {
    const g = it.gfx;
    const half = ITEM_SIZE / 2;
    const z0 = it.carrier ? HOLD_Z : it.z, z1 = z0 + ITEM_SIZE;
    const cs = Math.cos(it.rotation), sn = Math.sin(it.rotation);
    const corners = [[-half, -half], [half, -half], [half, half], [-half, half]]
      .map(([u, v]) => ({ x: it.x + cs * u - sn * v, y: it.y + sn * u + cs * v }));
    // в руках куб рисуется сразу ПОЗАДИ спрайта героя (в спрайте на его месте вырез)
    const depth = it.carrier ? it.carrier.body.y - 0.5 : it.support ? it.support.b + 0.02 : it.y;
    g.clear().setDepth(depth);
    if (it.carrier) {
      g.fillStyle(0x000000, 0.25).fillPoints(circlePts(it.x, it.y, half).map((p) => proj(p.x, p.y, 0)), true);
    }
    const top = drawPrism(g, corners, z0, z1, shadeColor(it.color, 0.95), shadeColor(it.color, 1.25));
    if (highlight) g.lineStyle(3, 0xffffff, 1).strokePoints(top, true);
    const lp = proj(it.x, it.y, z1 + 4);
    // на Hard/Extreme масса не подписана — только взвешивание
    const txt = this.difficulty() >= 2 ? (it.code || '?') : `${it.code ? it.code + ' · ' : ''}${it.mass} kg`;
    if (it.label.text !== txt) it.label.setText(txt);
    it.label.setPosition(lp.x, lp.y - 2).setDepth(depth + 0.01).setVisible(!it.carrier || highlight);
  }

  // ── Столкновения ───────────────────────────────────────────────────────
  circleVsRect(cx, cy, R, s) {
    const px = Phaser.Math.Clamp(cx, s.l, s.r);
    const py = Phaser.Math.Clamp(cy, s.t, s.b);
    const dx = cx - px, dy = cy - py;
    const d = Math.hypot(dx, dy);
    if (d >= R) return null;
    if (d > 0) return { nx: dx / d, ny: dy / d, depth: R - d };
    const opts = [[cx - s.l, -1, 0], [s.r - cx, 1, 0], [cy - s.t, 0, -1], [s.b - cy, 0, 1]];
    opts.sort((a, b) => a[0] - b[0]);
    return { nx: opts[0][1], ny: opts[0][2], depth: opts[0][0] + R };
  }

  pushOutOfSolid(body, s, cx = body.center.x, cy = body.center.y, R = PLAYER_RADIUS) {
    const hit = this.circleVsRect(cx, cy, R, s);
    if (!hit) return;
    const { nx, ny, depth } = hit;
    body.position.x += nx * depth;
    body.position.y += ny * depth;
    body.updateCenter();
    const vn = body.velocity.x * nx + body.velocity.y * ny;
    if (vn < 0) body.velocity.set(body.velocity.x - nx * vn, body.velocity.y - ny * vn);
  }

  // Лежащие на полу предметы: движение по инерции и трение
  stepItems(delta) {
    for (const it of this.items) {
      if (it.carrier || it.support) continue;
      it.x += it.vx * delta;
      it.y += it.vy * delta;
      const sp = Math.hypot(it.vx, it.vy);
      const ns = Math.max(0, sp - ITEM_FRICTION * delta);
      if (ns === 0) { it.vx = 0; it.vy = 0; } else { it.vx *= ns / sp; it.vy *= ns / sp; }
    }
  }

  resolveFloorItems(clamp) {
    for (const it of this.items) {
      if (it.carrier || it.support) continue;
      for (const pl of this.players) {
        const b = pl.body.body;
        let nx = it.x - b.center.x, ny = it.y - b.center.y;
        let dist = Math.hypot(nx, ny);
        const min = ITEM_RADIUS + PLAYER_RADIUS;
        if (dist >= min) continue;
        if (dist === 0) { nx = 1; ny = 0; dist = 1; }
        nx /= dist; ny /= dist;
        const mp = pl.moving ? 1 : IDLE_MASS;
        const overlap = min - dist;
        const shareItem = mp / (mp + ITEM_MASS), sharePl = ITEM_MASS / (mp + ITEM_MASS);
        it.x += nx * overlap * shareItem; it.y += ny * overlap * shareItem;
        b.position.x -= nx * overlap * sharePl; b.position.y -= ny * overlap * sharePl;
        clamp(b);
        const pv = b.velocity.x * nx + b.velocity.y * ny;
        const iv = it.vx * nx + it.vy * ny;
        if (pv > iv) { it.vx += nx * (pv - iv); it.vy += ny * (pv - iv); }
      }
      // предметы на полу не залезают друг в друга
      for (const o of this.items) {
        if (o === it || o.carrier || o.support) continue;
        let nx = it.x - o.x, ny = it.y - o.y;
        let dist = Math.hypot(nx, ny);
        const min = ITEM_RADIUS * 2;
        if (dist >= min) continue;
        if (dist === 0) { nx = 1; ny = 0; dist = 1; }
        nx /= dist; ny /= dist;
        const ov = (min - dist) / 2;
        it.x += nx * ov; it.y += ny * ov; o.x -= nx * ov; o.y -= ny * ov;
      }
      for (const s of this.solids) {
        const hit = this.circleVsRect(it.x, it.y, ITEM_RADIUS, s);
        if (!hit) continue;
        it.x += hit.nx * hit.depth; it.y += hit.ny * hit.depth;
        const vn = it.vx * hit.nx + it.vy * hit.ny;
        if (vn < 0) { it.vx -= hit.nx * vn; it.vy -= hit.ny * vn; }
      }
      const wb = this.physics.world.bounds;
      it.x = Phaser.Math.Clamp(it.x, wb.x + ITEM_RADIUS, wb.right - ITEM_RADIUS);
      it.y = Phaser.Math.Clamp(it.y, wb.y + ITEM_RADIUS, wb.bottom - ITEM_RADIUS);
    }
  }

  resolvePushes() {
    const ps = this.players;
    const minDist = PLAYER_RADIUS * 2;
    const wb = this.physics.world.bounds;
    const clamp = (body) => {
      body.position.x = Phaser.Math.Clamp(body.position.x, wb.x, wb.right - body.width);
      body.position.y = Phaser.Math.Clamp(body.position.y, wb.y, wb.bottom - body.height);
      body.updateCenter();
    };
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i].body.body, b = ps[j].body.body;
          let nx = b.center.x - a.center.x, ny = b.center.y - a.center.y;
          let dist = Math.hypot(nx, ny);
          if (dist >= minDist) continue;
          if (dist === 0) { nx = 1; ny = 0; dist = 1; }
          nx /= dist; ny /= dist;
          const ma = ps[i].moving ? 1 : IDLE_MASS;
          const mb = ps[j].moving ? 1 : IDLE_MASS;
          const overlap = minDist - dist;
          const shareA = mb / (ma + mb), shareB = ma / (ma + mb);
          a.position.x -= nx * overlap * shareA; a.position.y -= ny * overlap * shareA;
          b.position.x += nx * overlap * shareB; b.position.y += ny * overlap * shareB;
          clamp(a); clamp(b);
        }
      }
      // Предмет в руках — часть хитбокса героя: толкает других героев
      for (const owner of ps) {
        if (!owner.carrying) continue;
        const ob = owner.body.body;
        for (const other of ps) {
          if (other === owner) continue;
          const b = other.body.body;
          const ix = ob.center.x + Math.cos(owner.facing) * HOLD_DIST;
          const iy = ob.center.y + Math.sin(owner.facing) * HOLD_DIST;
          let nx = b.center.x - ix, ny = b.center.y - iy;
          let dist = Math.hypot(nx, ny);
          const min = ITEM_RADIUS + PLAYER_RADIUS;
          if (dist >= min) continue;
          if (dist === 0) { nx = 1; ny = 0; dist = 1; }
          nx /= dist; ny /= dist;
          const ma = owner.moving ? 1 : IDLE_MASS;
          const mb = other.moving ? 1 : IDLE_MASS;
          const overlap = min - dist;
          const shareA = mb / (ma + mb), shareB = ma / (ma + mb);
          ob.position.x -= nx * overlap * shareA; ob.position.y -= ny * overlap * shareA;
          b.position.x += nx * overlap * shareB; b.position.y += ny * overlap * shareB;
          clamp(ob); clamp(b);
        }
      }
      for (const pl of ps) {
        for (const s of this.solids) this.pushOutOfSolid(pl.body.body, s);
      }
      this.resolveFloorItems(clamp);
      for (const pl of ps) {
        if (!pl.carrying) continue;
        const b = pl.body.body;
        for (const s of this.solids) {
          if (!s.high) continue;
          const ix = b.center.x + Math.cos(pl.facing) * HOLD_DIST;
          const iy = b.center.y + Math.sin(pl.facing) * HOLD_DIST;
          this.pushOutOfSolid(b, s, ix, iy, ITEM_RADIUS);
        }
      }
    }
  }

  // ── Взгляд и цели ──────────────────────────────────────────────────────
  inView(pl, x, y, range = VIEW_RANGE) {
    const p = pl.body;
    if (Phaser.Math.Distance.Between(p.x, p.y, x, y) > range) return false;
    const toTarget = Phaser.Math.Angle.Between(p.x, p.y, x, y);
    const diff = Phaser.Math.Angle.Wrap(toTarget - pl.facing);
    return Math.abs(diff) <= VIEW_ANGLE / 2;
  }

  // Ближайший свободный предмет в конусе обзора
  targetItem(pl) {
    let best = null, bd = Infinity;
    for (const it of this.items) {
      if (it.carrier || !this.inView(pl, it.x, it.y)) continue;
      const d = Phaser.Math.Distance.Between(pl.body.x, pl.body.y, it.x, it.y);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  // Станция прямо перед героем: ближайшая точка её прямоугольника рядом и в конусе
  targetStation(pl) {
    let best = null, bd = Infinity;
    const { x, y } = pl.body;
    for (const st of this.stations) {
      const R = st.hit || st;
      const px = Phaser.Math.Clamp(x, R.l, R.r), py = Phaser.Math.Clamp(y, R.t, R.b);
      const d = Math.hypot(px - x, py - y);
      if (st.kind === 'decor' || d > PLAYER_RADIUS + STATION_REACH) continue;
      // точку чуть внутри станции, по направлению взгляда, тоже проверяем
      const fx = x + Math.cos(pl.facing) * (PLAYER_RADIUS + 12), fy = y + Math.sin(pl.facing) * (PLAYER_RADIUS + 12);
      const facingIt = this.inView(pl, px, py) || (fx >= R.l && fx <= R.r && fy >= R.t && fy <= R.b);
      if (!facingIt) continue;
      if (d < bd) { bd = d; best = st; }
    }
    return best;
  }

  canUse(pl, st) { return st.role === 'ANY' || st.role === pl.role; }

  // ── Этап Preparations: общее состояние и проверки ──────────────────────
  initPrep() {
    this.prep = {
      route: null,                                   // P06
      manifest: null,                                // P03: подпись утверждённого груза
      kits: [],                                      // P04
      power: { on: Object.fromEntries(BREAKERS.map((b) => [b.id, false])), ready: false }, // P05
      fuel: { loaded: 0, valve: false, coupled: false }, // P07
      consumables: null,                             // P08: подпись груза на момент FINALIZE
      hatch: { state: 'OPEN', gasketClean: false, latched: [], order: Phaser.Utils.Array.Shuffle([1, 2, 3]) }, // P09
      suits: SUIT_IDS.map(() => ({ o2: 40, battery: false, co2: false, ready: false })), // P10
    };
  }

  cargoGroup(it) {
    return { instrument: 'Science payload', kit: 'Spares', o2: 'O2', water: 'Water', food: 'Food' }[it.type] || 'Other';
  }
  // «Мёртвая масса»: приманки и приборы, которые не нужны текущим тикетам
  deadMass(it) {
    if (it.bad) return true;
    if (it.type === 'instrument') return !(this.tickets || []).some((t) => t.needs.includes(it.code));
    return false;
  }
  cargoSignature() { return this.itemsOnScale().map((it) => it.uid).sort().join(','); }
  manifestApproved() { return !!this.prep.manifest && this.prep.manifest === this.cargoSignature(); }
  consumablesInCargo() {
    const r = { o2: 0, water: 0, food: 0, bad: [] };
    for (const it of this.itemsOnScale()) {
      if (!['o2', 'water', 'food'].includes(it.type)) continue;
      if (it.bad) r.bad.push(it.name); else r[it.type] += 1;
    }
    return r;
  }

  // Список задач P01–P10 для Launch Control. gate — без этого старт запрещён.
  prepGates() {
    const tk = this.tickets || [];
    const ready = tk.filter((t) => this.ticketReady(t)).length;
    const packed = this.packedInstruments();
    const uncal = packed.filter((it) => !it.calibrated).length;
    const kitsPacked = this.itemsOnScale().filter((it) => it.type === 'kit').length;
    const suits = this.prep.suits.filter((x) => x.ready).length;
    return [
      { id: 'P01', text: `Science tickets ready ${ready}/${tk.length}`, ok: tk.length > 0 && ready > 0, gate: false },
      { id: 'P02', text: packed.length ? `Calibrated ${packed.length - uncal}/${packed.length}` : 'No instruments packed', ok: packed.length > 0 && uncal === 0, gate: false },
      { id: 'P03', text: 'Manifest approved', ok: this.manifestApproved(), gate: true },
      { id: 'P04', text: `Spare kits packed ${kitsPacked}/${KIT_RECIPES.length}`, ok: kitsPacked >= KIT_RECIPES.length, gate: false },
      { id: 'P05', text: 'Electrical check', ok: this.prep.power.ready, gate: true },
      { id: 'P06', text: this.prep.route === null ? 'Route not selected' : ROUTES[this.prep.route].name, ok: this.prep.route !== null, gate: true },
      { id: 'P07', text: `Propellant ${this.mission.fuelOk ? this.mission.fuelValue + ' kg' : 'not verified'}`, ok: this.mission.fuelOk && Math.abs(this.prep.fuel.loaded - this.requiredFuel()) <= Math.max(2, this.requiredFuel() * 0.01), gate: true },
      { id: 'P08', text: 'Consumables finalized', ok: !!this.prep.consumables && this.prep.consumables === this.cargoSignature(), gate: true },
      { id: 'P09', text: `Hatch ${this.prep.hatch.state}`, ok: this.prep.hatch.state === 'VERIFIED', gate: true },
      { id: 'P10', text: `EVA suits ready ${suits}/${SUITS_NEEDED}`, ok: suits >= SUITS_NEEDED, gate: false },
    ];
  }

  // ── Формулы «как в учебнике»: дроби, индексы, степени ────────────────
  // Токены: строка — обычный текст; { sub } — нижний индекс; { sup: [...] } — степень;
  // { frac: [[числитель], [знаменатель]] } — дробь с чертой.
  buildMath(tokens, size = 15, color = '#2d2400') {
    const c = this.add.container(0, 0);
    const fam = 'Cambria, "Cambria Math", "Times New Roman", serif';
    let x = 0, asc = size * 0.78, desc = size * 0.26;
    const arr = (v) => (Array.isArray(v) ? v : [v]);
    for (const tok of tokens) {
      if (typeof tok === 'string' || typeof tok === 'number') {
        const t = this.add.text(x, 0, String(tok), { fontFamily: fam, fontSize: `${size}px`, color }).setOrigin(0, 0.8);
        c.add(t); x += t.width;
      } else if (tok.sub !== undefined) {
        const m = this.buildMath(arr(tok.sub), size * 0.66, color);
        m.setPosition(x, size * 0.24); c.add(m); x += m.mw;
        desc = Math.max(desc, size * 0.24 + m.mdesc);
      } else if (tok.sup !== undefined) {
        const m = this.buildMath(arr(tok.sup), size * 0.78, color);
        const y = -size * 0.42 - m.mdesc * 0.35;
        m.setPosition(x + 1, y); c.add(m); x += m.mw + 2;
        asc = Math.max(asc, -y + m.masc);
      } else if (tok.frac) {
        const n = this.buildMath(arr(tok.frac[0]), size, color), d = this.buildMath(arr(tok.frac[1]), size, color);
        const w = Math.max(n.mw, d.mw) + 6, ly = -size * 0.3;
        n.setPosition(x + (w - n.mw) / 2, ly - 2 - n.mdesc); d.setPosition(x + (w - d.mw) / 2, ly + 2 + d.masc);
        const g = this.add.graphics();
        g.lineStyle(Math.max(1, size / 13), Phaser.Display.Color.HexStringToColor(color).color, 1).lineBetween(x + 1, ly, x + w - 1, ly);
        c.add([g, n, d]); x += w + 1;
        asc = Math.max(asc, -ly + 2 + n.mdesc + n.masc); desc = Math.max(desc, ly + 2 + d.masc + d.mdesc);
      }
    }
    c.mw = x; c.masc = asc; c.mdesc = desc;
    return c;
  }

  // Записка из строк и формул (стикер у окна, брифинг): возвращает контейнер с фоном
  buildNote(items, opt = {}) {
    const { bg = 0xfff176, band = 0xf2c230, text = '#4a3b00', math = '#2d2400', pad = 10, size = 11, mathSize = 15, align = 'left' } = opt;
    const c = this.add.container(0, 0), parts = [];
    let y = pad + 2, w = 0;
    for (const it of items) {
      if (it && it.math) {
        const m = this.buildMath(it.math, it.size || mathSize, math);
        m.setPosition(pad, y + m.masc); parts.push(m);
        y += m.masc + m.mdesc + 6; w = Math.max(w, m.mw);
      } else {
        const t = this.add.text(pad, y, it || ' ', { color: (it && it.color) || text, fontSize: `${size}px`, fontStyle: it && it.bold ? 'bold' : 'normal' });
        if (it && it.text) t.setText(it.text);
        parts.push(t); y += t.height + 2; w = Math.max(w, t.width);
      }
    }
    const W = w + pad * 2, H = y + pad - 2;
    if (align === 'center') for (const p of parts) p.x = (W - (p.mw || p.width)) / 2;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.18).fillRect(3, 4, W, H);
    g.fillStyle(bg, 1).fillRect(0, 0, W, H);
    if (band !== null) g.fillStyle(band, 1).fillRect(0, 0, W, 5);
    c.add([g, ...parts]); c.nw = W; c.nh = H;
    return c;
  }

  // Формула топлива: символьная и с подставленными числами
  fuelMath(plugged = false) {
    const ve = ['v', { sub: 'e' }];
    if (!plugged) return ['m', { sub: 'f' }, ' = m · ( e', { sup: [{ frac: [['Δv'], ve] }] }, ' − 1 )'];
    const dv = this.routeDv().toFixed(2), f = this.fuelFactor().toFixed(3);
    return ['m', { sub: 'f' }, ' = m · ( e', { sup: [{ frac: [[dv], [String(V_EXHAUST)]] }] }, ` − 1 ) = m · ${f}`];
  }

  // Стикер к окну станции по уровню сложности (строки и формулы)
  stickyFor(kind) {
    const d = this.difficulty();
    const formula = ['planning', 'fuel', 'scale'].includes(kind);
    const massMath = { math: ['m = m', { sub: 'cargo' }, ' + m', { sub: 'crew' }], size: 14 };
    if (d === 0) {
      const lines = (HINTS[kind] || []).map((h) => h);
      if (formula) {
        lines.push('', { text: 'Propellant (Tsiolkovsky)', bold: true }, { math: this.fuelMath(false) }, { math: this.fuelMath(true) }, massMath,
          `cargo now: ${Math.round(this.loadedMass() * 10) / 10} kg · crew: weigh everyone!`);
        if (this.prep.route === null) lines.push('(Δv shown for EFFICIENT — pick a route)');
      }
      if (kind === 'calibrate') lines.push('', { math: ['Q = 100 − 8 · | x − x', { sub: 'ref' }, ' |'], size: 14 });
      return lines.length ? lines : null;
    }
    if (d === 1 && formula) {
      return [{ text: 'Propellant (Tsiolkovsky)', bold: true }, { math: this.fuelMath(false) },
        { math: ['v', { sub: 'e' }, ` = ${V_EXHAUST} km/s`], size: 14 }, 'Δv — see Mission Planning', massMath];
    }
    return null;
  }

  // Hard: формулы один раз перед стартом миссии
  showBriefing(pl) {
    const note = this.buildNote([
      { text: 'MISSION BRIEFING', bold: true, color: '#ffcf5a' },
      { text: 'Remember this — it will not be shown again.', color: '#8c96c8' },
      '',
      { text: 'Propellant (Tsiolkovsky)', bold: true },
      { math: this.fuelMath(false), size: 20 },
      { math: ['v', { sub: 'e' }, ` = ${V_EXHAUST} km/s     Δv = Δv`, { sub: 'target' }, ' · k', { sub: 'route' }], size: 16 },
      { text: 'k_route: FAST ×1.25 · EFFICIENT ×1', color: '#8c96c8' },
      { math: ['m = m', { sub: 'cargo' }, ' + m', { sub: 'crew' }], size: 16 },
      '',
      { text: 'Calibration quality', bold: true },
      { math: ['Q = 100 − 8 · | x − x', { sub: 'ref' }, ' |'], size: 16 },
      '',
      `Cargo ≤ ${MAX_CARGO_KG} kg · science payload ≤ ${SCIENCE_CAPACITY} kg · power ≤ ${POWER_AVAILABLE} u`,
      '',
      { text: `${pl.cfg.useName} — close`, color: '#8c96c8' },
    ], { bg: 0x0f1430, band: 0xffb020, text: '#e6e9ff', math: '#ffffff', pad: 22, size: 13, mathSize: 18, align: 'center' });
    note.setPosition(640 - note.nw / 2, 360 - note.nh / 2).setDepth(26000);
    pl.win = { kind: 'brief', pl, st: null, c: note };
    pl.body.body.setVelocity(0, 0);
  }

  // ── Миссия ─────────────────────────────────────────────────────────────
  scaleStation() { return this.stations.find((s) => s.kind === 'scale'); }
  itemsOnScale() { return this.items.filter((it) => !it.carrier && !it.support && this.inScaleZone(it.x, it.y)); }
  loadedMass() { return this.itemsOnScale().reduce((a, it) => a + it.mass, 0); }
  crewMass() { return this.players.reduce((a, p) => a + p.mass, 0); }
  // Стартовая масса: весь груз в зоне весов + экипаж (каждого надо взвесить)
  launchMass() { return Math.round((this.loadedMass() + this.crewMass()) * 10) / 10; }
  orderTarget() { return TARGETS[this.order ? this.order.target : 1]; }
  routeDv() { return this.orderTarget().dv * (this.prep && this.prep.route !== null ? ROUTES[this.prep.route].dvMul : 1); }
  fuelFactor() { return Math.exp(this.routeDv() / V_EXHAUST) - 1; }
  requiredFuel() { return Math.round(this.launchMass() * this.fuelFactor()); }
  difficulty() { return this.order ? this.order.difficulty : 0; } // 0 Easy … 3 Extreme
  packedInstruments() { return this.itemsOnScale().filter((it) => it.type === 'instrument'); }
  ticketReady(tk) { const ids = new Set(this.packedInstruments().map((it) => it.code)); return tk.needs.every((n) => ids.has(n)); }

  // Тикеты под заказ: 3 случайных подходящих по типу миссии, чтобы вместе влезали в научную ёмкость
  rollTickets(order) {
    const phase = MISSION_TYPES[order.type].id === 'photo' ? 'F' : 'L';
    const pool = TICKETS.filter((t) => t.phase === phase);
    for (let guard = 0; guard < 500; guard++) {
      const pick = Phaser.Utils.Array.Shuffle([...pool]).slice(0, 3);
      const ids = new Set(pick.flatMap((t) => t.needs));
      const mass = [...ids].reduce((a, id) => a + INSTRUMENT_BY_ID[id].mass, 0);
      if (mass <= SCIENCE_CAPACITY) return pick;
    }
    return pool.slice(0, 2);
  }

  // Ошибка игрока: на Extreme — сразу провал миссии
  mistake(st, text, quiet = false) {
    this.mistakes = (this.mistakes || 0) + 1;
    if (this.difficulty() === 3) {
      this.mission.failed = true;
      for (const p of this.players) this.closeWindow(p);
      this.banner.setText('💀 Mission failed\n' + text).setVisible(true);
      return;
    }
    if (this.difficulty() <= 1 && !quiet) this.floatText(st, text, '#ff8a8a'); // Easy/Normal — предупреждение; Hard — молча
  }

  floatText(st, text, color = '#ffffff') {
    const c = proj((st.l + st.r) / 2, (st.t + st.b) / 2, (st.h || 0) + 30);
    const t = this.add.text(c.x, c.y, text, {
      color, fontSize: '13px', backgroundColor: '#0f1430dd', padding: { x: 6, y: 3 },
    }).setOrigin(0.5).setDepth(25000);
    this.tweens.add({ targets: t, y: c.y - 24, alpha: 0, delay: 900, duration: 500, onComplete: () => t.destroy() });
  }

  // Взять предмет прямо в руки (из окна станции)
  giveItem(pl, def) {
    const it = this.createItem(def, def.color, pl.body.x, pl.body.y);
    Object.assign(it, { type: def.type, code: def.code, ref: def.ref, bad: def.bad, uid: ++this.uidSeq,
      calibrated: false, calQuality: 0, calRef: 20 + Math.floor(Math.random() * 70) });
    it.carrier = pl;
    pl.carrying = it;
    return it;
  }

  // Вернуть предмет на станцию-источник (держим его и «используем» станцию)
  returnItem(pl, st) {
    const it = pl.carrying;
    if (!it || !it.ref || it.ref.station !== st.id) return false;
    it.ref.stock = (it.ref.stock || 0) + 1;
    pl.carrying = null;
    it.gfx.destroy(); it.label.destroy();
    this.items = this.items.filter((x) => x !== it);
    this.floatText(st, `${it.code || ''} returned`, '#8be08b');
    return true;
  }

  // Взаимодействие со станцией. Только своего цвета (серые — общие).
  useStation(pl, st) {
    if (!this.canUse(pl, st)) {
      this.floatText(st, `${ROLES[st.role].name} only`, hex(ROLES[st.role].color));
      return;
    }
    if (pl.carrying && this.returnItem(pl, st)) return;
    if (st.user && st.user !== pl) { this.floatText(st, 'In use'); return; }
    if (st.kind === 'order') this.openBoard(pl, st);
    else this.openPanel(pl, st);
  }

  // ── Доска заказов ──────────────────────────────────────────────────────
  openBoard(pl, st) {
    const c = this.add.container(0, 0).setDepth(21000);
    const bg = this.add.graphics();
    const title = this.add.text(16, 10, 'Order board', { color: '#ffffff', fontSize: '17px', fontStyle: 'bold' });
    const sub = this.add.text(BOARD_W - 16, 14, '', { color: '#8c96c8', fontSize: '11px' }).setOrigin(1, 0);
    const rows = this.add.text(0, 0, '');
    c.add([bg, title, sub]);
    // текущий черновик: продолжаем с активного заказа, если он есть
    const o = this.order || { type: 0, target: 1, duration: 4, difficulty: 0 };
    const w = { kind: 'board', pl, st, c, bg, title, sub, sel: 0, draft: { ...o }, texts: [] };
    pl.win = w; st.user = pl;
    pl.body.body.setVelocity(0, 0);
    this.refreshBoard(w);
  }

  boardRows(w) {
    const d = w.draft;
    return [
      { key: 'type',       label: 'Mission type',   list: MISSION_TYPES, show: (v) => v.name },
      { key: 'target',     label: 'Target',       list: TARGETS,       show: (v) => v.name },
      { key: 'duration',   label: 'Duration'    , list: DURATIONS,     show: (v) => `${v} days` },
      { key: 'difficulty', label: 'Difficulty',    list: DIFFICULTIES,  show: (v) => v.name },
      { key: 'confirm',    label: this.order ? 'Update order' : 'Confirm order', button: true },
      { key: 'close',      label: 'Close', button: true },
    ].map((r) => ({ ...r, value: r.list ? r.list[d[r.key]] : null }));
  }

  // Проверка заказа на реалистичность: хватает ли длительности на перелёт
  boardCheck(d) {
    const type = MISSION_TYPES[d.type], target = TARGETS[d.target];
    const need = target.travel * (type.returnTrip ? 2 : 1) + 7; // + неделя на работу на месте
    if (DURATIONS[d.duration] < need) {
      return `Not enough time: transfer ≈ ${target.travel} days${type.returnTrip ? ' each way' : ''}, need ≥ ${need} days`;
    }
    return null;
  }

  boardInput(pl, pressed) {
    const w = pl.win, k = pl.keys, rows = this.boardRows(w);
    if (pressed(k.up)) w.sel = (w.sel + rows.length - 1) % rows.length;
    if (pressed(k.down)) w.sel = (w.sel + 1) % rows.length;
    const r = rows[w.sel];
    if (r.list) {
      const n = r.list.length;
      if (pressed(k.left)) w.draft[r.key] = (w.draft[r.key] + n - 1) % n;
      if (pressed(k.right) || pressed(k.use)) w.draft[r.key] = (w.draft[r.key] + 1) % n;
    } else if (pressed(k.use)) {
      if (r.key === 'close') { this.closeWindow(pl); return; }
      if (r.key === 'confirm') {
        const err = this.boardCheck(w.draft);
        if (err) { w.flash = err; }
        else {
          this.order = { ...w.draft };
          this.tickets = this.rollTickets(this.order);
          this.updateOrderHud();
          const t = MISSION_TYPES[this.order.type], g = TARGETS[this.order.target];
          this.floatText(w.st, `Order accepted: ${t.name} · ${g.name}`, '#8be08b');
          this.closeWindow(pl);
          // Hard: формулы показываются один раз — перед стартом миссии
          if (this.order.difficulty === 2 && !this.briefed) { this.briefed = true; this.showBriefing(pl); }
          return;
        }
      }
    }
    this.refreshBoard(w);
  }

  refreshBoard(w) {
    const rows = this.boardRows(w), d = w.draft, col = w.pl.cfg.color, use = w.pl.cfg.useName;
    for (const t of w.texts) t.destroy();
    w.texts = [];
    const add = (x, y, str, style, ox = 0) => {
      const t = this.add.text(x, y, str, { color: '#e6e9ff', fontSize: '13px', ...style }).setOrigin(ox, 0);
      w.c.add(t); w.texts.push(t); return t;
    };
    w.sub.setText(`opened by: ${ROLES[w.pl.role].name}`);
    let y = 40;
    const rowH = 30;
    // строки настроек (фон и подсветку рисует redrawBoardBg)
    rows.forEach((r, i) => {
      const sel = i === w.sel;
      if (r.button) {
        if (i === rows.length - 2) y += 6;
        const bw = r.key === 'close' ? 120 : 200;
        const bx = r.key === 'close' ? BOARD_W - 16 - bw : 16;
        if (r.key === 'close') y -= rowH; // кнопки в один ряд
        add(bx + bw / 2, y + 5, r.label, { fontStyle: 'bold' }, 0.5);
      } else {
        add(20, y + 4, r.label, { color: '#8c96c8' });
        add(BOARD_W - 24, y + 4, `‹  ${r.show(r.value)}  ›`, { fontStyle: sel ? 'bold' : 'normal' }, 1);
      }
      y += rowH;
    });
    // сводка заказа
    const type = MISSION_TYPES[d.type], target = TARGETS[d.target], diff = DIFFICULTIES[d.difficulty];
    y += 12;
    const err = this.boardCheck(d);
    const summary = [
      `${type.name}: ${type.desc.toLowerCase()}.`,
      `Target: ${target.name}   Δv ≈ ${target.dv} km/s   transfer ≈ ${target.travel} days`,
      `Mission cargo: ${type.cargo.join(', ')}`,
      '',
      `${diff.name}: ${diff.desc}`,
      `Max score: ${Math.round(BASE_SCORE * diff.mult)} pts  (×${diff.mult})`,
    ];
    const st = add(16, y, summary.join('\n'), { fontSize: '12px', lineSpacing: 4, wordWrap: { width: BOARD_W - 32 } });
    y += st.height + 6;
    if (err) {
      const t = add(16, y, '⚠ ' + err, { color: '#ffb35c', fontSize: '12px', wordWrap: { width: BOARD_W - 32 } });
      y += t.height + 6;
    } else if (w.flash) w.flash = null;
    const ft = add(16, y, `↑↓ — row   ←→ — value   ${use} — select`, { color: '#6f79ad', fontSize: '11px' });
    y += ft.height + 10;

    this.redrawBoardBg(w, rows, y, col);

    const c = proj((w.st.l + w.st.r) / 2, w.st.b, w.st.h);
    const pos = this.placeWindow(w.st, BOARD_W, y);
    w.c.setPosition(pos.x, pos.y);
  }

  // Фон доски и подсветка строк (отдельно, чтобы фон был под ними)
  redrawBoardBg(w, rows, totalH, col) {
    const g = w.bg;
    g.clear();
    g.fillStyle(0x0f1430, 0.97).fillRoundedRect(0, 0, BOARD_W, totalH, 10);
    g.lineStyle(2, 0x9aa3cf, 1).strokeRoundedRect(0, 0, BOARD_W, totalH, 10);
    let y = 40;
    const rowH = 30;
    rows.forEach((r, i) => {
      const sel = i === w.sel;
      if (r.button) {
        if (i === rows.length - 2) y += 6;
        const bw = r.key === 'close' ? 120 : 200;
        const bx = r.key === 'close' ? BOARD_W - 16 - bw : 16;
        if (r.key === 'close') y -= rowH;
        g.fillStyle(sel ? col : 0x2a3266, 1).fillRoundedRect(bx, y, bw, rowH - 4, 6);
      } else if (sel) {
        g.fillStyle(0x1d2550, 1).fillRoundedRect(10, y - 2, BOARD_W - 20, rowH - 2, 6);
        g.lineStyle(2, col, 1).strokeRoundedRect(10, y - 2, BOARD_W - 20, rowH - 2, 6);
      }
      y += rowH;
    });
    const sepY = y + 4;
    g.lineStyle(1, 0x3a4170, 1).lineBetween(16, sepY, BOARD_W - 16, sepY);
  }

  // Строка активного заказа в углу экрана
  updateOrderHud() {
    if (!this.orderHud) {
      this.orderHud = this.add.text(1264, 10, '', {
        color: '#8be08b', fontSize: '13px', align: 'right', backgroundColor: '#0f1430cc', padding: { x: 8, y: 4 },
      }).setOrigin(1, 0).setDepth(10000);
    }
    const o = this.order;
    this.orderHud.setText(`Order: ${MISSION_TYPES[o.type].name} · ${TARGETS[o.target].name} · ` +
      `${DURATIONS[o.duration]} days · ${DIFFICULTIES[o.difficulty].name}`);
  }

  // ── Окна станций ───────────────────────────────────────────────────────
  // Окно ложится поверх самой станции и «вытекает» наружу карты (вверх у верхней стены,
  // вниз у нижней, в стороны у боковых), чтобы не закрывать игровое поле другим игрокам.
  stationBox(st) {
    const r = st.hit || st, h = r.h !== undefined ? r.h : st.h;
    const pts = [];
    for (const [x, y] of [[r.l, r.t], [r.r, r.t], [r.r, r.b], [r.l, r.b]]) for (const z of [0, h || 0]) pts.push(proj(x, y, z));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
  }

  placeWindow(st, w, h) {
    const bb = this.stationBox(st), r = st.hit || st;
    let x = (bb.l + bb.r) / 2 - w / 2, y = (bb.t + bb.b) / 2 - h / 2;
    if (r.t <= ty(1.5)) y = bb.b - h;            // у верхней стены — растём вверх
    else if (r.b >= ty(13.5)) y = bb.t;          // у нижней — вниз
    else if (r.l <= tx(3.5)) x = bb.r - w;       // у левой — влево
    else if (r.r >= tx(26.5)) x = bb.l;          // у правой — вправо
    return { x: Phaser.Math.Clamp(x, 4, 1276 - w), y: Phaser.Math.Clamp(y, 44, 716 - h) };
  }

  // Не даём окнам разных игроков перекрывать друг друга: сдвигаем новое вверх/вниз/вбок
  avoidWindows(w, pos, W, H) {
    const others = this.players.map((p) => p.win).filter((o) => o && o !== w && o.pos && o.H);
    const hit = (x, y) => others.find((o) => x < o.pos.x + o.W + 4 && x + W + 4 > o.pos.x && y < o.pos.y + o.H + 4 && y + H + 4 > o.pos.y);
    const ok = (x, y) => x >= 4 && y >= 44 && x + W <= 1276 && y + H <= 716 && !hit(x, y);
    if (!hit(pos.x, pos.y)) return pos;
    const o = hit(pos.x, pos.y);
    const cands = [[pos.x, o.pos.y + o.H + 6], [pos.x, o.pos.y - H - 6], [o.pos.x - W - 6, pos.y], [o.pos.x + o.W + 6, pos.y]];
    for (const [x, y] of cands) if (ok(x, y)) return { x, y };
    return pos;
  }

  openPanel(pl, st) {
    const c = this.add.container(0, 0).setDepth(21000);
    const w = { kind: 'panel', pl, st, c, sel: 0, scroll: 0, sig: '' };
    pl.win = w; st.user = pl;
    pl.body.body.setVelocity(0, 0);
    this.refreshPanel(w);
  }

  closeWindow(pl) {
    if (!pl.win) return;
    if (pl.win.sticky) pl.win.sticky.destroy();
    if (pl.win.cc) pl.win.cc.destroy();
    pl.win.c.destroy();
    if (pl.win.st && pl.win.st.user === pl) pl.win.st.user = null;
    pl.win = null;
  }

  // Содержимое окна для каждой станции. Типы строк:
  //   item    — компактный пункт списка (каталоги, склады)
  //   pick    — большой переключатель ◄ значение ► (подпись сверху, E — действие, если есть)
  //   toggle  — пункт-флажок (детали, автоматы)
  //   tiles   — ряд плиток (защёлки люка)
  //   dial    — барабаны набора числа
  //   primary — большая главная кнопка; проверки открываются отдельным окном (openCheck)
  // Закрыть окно — крестик ✕ в заголовке (↑ с первой строки).
  panelSpec(w) {
    const st = w.st, pl = w.pl, diff = this.difficulty(), held = pl.carrying;
    const ord = this.order;
    const spec = { title: st.name, info: [], rows: [], sticky: null, width: 230 };
    const ok = '#8be08b';

    switch (st.kind) {
      case 'catalog': { // Instrument Shelf — 32 прибора из каталога
        spec.width = 300;
        const req = new Set((this.tickets || []).flatMap((t) => t.needs));
        spec.rows = INSTRUMENTS.map((ins) => {
          const tag = diff === 0 && this.tickets ? (req.has(ins.id) ? '  ★' : '') : '';
          return {
            label: `${ins.id}  ${ins.name}${tag}`, right: ins.stock === 0 ? 'taken' : `${ins.mass} kg ${ins.power}p`,
            color: diff === 0 ? CAT_COLORS[ins.cat] : null, disabled: ins.stock === 0,
            act: () => {
              if (pl.carrying) { this.floatText(st, 'Hands are full'); return; }
              if (ins.stock === 0) return;
              ins.stock = 0;
              this.giveItem(pl, { name: ins.name, mass: ins.mass, code: ins.id, type: 'instrument',
                color: 0xb98ae8, ref: Object.assign(ins, { station: 'shelf' }) });
              this.closeWindow(pl);
            },
            detail: ins,
          };
        });
        const d = w.sel >= 0 && spec.rows[Math.min(w.sel, spec.rows.length - 1)].detail;
        if (d) {
          spec.info = [`${d.id} — ${d.name}`, d.purpose, `Mass ${d.mass} kg · power ${d.power}u · ${d.roles}`, `Real analog: ${d.analog}`];
          if (this.tickets && diff === 0) {
            const hits = this.tickets.filter((t) => t.needs.includes(d.id)).map((t) => t.id);
            spec.info.push(hits.length ? `Ticket: ${hits.join(', ')}` : 'Not requested by current tickets');
          }
          if (diff === 0) spec.info.push(`Category: ${d.cat}`);
        }
        spec.visibleRows = 8;
        break;
      }
      case 'science': { // Lab Console — научные тикеты заказа
        spec.width = 270;
        if (!this.tickets) spec.info = ['No order yet.', 'Place an order at the Order Screen.'];
        else {
          const used = new Set(this.packedInstruments().map((it) => it.code));
          const mass = [...used].reduce((a, id) => a + INSTRUMENT_BY_ID[id].mass, 0);
          spec.info = this.tickets.map((t) => `${this.ticketReady(t) ? '✓' : '•'} ${t.id} ${t.name}` +
            (diff === 0 ? `  [${t.needs.join('+')}]` : ''));
          if (diff <= 1) spec.info.push('', `Science payload: ${Math.round(mass * 10) / 10}/${SCIENCE_CAPACITY} kg${mass > SCIENCE_CAPACITY ? '  ⚠ over capacity' : ''}`);
          const calib = this.packedInstruments().filter((it) => !it.calibrated).map((it) => it.code);
          if (calib.length && diff <= 1) spec.info.push(`Not calibrated: ${calib.join(', ')}`);
        }
        break;
      }
      case 'calibrate': { // P02 — Analyzer: эталон + юстировка, проверка отдельным окном
        spec.width = 250;
        if (!held || held.type !== 'instrument') {
          spec.info = ['P02 · Calibrate a science payload', 'Bring an instrument case from the', 'Instrument Shelf and open the bench.'];
        } else if (held.calibrated) {
          spec.info = [`${held.code} ${held.name}`, `CALIBRATED ✓ · quality ${held.calQuality}`];
        } else {
          w.reading = w.reading ?? 50; w.ref = w.ref ?? 0;
          const need = CAL_CLASS(held.code);
          spec.info = [`${held.code} ${held.name}`, `Target signal: ${held.calRef}`];
          if (diff === 0) spec.info.push(`Needs: ${CAL_REFS[need]}`);
          spec.rows = [
            { kind: 'pick', cap: 'Reference standard', label: CAL_REFS[w.ref], adjust: (s2) => { w.ref = (w.ref + s2 + CAL_REFS.length) % CAL_REFS.length; } },
            { kind: 'pick', cap: 'Align signal · hold ◄► to sweep', label: `${w.reading}`, bar: w.reading / 99, mark: held.calRef / 99, repeat: true,
              adjust: (s2) => { w.reading = Phaser.Math.Clamp(w.reading + s2, 0, 99); } },
            { kind: 'primary', label: 'VERIFY', act: () => {
              const q = Math.max(0, 100 - Math.abs(w.reading - held.calRef) * 8);
              this.openCheck(w, 'Calibration check', [
                { t: `Reference: ${CAL_REFS[w.ref]}`, ok: w.ref === need, why: `WRONG REFERENCE — needs ${CAL_REFS[need]}` },
                { t: `Signal ${w.reading} → target ${held.calRef}`, ok: q >= 50, why: `Off by ${w.reading - held.calRef}` },
                { t: `Quality ${q} / 100 (pass ≥ 50)`, ok: q >= 50 },
              ], { generic: 'Verification failed', pass: () => { held.calibrated = true; held.calQuality = q; } });
            } },
          ];
        }
        break;
      }
      case 'workbench': { // P04 — сборка ремкомплекта по рецепту
        spec.width = 260;
        w.job = w.job ?? 0; w.tool = w.tool ?? 0; w.torque = w.torque ?? 10; w.parts = w.parts || new Set();
        const rec = KIT_RECIPES[w.job];
        const done = this.prep.kits.includes(rec.id);
        spec.info = ['P04 · Assemble fault-specific spare kit'];
        if (diff === 0) spec.info.push(`Parts: ${rec.parts.join(', ')}`, `Tool: ${rec.tool}${rec.torque ? ` · ${rec.torque[0]}–${rec.torque[1]} N·m` : ''}`);
        else if (rec.torque && diff <= 2) spec.info.push(`Torque spec: ${rec.torque[0]}–${rec.torque[1]} N·m`);
        spec.rows = [{ kind: 'pick', cap: 'Repair job', label: rec.id === 'ELEC' ? 'ELECTRICAL' : 'PRESSURE SEAL', right: done ? 'built ✓' : '',
          adjust: () => { w.job = 1 - w.job; w.parts = new Set(); } }];
        for (const b of rec.bins) spec.rows.push({ kind: 'toggle', label: b, on: w.parts.has(b), act: () => { w.parts.has(b) ? w.parts.delete(b) : w.parts.add(b); } });
        spec.rows.push({ kind: 'pick', cap: 'Tool', label: KIT_TOOLS[w.tool], adjust: (s2) => { w.tool = (w.tool + s2 + KIT_TOOLS.length) % KIT_TOOLS.length; } });
        if (rec.torque) spec.rows.push({ kind: 'pick', cap: 'Torque', label: `${w.torque} N·m`, bar: w.torque / 40, repeat: true,
          adjust: (s2) => { w.torque = Phaser.Math.Clamp(w.torque + s2, 0, 40); } });
        spec.rows.push({ kind: 'primary', label: done ? 'KIT BUILT ✓' : 'ASSEMBLE + INSPECT', disabled: done, act: () => {
          if (pl.carrying) { this.floatText(st, 'Hands are full'); return; }
          const want = new Set(rec.parts);
          const wrong = [...w.parts].filter((p) => !want.has(p)), missing = rec.parts.filter((p) => !w.parts.has(p));
          const checks = [
            { t: `Parts: ${w.parts.size} selected`, ok: !missing.length, why: missing.length ? `NEED ITEM: ${missing[0]}` : '' },
            { t: 'No foreign parts', ok: !wrong.length, why: wrong.length ? `WRONG PART: ${wrong[0]}` : '' },
            { t: `Tool: ${KIT_TOOLS[w.tool]}`, ok: KIT_TOOLS[w.tool] === rec.tool, why: `WRONG TOOL — use ${rec.tool}` },
          ];
          if (rec.torque) checks.push({ t: `Torque ${w.torque} N·m`, ok: w.torque >= rec.torque[0] && w.torque <= rec.torque[1], why: 'Torque out of range' });
          this.openCheck(w, 'Kit inspection', checks, { generic: 'Inspection failed',
            pass: () => {
              this.prep.kits.push(rec.id);
              this.giveItem(pl, { name: rec.name, mass: rec.mass, code: rec.id === 'ELEC' ? 'KIT-E' : 'KIT-P', type: 'kit', color: 0xe57373 });
            },
            done: () => { this.floatText(st, `${rec.name} ✓ — pack it into the cargo`, ok); this.closeWindow(pl); } });
        } });
        break;
      }
      case 'power': { // P05 — Fuel Cells: проверка электросистем
        spec.width = 240;
        const P = this.prep.power;
        const load = BREAKERS.filter((b) => P.on[b.id]).reduce((a, b) => a + b.load, 0);
        spec.info = ['P05 · Prelaunch electrical check', diff <= 1 ? `Voltage: ${P.on.MASTER ? '28.0 V' : '0.0 V'} · load ${load}/${POWER_AVAILABLE} u` : `Voltage: ${P.on.MASTER ? '28.0 V' : '0.0 V'}`];
        if (diff === 0) spec.info.push('Order: MASTER → AVIONICS → LIFE SUPPORT;', 'leave nonessential loads off.');
        spec.rows = BREAKERS.map((b) => ({ kind: 'toggle', label: b.name, on: !!P.on[b.id], right: b.load ? `${b.load}u` : '',
          act: () => {
            P.ready = false;
            if (!P.on[b.id]) {
              const idx = POWER_ORDER.indexOf(b.id), done2 = POWER_ORDER.filter((id) => P.on[id]).length;
              if (idx >= 0 && idx !== done2) { // не по порядку — чек-лист сбрасывается
                for (const id of Object.keys(P.on)) P.on[id] = false;
                this.mistake(st, diff === 0 ? 'Out of order — checklist reset' : 'Checklist reset'); return;
              }
              if (!P.on.MASTER && b.id !== 'MASTER') { this.mistake(st, 'NEED POWER — battery master is off'); return; }
              P.on[b.id] = true;
              const l2 = BREAKERS.filter((x) => P.on[x.id]).reduce((a, x) => a + x.load, 0);
              if (l2 > POWER_AVAILABLE) { P.on[b.id] = false; this.mistake(st, `OVERLOAD — ${b.name} tripped`); }
            } else P.on[b.id] = false;
          } }));
        spec.rows.push({ kind: 'primary', label: P.ready ? 'POWER READY ✓' : 'SELF-TEST', disabled: P.ready, act: () => {
          const checks = POWER_ORDER.map((id) => ({ t: BREAKERS.find((b) => b.id === id).name, ok: !!P.on[id], why: `FAULT: ${id}` }));
          checks.push({ t: `Load ${load} / ${POWER_AVAILABLE} u`, ok: load <= POWER_AVAILABLE, why: 'FAULT: overload' });
          this.openCheck(w, 'Electrical self-test', checks, { generic: 'Self-test failed', pass: () => { P.ready = true; } });
        } });
        break;
      }
      case 'scale': { // P03 — весы: манифест и утверждение
        spec.width = 250;
        const its = this.itemsOnScale(), m = this.loadedMass();
        const groups = {};
        for (const it of its) { const g = this.cargoGroup(it); groups[g] = (groups[g] || 0) + it.mass; }
        spec.info = ['P03 · Launch mass & packing', ...Object.entries(groups).map(([g, v]) => `${g}: ${v} kg`)];
        if (!its.length) spec.info.push('(no cargo in the zone)');
        spec.info.push(diff <= 1 ? `Cargo: ${m} / ${MAX_CARGO_KG} kg${m > MAX_CARGO_KG ? ' ⚠ OVERLOAD' : ''}` : `Cargo: ${m} kg`);
        if (diff <= 1) { const dead = its.filter((it) => this.deadMass(it)); if (dead.length) spec.info.push(`Dead mass: ${dead.map((it) => it.code).join(', ')}`); }
        spec.info.push(`Display: ${this.scaleReading().toFixed(1)} kg`);
        const appr = this.manifestApproved();
        spec.rows = [{ kind: 'primary', label: appr ? 'MANIFEST APPROVED ✓' : 'APPROVE MANIFEST', disabled: appr, act: () => {
          this.openCheck(w, 'Manifest check', [
            { t: `Cargo items: ${its.length}`, ok: its.length > 0, why: 'Nothing to approve' },
            { t: diff <= 1 ? `Mass ${m} / ${MAX_CARGO_KG} kg` : `Mass ${m} kg`, ok: m <= MAX_CARGO_KG, why: `Overload: ${m} > ${MAX_CARGO_KG} kg` },
          ], { generic: 'Manifest rejected', pass: () => { this.prep.manifest = this.cargoSignature(); } });
        } }];
        break;
      }
      case 'planning': { // P06 — выбор маршрута: две карточки
        spec.width = 300;
        const t = this.orderTarget();
        w.route = w.route ?? (this.prep.route ?? 1);
        spec.info = ['P06 · Select transfer route', `Target: ${t.name}${ord ? '' : ' (no order yet)'}`];
        const committed = this.prep.route === w.route;
        spec.rows = [
          { kind: 'routes', cur: w.route, committed: this.prep.route, cards: ROUTES.map((r) => ({
            name: r.name, days: Math.round(t.travel * r.timeMul), dv: (t.dv * r.dvMul).toFixed(1), need: r.need })),
          adjust: () => { w.route = 1 - w.route; } },
          { kind: 'primary', label: committed ? `${ROUTES[w.route].name} COMMITTED ✓` : 'CONFIRM ROUTE', disabled: committed,
            act: () => { this.prep.route = w.route; this.floatText(st, `${ROUTES[w.route].name} committed`, ok); } },
        ];
        break;
      }
      case 'fuel': { // P07 — заправка: картридж, барабаны, одна кнопка по шагам
        spec.width = 250;
        const F = this.prep.fuel;
        const req = this.prep.route === null ? null : this.requiredFuel();
        spec.info = ['P07 · Load propellant', `Valve ${F.valve ? 'OPEN' : 'CLOSED'} · ${F.coupled ? 'coupled' : 'not coupled'}`];
        if (req === null && diff <= 1) spec.info.push('Select a route first (Mission Planning).');
        w.cart = w.cart ?? 0; w.digits = w.digits || [0, 0, 0, 0]; w.dc = w.dc ?? 0;
        const dialValue = Number(w.digits.join(''));
        let main;
        if (!F.coupled) main = { label: 'COUPLE + LOCK', act: () => {
          const c = FUEL_CARTRIDGES[w.cart];
          if (!c.ok) { this.mistake(st, diff === 0 ? c.why : 'Cannot connect'); return; }
          F.coupled = true;
        } };
        else if (this.mission.fuelOk && dialValue === F.loaded && !F.valve) main = { label: 'PROPELLANT VERIFIED ✓', disabled: true };
        else if (F.valve && dialValue === F.loaded) main = { label: 'CLOSE VALVE + VERIFY', act: () => {
          F.valve = false;
          this.openCheck(w, 'Propellant check', [
            { t: `Cartridge: ${FUEL_CARTRIDGES[w.cart].name}`, ok: true },
            { t: 'Route committed', ok: req !== null, why: 'No route committed' },
            { t: diff === 0 && req !== null ? `Loaded ${F.loaded} kg · need ${req}` : `Loaded ${F.loaded} kg`,
              ok: req !== null && Math.abs(F.loaded - req) <= Math.max(2, req * 0.01), why: `Need ${req} kg, loaded ${F.loaded}` },
            { t: 'Valve closed, no leak', ok: true },
          ], { generic: 'Propellant check failed', pass: () => { this.mission.fuelOk = true; this.mission.fuelValue = F.loaded; } });
        } };
        else main = { label: F.valve ? `PUMP TO ${dialValue} kg` : `OPEN VALVE · PUMP ${dialValue} kg`, act: () => {
          F.valve = true; F.loaded = dialValue; this.mission.fuelOk = false;
        } };
        spec.rows = [
          { kind: 'pick', cap: 'Cartridge', label: FUEL_CARTRIDGES[w.cart].name, right: F.coupled ? 'locked ✓' : '',
            adjust: (s2) => { if (F.coupled) return; w.cart = (w.cart + s2 + 3) % 3; } },
          { kind: 'dial', dial: { digits: w.digits, cursor: w.dc, edit: !!w.dialEdit, loaded: F.loaded, cap: 2000 }, act: () => { w.dialEdit = true; } },
          Object.assign({ kind: 'primary' }, main),
        ];
        break;
      }
      case 'o2': case 'supply': { // P08 — расходники
        spec.width = 250;
        spec.info = ['P08 · Pack consumables'];
        spec.rows = CONSUMABLES[st.kind].map((d) => ({
          label: d.name, right: `${d.mass} kg ×${d.stock}`, disabled: d.stock === 0,
          act: () => {
            if (pl.carrying) { this.floatText(st, 'Hands are full'); return; }
            if (d.stock === 0) return;
            d.stock -= 1;
            this.giveItem(pl, { name: d.name, mass: d.mass, code: d.id, type: d.kind, bad: d.bad, color: d.bad ? 0x9aa08a : 0x9ed36a,
              ref: Object.assign(d, { station: st.id }) });
            this.closeWindow(pl);
          } }));
        if (st.kind === 'supply') { // чек-лист расходников и FINALIZE — на Supply Rack
          const need = this.prep.route === null ? null : ROUTES[this.prep.route].need;
          const have = this.consumablesInCargo();
          if (diff <= 1) spec.info.push(need ? `O2 ${have.o2}/${need.o2} · water ${have.water}/${need.water} · food ${have.food}/${need.food}` : 'Route not selected — needs unknown');
          if (diff <= 1 && have.bad.length) spec.info.push(`⚠ In cargo: ${have.bad.join(', ')}`);
          const fin = !!this.prep.consumables && this.prep.consumables === this.cargoSignature();
          spec.rows.push({ kind: 'primary', label: fin ? 'FINALIZED ✓' : 'FINALIZE', disabled: fin, act: () => {
            const n2 = (k2, name) => ({ t: diff <= 1 && need ? `${name}: ${have[k2]} / ${need[k2]}` : `${name}: ${have[k2]}`,
              ok: !!need && have[k2] >= need[k2], why: `Short: ${name}` });
            this.openCheck(w, 'Consumables check', [
              { t: 'Route selected', ok: !!need, why: 'Select a route first' },
              n2('o2', 'O2 cylinders'), n2('water', 'Water'), n2('food', 'Food'),
              { t: 'No expired / waste items', ok: !have.bad.length, why: `Remove: ${have.bad[0]}` },
            ], { generic: 'Supplies below minimum', pass: () => { this.prep.consumables = this.cargoSignature(); } });
          } });
        }
        break;
      }
      case 'hatch': { // P09 — гермолюк
        spec.width = 240;
        const H = this.prep.hatch;
        spec.info = ['P09 · Seal pressure hatch', `State: ${H.state}${H.gasketClean ? '' : ' · gasket: debris on seal lip'}`];
        if (H.state === 'OPEN') {
          spec.rows = [
            { kind: 'toggle', label: 'Gasket inspected + cleaned', on: H.gasketClean, act: () => { H.gasketClean = true; } },
            { kind: 'primary', label: 'TURN WHEEL → CLOSED', act: () => { H.state = 'CLOSED'; H.latched = []; } },
          ];
        } else if (H.state === 'CLOSED') {
          w.latch = w.latch ?? 0;
          if (diff <= 1) spec.info.push(`Latch sequence: ${H.order.join(' → ')}`);
          spec.rows = [
            { kind: 'tiles', cap: 'Engage latches in sequence', cur: w.latch,
              tiles: [1, 2, 3].map((n) => ({ label: `LATCH ${n}`, done: H.latched.includes(n) })),
              adjust: (s2) => { w.latch = (w.latch + s2 + 3) % 3; },
              act: () => {
                const n = w.latch + 1;
                if (H.latched.includes(n)) return;
                if (H.order[H.latched.length] !== n) { H.latched = []; this.mistake(st, diff === 0 ? `Wrong latch — sequence ${H.order.join('→')}` : 'Latch sequence reset'); return; }
                H.latched.push(n);
                if (H.latched.length === 3) { H.state = 'LATCHED'; w.sel = 0; }
              } },
            { label: 'Reopen wheel', act: () => { H.state = 'OPEN'; H.latched = []; } },
          ];
        } else if (H.state === 'LATCHED') {
          spec.rows = [{ kind: 'primary', label: 'PRESSURE CHECK', act: () => {
            this.openCheck(w, 'Pressure decay test', [
              { t: 'Wheel closed', ok: true },
              { t: `Latches ${H.order.join('-')} engaged`, ok: true },
              { t: 'Gasket seal holds 101 kPa', ok: H.gasketClean, why: 'Pressure drop — reseat the gasket' },
            ], { generic: 'Pressure check failed',
              pass: () => { H.state = 'VERIFIED'; },
              fail: () => { H.state = 'OPEN'; H.latched = []; } });
          } }];
        } else spec.info.push('Hatch VERIFIED ✓');
        break;
      }
      case 'suits': { // P10 — подготовка скафандров
        spec.width = 260;
        w.suit = w.suit ?? 0; w.bat = w.bat ?? 0; w.co2 = w.co2 ?? 0;
        const S = this.prep.suits[w.suit];
        const ready = this.prep.suits.filter((x) => x.ready).length;
        spec.info = ['P10 · Prepare EVA suits', `EVA READY: ${ready}/${SUITS_NEEDED}`];
        spec.rows = [
          { kind: 'pick', cap: 'Suit', label: SUIT_IDS[w.suit], right: S.ready ? 'READY ✓' : '', adjust: (s2) => { w.suit = (w.suit + s2 + 4) % 4; } },
          { kind: 'toggle', label: `O2 hose locked + filled (${S.o2}%)`, on: S.o2 >= 100, act: () => { S.o2 = 100; } },
          { kind: 'pick', cap: `Battery · ${diff >= 2 ? '' : 'E installs'}`, label: ['Charged module', 'Empty module'][w.bat], right: S.battery ? 'installed ✓' : '',
            adjust: () => { w.bat = 1 - w.bat; },
            act: () => { if (w.bat) { S.battery = false; this.mistake(st, diff === 0 ? 'Battery is empty' : 'Install failed'); } else S.battery = true; } },
          { kind: 'pick', cap: `CO2 cartridge · ${diff >= 2 ? '' : 'E installs'}`, label: ['Approved', 'Expired'][w.co2], right: S.co2 ? 'installed ✓' : '',
            adjust: () => { w.co2 = 1 - w.co2; },
            act: () => { if (w.co2) { S.co2 = false; this.mistake(st, diff === 0 ? 'Cartridge expired' : 'Install failed'); } else S.co2 = true; } },
          { kind: 'primary', label: S.ready ? `${SUIT_IDS[w.suit]} READY ✓` : 'LEAK TEST', disabled: S.ready, act: () => {
            this.openCheck(w, `${SUIT_IDS[w.suit]} leak test`, [
              { t: `O2 ${S.o2}% (setpoint 100%)`, ok: S.o2 >= 100, why: 'O2 below setpoint' },
              { t: 'Battery module', ok: S.battery, why: 'NEED battery' },
              { t: 'CO2 scrubber cartridge', ok: S.co2, why: 'NEED CO2 cartridge' },
              { t: 'Suit holds pressure', ok: S.o2 >= 100 && S.battery && S.co2 },
            ], { generic: 'Suit test failed', pass: () => { S.ready = true; } });
          } },
        ];
        break;
      }
      case 'engine': { // Launch Control — стартовые ворота P01–P10 (проверка отдельным окном)
        spec.width = 260;
        const g = this.prepGates();
        spec.info = diff <= 1 ? g.map((x) => `${x.ok ? '✓' : x.gate ? '✗' : '•'} ${x.id} ${x.text}`) : ['Pre-launch checklist: on you.'];
        const blocked = g.filter((x) => x.gate && !x.ok);
        spec.rows = [{ kind: 'primary', label: '🚀 LAUNCH', act: () => {
          this.openCheck(w, 'Go / No-Go poll', g.filter((x) => x.gate).map((x) => ({ t: `${x.id} ${x.text}`, ok: x.ok, why: `Blocked: ${x.id} ${x.text}` })),
            { generic: 'Launch blocked', free: diff <= 1, done: () => this.launch() });
        } }];
        break;
      }
    }
    spec.sticky = this.stickyFor(st.kind);
    return spec;
  }

  // Отдельное окно проверки: строки появляются по очереди, внизу PASS / FAIL.
  // Последствия (pass/fail/ошибка) применяются сразу; done — после закрытия окна при успехе.
  openCheck(w, title, checks, opt = {}) {
    const diff = this.difficulty();
    const pass = checks.every((c) => c.ok);
    w.check = { title, checks, pass, t0: this.time.now, hide: diff >= 2, done: pass ? opt.done : null };
    if (pass) { if (opt.pass) opt.pass(); }
    else {
      if (opt.fail) opt.fail();
      if (!opt.free) { const f = checks.find((c) => !c.ok); this.mistake(w.st, diff === 0 ? (f.why || f.t) : (opt.generic || 'Check failed'), true); }
    }
  }

  drawCheck(w, pos, W) {
    const C = w.check, step = 260;
    const shown = Math.min(C.checks.length, Math.floor((this.time.now - C.t0) / step));
    const finished = shown >= C.checks.length;
    const sig = JSON.stringify([shown, finished]);
    if (w.cc && w.ccSig === sig) return;
    if (w.cc) w.cc.destroy();
    w.ccSig = sig;
    const cc = this.add.container(pos.x + 14, pos.y + 26).setDepth(21003);
    w.cc = cc;
    const CW = Math.max(W - 28, 236), gb = this.add.graphics(), g = this.add.graphics();
    cc.add([gb, g]);
    const txt = (x, y, s, st = {}, ox = 0) => { const t = this.add.text(x, y, s, { color: '#e6e9ff', fontSize: '12px', ...st }).setOrigin(ox, 0); cc.add(t); return t; };
    const col = ROLES[w.st.role].color;
    let y = 0;
    g.fillStyle(col, 1).fillRoundedRect(0, 0, CW, 28, { tl: 8, tr: 8, bl: 0, br: 0 });
    txt(12, 6, '🔍 ' + C.title, { fontSize: '13px', fontStyle: 'bold', color: '#ffffff' });
    y = 36;
    C.checks.forEach((c, i) => {
      if (i > shown) return;
      if (i === shown) { txt(14, y, '… checking', { color: '#8c96c8', fontSize: '11px' }); y += 22; return; }
      const mark = C.hide ? '•' : c.ok ? '✓' : '✗', mc = C.hide ? '#8c96c8' : c.ok ? '#8be08b' : '#ff7a7a';
      g.fillStyle(0xffffff, 0.04).fillRoundedRect(8, y - 3, CW - 16, 22, 4);
      txt(16, y, mark, { color: mc, fontStyle: 'bold', fontSize: '13px' });
      txt(36, y + 1, c.t, { fontSize: '11.5px', wordWrap: { width: CW - 48 } });
      y += 25;
    });
    if (finished) {
      y += 4;
      g.fillStyle(C.pass ? 0x2f8f4e : 0xb03a3a, 1).fillRoundedRect(8, y, CW - 16, 34, 6);
      txt(CW / 2, y + 7, C.pass ? 'PASS ✓' : 'FAIL ✗', { fontSize: '16px', fontStyle: 'bold', color: '#ffffff' }, 0.5);
      y += 42;
      txt(CW / 2, y, `${w.pl.cfg.useName} — continue`, { color: '#8c96c8', fontSize: '10.5px' }, 0.5);
      y += 18;
    } else y += 6;
    gb.fillStyle(0x0b1028, 0.98).fillRoundedRect(0, 28, CW, y - 28, { tl: 0, tr: 0, bl: 8, br: 8 });
    g.lineStyle(2, finished ? (C.pass ? 0x5fd17f : 0xff7a7a) : col, 1).strokeRoundedRect(0, 0, CW, y, 8);
    const cy = Phaser.Math.Clamp(pos.y + 26, 44, 716 - y);
    cc.setPosition(Phaser.Math.Clamp(pos.x + 14, 4, 1276 - CW), cy);
  }

  launch() {
    this.mission.launched = true;
    for (const p of this.players) this.closeWindow(p);
    const tk = this.tickets || [];
    const total = tk.reduce((a, t) => a + t.pts, 0) || 1;
    // научные баллы: готовые тикеты × качество калибровки их приборов
    let got = 0;
    for (const t of tk) {
      if (!this.ticketReady(t)) continue;
      const qs = t.needs.map((id) => { const it = this.packedInstruments().find((x) => x.code === id); return it && it.calibrated ? it.calQuality : 40; });
      got += t.pts * (qs.reduce((a, q) => a + q, 0) / qs.length) / 100;
    }
    const g = this.prepGates();
    const bonus = (g.find((x) => x.id === 'P04').ok ? 0.05 : 0) + (g.find((x) => x.id === 'P10').ok ? 0.05 : 0);
    const mult = DIFFICULTIES[this.difficulty()].mult, max = Math.round(BASE_SCORE * mult);
    const score = Math.max(0, Math.min(max, Math.round(max * (0.9 * got / total + bonus) - (this.mistakes || 0) * 25 * mult)));
    this.banner.setText(`Launch!\nScience ${Math.round(got)}/${total} pts · mistakes ${this.mistakes || 0}\nScore: ${score} / ${max}`).setVisible(true);
  }

  // Кодовый «циферблат» из барабанов + шкала бака (Fuel Port)
  drawDial(w, d, g, add, y, W, col) {
    const n = d.digits.length, cw = 32, ch = 58, gap = 6, x0 = 12, top = y + 4;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (cw + gap), sel = d.edit && i === d.cursor;
      g.fillStyle(0x070a16, 1).fillRoundedRect(x, top, cw, ch, 6);
      g.fillStyle(0xffffff, 0.06).fillRect(x + 2, top + ch / 2 - 13, cw - 4, 26);  // окошко барабана
      g.lineStyle(sel ? 2 : 1, sel ? col : 0x2a3266, 1).strokeRoundedRect(x, top, cw, ch, 6);
      const v = d.digits[i];
      add(x + cw / 2, top + 3, String((v + 9) % 10), { color: '#5c6699', fontSize: '11px', wordWrap: null }, 0.5);
      add(x + cw / 2, top + ch / 2 - 13, String(v), { color: '#ffcf5a', fontSize: '22px', fontStyle: 'bold', fontFamily: 'Consolas, monospace', wordWrap: null }, 0.5);
      add(x + cw / 2, top + ch - 15, String((v + 1) % 10), { color: '#5c6699', fontSize: '11px', wordWrap: null }, 0.5);
      if (sel && d.edit) {
        g.fillStyle(col, 1).fillTriangle(x + cw / 2 - 5, top - 2, x + cw / 2 + 5, top - 2, x + cw / 2, top - 8);
        g.fillTriangle(x + cw / 2 - 5, top + ch + 2, x + cw / 2 + 5, top + ch + 2, x + cw / 2, top + ch + 8);
      }
    }
    const kx = x0 + n * (cw + gap);
    add(kx, top + ch / 2 - 7, 'kg', { color: '#ffcf5a', fontSize: '12px', fontStyle: 'bold', wordWrap: null });
    // шкала бака
    const gx = W - 40, gw = 24, frac = Phaser.Math.Clamp(w.gauge / d.cap, 0, 1);
    g.fillStyle(0x070a16, 1).fillRoundedRect(gx, top, gw, ch, 5);
    g.fillStyle(0x3fa7e0, 1).fillRoundedRect(gx + 3, top + 3 + (ch - 6) * (1 - frac), gw - 6, (ch - 6) * frac, 3);
    for (let k2 = 1; k2 < 4; k2++) g.lineStyle(1, 0x5c6699, 0.8).lineBetween(gx + gw - 6, top + (ch * k2) / 4, gx + gw, top + (ch * k2) / 4);
    g.lineStyle(1.5, 0x2a3266, 1).strokeRoundedRect(gx, top, gw, ch, 5);
    add(gx + gw / 2, top + ch + 3, `${Math.round(w.gauge)} kg`, { color: '#8c96c8', fontSize: '10px', wordWrap: null }, 0.5);
    return top + ch + 20;
  }

  panelInput(pl, pressed) {
    const w = pl.win, k = pl.keys, spec = w.spec;
    if (w.check) { // окно проверки: E — показать всё / закрыть
      if (pressed(k.use)) {
        if (this.time.now - w.check.t0 < w.check.checks.length * 260) w.check.t0 = -1e9;
        else {
          const done = w.check.done;
          w.check = null;
          if (w.cc) { w.cc.destroy(); w.cc = null; }
          if (done) done();
        }
      }
      if (pl.win === w) this.refreshPanel(w);
      return;
    }
    if (w.dialEdit) { // режим набора на барабанах
      const n = w.digits.length;
      if (pressed(k.up)) w.digits[w.dc] = (w.digits[w.dc] + 1) % 10;
      if (pressed(k.down)) w.digits[w.dc] = (w.digits[w.dc] + 9) % 10;
      if (pressed(k.left)) w.dc = (w.dc + n - 1) % n;
      if (pressed(k.right)) w.dc = (w.dc + 1) % n;
      if (pressed(k.use)) w.dialEdit = false;
      this.refreshPanel(w);
      return;
    }
    const rows = spec.rows, n = rows.length;
    if (pressed(k.up)) w.sel = w.sel <= -1 ? n - 1 : w.sel - 1;      // -1 — крестик ✕
    if (pressed(k.down)) w.sel = w.sel >= n - 1 ? -1 : w.sel + 1;
    const r = w.sel >= 0 ? rows[w.sel] : null;
    if (r && r.adjust) { // ◄► с автоповтором при удержании (для ползунков)
      const now = this.time.now, L = k.left.some((x) => x.isDown), R = k.right.some((x) => x.isDown);
      if (pressed(k.left)) { r.adjust(-1); w.rep = now + 320; }
      else if (pressed(k.right)) { r.adjust(1); w.rep = now + 320; }
      else if (r.repeat && (L || R) && now > (w.rep || 0)) { r.adjust(L ? -1 : 1); w.rep = now + 45; }
    }
    if (pressed(k.use)) {
      if (!r) { this.closeWindow(pl); return; }
      if (r.act && !r.disabled) r.act(); else if (r.adjust && !r.act) r.adjust(1);
    }
    if (pl.win === w) this.refreshPanel(w);
  }

  // Высота строки по типу
  rowHeight(r) {
    return { pick: 40, primary: 40, toggle: 24, tiles: 52, dial: 86, routes: 92 }[r.kind] || 17;
  }

  refreshPanel(w) {
    const spec = this.panelSpec(w);
    w.spec = spec;
    if (w.sel === undefined || w.sel >= spec.rows.length) w.sel = spec.rows.length - 1;
    const vis = spec.visibleRows || spec.rows.length;
    if (w.sel >= 0 && w.sel < w.scroll) w.scroll = w.sel;
    if (w.sel >= w.scroll + vis) w.scroll = w.sel - vis + 1;
    const dialRow = spec.rows.find((r) => r.kind === 'dial');
    if (dialRow) w.gauge = (w.gauge ?? dialRow.dial.loaded) + (dialRow.dial.loaded - (w.gauge ?? dialRow.dial.loaded)) * 0.12;
    const sig = JSON.stringify([spec.title, spec.info, spec.rows.map((r) => [r.label, r.right, r.disabled, r.on, r.cur, r.tiles, r.dial, r.bar]),
      w.sel, w.scroll, spec.sticky, dialRow ? Math.round(w.gauge) : 0, w.dialEdit, !!w.check]);
    if (sig !== w.sig) {
      w.sig = sig;
      this.drawPanel(w, spec, vis);
    }
    if (w.check) this.drawCheck(w, w.pos, w.W);
  }

  drawPanel(w, spec, vis) {
    w.c.removeAll(true);
    const bb0 = this.stationBox(w.st);
    const W = Math.round(Math.max(spec.width, Math.min(bb0.r - bb0.l, 320))), col = ROLES[w.st.role].color;
    const base = this.add.graphics(), bg = this.add.graphics();
    w.c.add([base, bg]);
    let y = 8;
    const add = (x, yy, str, style = {}, ox = 0) => {
      const t = this.add.text(x, yy, str, { color: '#e6e9ff', fontSize: '11px', wordWrap: { width: W - 20 }, ...style }).setOrigin(ox, 0);
      w.c.add(t); return t;
    };
    const dim = !!w.check;
    // заголовок + крестик
    add(10, y, spec.title, { color: hex(col), fontSize: '14px', fontStyle: 'bold' });
    const xs = w.sel === -1;
    bg.fillStyle(xs ? col : 0x1d2550, 1).fillRoundedRect(W - 30, 6, 22, 20, 5);
    if (xs) bg.lineStyle(1.5, 0xffffff, 1).strokeRoundedRect(W - 30, 6, 22, 20, 5);
    add(W - 19, 7, '✕', { color: xs ? '#ffffff' : '#8c96c8', fontSize: '13px', fontStyle: 'bold', wordWrap: null }, 0.5);
    y += 24;
    for (const line of spec.info) { const t = add(10, y, line || ' ', { color: '#b9c0e6' }); y += t.height + 1; }
    if (spec.info.length) y += 6;
    const shown = spec.rows.slice(w.scroll, w.scroll + vis);
    if (w.scroll > 0) add(W - 12, y - 10, '▲', { color: '#8c96c8' }, 1);
    const tint = (c, a) => Phaser.Display.Color.ObjectToColor(Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(0x141a3a), Phaser.Display.Color.ValueToColor(c), 100, a * 100)).color;
    shown.forEach((r, i) => {
      const idx = w.scroll + i, sel = idx === w.sel && !dim, h = this.rowHeight(r), kind = r.kind || 'item';
      const L = 8, RW = W - 16;
      if (kind === 'item') {
        if (sel) bg.fillStyle(0x1d2550, 1).fillRoundedRect(6, y - 1, W - 12, h - 1, 4).lineStyle(1.5, col, 1).strokeRoundedRect(6, y - 1, W - 12, h - 1, 4);
        if (r.color) bg.fillStyle(Phaser.Display.Color.HexStringToColor(r.color).color, 1).fillCircle(14, y + h / 2 - 1, 3);
        add(r.color ? 22 : 12, y + 1, r.label, { color: r.disabled ? '#5c6699' : '#e6e9ff', fontStyle: sel ? 'bold' : 'normal', wordWrap: null, fontSize: '10.5px' });
        if (r.right) add(W - 12, y + 1, r.right, { color: '#8c96c8', wordWrap: null, fontSize: '10.5px' }, 1);
        y += h;
        return;
      }
      if (kind === 'toggle') {
        bg.fillStyle(sel ? 0x1d2550 : 0x141a3a, 1).fillRoundedRect(L, y, RW, h - 3, 5);
        if (sel) bg.lineStyle(1.5, col, 1).strokeRoundedRect(L, y, RW, h - 3, 5);
        bg.fillStyle(r.on ? col : 0x070a16, 1).fillRoundedRect(L + 6, y + 4, 13, 13, 3);
        bg.lineStyle(1, r.on ? 0xffffff : 0x5c6699, 1).strokeRoundedRect(L + 6, y + 4, 13, 13, 3);
        if (r.on) add(L + 12.5, y + 2, '✓', { color: '#ffffff', fontSize: '11px', fontStyle: 'bold', wordWrap: null }, 0.5);
        add(L + 26, y + 4, r.label, { fontSize: '11.5px', fontStyle: sel ? 'bold' : 'normal', color: r.on ? '#ffffff' : '#c8cdee', wordWrap: null });
        if (r.right) add(W - 16, y + 4, r.right, { color: '#8c96c8', fontSize: '11px', wordWrap: null }, 1);
        y += h;
        return;
      }
      if (kind === 'pick') {
        bg.fillStyle(sel ? 0x1d2550 : 0x141a3a, 1).fillRoundedRect(L, y, RW, h - 4, 6);
        bg.lineStyle(sel ? 2 : 1, sel ? col : 0x2a3266, 1).strokeRoundedRect(L, y, RW, h - 4, 6);
        add(L + 8, y + 3, r.cap || '', { color: '#7f89bd', fontSize: '9.5px', wordWrap: null });
        if (r.right) add(W - 16, y + 3, r.right, { color: '#8be08b', fontSize: '9.5px', fontStyle: 'bold', wordWrap: null }, 1);
        const ac = sel ? hex(col) : '#4a548a';
        add(L + 10, y + 15, '◄', { color: ac, fontSize: '13px', wordWrap: null });
        add(W - 18, y + 15, '►', { color: ac, fontSize: '13px', wordWrap: null }, 1);
        add(W / 2, y + 15, r.label, { color: '#ffffff', fontSize: r.label.length > 22 ? '11.5px' : '13px', fontStyle: 'bold', wordWrap: null }, 0.5);
        if (r.bar !== undefined) {
          const bx = L + 30, bw = RW - 60, by = y + h - 9;
          bg.fillStyle(0x070a16, 1).fillRect(bx, by, bw, 3);
          bg.fillStyle(col, 1).fillRect(bx, by, bw * r.bar, 3);
          if (r.mark !== undefined && this.difficulty() === 0) bg.fillStyle(0x8be08b, 1).fillRect(bx + bw * r.mark - 1, by - 2, 2, 7);
        }
        y += h;
        return;
      }
      if (kind === 'primary') {
        const fill = r.disabled ? 0x23305a : sel ? col : tint(col, 0.45);
        bg.fillStyle(fill, 1).fillRoundedRect(L, y + 2, RW, h - 6, 8);
        if (sel && !r.disabled) bg.lineStyle(2, 0xffffff, 1).strokeRoundedRect(L, y + 2, RW, h - 6, 8);
        add(W / 2, y + 11, r.label, { color: r.disabled ? '#8be08b' : '#ffffff', fontSize: '14px', fontStyle: 'bold', wordWrap: null }, 0.5);
        y += h;
        return;
      }
      if (kind === 'tiles') {
        add(L + 2, y, r.cap || '', { color: '#7f89bd', fontSize: '9.5px', wordWrap: null });
        const n = r.tiles.length, gap = 6, tw = (RW - gap * (n - 1)) / n;
        r.tiles.forEach((t, j) => {
          const x = L + j * (tw + gap), on = sel && j === r.cur;
          bg.fillStyle(t.done ? tint(0x5fd17f, 0.55) : on ? 0x1d2550 : 0x141a3a, 1).fillRoundedRect(x, y + 14, tw, 34, 6);
          bg.lineStyle(on ? 2 : 1, on ? col : 0x2a3266, 1).strokeRoundedRect(x, y + 14, tw, 34, 6);
          add(x + tw / 2, y + 23, t.done ? `${t.label} ✓` : t.label, { color: '#ffffff', fontSize: '11.5px', fontStyle: 'bold', wordWrap: null }, 0.5);
        });
        y += h;
        return;
      }
      if (kind === 'dial') {
        const d = r.dial;
        if (sel || d.edit) {
          bg.fillStyle(0x1d2550, 1).fillRoundedRect(L - 2, y, RW + 4, h - 4, 6);
          bg.lineStyle(2, col, 1).strokeRoundedRect(L - 2, y, RW + 4, h - 4, 6);
        }
        this.drawDial(w, d, bg, add, y + 6, W, col);
        if (sel && !d.edit) add(W / 2 - 18, y + h - 16, `${w.pl.cfg.useName} — set amount`, { color: hex(col), fontSize: '9.5px', wordWrap: null }, 0.5);
        y += h;
        return;
      }
      if (kind === 'routes') {
        const gap = 8, cwid = (RW - gap) / 2;
        r.cards.forEach((c, j) => {
          const x = L + j * (cwid + gap), cur = j === r.cur, com = j === r.committed;
          bg.fillStyle(cur ? 0x1d2550 : 0x141a3a, 1).fillRoundedRect(x, y, cwid, h - 6, 7);
          bg.lineStyle(cur ? 2 : 1, cur ? (sel ? col : 0x6f79ad) : 0x2a3266, 1).strokeRoundedRect(x, y, cwid, h - 6, 7);
          add(x + 8, y + 5, c.name + (com ? '  ✓' : ''), { color: cur ? '#ffffff' : '#9aa3cf', fontSize: '12px', fontStyle: 'bold', wordWrap: null });
          add(x + 8, y + 23, `⏱ ${c.days} days`, { color: '#c8cdee', fontSize: '10.5px', wordWrap: null });
          add(x + 8, y + 38, `Δv ${c.dv} km/s`, { color: '#ffcf5a', fontSize: '10.5px', wordWrap: null });
          add(x + 8, y + 53, `O2 ${c.need.o2} · H2O ${c.need.water} · food ${c.need.food}`, { color: '#9ed36a', fontSize: '9.5px', wordWrap: null });
          if (sel && cur) add(x + cwid / 2, y + 68, '◄ ►', { color: hex(col), fontSize: '10px', wordWrap: null }, 0.5);
        });
        y += h;
      }
    });
    if (w.scroll + vis < spec.rows.length) add(W - 12, y - 6, '▼', { color: '#8c96c8' }, 1);
    y += 4;
    const use = w.pl.cfg.useName;
    const hint = w.dialEdit ? `▲▼ digit · ◄► wheel · ${use} done` : `↑↓ select · ◄► change · ${use} ok`;
    const ft = add(10, y, hint, { color: '#6f79ad', fontSize: '10px' });
    y += ft.height + 8;
    base.fillStyle(0x0f1430, 0.97).fillRoundedRect(0, 0, W, y, 9);
    base.lineStyle(2, col, 1).strokeRoundedRect(0, 0, W, y, 9);
    if (dim) { const ov = this.add.graphics(); ov.fillStyle(0x000000, 0.4).fillRoundedRect(0, 0, W, y, 9); w.c.add(ov); }
    const pos = this.avoidWindows(w, this.placeWindow(w.st, W, y), W, y);
    w.c.setPosition(pos.x, pos.y);
    w.pos = pos; w.W = W; w.H = y;
    // «Стикер» с формулами — рядом с окном
    if (w.sticky) { w.sticky.destroy(); w.sticky = null; }
    if (spec.sticky) {
      const s = this.buildNote(spec.sticky).setDepth(21001);
      const sw = s.nw;
      const sx = pos.x + W + 6 + sw < 1276 ? pos.x + W + 6 : pos.x - sw - 6;
      s.setPosition(sx, Phaser.Math.Clamp(pos.y + 6, 44, 716 - s.nh)).setAngle(-1.5);
      w.sticky = s;
    }
  }

  // ── Кадр ───────────────────────────────────────────────────────────────
  update(time, delta) {
    const dt = delta / 1000;
    const highlighted = new Set();
    this.hl.clear();
    for (const pl of this.players) {
      const t = this.updatePlayer(pl, dt);
      if (t && t.item) highlighted.add(t.item);
      if (t && t.station) {
        const st = t.station, R = st.hit || st, h = R.h !== undefined ? R.h : st.h;
        const top = [proj(R.l, R.t, h), proj(R.r, R.t, h), proj(R.r, R.b, h), proj(R.l, R.b, h)];
        this.hl.lineStyle(3, this.canUse(pl, st) ? 0xffffff : 0xff6b6b, 0.9).strokePoints(top, true);
      }
    }
    for (const it of this.items) this.drawItem(it, highlighted.has(it));
    this.updateScaleDisplay(dt);
    for (const pl of this.players) if (pl.win && pl.win.kind === 'panel') this.refreshPanel(pl.win); // данные живые
  }

  // Возвращает текущую цель героя { item?, station? } для подсветки
  updatePlayer(pl, dt) {
    const k = pl.keys;
    const down = (keys) => keys.some((key) => key.isDown);
    const pressed = (keys) => keys.some((key) => Phaser.Input.Keyboard.JustDown(key));

    let dx = down(k.right) - down(k.left);
    let dy = down(k.down) - down(k.up);
    if (pl.win || this.mission.launched || this.mission.failed) { dx = 0; dy = 0; } // пока открыто окно — стоим

    const vel = pl.body.body.velocity.clone();
    const moving = dx !== 0 || dy !== 0;
    pl.moving = moving;
    const target = new Phaser.Math.Vector2(dx, dy).normalize().scale(MAX_SPEED);
    const diff = target.clone().subtract(vel);
    const step = (moving ? ACCEL : FRICTION) * dt;
    if (diff.length() <= step) vel.copy(target);
    else vel.add(diff.setLength(step));
    pl.body.body.setVelocity(vel.x, vel.y);

    if (moving) {
      pl.facing = Phaser.Math.Angle.RotateTo(pl.facing, Math.atan2(dy, dx), TURN_SPEED * dt);
    }

    const p = pl.body;
    let tgt = null;
    if (pl.win && pl.win.kind === 'brief') {
      if (pressed(k.use)) this.closeWindow(pl);
    } else if (pl.win && pl.win.kind === 'board') {
      this.boardInput(pl, pressed);
    } else if (pl.win) {
      this.panelInput(pl, pressed);
    } else if (!this.mission.launched && !this.mission.failed) {
      const item = pl.carrying ? null : this.targetItem(pl);
      const st = this.targetStation(pl);
      if (pl.carrying) {
        // с предметом в руках станция нужна только чтобы вернуть его на место или откалибровать
        const it = pl.carrying;
        const useful = st && this.canUse(pl, st) && (st.kind === 'calibrate' || (it.ref && it.ref.station === st.id));
        tgt = useful ? { station: st } : null;
      } else {
        // окно станции важнее предметов, лежащих на ней
        const stationFirst = st && this.canUse(pl, st);
        tgt = stationFirst ? { station: st } : item ? { item } : st ? { station: st } : null;
      }

      if (pressed(k.use)) {
        if (pl.carrying && tgt && tgt.station) {
          this.useStation(pl, tgt.station);
        } else if (pl.carrying) {
          // Кладём предмет перед собой: на низкую станцию под ним или на пол
          const it = pl.carrying;
          const under = this.solids.find((s) => !s.high &&
            it.x >= s.l && it.x <= s.r && it.y >= s.t && it.y <= s.b);
          it.support = under || null;
          it.z = under ? under.h : 0;
          it.vx = 0; it.vy = 0;
          it.carrier = null;
          pl.carrying = null;
        } else if (tgt && tgt.item) {
          pl.carrying = tgt.item;
          tgt.item.carrier = pl;
          tgt.item.support = null;
        } else if (tgt && tgt.station) {
          this.useStation(pl, tgt.station);
        }
      }
    }

    if (pl.carrying) {
      pl.carrying.x = p.x + Math.cos(pl.facing) * HOLD_DIST;
      pl.carrying.y = p.y + Math.sin(pl.facing) * HOLD_DIST;
      pl.carrying.rotation = pl.facing;
    }

    this.drawPlayer(pl, dt);

    // Конус обзора — на полу; белеет, когда есть с чем взаимодействовать
    const g = pl.cone;
    g.clear();
    const active = !!tgt;
    g.fillStyle(active ? 0xffffff : pl.cfg.color, active ? 0.22 : 0.13);
    g.lineStyle(1, pl.cfg.color, 0.5);
    const pts = [proj(p.x, p.y)];
    const N = 16;
    for (let i = 0; i <= N; i++) {
      const a = pl.facing - VIEW_ANGLE / 2 + (VIEW_ANGLE * i) / N;
      pts.push(proj(p.x + Math.cos(a) * VIEW_RANGE, p.y + Math.sin(a) * VIEW_RANGE));
    }
    g.fillPoints(pts, true);
    g.strokePoints(pts, true);
    return tgt;
  }

  // Герой: тень и кольцо цвета роли на полу + спрайт модели нужного направления и кадра
  drawPlayer(pl, dt) {
    const g = pl.gfx;
    const { x, y } = pl.body;
    const R = PLAYER_RADIUS;
    const floor = (r) => circlePts(x, y, r, 24).map((p) => proj(p.x, p.y, 0));
    g.clear();
    g.fillStyle(0x000000, 0.3).fillPoints(floor(R * 1.1), true);
    g.lineStyle(3, pl.cfg.color, 0.9).strokePoints(floor(R * 1.2), true);

    const step = (Math.PI * 2) / SPRITE.dirs;
    const dir = ((Math.round(pl.facing / step) % SPRITE.dirs) + SPRITE.dirs) % SPRITE.dirs;
    const v = pl.body.body.velocity;
    const speed = Math.hypot(v.x, v.y);
    let col;
    if (speed > 20) {
      pl.walkPhase = (pl.walkPhase + (dt * (speed / MAX_SPEED)) / SPRITE.walkTime) % 1;
      col = Math.floor(pl.walkPhase * SPRITE.walk);
    } else {
      pl.walkPhase = 0;
      col = SPRITE.walk;
    }
    const f = proj(x, y, 0);
    const p1 = proj(x + 10, y, 0);
    const k = (p1.x - f.x) / 10;
    pl.sprite
      .setFrame(dir * (SPRITE.walk + SPRITE.idle) * 2 + (pl.carrying ? SPRITE.walk + SPRITE.idle : 0) + col)
      .setPosition(f.x, f.y)
      .setScale((k * MODEL_UNIT) / SPRITE.pxPerUnit,
        ((k * MODEL_UNIT) / SPRITE.pxPerUnit) * (speed > 20 ? 1 : 1 + 0.025 * Math.sin(this.time.now / 400 + pl.cfg.x)))
      .setDepth(y);
  }
}
