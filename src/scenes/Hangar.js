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
  { id: 'launch',    name: 'Launch Control',   rect: [10.9, 12.6, 4.3, 2.4], role: 'N', look: 'launchcontrol', kind: 'engine', open: true },
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
  { id: 'soil',  name: 'Soil sample',  desc: 'Land, drill and return samples (mostly surface science)', cargo: ['Drill', 'Sample containers'], returnTrip: true },
  { id: 'photo', name: 'Photo survey', desc: 'Image the target on approach, then land (mostly cruise science)',   cargo: ['High-res camera'] },
];
// budget — сколько денег выделено на миссию, $M; color — как цель выглядит в иллюминаторе
const TARGETS = [
  { name: 'Moon',   dv: 4.0, travel: 3,   budget: 85, color: 0xc9c9c9, gravity: 1.62 },
  { name: 'Mars',   dv: 3.6, travel: 210, budget: 120, color: 0xe0703a, gravity: 3.71 },
  { name: 'Phobos',  dv: 4.5, travel: 210, budget: 135, color: 0x9a8a7a, gravity: 0.006 },
  { name: 'Venus', dv: 3.5, travel: 150, budget: 115, color: 0xf0d090, gravity: 8.87 },
  { name: 'Ceres', dv: 6.5, travel: 600, budget: 220, color: 0x8a8a90, gravity: 0.28 },
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
  planning: ['Route — FAST: shorter, more Δv → more fuel', 'EFFICIENT: longer, needs more O2/water/food', 'Launcher must lift cargo + crew + fuel', 'High-gain dish: 4× data, but heavier', 'CONFIRM the design'],
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

// ── Требования Space Apps: бюджет, ракета-носитель, связь, экипаж 1–4 ──────────
// Всё, что состоит в игре между этапами (ангар → полёт → поверхность → отчёт)
// roster — кто играет: [{ slot: номер набора клавиш, role }]. Роли, которые никто не взял, делает автопилот.
const GAME = { roster: null, mission: null, stage: 'hangar' };
const ROLE_ORDER = ['N', 'E', 'S', 'L'];
window.__GAME = GAME; // для отладочных скриптов
const ROLE_MODEL = { N: 'robotdog', E: 'bunny', S: 'cat', L: 'bear' };
// Ракеты-носители: сколько «стартовой массы» (груз + экипаж + антенна + топливо) могут вывести и сколько стоят
const LAUNCH_VEHICLES = [
  { id: 'LIGHT', name: 'Light launcher', cap: 1700, cost: 55, note: 'cheap, tight on mass' },
  { id: 'MEDIUM', name: 'Medium launcher', cap: 2600, cost: 90, note: 'balanced' },
  { id: 'HEAVY', name: 'Heavy launcher', cap: 4200, cost: 145, note: 'lifts anything, very expensive' },
];
// Антенны: масса летит вместе с кораблём, rate — во сколько раз быстрее передаются данные на Землю
const ANTENNAS = [
  { id: 'LGA', name: 'Low-gain antenna', mass: 4, cost: 2, rate: 1 },
  { id: 'HGA', name: 'High-gain dish', mass: 18, cost: 9, rate: 4 },
];
const FUEL_COST = 0.02;           // $M за кг топлива
const PAYLOAD_POWER_CAP = 10;     // ед. мощности, которые корабль может отдать научным приборам
const KIT_COST = { ELEC: 2, SEAL: 1.5 };
const CONSUMABLE_COST = { O2: 0.8, O2E: 0.8, H2O: 0.3, WW: 0.3, FD: 0.5, XFD: 0.5 };
const instrumentCost = (ins) => Math.round((1 + ins.mass * 0.9 + ins.power * 1.5) * 10) / 10;
for (const ins of INSTRUMENTS) ins.cost = instrumentCost(ins);
const money = (v) => `$${(Math.round(v * 10) / 10).toFixed(1)}M`;

// Приборы, у которых есть своя 3D-модель вместо куба
// все 32 прибора каталога + ящики еды и мешки с водой (assets/instruments/<код>.png)
const INSTRUMENT_MODELS = [...Array.from({ length: 32 }, (_, i) => 'S' + String(i + 1).padStart(2, '0')), 'FD', 'XFD', 'H2O', 'WW'];
const ITEM_SPRITE = { frame: 128, frameH: 144, footX: 64, footY: 89, pxPerUnit: 40, dirs: 32 };

export class HangarScene extends Phaser.Scene {
  constructor() { super('Hangar'); }

  // data.stage: 'hangar' | 'flight' | 'surface' | 'report'; data.crew — сколько игроков
  init(data) {
    this.stage = (data && data.stage) || 'hangar';
    if (data && data.roster) GAME.roster = data.roster;
    GAME.stage = this.stage;
  }

  preload() {
    const v = window.BUILD || Date.now();
    // Интерьер, отрендеренный в 3D (tools/level-render): слои-картинки + их положение и глубина.
    // Если файлов нет — карта рисуется простыми коробками, как раньше.
    this.load.json('levelmeta', `assets/level/level.json?v=${v}`);
    this.load.pack('levelpack', `assets/level/pack.json?v=${v}`);
    // корабль в полёте и посадочная сцена (tools/level-render, режимы ship / surface)
    this.load.json('shipmeta', `assets/ship/level.json?v=${v}`);
    this.load.pack('shippack', `assets/ship/pack.json?v=${v}`);
    this.load.json('surfmeta', `assets/surface/level.json?v=${v}`);
    this.load.pack('surfpack', `assets/surface/pack.json?v=${v}`);
    for (const name of ['robotdog', 'bunny', 'cat', 'bear']) {
      this.load.spritesheet(name, `assets/crew/${name}.png?v=${v}`,
        { frameWidth: SPRITE.frame, frameHeight: SPRITE.frameH });
    }
    // 3D-модели приборов (tools/item-render): 32 направления, кадр 96×112
    for (const id of INSTRUMENT_MODELS) {
      this.load.spritesheet('inst_' + id, `assets/instruments/${id}.png?v=${v}`, { frameWidth: ITEM_SPRITE.frame, frameHeight: ITEM_SPRITE.frameH });
    }
  }

  create() {
    // Чёткость: игра рисуется во внутреннем разрешении 1280×720 × RES (см. main.js),
    // а вся логика остаётся в координатах 1280×720 — камера просто увеличена.
    const RES = window.RES || 1;
    this.cameras.main.setZoom(RES).centerOn(640, 360);
    this.physics.world.setBounds(0, 0, 1280, 720);
    // Весь текст — в том же разрешении и нормальным шрифтом (по умолчанию у Phaser тонкий Courier)
    if (!this.add.origText) this.add.origText = this.add.text.bind(this.add);
    const addText = this.add.origText;
    this.add.text = (x, y, str, style = {}) => addText(x, y, str, {
      fontFamily: '"Segoe UI", Roboto, Arial, sans-serif', resolution: RES, ...style,
    });

    // после restart() свойства сцены остаются от прошлого этапа — обнуляем ссылки на объекты
    Object.assign(this, { orderHud: null, nextHud: null, nextSig: null, tut: null, menu: null, scaleText: null, scaleGhost: null,
      scaleZone: null, arena: null, flight: null, surf: null, players: [], stations: [], solids: [], boxes: [], hudT: 0, order: null });
    this.items = [];
    this.mistakes = 0;
    this.uidSeq = 0;
    if (this.stage === 'report') { this.buildReport(); return; }
    if (this.stage === 'hangar') {
      this.buildLevel();
      this.mission = { fuelOk: false, fuelValue: null, launched: false, failed: false };
      this.tickets = null;
      // запасы станций на старте
      for (const ins of INSTRUMENTS) ins.stock = 1;
      for (const list of Object.values(CONSUMABLES)) for (const s2 of list) s2.stock = s2.stock0 ?? (s2.stock0 = s2.stock);
      this.initPrep();
      this.stageT0 = this.time.now;
    } else {
      const M = GAME.mission;
      this.order = M.order; this.tickets = M.tickets; this.mistakes = M.mistakes || 0;
      this.mission = { launched: false, failed: false };
      this.initPrep(); this.prep.route = M.route; this.prep.design = M.design;
      if (this.stage === 'flight') this.buildShip(); else this.buildSurface();
    }
    this.hl = this.add.graphics().setDepth(9000); // подсветка станций

    const kb = this.input.keyboard;
    const bind = (codes) => codes.map((c) => kb.addKey(c, true));
    this.escKey = kb.addKey(KC.ESC, true); this.hKey = kb.addKey(KC.H, true);
    this.banner = this.add.text(640, 360, '', {
      color: '#ffffff', fontSize: '34px', fontStyle: 'bold', backgroundColor: '#0f1430cc',
      padding: { x: 24, y: 14 }, align: 'center',
    }).setOrigin(0.5).setDepth(30000).setVisible(false);

    // Сколько игроков — выбирается в меню перед первой игрой
    if (!GAME.roster) { this.players = []; this.openMenu(bind); return; }
    const roster = GAME.roster;
    this.auto = new Set(ROLE_ORDER.filter((r) => !roster.some((p) => p.role === r))); // роли на автопилоте
    const crewMasses = this.stage === 'hangar' || !GAME.mission ? rollCrewMasses(4) : GAME.mission.crewMasses;
    this.crewAll = crewMasses; // экипаж всегда из четырёх: кого нет за клавиатурой — ведёт автопилот
    const spawn = this.stageSpawn();
    this.players = roster.map((rs, idx) => {
      const cfg = { ...PLAYERS[rs.slot], model: ROLE_MODEL[rs.role] };
      const roles = [rs.role];
      const color = ROLES[roles[0]].color;
      const sx = spawn.x + SPAWN_OFFSETS[idx][0], sy = spawn.y + SPAWN_OFFSETS[idx][1];
      // Физическое тело — невидимый круг на плоскости; рисуем героя отдельно
      const body = this.add.circle(sx, sy, PLAYER_RADIUS, color).setVisible(false);
      this.physics.add.existing(body);
      body.body.setCircle(PLAYER_RADIUS);
      body.body.setCollideWorldBounds(true);
      return {
        cfg, idx,
        role: roles[0], roles,
        color,
        body,
        facing: Math.PI / 2,                         // направление взгляда, 0 = вправо
        cone: this.add.graphics().setDepth(-500),    // конус обзора (лежит на полу)
        gfx: this.add.graphics().setDepth(-400),     // тень и цветное кольцо на полу
        sprite: this.add.image(sx, sy, cfg.model, 0)
          .setOrigin(SPRITE.footX / SPRITE.frame, SPRITE.footY / SPRITE.frameH),
        walkPhase: 0,
        keys: {
          up: bind(cfg.up), left: bind(cfg.left), down: bind(cfg.down),
          right: bind(cfg.right), use: bind(cfg.use),
        },
        carrying: null,
        win: null,      // открытое окно задачи
        mass: crewMasses[ROLE_ORDER.indexOf(rs.role)], // вес героя, кг (узнать можно только на весах)
        suited: false,  // в скафандре (этап «поверхность»)
        busyT: 0,       // секунды за работой (для оценки командной работы)
      };
    });

    this.physics.world.on('worldstep', (delta) => {
      this.stepItems(delta);
      this.resolvePushes();
    });

    const help = this.players.map((pl) => `${ROLES[pl.role].name} (${pl.cfg.label})`).join('   ');
    const autoTxt = this.auto.size ? `   ·   🤖 auto: ${[...this.auto].map((r) => ROLES[r].name).join(', ')}` : '';
    this.add.text(16, 10, help + autoTxt, { color: '#ffffff', fontSize: '13px' }).setDepth(10000);
    this.add.text(16, 28, 'Action key — pick up / put down / use stations of your color (gray — anyone) · H — how to play',
      { color: '#9aa3cf', fontSize: '12px' }).setDepth(10000);
    if (this.stage === 'hangar') {
      this.time.delayedCall(400, () => { if (!window.NO_TUTORIAL) this.startTutorial(); });
      this.updateOrderHud();
    } else if (this.stage === 'flight') this.initFlight();
    else this.initSurface();
  }

  stageSpawn() {
    if (this.stage === 'flight') return { x: SHIP.cx, y: SHIP.cy + SHIP.lift + 46 };
    if (this.stage === 'surface') return { x: LANDER.cx, y: LANDER.cy + 20 };
    return SPAWN;
  }

  // ── Меню: кто играет и какой ролью ─────────────────────────────────────
  // Каждый набор клавиш: действие — присоединиться / готов, ◄► — выбрать роль, ▼ — выйти.
  // Роли, которые никто не взял, выполняются автоматически.
  openMenu(bind) {
    const keys = PLAYERS.map((cfg) => ({ left: bind(cfg.left), right: bind(cfg.right), use: bind(cfg.use), up: bind(cfg.up), down: bind(cfg.down) }));
    const c = this.add.container(0, 0).setDepth(28000);
    this.menu = { keys, c, slots: PLAYERS.map(() => ({ joined: false, role: null, ready: false })), go: 0 };
    this.drawMenu();
  }

  freeRoles(except) {
    const taken = this.menu.slots.filter((s2, i) => s2.joined && i !== except).map((s2) => s2.role);
    return ROLE_ORDER.filter((r) => !taken.includes(r));
  }

  drawMenu() {
    const M = this.menu, c = M.c;
    c.removeAll(true);
    const g = this.add.graphics();
    c.add(g);
    g.fillStyle(0x060a1c, 0.74).fillRect(0, 0, 1280, 720);
    const W = 860, H = 500, x0 = 640 - W / 2, y0 = 360 - H / 2;
    g.fillStyle(0x0f1430, 0.98).fillRoundedRect(x0, y0, W, H, 16);
    g.lineStyle(2, 0xffcf5a, 1).strokeRoundedRect(x0, y0, W, H, 16);
    const t = (x, y, str, st = {}, ox = 0.5) => { const o = this.add.text(x, y, str, { color: '#e6e9ff', fontSize: '14px', ...st }).setOrigin(ox, 0); c.add(o); return o; };
    t(640, y0 + 20, 'LAUNCH RUSH', { fontSize: '34px', fontStyle: 'bold', color: '#ffcf5a' });
    t(640, y0 + 66, 'Prepare, fly and land a science mission — 1 to 4 players.', { color: '#9aa3cf' });
    t(640, y0 + 92, 'Press YOUR action key to join · ◄ ► pick a role · action again = READY · ▼ leave', { color: '#e6e9ff', fontSize: '13px' });
    const cw = 190, gap = 12, cx0 = 640 - (cw * 4 + gap * 3) / 2;
    M.slots.forEach((sl, i) => {
      const cfg = PLAYERS[i], x = cx0 + i * (cw + gap), y = y0 + 130;
      const col = sl.joined ? ROLES[sl.role].color : 0x3a4170;
      g.fillStyle(sl.joined ? shadeColor(col, 0.35) : 0x141a3a, 1).fillRoundedRect(x, y, cw, 220, 12);
      g.lineStyle(sl.ready ? 3 : 1.5, sl.ready ? 0x8be08b : col, 1).strokeRoundedRect(x, y, cw, 220, 12);
      t(x + cw / 2, y + 10, `Keys: ${cfg.label}`, { color: '#8c96c8', fontSize: '12px' });
      if (!sl.joined) {
        t(x + cw / 2, y + 90, `Press ${cfg.useName}\nto join`, { fontSize: '17px', fontStyle: 'bold', color: '#6f79ad', align: 'center' });
        return;
      }
      const model = ROLE_MODEL[sl.role];
      const img = this.add.image(x + cw / 2, y + 128, model, 8 * 34 + 16).setScale(1.25); c.add(img);
      t(x + cw / 2, y + 34, `◄  ${ROLES[sl.role].name}  ►`, { fontSize: '16px', fontStyle: 'bold', color: hex(col) });
      t(x + cw / 2, y + 186, sl.ready ? 'READY ✓' : `${cfg.useName} — ready`, { fontSize: '14px', fontStyle: 'bold', color: sl.ready ? '#8be08b' : '#e6e9ff' });
    });
    const joined = M.slots.filter((s2) => s2.joined);
    const auto = ROLE_ORDER.filter((r) => !joined.some((s2) => s2.role === r));
    let y = y0 + 372;
    if (joined.length) {
      t(640, y, auto.length ? `🤖 Done automatically: ${auto.map((r) => ROLES[r].name).join(', ')} — their tasks are skipped by the crew autopilot` : 'All four roles are played by people — full mission!',
        { color: auto.length ? '#ffcf5a' : '#8be08b', fontSize: '13px' });
      y += 28;
      t(640, y, M.go > 0 ? `Starting in ${Math.ceil(M.go)}…` : 'When everyone who joined is READY, the game starts.', { color: '#8c96c8', fontSize: '13px' });
    } else t(640, y, 'Up to four people on one keyboard.', { color: '#8c96c8', fontSize: '13px' });
    const roles = [['Navigator', 'route, launcher, fuel, comms, landing'], ['Engineer', 'spare kits, power, engine, repairs'], ['Scientist', 'instruments, calibration, observations'], ['Life Support', 'O2, water, food, hatch, EVA suits']];
    roles.forEach(([n, d], i) => t(x0 + 40 + (i % 2) * 400, y0 + H - 58 + Math.floor(i / 2) * 20, `${n}: ${d}`, { color: hex(ROLES[ROLE_ORDER[i]].color), fontSize: '11.5px' }, 0));
  }

  updateMenu() {
    const M = this.menu, J = Phaser.Input.Keyboard.JustDown;
    let ch = false;
    M.keys.forEach((k, i) => {
      const sl = M.slots[i];
      if (k.use.some(J)) {
        if (!sl.joined) { const free = this.freeRoles(i); if (free.length) { sl.joined = true; sl.role = free[0]; } }
        else sl.ready = !sl.ready;
        ch = true;
      }
      if (sl.joined && !sl.ready) {
        const dir = (k.left.some(J) ? -1 : 0) + (k.right.some(J) ? 1 : 0);
        if (dir) {
          const free = this.freeRoles(i);
          const order = ROLE_ORDER.filter((r) => free.includes(r));
          const at = order.indexOf(sl.role);
          sl.role = order[(at + dir + order.length) % order.length]; ch = true;
        }
        if (k.down.some(J)) { sl.joined = false; sl.role = null; ch = true; }
      }
    });
    const joined = M.slots.filter((s2) => s2.joined);
    const allReady = joined.length > 0 && joined.every((s2) => s2.ready);
    if (allReady) {
      const before = Math.ceil(M.go || 0);
      if (!M.goAt) M.goAt = this.time.now + 1600;
      M.go = Math.max(0.001, (M.goAt - this.time.now) / 1000);
      if (this.time.now >= M.goAt) M.go = 0;
      if (M.go <= 0 && M.goAt) {
        const roster = M.slots.map((s2, i) => (s2.joined ? { slot: i, role: s2.role } : null)).filter(Boolean);
        this.scene.restart({ stage: 'hangar', roster });
        return;
      }
      if (Math.ceil(M.go) !== before) ch = true;
    } else if (M.goAt) { M.go = 0; M.goAt = 0; ch = true; }
    if (ch) this.drawMenu();
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
    if (z && z.circle) return Math.hypot(x - z.circle.cx, y - z.circle.cy) <= z.circle.r;
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
    const key = it.code && this.textures.exists('inst_' + it.code) ? 'inst_' + it.code : null;
    if (key) {
      // своя модель: спрайт нужного направления; в руках — за ним «стеклянный» кейс, закрывающий вырез в спрайте героя
      if (!it.spr) it.spr = this.add.image(0, 0, key, 0).setOrigin(ITEM_SPRITE.footX / ITEM_SPRITE.frame, ITEM_SPRITE.footY / ITEM_SPRITE.frameH);
      if (it.carrier) {
        g.fillStyle(0xbfd8ff, 0.18);
        const glass = drawPrism(g, corners, z0, z1, 0x9fb8e0, 0xc8dcff);
        g.lineStyle(1, 0xffffff, 0.5).strokePoints(glass, true);
        g.setAlpha(0.35);
      } else {
        g.setAlpha(1);
        g.fillStyle(0x000000, 0.25).fillPoints(circlePts(it.x, it.y, half * 1.1).map((p) => proj(p.x, p.y, z0)), true);
        if (highlight) g.lineStyle(3, 0xffffff, 1).strokePoints(circlePts(it.x, it.y, half * 1.35).map((p) => proj(p.x, p.y, z0)), true);
      }
      const step = (Math.PI * 2) / ITEM_SPRITE.dirs;
      const dir = ((Math.round(it.rotation / step) % ITEM_SPRITE.dirs) + ITEM_SPRITE.dirs) % ITEM_SPRITE.dirs;
      const f = proj(it.x, it.y, z0), p1 = proj(it.x + 10, it.y, z0), k = (p1.x - f.x) / 10;
      it.spr.setFrame(dir).setPosition(f.x, f.y).setScale((k * MODEL_UNIT) / ITEM_SPRITE.pxPerUnit).setDepth(depth + 0.005);
    } else {
      const top = drawPrism(g, corners, z0, z1, shadeColor(it.color, 0.95), shadeColor(it.color, 1.25));
      if (highlight) g.lineStyle(3, 0xffffff, 1).strokePoints(top, true);
    }
    const lp = proj(it.x, it.y, z1 + 4);
    // на Hard/Extreme масса не подписана — только взвешивание
    const txt = this.stage !== 'hangar' ? (it.code || it.name) : this.difficulty() >= 2 ? (it.code || '?') : `${it.code ? it.code + ' · ' : ''}${it.mass} kg`;
    if (it.label.text !== txt) it.label.setText(txt);
    // подпись — только у предметов рядом с героями (иначе в зоне груза каша из надписей)
    const near = !it.carrier && this.players.some((p) => Math.hypot(p.body.x - it.x, p.body.y - it.y) < 95);
    it.label.setPosition(lp.x, lp.y - 2).setDepth(depth + 0.01).setVisible(near || highlight);
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
      if (this.arena) this.arenaItem(it);
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
        if (this.arena) this.arenaBody(pl);
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

  // Своя роль — можно. Если роль на автопилоте, «ключевые» станции (старт, посадка, скафандры) открыты всем.
  canUse(pl, st) { return st.role === 'ANY' || pl.roles.includes(st.role) || (!!this.auto && this.auto.has(st.role) && !!st.open); }

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
      design: { lv: null, ant: null },               // P06: носитель и антенна (вместе с маршрутом)
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
      { id: 'P06', text: this.prep.route === null ? 'Mission design not confirmed' : `${ROUTES[this.prep.route].name} · ${LAUNCH_VEHICLES[this.prep.design.lv].name} · ${ANTENNAS[this.prep.design.ant].id}`, ok: this.prep.route !== null, gate: true },
      { id: 'P07', text: `Propellant ${this.mission.fuelOk ? this.mission.fuelValue + ' kg' : 'not verified'}`, ok: this.mission.fuelOk && Math.abs(this.prep.fuel.loaded - this.requiredFuel()) <= Math.max(2, this.requiredFuel() * 0.01), gate: true },
      { id: 'P08', text: 'Consumables finalized', ok: !!this.prep.consumables && this.prep.consumables === this.cargoSignature(), gate: true },
      { id: 'P09', text: `Hatch ${this.prep.hatch.state}`, ok: this.prep.hatch.state === 'VERIFIED', gate: true },
      { id: 'P10', text: `EVA suits ready ${suits}/${SUITS_NEEDED}`, ok: suits >= SUITS_NEEDED, gate: false },
      { id: 'P11', text: `Budget ${money(this.missionCost())} / ${money(this.budget())}`, ok: this.missionCost() <= this.budget(), gate: true },
      { id: 'P12', text: this.prep.route === null ? 'Launcher not chosen' : `Launch mass ${this.grossMass()} / ${LAUNCH_VEHICLES[this.prep.design.lv].cap} kg`,
        ok: this.prep.route !== null && this.grossMass() <= LAUNCH_VEHICLES[this.prep.design.lv].cap, gate: true },
      { id: 'P13', text: `Payload power ${this.payloadPower()} / ${PAYLOAD_POWER_CAP} u`, ok: this.payloadPower() <= PAYLOAD_POWER_CAP, gate: false },
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
    const massMath = { math: ['m = m', { sub: 'cargo' }, ' + m', { sub: 'crew' }, ' + m', { sub: 'antenna' }], size: 14 };
    if (d === 0) {
      const lines = (HINTS[kind] || []).map((h) => h);
      if (formula) {
        lines.push('', { text: 'Propellant (Tsiolkovsky)', bold: true }, { math: this.fuelMath(false) }, { math: this.fuelMath(true) }, massMath,
          `cargo now: ${Math.round(this.loadedMass() * 10) / 10} kg · antenna: ${this.antennaMass()} kg · crew: weigh everyone!`);
        if (this.auto && this.auto.size) lines.push(`🤖 autopilot crew (${[...this.auto].map((r) => ROLES[r].name).join(', ')}): ${Math.round(this.autoCrewMass() * 10) / 10} kg`);
        if (this.prep.route === null) lines.push('(Δv shown for EFFICIENT — pick a route)');
      }
      if (kind === 'calibrate') lines.push('', { math: ['Q = 100 − 8 · | x − x', { sub: 'ref' }, ' |'], size: 14 });
      return lines.length ? lines : null;
    }
    if (d === 1 && formula) {
      return [{ text: 'Propellant (Tsiolkovsky)', bold: true }, { math: this.fuelMath(false) },
        { math: ['v', { sub: 'e' }, ` = ${V_EXHAUST} km/s`], size: 14 }, 'Δv — see Mission Planning', massMath,
        ...(this.auto && this.auto.size ? [`🤖 autopilot crew: ${Math.round(this.autoCrewMass() * 10) / 10} kg`] : [])];
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
      { math: ['m = m', { sub: 'cargo' }, ' + m', { sub: 'crew' }, ' + m', { sub: 'antenna' }], size: 16 },
      '',
      { text: 'Calibration quality', bold: true },
      { math: ['Q = 100 − 8 · | x − x', { sub: 'ref' }, ' |'], size: 16 },
      '',
      `Cargo ≤ ${MAX_CARGO_KG} kg · science payload ≤ ${SCIENCE_CAPACITY} kg · power ≤ ${POWER_AVAILABLE} u`,
      `Budget ${money(this.budget())} · launch mass (with fuel) ≤ launcher capacity`,
      ...(this.auto && this.auto.size ? [`🤖 autopilot crew mass: ${Math.round(this.autoCrewMass() * 10) / 10} kg`] : []),
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
  crewMass() { return this.crewAll ? this.crewAll.reduce((a, m) => a + m, 0) : this.players.reduce((a, p) => a + p.mass, 0); }
  autoCrewMass() { return [...(this.auto || [])].reduce((a, r) => a + this.crewAll[ROLE_ORDER.indexOf(r)], 0); }
  // Стартовая масса: весь груз в зоне весов + экипаж (каждого надо взвесить)
  antennaMass() { const d = this.prep && this.prep.design; return d && d.ant !== null ? ANTENNAS[d.ant].mass : 0; }
  launchMass() { return Math.round((this.loadedMass() + this.crewMass() + this.antennaMass()) * 10) / 10; }
  // Полная стартовая масса для ракеты-носителя: всё + топливо
  grossMass() { return Math.round(this.launchMass() + (this.prep.fuel.loaded || 0)); }
  // Бюджет: база цели + стоимость приборов, которые требуют тикеты (лишнее — уже за свой счёт)
  budget() {
    const ids = new Set((this.tickets || []).flatMap((t) => t.needs));
    return Math.round((this.orderTarget().budget + [...ids].reduce((a, id) => a + INSTRUMENT_BY_ID[id].cost, 0)) * 10) / 10;
  }
  // Сколько стоит миссия сейчас: носитель + антенна + всё, что в грузе, + топливо
  missionCost() {
    const d = this.prep.design || {};
    let c = 0;
    if (d.lv !== null && d.lv !== undefined) c += LAUNCH_VEHICLES[d.lv].cost;
    if (d.ant !== null && d.ant !== undefined) c += ANTENNAS[d.ant].cost;
    for (const it of this.itemsOnScale()) c += it.cost || 0;
    c += (this.prep.fuel.loaded || 0) * FUEL_COST;
    return Math.round(c * 10) / 10;
  }
  payloadPower() { return this.packedInstruments().reduce((a, it) => a + (it.power || 0), 0); }
  orderTarget() { return TARGETS[this.order ? this.order.target : 1]; }
  routeDv() { return this.orderTarget().dv * (this.prep && this.prep.route !== null ? ROUTES[this.prep.route].dvMul : 1); }
  fuelFactor() { return Math.exp(this.routeDv() / V_EXHAUST) - 1; }
  requiredFuel() { return Math.round(this.launchMass() * this.fuelFactor()); }
  difficulty() { return this.order ? this.order.difficulty : 0; } // 0 Easy … 3 Extreme
  packedInstruments() { return this.itemsOnScale().filter((it) => it.type === 'instrument'); }
  ticketReady(tk) { const ids = new Set(this.packedInstruments().map((it) => it.code)); return tk.needs.every((n) => ids.has(n)); }

  // Тикеты под заказ: 3 случайных подходящих по типу миссии, чтобы вместе влезали в научную ёмкость
  rollTickets(order) {
    // 2 тикета основной фазы + 1 другой: наука есть и в полёте (F), и на поверхности (L)
    const main = MISSION_TYPES[order.type].id === 'photo' ? 'F' : 'L', other = main === 'F' ? 'L' : 'F';
    const pool = TICKETS.filter((t) => t.phase === main), pool2 = TICKETS.filter((t) => t.phase === other);
    for (let guard = 0; guard < 500; guard++) {
      const pick = [...Phaser.Utils.Array.Shuffle([...pool]).slice(0, 2), Phaser.Utils.Array.Shuffle([...pool2])[0]];
      const ids = new Set(pick.flatMap((t) => t.needs));
      const mass = [...ids].reduce((a, id) => a + INSTRUMENT_BY_ID[id].mass, 0);
      const pw = [...ids].reduce((a, id) => a + INSTRUMENT_BY_ID[id].power, 0);
      if (mass <= SCIENCE_CAPACITY && pw <= PAYLOAD_POWER_CAP) return pick;
    }
    return pool.slice(0, 2);
  }

  // Ошибка игрока: на Extreme — сразу провал миссии
  mistake(st, text, quiet = false) {
    this.mistakes = (this.mistakes || 0) + 1;
    if (this.difficulty() === 3) {
      this.failMission('Extreme: one mistake ends the mission — ' + text);
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
    Object.assign(it, { type: def.type, code: def.code, ref: def.ref, bad: def.bad, uid: ++this.uidSeq, cost: def.cost || 0, power: def.power || 0,
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
    it.gfx.destroy(); it.label.destroy(); if (it.spr) it.spr.destroy();
    this.items = this.items.filter((x) => x !== it);
    this.floatText(st, `${it.code || ''} returned`, '#8be08b');
    return true;
  }

  // Взаимодействие со станцией. Только своего цвета (серые — общие).
  useStation(pl, st) {
    if (!this.canUse(pl, st)) {
      if (this.auto && this.auto.has(st.role)) { this.floatText(st, `🤖 ${ROLES[st.role].name} autopilot handles this`, hex(ROLES[st.role].color)); return; }
      this.floatText(st, `${ROLES[st.role].name} only`, hex(ROLES[st.role].color));
      return;
    }
    if (pl.carrying && this.returnItem(pl, st)) return;
    if (pl.carrying && this.stage !== 'hangar' && this.itemToStation(pl, st)) return;
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
    const rows = this.boardRows(w), d = w.draft, col = w.pl.color, use = w.pl.cfg.useName;
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
      `Target: ${target.name}   Δv ≈ ${target.dv} km/s   transfer ≈ ${target.travel} days   budget ${money(target.budget)} + instruments`,
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
      this.orderHud = this.add.text(1264, 8, '', {
        color: '#8be08b', fontSize: '12.5px', align: 'right', backgroundColor: '#0f1430cc', padding: { x: 8, y: 4 }, lineSpacing: 2,
      }).setOrigin(1, 0).setDepth(10000);
    }
    const o = this.order;
    if (!o) { this.orderHud.setText('No order yet — open the Order Screen').setColor('#ffcf5a'); return; }
    const lines = [`Order: ${MISSION_TYPES[o.type].name} · ${TARGETS[o.target].name} · ${DURATIONS[o.duration]} days · ${DIFFICULTIES[o.difficulty].name}`];
    if (this.stage === 'hangar') {
      const cost = this.missionCost(), bud = this.budget();
      let l2 = `Budget ${money(cost)} / ${money(bud)}`;
      if (this.prep.route !== null) l2 += `  ·  Launch mass ${this.grossMass()} / ${LAUNCH_VEHICLES[this.prep.design.lv].cap} kg`;
      lines.push(l2 + (cost > bud ? '  ⚠' : ''));
    }
    this.orderHud.setText(lines.join('\n')).setColor('#8be08b');
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
            label: `${ins.id}  ${ins.name}${tag}`, right: ins.stock === 0 ? 'taken' : `${diff >= 2 ? '' : ins.mass + ' kg · '}${ins.power}p · ${money(ins.cost)}`,
            color: diff === 0 ? CAT_COLORS[ins.cat] : null, disabled: ins.stock === 0,
            act: () => {
              if (pl.carrying) { this.floatText(st, 'Hands are full'); return; }
              if (ins.stock === 0) return;
              ins.stock = 0;
              this.giveItem(pl, { name: ins.name, mass: ins.mass, code: ins.id, type: 'instrument', cost: ins.cost, power: ins.power,
                color: 0xb98ae8, ref: Object.assign(ins, { station: 'shelf' }) });
              this.closeWindow(pl);
            },
            detail: ins,
          };
        });
        const d = w.sel >= 0 && spec.rows[Math.min(w.sel, spec.rows.length - 1)].detail;
        if (d) {
          spec.info = [`${d.id} — ${d.name}`, d.purpose, `${diff >= 2 ? '' : `Mass ${d.mass} kg · `}power ${d.power}u · cost ${money(d.cost)} · ${d.roles}`, `Real analog: ${d.analog}`];
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
              this.giveItem(pl, { name: rec.name, mass: rec.mass, code: rec.id === 'ELEC' ? 'KIT-E' : 'KIT-P', type: 'kit', color: 0xe57373, cost: KIT_COST[rec.id] });
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
      case 'planning': { // P06 — дизайн миссии: маршрут, ракета-носитель, антенна
        spec.width = 320;
        const t = this.orderTarget();
        w.route = w.route ?? (this.prep.route ?? 1);
        const D = this.prep.design;
        w.lv = w.lv ?? (D.lv ?? 0); w.ant = w.ant ?? (D.ant ?? 0);
        spec.info = ['P06 · Mission design', `Target: ${t.name}${ord ? '' : ' (no order yet)'} · budget ${money(this.budget())}`];
        const committed = this.prep.route === w.route && D.lv === w.lv && D.ant === w.ant;
        // оценка: сколько всё будет весить с топливом и сколько стоить
        const dv = t.dv * ROUTES[w.route].dvMul, m = this.loadedMass() + this.crewMass() + ANTENNAS[w.ant].mass;
        const fuel = Math.round(m * (Math.exp(dv / V_EXHAUST) - 1)), gross = Math.round(m + fuel);
        const cost = LAUNCH_VEHICLES[w.lv].cost + ANTENNAS[w.ant].cost + this.itemsOnScale().reduce((a2, it) => a2 + (it.cost || 0), 0) + fuel * FUEL_COST;
        if (diff <= 1) {
          spec.info.push(`Est. launch mass ${gross} kg (fuel ≈ ${fuel} kg) / cap ${LAUNCH_VEHICLES[w.lv].cap} kg ${gross > LAUNCH_VEHICLES[w.lv].cap ? '⚠ TOO HEAVY' : '✓'}`);
          spec.info.push(`Est. cost ${money(cost)} / ${money(this.budget())} ${cost > this.budget() ? '⚠ OVER BUDGET' : '✓'}`);
        }
        spec.rows = [
          { kind: 'routes', cur: w.route, committed: this.prep.route, cards: ROUTES.map((r) => ({
            name: r.name, days: Math.round(t.travel * r.timeMul), dv: (t.dv * r.dvMul).toFixed(1), need: r.need })),
          adjust: () => { w.route = 1 - w.route; } },
          { kind: 'pick', cap: `Launcher · ${LAUNCH_VEHICLES[w.lv].note}`, label: LAUNCH_VEHICLES[w.lv].name,
            right: `${LAUNCH_VEHICLES[w.lv].cap} kg · ${money(LAUNCH_VEHICLES[w.lv].cost)}`,
            adjust: (s2) => { w.lv = (w.lv + s2 + LAUNCH_VEHICLES.length) % LAUNCH_VEHICLES.length; } },
          { kind: 'pick', cap: `Antenna · data rate ×${ANTENNAS[w.ant].rate}`, label: ANTENNAS[w.ant].name,
            right: `${ANTENNAS[w.ant].mass} kg · ${money(ANTENNAS[w.ant].cost)}`,
            adjust: (s2) => { w.ant = (w.ant + s2 + ANTENNAS.length) % ANTENNAS.length; } },
          { kind: 'primary', label: committed ? 'DESIGN CONFIRMED ✓' : 'CONFIRM DESIGN', disabled: committed,
            act: () => {
              this.prep.route = w.route; this.prep.design = { lv: w.lv, ant: w.ant };
              this.floatText(st, `${ROUTES[w.route].name} · ${LAUNCH_VEHICLES[w.lv].name} · ${ANTENNAS[w.ant].id}`, ok);
            } },
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
          label: d.name, right: `${d.mass} kg · ${money(CONSUMABLE_COST[d.id])} ×${d.stock}`, disabled: d.stock === 0,
          act: () => {
            if (pl.carrying) { this.floatText(st, 'Hands are full'); return; }
            if (d.stock === 0) return;
            d.stock -= 1;
            this.giveItem(pl, { name: d.name, mass: d.mass, code: d.id, type: d.kind, bad: d.bad, color: d.bad ? 0x9aa08a : 0x9ed36a, cost: CONSUMABLE_COST[d.id],
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
      default: if (this.stageSpec) this.stageSpec(w, spec, st, pl, diff);
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

  // Старт: запоминаем всё, что было подготовлено, и переходим к этапу «Полёт»
  launch() {
    this.mission.launched = true;
    for (const p of this.players) this.closeWindow(p);
    const g = this.prepGates();
    const cargo = this.itemsOnScale().map((it) => ({ type: it.type, code: it.code, name: it.name, mass: it.mass, bad: it.bad || null,
      calibrated: !!it.calibrated, calQuality: it.calQuality || 0, cost: it.cost || 0, power: it.power || 0, color: it.color }));
    GAME.mission = {
      order: this.order, tickets: this.tickets, route: this.prep.route, design: this.prep.design,
      crewMasses: this.crewAll,
      cargo, cargo0: cargo, deadPacked: this.itemsOnScale().filter((it) => this.deadMass(it)).length, fuelLoaded: this.prep.fuel.loaded, fuelRequired: this.requiredFuel(), launchMass: this.launchMass(), grossMass: this.grossMass(),
      lvCap: LAUNCH_VEHICLES[this.prep.design.lv].cap, cost: this.missionCost(), budget: this.budget(),
      suitsReady: this.prep.suits.filter((x) => x.ready).length, kitsPacked: cargo.filter((c) => c.type === 'kit').length,
      gates: g.map((x) => ({ id: x.id, text: x.text, ok: x.ok, gate: x.gate })),
      mistakes: this.mistakes || 0, stage1Time: (this.time.now - this.stageT0) / 1000,
      team: this.teamStats(), log: [], flight: null, surface: null, failed: false,
    };
    this.cinematic(['3', '2', '1', '🚀 LIFTOFF!'], () => this.scene.restart({ stage: 'flight' }));
  }

  // Учёт командной работы: сколько времени заняты двое и больше одновременно
  trackTeam(dt) {
    const busy = this.players.filter((p) => p.win || p.carrying).length;
    this.team = this.team || { t: 0, par: 0, busy: 0 };
    this.team.t += dt; if (busy >= 2) this.team.par += dt; this.team.busy += busy * dt;
  }
  teamStats() {
    const prev = (GAME.mission && GAME.mission.team) || { t: 0, par: 0, busy: 0 };
    const cur = this.team || { t: 0, par: 0, busy: 0 };
    return { t: prev.t + cur.t, par: prev.par + cur.par, busy: prev.busy + cur.busy };
  }

  // Короткая «кат-сцена» из крупных надписей
  cinematic(frames, done, dur = 700) {
    const c = this.add.container(0, 0).setDepth(29000);
    const g = this.add.graphics(); g.fillStyle(0x060a1c, 0.0).fillRect(0, 0, 1280, 720); c.add(g);
    const t = this.add.text(640, 360, '', { color: '#ffffff', fontSize: '64px', fontStyle: 'bold' }).setOrigin(0.5); c.add(t);
    frames.forEach((f, i) => this.time.delayedCall(i * dur, () => {
      t.setText(f).setScale(1.4).setAlpha(1);
      this.tweens.add({ targets: t, scale: 1, duration: dur * 0.6, ease: 'Cubic.out' });
      g.clear().fillStyle(0x060a1c, Math.min(0.85, 0.25 + i * 0.2)).fillRect(0, 0, 1280, 720);
      if (i === frames.length - 1) this.cameras.main.shake(dur, 0.006);
    }));
    this.time.delayedCall(frames.length * dur + 300, () => { this.cameras.main.fadeOut(400, 6, 10, 28); });
    this.time.delayedCall(frames.length * dur + 750, done);
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
    add(kx, top + ch / 2 - 7, d.unit || 'kg', { color: '#ffcf5a', fontSize: '12px', fontStyle: 'bold', wordWrap: null });
    if (d.point) add(x0 + d.point * (cw + gap) - gap / 2, top + ch / 2 - 2, '.', { color: '#ffcf5a', fontSize: '22px', fontStyle: 'bold', wordWrap: null }, 0.5);
    if (d.gauge === false) return top + ch + 20;
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
    if (dialRow && dialRow.dial.loaded !== undefined) w.gauge = (w.gauge ?? dialRow.dial.loaded) + (dialRow.dial.loaded - (w.gauge ?? dialRow.dial.loaded)) * 0.12;
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

  // ── Обучающий брифинг («кат-сцена»): по шагам подсвечивает станции и объясняет порядок ──
  tutorialSteps() {
    return [
      { title: 'Welcome to Launch Rush', role: null, at: [],
        text: 'Your crew of four must get the rocket ready for Mars.\nEach hero has a role color and can only use stations with the same color underline (gray = anyone).\nAction key: pick up / put down items and open stations. Hands hold one item at a time.' },
      { title: '1 · Choose the mission', role: 'ANY', at: ['order'],
        text: 'Anyone opens the Order Screen and picks mission type, target, duration and difficulty.\nThis creates the science tickets — the list of experiments the rocket must carry.' },
      { title: '2 · Read the science tickets', role: 'S', at: ['labconsole'],
        text: 'Lab Console = the Scientist\'s to-do list. It shows each ticket and which instruments it needs (S01…S32), whether it is ready, and which packed instruments still need calibration.' },
      { title: '3 · Take the instruments', role: 'S', at: ['shelf'],
        text: 'Instrument Shelf: take the instruments named on the tickets (on Easy they have a ★).\nTake one, carry it, come back for the next.' },
      { title: '4 · Calibrate each instrument', role: 'S', at: ['analyzer'],
        text: 'Analyzer = calibration bench. Walk up WITH the instrument in your hands and press action.\nPick the right reference standard, slide the signal to the target number, VERIFY.\nUncalibrated instruments give fewer science points.' },
      { title: '5 · Everything that flies goes to CARGO', role: 'ANY', at: ['scale'],
        text: 'Drop every item for the flight inside the big hatched CARGO zone in the middle.\nCargo + crew = launch mass. The display shows the weight live — step on it to weigh the crew.' },
      { title: '6 · Build two spare kits', role: 'E', at: ['workbench'],
        text: 'Workbench: pick the job, tick the right parts, choose the tool (and torque), ASSEMBLE + INSPECT.\nCarry both kits (Electrical, Pressure-seal) to CARGO.' },
      { title: '7 · Design the mission', role: 'N', at: ['planning'],
        text: 'Mission Planning: FAST (shorter trip, more fuel) or EFFICIENT (less fuel, more supplies);\na launcher that can lift cargo + crew + fuel (bigger = pricier); a low-gain antenna or a heavy high-gain dish (4× data).\nStay inside the BUDGET shown in the top-right corner!' },
      { title: '8 · Pack consumables', role: 'L', at: ['o2', 'supply'],
        text: 'Bring the O2 cylinders, water and food the route needs to CARGO.\nDon\'t take EMPTY cylinders, expired food or waste water.\nThen press FINALIZE at the Supply Rack.' },
      { title: '9 · Approve the manifest', role: 'E', at: ['scale'],
        text: 'When all cargo is in the zone — Engineer opens the Scale and presses APPROVE MANIFEST (max 600 kg).\nChanged the cargo afterwards? Approve again.' },
      { title: '10 · Power check', role: 'E', at: ['fuelcells'],
        text: 'Fuel Cells: switch breakers ON in order MASTER → AVIONICS → LIFE SUPPORT, leave the rest off, then SELF-TEST.' },
      { title: '11 · Fuel — do it last', role: 'N', at: ['fuelport'],
        text: 'Fuel depends on the FINAL mass (cargo + crew), so fuel after the manifest.\nFuel Port: LOX/LH2 cartridge → COUPLE, dial the mass from the formula on the note, PUMP, CLOSE VALVE + VERIFY.' },
      { title: '12 · Seal the hatch', role: 'L', at: ['hatch'],
        text: 'Boarding Hatch: clean the gasket, turn the wheel to CLOSED, engage the latches in the shown order, PRESSURE CHECK.' },
      { title: '13 · Prepare two EVA suits', role: 'L', at: ['suits'],
        text: 'Suit Locker: for two suits — fill O2, install a CHARGED battery and an APPROVED CO2 cartridge, LEAK TEST.' },
      { title: '14 · Launch!', role: 'N', at: ['launch'],
        text: 'Launch Control shows the checklist. All green → LAUNCH.\nScore = science × calibration quality, plus bonuses for kits and suits, minus mistakes.' },
      { title: 'Then: fly and land', role: null, at: [],
        text: 'After LAUNCH the mission continues: STAGE 2 — the flight in a round ship (air, power, repairs, science, comms),\nSTAGE 3 — landing and EVA on the surface (only crew in suits can go out).\nWhat you pack here is all you will have up there!\nAt the end a report scores success, science, resources, decisions and teamwork.' },
      { title: 'Who does what — work in parallel', role: null, at: [], lanes: true,
        text: 'Easy mode shows a NEXT hint for each role in the top-left corner. Roles nobody picked are done by the 🤖 autopilot.\nPress H any time to watch this briefing again.' },
    ];
  }

  startTutorial() {
    for (const p of this.players) this.closeWindow(p);
    if (this.tut) this.endTutorial();
    const c = this.add.container(0, 0).setDepth(25000);
    const shade = this.add.graphics(), hole = this.make.graphics({ add: false });
    const fx = this.add.graphics();
    c.add([shade, fx]);
    this.tut = { i: 0, steps: this.tutorialSteps(), c, shade, hole, fx, card: null, t0: this.time.now };
    this.drawTutorial();
  }

  endTutorial() {
    if (!this.tut) return;
    this.tut.c.destroy(); this.tut.hole.destroy();
    this.tut = null;
  }

  drawTutorial() {
    const T = this.tut, s = T.steps[T.i];
    const boxes = s.at.map((id) => this.stationBox(this.stations.find((x) => x.id === id)));
    // затемнение с «окнами» над нужными станциями
    T.hole.clear().fillStyle(0xffffff, 1);
    for (const b of boxes) T.hole.fillRoundedRect(b.l - 14, b.t - 30, b.r - b.l + 28, b.b - b.t + 44, 14);
    T.shade.clear().fillStyle(0x060a1c, boxes.length ? 0.62 : 0.72).fillRect(0, 0, 1280, 720);
    T.shade.clearMask();
    if (boxes.length) {
      const m = T.hole.createGeometryMask(); m.setInvertAlpha(true); T.shade.setMask(m);
    }
    T.boxes = boxes;
    // карточка
    if (T.card) T.card.destroy();
    const card = this.add.container(0, 0);
    T.c.add(card); T.card = card;
    const CW = 600, g = this.add.graphics();
    card.add(g);
    const txt = (x, y, str, st = {}, ox = 0) => { const t = this.add.text(x, y, str, { color: '#e6e9ff', fontSize: '14px', wordWrap: { width: CW - 40 }, lineSpacing: 3, ...st }).setOrigin(ox, 0); card.add(t); return t; };
    const role = s.role ? ROLES[s.role] : null, col = role ? role.color : 0xffcf5a;
    let y = 16;
    txt(20, y, `${T.i + 1} / ${T.steps.length}`, { color: '#7f89bd', fontSize: '12px' });
    if (role) {
      const name = s.role === 'ANY' ? 'Anyone' : role.name;
      const chip = txt(CW - 20, y - 2, name, { color: '#ffffff', fontSize: '12px', fontStyle: 'bold', backgroundColor: hex(col), padding: { x: 8, y: 2 } }, 1);
    }
    y += 22;
    const tt = txt(20, y, s.title, { color: hex(col), fontSize: '22px', fontStyle: 'bold' });
    y += tt.height + 8;
    const body = txt(20, y, s.text);
    y += body.height + 12;
    if (s.lanes) { // четыре дорожки ролей
      const lanes = [
        ['S', ['Lab Console', 'Instrument Shelf', 'Analyzer', '→ CARGO']],
        ['E', ['Workbench (2 kits)', 'Fuel Cells', 'Scale: APPROVE']],
        ['L', ['Supplies → CARGO', 'FINALIZE', 'Boarding Hatch', 'Suit Locker']],
        ['N', ['Mission Planning', 'Fuel Port (last)', 'Launch Control']],
      ];
      const lw = (CW - 40 - 18) / 4;
      lanes.forEach(([r, items], j) => {
        const x = 20 + j * (lw + 6), rc = ROLES[r].color;
        g.fillStyle(rc, 0.18).fillRoundedRect(x, y, lw, 128, 8);
        g.lineStyle(1.5, rc, 1).strokeRoundedRect(x, y, lw, 128, 8);
        txt(x + 8, y + 6, ROLES[r].name, { color: hex(rc), fontSize: '13px', fontStyle: 'bold', wordWrap: { width: lw - 12 } });
        items.forEach((it, k) => txt(x + 8, y + 28 + k * 24, `${k + 1}. ${it}`, { fontSize: '11.5px', wordWrap: { width: lw - 12 } }));
      });
      y += 140;
    }
    const last = T.i === T.steps.length - 1;
    txt(20, y, `Action / ► — ${last ? 'start playing' : 'next'}    ◄ — back    Esc — skip`, { color: '#8c96c8', fontSize: '12px' });
    y += 28;
    // точки прогресса
    for (let k = 0; k < T.steps.length; k++) g.fillStyle(k === T.i ? col : 0x2a3266, 1).fillCircle(CW - 20 - (T.steps.length - 1 - k) * 12, y - 20, 3.5);
    g.fillStyle(0x0f1430, 0.97).fillRoundedRect(0, 0, CW, y, 14);
    g.fillStyle(col, 1).fillRoundedRect(0, 0, 6, y, { tl: 14, bl: 14, tr: 0, br: 0 });
    g.lineStyle(2, col, 1).strokeRoundedRect(0, 0, CW, y, 14);
    // фон под текстом: перекладываем графику в начало
    card.sendToBack(g);
    // карточка — с той стороны, где нет подсвеченных станций
    const cy = boxes.length ? boxes.reduce((a, b) => a + (b.t + b.b) / 2, 0) / boxes.length : 360;
    const cx = boxes.length ? boxes.reduce((a, b) => a + (b.l + b.r) / 2, 0) / boxes.length : 640;
    const x = Phaser.Math.Clamp(cx - CW / 2, 20, 1260 - CW);
    card.setPosition(x, boxes.length ? (cy < 360 ? 700 - y : 50) : 360 - y / 2);
    T.col = col;
  }

  // Каждый кадр: пульсирующая рамка и стрелка над станцией, ввод
  updateTutorial() {
    const T = this.tut;
    const pressedAny = (name) => this.players.some((p) => p.keys[name].some((k) => Phaser.Input.Keyboard.JustDown(k)));
    const next = pressedAny('use') | pressedAny('right'), prev = pressedAny('left');
    pressedAny('up'); pressedAny('down');
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) { this.endTutorial(); return; }
    if (next) { if (T.i >= T.steps.length - 1) { this.endTutorial(); return; } T.i++; this.drawTutorial(); }
    else if (prev && T.i > 0) { T.i--; this.drawTutorial(); }
    const g = T.fx, t = this.time.now / 1000, a = 0.55 + 0.45 * Math.sin(t * 5);
    g.clear();
    for (const b of T.boxes) {
      g.lineStyle(3, T.col, a).strokeRoundedRect(b.l - 14, b.t - 30, b.r - b.l + 28, b.b - b.t + 44, 14);
      const ax = (b.l + b.r) / 2, ay = b.t - 40 + Math.sin(t * 6) * 6;
      g.fillStyle(T.col, 1).fillTriangle(ax - 12, ay - 16, ax + 12, ay - 16, ax, ay);
      g.lineStyle(2, 0xffffff, 1).strokeTriangle(ax - 12, ay - 16, ax + 12, ay - 16, ax, ay);
    }
    for (const p of this.players) p.body.body.setVelocity(0, 0);
  }

  // Подсказка «что дальше» для каждой роли (только Easy)
  nextHints() {
    const tk = this.tickets;
    const has = (pl) => pl.carrying;
    const out = {};
    const S = this.players.find((p) => p.roles.includes('S'));
    const packed = this.packedInstruments(), packedIds = new Set(packed.map((i) => i.code));
    if (!tk) out.S = 'Order Screen (anyone): pick a mission first';
    else if (S && has(S) && S.carrying.type === 'instrument') out.S = S.carrying.calibrated ? `Drop ${S.carrying.code} in the CARGO zone` : `Analyzer: calibrate ${S.carrying.code} (keep it in hands)`;
    else {
      const need = [...new Set(tk.flatMap((t) => t.needs))];
      const missing = need.filter((id) => !packedIds.has(id));
      const uncal = packed.filter((i) => !i.calibrated);
      if (missing.length) out.S = `Instrument Shelf: take ${missing[0]} → Analyzer → CARGO`;
      else if (uncal.length) out.S = `Pick ${uncal[0].code} up from CARGO → Analyzer`;
      else out.S = 'Science done ✓ — help the others';
    }
    const kitsIn = this.itemsOnScale().filter((it) => it.type === 'kit').length;
    const P = this.prep, gates = Object.fromEntries(this.prepGates().map((g) => [g.id, g.ok]));
    const cargoDone = gates.P01 && gates.P02 && kitsIn >= KIT_RECIPES.length && gates.P08;
    if (P.kits.length < KIT_RECIPES.length) out.E = `Workbench: build ${KIT_RECIPES.find((r) => !P.kits.includes(r.id)).name}`;
    else if (kitsIn < KIT_RECIPES.length) out.E = 'Carry the kit to the CARGO zone';
    else if (!P.power.ready) out.E = 'Fuel Cells: MASTER → AVIONICS → LIFE SUPPORT, SELF-TEST';
    else if (!gates.P03) out.E = cargoDone ? 'Scale: APPROVE MANIFEST' : 'Wait until all cargo is in, then Scale: APPROVE';
    else out.E = 'Done ✓ — help the others';
    if (P.route === null) { out.N = 'Mission Planning: choose a route'; out.L = 'Wait for the route (Navigator)'; }
    else {
      if (!gates.P07) out.N = gates.P03 ? 'Fuel Port: load propellant by the formula' : 'Fuel Port after the manifest is approved';
      else if (this.prepGates().some((g) => g.gate && !g.ok)) out.N = 'Wait for the crew, then Launch Control';
      else out.N = 'Launch Control: LAUNCH! 🚀';
      const need = ROUTES[P.route].need, have = this.consumablesInCargo();
      const short = ['o2', 'water', 'food'].filter((k) => have[k] < need[k]);
      if (have.bad.length) out.L = `Remove ${have.bad[0]} from CARGO`;
      else if (short.length) out.L = `Bring ${short.map((k) => `${need[k] - have[k]} ${k === 'o2' ? 'O2' : k}`).join(', ')} to CARGO`;
      else if (!gates.P08) out.L = 'Supply Rack: FINALIZE';
      else if (!gates.P09) out.L = 'Boarding Hatch: seal it';
      else if (!gates.P10) out.L = 'Suit Locker: prepare 2 suits';
      else out.L = 'Done ✓ — help the others';
    }
    return out;
  }

  updateNextHud() {
    const show = this.stage === 'hangar' && this.difficulty() === 0 && !this.mission.launched && !this.mission.failed;
    if (!this.nextHud) this.nextHud = this.add.container(0, 0).setDepth(10001);
    this.nextHud.setVisible(show);
    if (!show || this.time.now < (this.nextT || 0)) return;
    this.nextT = this.time.now + 400;
    const h = this.nextHints(), sig = JSON.stringify(h);
    if (sig === this.nextSig) return;
    this.nextSig = sig;
    this.nextHud.removeAll(true);
    const g = this.add.graphics();
    this.nextHud.add(g);
    let y = 6, wMax = 0;
    const lines = ['S', 'E', 'L', 'N'].map((r) => {
      const t1 = this.add.text(10, y, `${ROLES[r].name} ▸`, { color: hex(ROLES[r].color), fontSize: '11.5px', fontStyle: 'bold' });
      const t2 = this.add.text(10 + t1.width + 6, y, h[r] || '', { color: '#e6e9ff', fontSize: '11.5px' });
      this.nextHud.add([t1, t2]); wMax = Math.max(wMax, t1.width + t2.width + 26); y += 17; return [t1, t2];
    });
    const head = this.add.text(10, -12, 'NEXT  (H — briefing)', { color: '#8c96c8', fontSize: '10px' });
    this.nextHud.add(head);
    g.fillStyle(0x0f1430, 0.85).fillRoundedRect(0, -16, wMax, y + 20, 8);
    this.nextHud.sendToBack(g);
    this.nextHud.setPosition(10, 62);
  }

  // ── Кадр ───────────────────────────────────────────────────────────────
  update(time, delta) {
    const dt = delta / 1000;
    if (this.menu) { this.updateMenu(); return; }
    if (this.stage === 'report') { this.updateReport(dt); return; }
    if (this.stage === 'flight') this.updateFlight(dt);
    else if (this.stage === 'surface') this.updateSurface(dt);
    this.trackTeam(dt);
    if (this.auto && this.auto.size && this.players.length && !this.mission.failed) this.autoRoles(dt);
    if (this.stage === 'hangar' && this.time.now > this.hudT) { this.hudT = this.time.now + 300; this.updateOrderHud(); }
    if (this.tut) this.updateTutorial();
    else if (Phaser.Input.Keyboard.JustDown(this.hKey) && !this.mission.launched) this.startTutorial();
    this.updateNextHud();
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
    // внешнее управление (запись трейлера / автотесты): window.__drive[номер героя] = { dx, dy }
    const drv = window.__drive && window.__drive[pl.idx];
    if (drv) { dx = drv.dx; dy = drv.dy; }
    if (pl.win || this.tut || this.mission.launched || this.mission.failed) { dx = 0; dy = 0; } // пока открыто окно — стоим

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
    if (this.tut) {
      // идёт обучающий брифинг — ввод обрабатывает updateTutorial
    } else if (pl.win && pl.win.kind === 'brief') {
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
        const useful = st && this.canUse(pl, st) && (st.kind === 'calibrate' || (it.ref && it.ref.station === st.id) || (this.stage !== 'hangar' && this.acceptsItem(st, it)));
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
    g.fillStyle(active ? 0xffffff : pl.color, active ? 0.22 : 0.13);
    g.lineStyle(1, pl.color, 0.5);
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
    // кольцо цвета роли; у игрока с несколькими ролями — по сектору на каждую
    const ring = floor(R * 1.2), n = pl.roles.length;
    for (let k = 0; k < n; k++) {
      const a0 = Math.floor((ring.length * k) / n), a1 = Math.floor((ring.length * (k + 1)) / n);
      const seg = ring.slice(a0, a1 + 1); if (k === n - 1) seg.push(ring[0]);
      g.lineStyle(3, ROLES[pl.roles[k]].color, 0.95).strokePoints(seg, false);
    }
    if (pl.suited) g.lineStyle(2, 0xffffff, 0.9).strokePoints(floor(R * 1.45), true);

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

// ════════════════════════════════════════════════════════════════════════
// Этапы 2 и 3: полёт в круглом корабле и посадка с выходом на поверхность
// (методы добавляются в HangarScene — физика, герои, окна станций общие)
// ════════════════════════════════════════════════════════════════════════

// Круглый жилой отсек корабля: центр, радиус оси стены, толщина стены, радиус грузового лифта
const SHIP = { cx: 640, cy: 385, R: 350, wall: 18, lift: 120 };
// Посадочная сцена: та же круглая ракета (поменьше) слева, справа — поверхность. Шлюз — разрыв стены.
const LANDER = { cx: 372, cy: 385, R: 255, wall: 18, lift: 80, door: [-11, 11] };

// Станции на кольце: at — [угол°, расстояние от центра] (0° — вправо, 90° — к камере), size — [ширина, глубина] px
const SHIP_STATIONS = [
  { id: 'cockpit',   name: 'Cockpit Window', at: [-90, 336], size: [288, 10], role: 'ANY', look: 'cockpit', kind: 'decor' },
  { id: 'nav',       name: 'Nav Console',    at: [-90, 247], size: [125, 45], role: 'N', look: 'navconsole', kind: 'nav', open: true },
  { id: 'scibay',    name: 'Analyzer',       at: [-128, 264], size: [103, 56], role: 'S', look: 'analyzer', kind: 'scibay' },
  { id: 'board',     name: 'Mission Board',  at: [-52, 275], size: [125, 34], role: 'ANY', look: 'orderscreen', kind: 'board2' },
  { id: 'power',     name: 'Power Panel',    at: [-158, 278], size: [56, 92], role: 'E', look: 'powerpanel', kind: 'powerpanel' },
  { id: 'engine',    name: 'Engine',         at: [-28, 264], size: [69, 69], role: 'E', look: 'engine', kind: 'engine2', high: true },
  { id: 'fuelcells', name: 'Fuel Cells',     at: [3, 287], size: [52, 69], role: 'E', look: 'fuelcells', kind: 'fuelcell' },
  { id: 'data',      name: 'Data Storage',   at: [20, 294], size: [45, 63], role: 'S', look: 'datastorage', kind: 'datastore', high: true },
  { id: 'antenna',   name: 'Antenna',        at: [41, 278], size: [65, 65], role: 'N', look: 'antenna', kind: 'antenna' },
  { id: 'jettison',  name: 'Jettison',       at: [66, 292], size: [58, 58], role: 'ANY', look: 'jettison', kind: 'jettison' },
  { id: 'water',     name: 'Water Recycler', at: [92, 298], size: [58, 47], role: 'L', look: 'waterrecycler', kind: 'water' },
  { id: 'air',       name: 'Air System',     at: [113, 292], size: [58, 47], role: 'L', look: 'airsystem', kind: 'air', high: true },
  { id: 'o2rack',    name: 'O2 Storage',     at: [134, 285], size: [81, 67], role: 'L', look: 'o2', kind: 'o2rack' },
  { id: 'workbench', name: 'Workbench',      at: [170, 280], size: [92, 69], role: 'E', look: 'workbench', kind: 'workbench2' },
  { id: 'lift',      name: 'Cargo Lift',     at: [0, 0], size: [240, 240], role: 'ANY', look: 'cargolift', kind: 'lift', zone: true, circle: 120 },
];

// Посадочная сцена: внутри круглой ракеты (центр LANDER) и снаружи
const SURF_STATIONS = [
  { id: 'nav',      name: 'Nav Console',  at: [-90, 177], size: [109, 40], role: 'N', look: 'navconsole', kind: 'ascent', open: true },
  { id: 'lab',      name: 'Sample Lab',   at: [-138, 177], size: [90, 50], role: 'S', look: 'analyzer', kind: 'samplelab' },
  { id: 'data',     name: 'Data Storage', at: [-42, 195], size: [42, 55], role: 'S', look: 'datastorage', kind: 'datastore', high: true },
  { id: 'antenna',  name: 'Antenna',      at: [40, 186], size: [59, 59], role: 'N', look: 'antenna', kind: 'antenna' },
  { id: 'suitrack', name: 'Suit Rack',    at: [150, 173], size: [97, 59], role: 'L', look: 'suitrack', kind: 'suitrack', open: true },
  { id: 'airlock',  name: 'Airlock',      at: [0, 257], size: [32, 97], role: 'ANY', look: 'airlock', kind: 'decor', nosolid: true },
  { id: 'lift',     name: 'Cargo Lift',   at: [0, 0], size: [160, 160], role: 'ANY', look: 'cargolift', kind: 'lift', zone: true, circle: 80 },
];
// Камни на поверхности (препятствия) и места для научных площадок — в мировых px
const SURF_ROCKS = [
  [700, 150, 26], [905, 118, 18], [1150, 175, 30], [1205, 420, 22], [1010, 612, 28], [760, 640, 20],
  [870, 330, 16], [1100, 300, 14], [640, 560, 15], [1185, 600, 16],
];
const SITE_SPOTS = [[800, 250], [980, 210], [1120, 380], [950, 480], [780, 520], [1080, 560]];
const SURF_BOUNDS = { l: OX + 10, t: OY + 10, r: OX + GRID_W * TILE - 10, b: OY + GRID_H * TILE - 10 };

// Прямоугольник станции на кольце (то же считает рендер интерьера)
const ringRect = (c, def) => {
  const a = (def.at[0] * Math.PI) / 180, x = c.cx + Math.cos(a) * def.at[1], y = c.cy + Math.sin(a) * def.at[1];
  return { l: x - def.size[0] / 2, t: y - def.size[1] / 2, r: x + def.size[0] / 2, b: y + def.size[1] / 2 };
};

Object.assign(HangarScene.prototype, {
  // ── Общая сборка уровня этапа: картинки из 3D-рендера + станции + стены-кольцо ──
  buildStageLevel(metaKey, defs, C) {
    const meta = this.cache.json.get(metaKey);
    this.textured = !!meta && meta.layers.every((L) => this.textures.exists(L.key));
    if (this.textured) for (const L of meta.layers) this.add.image(L.x, L.y, L.key).setOrigin(0).setScale(1 / meta.scale).setDepth(L.depth);
    else this.drawRingFallback(C);
    this.solids = []; this.boxes = [];
    this.stations = defs.map((def) => {
      const { l, t, r, b } = ringRect(C, def);
      if (def.zone) {
        const st = this.buildScaleZone(def, l, t, r, b);
        st.circle = { cx: C.cx, cy: C.cy, r: def.circle };
        return st;
      }
      const hgt = def.high ? HIGH_H : LOW_H;
      const st = { ...def, l, t, r, b, h: hgt, label: null, given: false, anchor: proj((l + r) / 2, (t + b) / 2, hgt + 10) };
      if (!def.nosolid) { st.solid = { l, t, r, b, high: !!def.high, h: hgt, station: st }; this.solids.push(st.solid); }
      if (!this.textured) {
        const box = this.addBox(l, t, r, b, def.kind === 'decor' ? 8 : hgt, 0x353c66, 0x47507c, 0x8c96c8);
        const stripe = [proj(l, b - 6, hgt), proj(r, b - 6, hgt), proj(r, b, hgt), proj(l, b, hgt)];
        if (def.kind !== 'decor') box.g.fillStyle(ROLES[def.role].color, 1).fillPoints(stripe, true);
      }
      return st;
    });
    this.makeBubbles();
    this.arena = { cx: C.cx, cy: C.cy, R: C.R, wt: C.wall / 2 + 2, door: C.door || null, outside: !!C.door };
    this.cameras.main.fadeIn(500, 6, 10, 28);
  },

  // Запасная отрисовка, если картинок рендера нет: пол-круг и стена
  drawRingFallback(C) {
    const g = this.add.graphics().setDepth(-1000);
    if (C.door) { // поверхность
      g.fillStyle(0xb5562e, 1).fillPoints([proj(SURF_BOUNDS.l, SURF_BOUNDS.t), proj(SURF_BOUNDS.r, SURF_BOUNDS.t), proj(SURF_BOUNDS.r, SURF_BOUNDS.b), proj(SURF_BOUNDS.l, SURF_BOUNDS.b)], true);
      for (const [x, y, r] of SURF_ROCKS) g.fillStyle(0x7a3a20, 1).fillPoints(circlePts(x, y, r, 14).map((p) => proj(p.x, p.y, 0)), true);
    }
    g.fillStyle(0xe4e9f1, 1).fillPoints(circlePts(C.cx, C.cy, C.R, 64).map((p) => proj(p.x, p.y, 0)), true);
    g.lineStyle(10, 0x37598f, 1).strokePoints(circlePts(C.cx, C.cy, C.R, 64).map((p) => proj(p.x, p.y, 0)), true);
  },

  // ── Стена-кольцо: герои и предметы не проходят сквозь неё (в скафандре — через шлюз) ──
  inDoor(x, y) {
    const A = this.arena;
    if (!A.door) return false;
    const a = (Math.atan2(y - A.cy, x - A.cx) * 180) / Math.PI;
    return a >= A.door[0] && a <= A.door[1];
  },
  ringPush(x, y, rad, canDoor, side = null) {
    const A = this.arena, dx = x - A.cx, dy = y - A.cy, d = Math.hypot(dx, dy) || 1;
    const inner = A.R - A.wt - rad, outer = A.R + A.wt + rad;
    let nd = d;
    if (!A.outside) { if (d > inner) nd = inner; }
    else if (d > inner && d < outer) {
      if (canDoor && this.inDoor(x, y)) {
        // проём шлюза: держим внутри по углу, чтобы не тереться о косяки
        const a = Math.atan2(dy, dx), lim = ((A.door[1] - 2) * Math.PI) / 180;
        const ca = Phaser.Math.Clamp(a, -lim, lim);
        if (ca !== a) return { x: A.cx + Math.cos(ca) * d, y: A.cy + Math.sin(ca) * d };
        return null;
      }
      nd = side === 'in' ? inner : side === 'out' ? outer : d - inner < outer - d ? inner : outer;
    }
    let px = A.cx + (dx / d) * nd, py = A.cy + (dy / d) * nd;
    if (A.outside) { px = Phaser.Math.Clamp(px, SURF_BOUNDS.l + rad, SURF_BOUNDS.r - rad); py = Phaser.Math.Clamp(py, SURF_BOUNDS.t + rad, SURF_BOUNDS.b - rad); }
    if (nd === d && px === x && py === y) return null;
    return { x: px, y: py };
  },
  arenaBody(pl) {
    const b = pl.body.body;
    // без скафандра в шлюз не пускаем; с предметом в руках — тоже можно, если в скафандре
    const p = this.ringPush(b.center.x, b.center.y, PLAYER_RADIUS, pl.suited, pl.ringSide);
    const A = this.arena;
    const fin = p || b.center, dd = Math.hypot(fin.x - A.cx, fin.y - A.cy);
    // с какой стороны стены герой был в прошлый раз (чтобы быстрый шаг не «проскакивал» стену)
    if (dd < A.R - A.wt) pl.ringSide = 'in'; else if (dd > A.R + A.wt) pl.ringSide = 'out';
    if (!p) return;
    const nx = p.x - b.center.x, ny = p.y - b.center.y, len = Math.hypot(nx, ny) || 1;
    b.position.x += nx; b.position.y += ny; b.updateCenter();
    const vn = (b.velocity.x * nx + b.velocity.y * ny) / len;
    if (vn < 0) b.velocity.set(b.velocity.x - (nx / len) * vn, b.velocity.y - (ny / len) * vn);
    if (!pl.suited && this.arena.door && this.inDoor(b.center.x, b.center.y) && this.time.now > (pl.doorMsgT || 0)) {
      pl.doorMsgT = this.time.now + 2500;
      const st = this.stations.find((s) => s.id === 'airlock');
      if (st) this.floatText(st, 'EVA suit required — put one on at the Suit Rack', '#ffcf5a');
    }
  },
  arenaItem(it) {
    const p = this.ringPush(it.x, it.y, ITEM_RADIUS, true, it.ringSide);
    if (p) { it.x = p.x; it.y = p.y; it.vx *= -0.3; it.vy *= -0.3; }
    const A = this.arena, dd = Math.hypot(it.x - A.cx, it.y - A.cy);
    if (dd < A.R - A.wt) it.ringSide = 'in'; else if (dd > A.R + A.wt) it.ringSide = 'out';
  },

  // Положить список груза из прошлого этапа на грузовой лифт (по кругу)
  spawnCargo(list, C, liftR) {
    const n = list.length;
    list.forEach((c, i) => {
      const ring = i < 8 ? 0 : i < 22 ? 1 : 2, idxIn = ring === 0 ? i : ring === 1 ? i - 8 : i - 22, cnt = ring === 0 ? Math.min(8, n) : ring === 1 ? Math.min(14, n - 8) : n - 22;
      const rr = [liftR * 0.32, liftR * 0.62, liftR * 0.86][ring], a = (idxIn / Math.max(1, cnt)) * Math.PI * 2 + ring * 0.3;
      const it = this.createItem({ name: c.name, mass: c.mass, code: c.code }, c.color || 0x9ed36a, C.cx + Math.cos(a) * rr, C.cy + Math.sin(a) * rr);
      Object.assign(it, { type: c.type, code: c.code, bad: c.bad, uid: ++this.uidSeq, cost: c.cost || 0, power: c.power || 0,
        calibrated: c.calibrated, calQuality: c.calQuality, calRef: 50, rotation: a + Math.PI / 2, extra: c.extra || null });
    });
  },
  cargoSnapshot() {
    return this.items.filter((it) => !it.gone).map((it) => ({ type: it.type, code: it.code, name: it.name, mass: it.mass, bad: it.bad || null,
      calibrated: !!it.calibrated, calQuality: it.calQuality || 0, cost: it.cost || 0, power: it.power || 0, color: it.color, extra: it.extra || null }));
  },
  removeItem(it) {
    if (it.carrier) it.carrier.carrying = null;
    it.gfx.destroy(); it.label.destroy(); if (it.spr) it.spr.destroy();
    it.gone = true;
    this.items = this.items.filter((x) => x !== it);
  },

  // Провал миссии: короткая надпись → отчёт
  failMission(reason) {
    if (this.mission.failed) return;
    this.mission.failed = true;
    for (const p of this.players) this.closeWindow(p);
    if (!GAME.mission) GAME.mission = { order: this.order, tickets: this.tickets, cargo: [], mistakes: this.mistakes, gates: this.prepGates ? this.prepGates() : [], team: this.teamStats(), log: [] };
    const M = GAME.mission;
    M.failed = reason; M.failedStage = this.stage; M.mistakes = this.mistakes; M.team = this.teamStats();
    if (this.stage === 'flight' && this.flight) M.flight = this.flightSummary();
    if (this.stage === 'surface' && this.surf) M.surface = this.surfaceSummary();
    this.banner.setText('💀 Mission failed\n' + reason).setVisible(true).setFontSize(26);
    this.time.delayedCall(3200, () => this.scene.restart({ stage: 'report' }));
  },

  // Работа «по времени» в окне станции (например, сборка заплатки на верстаке)
  startJob(w, label, secs, done) { w.job = { label, t: 0, dur: secs, done }; },
  tickJobs(dt) {
    for (const pl of this.players) {
      const w = pl.win;
      if (!w || !w.job) continue;
      w.job.t += dt;
      if (w.job.t >= w.job.dur) { const d = w.job.done; w.job = null; d(); }
    }
  },

  // Предмет в руках «применяется» к станции без окна (заплатка к утечке, баллон в Air System…)
  itemToStation(pl, st) {
    if (this.stage === 'flight') return this.flightItemUse(pl, st);
    if (this.stage === 'surface') return this.surfaceItemUse(pl, st);
    return false;
  },
  acceptsItem(st, it) {
    if (this.stage === 'flight') return ['jettison', 'air', 'water', 'leak', 'fuelcell', 'powerpanel', 'scibay', 'o2rack'].includes(st.kind);
    if (this.stage === 'surface') return ['site', 'samplelab', 'suitrack'].includes(st.kind);
    return false;
  },

  stageSpec(w, spec, st, pl, diff) {
    if (this.stage === 'flight') this.flightSpec(w, spec, st, pl, diff);
    else if (this.stage === 'surface') this.surfaceSpec(w, spec, st, pl, diff);
  },

  // Табличка-шкала (HUD): подпись + полоска
  hudBar(g, add, x, y, w, label, frac, color, valueText, warn) {
    g.fillStyle(0x0b1028, 0.9).fillRoundedRect(x, y, w, 30, 6);
    g.lineStyle(1, warn ? 0xff7a7a : 0x2a3266, 1).strokeRoundedRect(x, y, w, 30, 6);
    add(x + 7, y + 3, label, { color: '#8c96c8', fontSize: '9.5px', fontStyle: 'bold' });
    add(x + w - 7, y + 3, valueText, { color: warn ? '#ff8a8a' : '#e6e9ff', fontSize: '9.5px', fontStyle: 'bold' }, 1);
    g.fillStyle(0x070a16, 1).fillRoundedRect(x + 7, y + 18, w - 14, 6, 3);
    g.fillStyle(warn ? 0xff6b6b : color, 1).fillRoundedRect(x + 7, y + 18, Math.max(0, (w - 14) * Phaser.Math.Clamp(frac, 0, 1)), 6, 3);
  },

  // Звёздное небо за кораблём
  starfield(seed = 7) {
    const g = this.add.graphics().setDepth(-2000);
    g.fillStyle(0x0b1230, 1).fillRect(-10, -10, 1300, 740);
    let s = seed;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 260; i++) {
      const x = rnd() * 1280, y = rnd() * 720, r = rnd() < 0.08 ? 1.6 : 0.8;
      g.fillStyle(0xffffff, 0.25 + rnd() * 0.6).fillCircle(x, y, r);
    }
    return g;
  },
});

// ── Этап 2: Полёт ─────────────────────────────────────────────────────────
// Нагрузки шины питания в полёте (ед.). Fuel Cells дают 8 — всё сразу не включить.
const FLIGHT_LOADS = [
  { id: 'AVI', name: 'AVIONICS', load: 2, why: 'navigation & engine control' },
  { id: 'LS', name: 'LIFE SUPPORT', load: 3, why: 'air & water loops — keep ON' },
  { id: 'PAY', name: 'PAYLOAD (science)', load: 3, why: 'needed to run observations' },
  { id: 'COMMS', name: 'COMMS', load: 2, why: 'needed to downlink data' },
  { id: 'HEAT', name: 'HEATERS', load: 2, why: 'only during a cold soak' },
];
const BEARINGS = ['0° (ahead)', '45°', '90°', '135°', '180° (behind)', '225°', '270°', '315°'];
const BURN_DIRS = ['PROGRADE', 'RETROGRADE', 'NORMAL', 'ANTI-NORMAL'];
const EVENT_INFO = {
  comm:  { title: 'Earth comm window', role: 'N', icon: '📡' },
  tcm:   { title: 'Course correction burn', role: 'N', icon: '🧭' },
  leak:  { title: 'Hull leak!', role: 'E', icon: '💨' },
  power: { title: 'Fuel cell fault', role: 'E', icon: '⚡' },
  flare: { title: 'Solar flare', role: 'ANY', icon: '☀' },
  co2:   { title: 'CO2 filter saturated', role: 'L', icon: '🫁' },
  clog:  { title: 'Water filter clogged', role: 'L', icon: '💧' },
  cold:  { title: 'Cold soak', role: 'E', icon: '❄' },
  sci:   { title: 'Observation window', role: 'S', icon: '🔭' },
};
const DIFF_RATE = [0.7, 1, 1.15, 1.3];   // как быстро всё портится на разных сложностях
const DATA_RATE = 3;                     // МБ/с при антенне ×1

Object.assign(HangarScene.prototype, {
  buildShip() {
    this.starfield(11);
    this.buildStageLevel('shipmeta', SHIP_STATIONS, SHIP);
  },

  initFlight() {
    const M = GAME.mission, t = this.orderTarget(), route = ROUTES[M.route], diff = this.difficulty();
    const days = Math.max(3, Math.round(t.travel * route.timeMul));
    const dur = Phaser.Math.Clamp(150 + days * 0.45, 150, 400);
    // баллоны O2 из груза едут в стойку O2 Storage, остальное — на грузовом лифте
    const full = M.cargo.filter((c) => c.code === 'O2' && !c.bad).length;
    this.spawnCargo(M.cargo.filter((c) => !(c.code === 'O2' && !c.bad)), SHIP, SHIP.lift);
    const F = this.flight = {
      t: 0, dur, days, need: route.need, k: DIFF_RATE[diff],
      o2: 100, water: 100, hull: 100, co2Bad: false, dose: 0, hypoxiaT: 0, o2Min: 100, hullMin: 100, waterMin: 100,
      o2Full: full, o2Empty: 0,
      power: { on: { AVI: true, LS: true, PAY: false, COMMS: false, HEAT: false }, cap: 8, fault: false },
      data: {}, mounted: [], obs: null,
      courseErr: 0, tcmDone: 0, armedT: 0, downlink: false, bearing: 0,
      hungry: 0, foodEaten: 0, jettisoned: [], log: [], events: [], alerts: [],
      arrived: false, landing: null, handled: 0, missed: 0,
      foodTimes: Array.from({ length: route.need.food }, (_, i) => ((i + 1) / (route.need.food + 0.5)) * dur),
    };
    // расписание событий
    const sched = [];
    const add = (type, at, extra = {}) => sched.push({ type, at: at * dur, ...extra });
    for (const f of [0.17, 0.5, 0.83]) add('comm', f, { bearing: Phaser.Math.Between(0, 7) });
    add('tcm', 0.3); add('tcm', 0.66);
    const fTickets = (this.tickets || []).filter((tk) => tk.phase === 'F');
    fTickets.forEach((tk, i) => add('sci', 0.1 + i * 0.22, { ticket: tk.id }));
    const hazards = Phaser.Utils.Array.Shuffle(['leak', 'power', 'flare', 'co2', 'clog', 'cold']).slice(0, [3, 4, 5, 6][diff]);
    // важные аварии — обязательно, если есть ремкомплекты, чтобы они пригодились
    hazards.forEach((h, i) => add(h, 0.2 + (i + 0.5) * (0.62 / hazards.length) + Phaser.Math.FloatBetween(-0.03, 0.03)));
    sched.sort((a, b) => a.at - b.at);
    F.schedule = sched;
    this.makeFlightHud();
    this.makeCockpitView();
    this.cameras.main.fadeIn(600, 6, 10, 28);
    this.time.delayedCall(700, () => {
      if (!window.NO_TUTORIAL) this.startTutorial();
    });
  },

  // ── Ход полёта ──
  updateFlight(dt) {
    const F = this.flight;
    if (!F || this.mission.failed) return;
    this.tickJobs(dt);
    if (F.landing) { this.updateLanding(dt); this.drawFlightHud(); return; }
    if (this.tut) { this.drawFlightHud(); return; }
    const P = F.power;
    F.t = Math.min(F.dur, F.t + dt);
    const k = F.k;
    // запуск событий по расписанию
    while (F.schedule.length && F.schedule[0].at <= F.t) this.startEvent(F.schedule.shift());
    // расход кислорода и воды; без LIFE SUPPORT — втрое быстрее
    if (!F.arrived) {
      const ls = P.on.LS ? 1 : 3;
      F.o2 -= (F.need.o2 * 100 / F.dur) * dt * ls * (F.co2Bad ? 1.8 : 1) * (0.85 + 0.15 * k);
      F.water -= (F.need.water * 100 / F.dur) * dt * (P.on.LS ? 1 : 2) * (0.85 + 0.15 * k);
      while (F.foodTimes.length && F.foodTimes[0] <= F.t) { F.foodTimes.shift(); this.eatFood(); }
    }
    // утечка
    const leak = F.events.find((e) => e.type === 'leak' && !e.done);
    if (leak) { F.hull -= 0.55 * k * dt; F.o2 -= 0.35 * k * dt; }
    F.o2 = Math.max(0, F.o2); F.water = Math.max(0, F.water);
    F.o2Min = Math.min(F.o2Min, F.o2); F.hullMin = Math.min(F.hullMin, F.hull); F.waterMin = Math.min(F.waterMin, F.water);
    if (F.o2 <= 0) { F.hypoxiaT += dt; if (F.hypoxiaT > 12) { this.failMission('Cabin oxygen ran out — the crew could not breathe'); return; } }
    if (F.water <= 0) F.hypoxiaT += dt * 0.3;
    if (F.hull <= 45) { this.failMission('Hull breach — the cabin depressurized'); return; }
    // питание: если перегрузка — отключаются необязательные потребители
    const load = this.flightLoad();
    if (load > P.cap) {
      for (const id of ['HEAT', 'COMMS', 'PAY']) if (this.flightLoad() > P.cap && P.on[id]) { P.on[id] = false; this.alert(`Overload — ${id} breaker tripped`, 0xffb020); }
    }
    // двигатель «взведён» ограниченное время
    if (F.armedT > 0) F.armedT = Math.max(0, F.armedT - dt);
    // наблюдение (научный тикет полёта)
    if (F.obs) {
      const win = F.events.find((e) => e.type === 'sci' && e.ticket === F.obs.ticket && !e.done && !e.expired);
      if (!win || !P.on.PAY) { if (!F.obs.pauseMsg) { F.obs.pauseMsg = true; this.alert(!win ? 'Observation window closed' : 'Observation paused — PAYLOAD power is off', 0xffb020); } }
      else {
        F.obs.pauseMsg = false;
        F.obs.t += dt;
        if (F.obs.t >= F.obs.dur) this.finishObservation(win);
      }
    }
    // передача данных на Землю
    this.tickDownlink(dt, F.events.find((e) => e.type === 'comm' && e.active));
    // активные события: таймеры
    for (const e of F.events) {
      if (!e.active) continue;
      e.left -= dt;
      this.tickEvent(e, dt);
      if (e.left <= 0 && e.active) this.endEvent(e);
    }
    if (!F.arrived && F.t >= F.dur) {
      F.arrived = true;
      for (const e of F.events) if (e.active && e.type !== 'leak' && e.type !== 'power') this.endEvent(e);
      this.alert(`Arrived at ${this.orderTarget().name}! Navigator: BEGIN DESCENT at the Nav Console`, 0x8be08b, 6);
      F.log.push(`Day ${F.days}: arrived at ${this.orderTarget().name}`);
    }
    this.drawFlightHud();
    this.drawCockpitView();
  },

  flightLoad() { const P = this.flight.power; return FLIGHT_LOADS.filter((b) => P.on[b.id]).reduce((a, b) => a + b.load, 0); },
  day() { const F = this.flight; return Math.min(F.days, Math.floor((F.t / F.dur) * F.days) + 1); },

  eatFood() {
    const F = this.flight;
    const box = this.items.find((it) => it.type === 'food' && !it.bad && !it.carrier) || this.items.find((it) => it.type === 'food' && !it.bad);
    if (box) { this.removeItem(box); F.foodEaten++; F.log.push(`Day ${this.day()}: crew opened a food box`); }
    else { F.hungry++; this.alert('No food boxes left — crew on emergency rations', 0xff7a7a); F.log.push(`Day ${this.day()}: no food left!`); }
  },

  // ── События ──
  startEvent(ev) {
    const F = this.flight, diff = this.difficulty();
    const e = { ...ev, active: true, done: false, t0: F.t, rt0: this.time.now };
    const k = F.k;
    switch (e.type) {
      case 'comm': e.left = 38; F.bearing = -1; break;
      case 'tcm': e.left = 55 / Math.sqrt(k); e.dv = Math.round(Phaser.Math.FloatBetween(4, 24) * 10) / 10; e.dir = Phaser.Math.Between(0, 3); break;
      case 'leak': {
        e.left = 9999;
        // место утечки — на стене между станциями
        const free = [-105, -75, -40, 10, 30, 55, 80, 100, 122, 145, 160, 185, -170, -142].map((a) => a * Math.PI / 180);
        const a = Phaser.Utils.Array.GetRandom(free), r = SHIP.R - 30;
        const x = SHIP.cx + Math.cos(a) * r, y = SHIP.cy + Math.sin(a) * r;
        const st = { id: 'leak', name: 'Leak', kind: 'leak', role: 'ANY', l: x - 16, t: y - 16, r: x + 16, b: y + 16, h: 6, anchor: proj(x, y, 30), dynamic: true };
        this.stations.push(st);
        e.st = st; e.x = x; e.y = y;
        e.fx = this.add.graphics().setDepth(y + 1);
        this.makeBubble(st, 0xff7a7a);
        break;
      }
      case 'power': e.left = 9999; F.power.cap = 5; F.power.fault = true; break;
      case 'flare': e.left = 34; e.warn = 16; break;
      case 'co2': e.left = 40 / Math.sqrt(k); break;
      case 'clog': e.left = 45 / Math.sqrt(k); break;
      case 'cold': e.left = 45 / Math.sqrt(k); e.heat = 0; break;
      case 'sci': e.left = 70; break;
      default: break;
    }
    F.events.push(e);
    const info = EVENT_INFO[e.type];
    this.alert(`${info.icon} ${info.title}${e.type === 'sci' ? ' — ' + this.tickets.find((t) => t.id === e.ticket).name : ''}`, ROLES[info.role].color, 4);
    F.log.push(`Day ${this.day()}: ${info.title}`);
  },

  tickEvent(e, dt) {
    const F = this.flight, P = F.power;
    if (e.type === 'flare') {
      if (e.warn > 0) { e.warn -= dt; if (e.warn <= 0) this.alert('☀ Radiation storm NOW — everyone into the Cargo Lift shelter!', 0xffcf5a, 3); return; }
      const out = this.players.filter((p) => Math.hypot(p.body.x - SHIP.cx, p.body.y - SHIP.cy) > SHIP.lift);
      F.dose += out.length * dt;
      // дозиметр на борту (S03 / S11) записывает научные данные о вспышке
      if (P.on.PAY) for (const tk of this.tickets.filter((t2) => t2.phase === 'F' && t2.needs.some((n) => ['S03', 'S11'].includes(n)))) {
        if (tk.needs.every((n) => this.onBoard(n))) this.addData(tk.id, dt * 3);
      }
    }
    if (e.type === 'cold' && P.on.HEAT) { e.heat += dt; if (e.heat >= 12) { e.done = true; F.handled++; this.endEvent(e, true); this.alert('Cabin warm again ✓', 0x8be08b); } }
  },

  endEvent(e, ok = false) {
    const F = this.flight;
    e.active = false;
    if (e.done || ok) { e.done = true; return; }
    e.expired = true;
    switch (e.type) {
      case 'comm': if (F.downlink) F.downlink = false; break;
      case 'tcm': F.courseErr++; F.missed++; this.alert('Correction missed — landing will need more fuel', 0xff7a7a); F.log.push(`Day ${this.day()}: correction burn missed`); break;
      case 'co2': F.co2Bad = true; F.missed++; this.alert('CO2 builds up — oxygen use doubled until the filter is replaced', 0xff7a7a); e.active = true; e.left = 9999; e.expired = false; e.late = true; break;
      case 'clog': F.water = Math.max(0, F.water - 25); F.missed++; this.alert('Water filter failed — lost 25% water', 0xff7a7a); break;
      case 'cold': F.water = Math.max(0, F.water - 20); F.missed++; this.alert('Water lines froze — lost 20% water', 0xff7a7a); break;
      case 'flare': if (F.dose > 0.5) F.log.push(`Radiation dose: ${F.dose.toFixed(1)} crew·s outside shelter`); if (F.dose < 0.5) F.handled++; else F.missed++; e.done = true; break;
      case 'sci': F.log.push(`Observation window closed: ${e.ticket}`); break;
      default: break;
    }
  },

  resolveEvent(type, msg) {
    const F = this.flight;
    const e = F.events.find((x) => x.type === type && x.active);
    if (!e) return false;
    e.done = true; e.active = false; F.handled++;
    if (e.late) F.handled--;
    if (msg) this.alert(msg, 0x8be08b);
    return e;
  },

  onBoard(code) { return this.items.some((it) => it.code === code) || this.flight.mounted.some((m) => m.code === code); },

  addData(tid, mb) {
    const d = this.flight.data[tid] = this.flight.data[tid] || { made: 0, sent: 0 };
    d.made += mb;
  },
  storedData() { return Object.values(this.flight.data).reduce((a, d) => a + d.made - d.sent, 0); },

  tickDownlink(dt, win) {
    const F = this.flight;
    if (!F.downlink) return;
    if (!win || F.bearing !== win.bearing || !F.power.on.COMMS) return;
    let budget = DATA_RATE * ANTENNAS[this.prep.design.ant].rate * dt;
    for (const d of Object.values(F.data)) {
      const left = d.made - d.sent;
      if (left <= 0) continue;
      const x = Math.min(left, budget); d.sent += x; budget -= x;
      if (budget <= 0) break;
    }
  },

  finishObservation(win) {
    const F = this.flight, tk = this.tickets.find((t) => t.id === F.obs.ticket);
    const qs = tk.needs.map((n) => { const m = F.mounted.find((x) => x.code === n); return m && m.calibrated ? m.calQuality : 40; });
    const q = qs.reduce((a, b) => a + b, 0) / qs.length / 100;
    this.addData(tk.id, tk.pts * q);
    F.obs = null;
    win.done = true; win.active = false; F.handled++;
    this.alert(`🔭 ${tk.name}: ${Math.round(tk.pts * q)} MB of data stored — downlink it in a comm window`, 0x8be08b, 4);
    F.log.push(`Day ${this.day()}: ${tk.id} observation complete (${Math.round(tk.pts * q)} MB)`);
  },

  // Короткие всплывающие сообщения сверху по центру
  alert(text, color = 0xffffff, secs = 3) {
    const F = this.flight || this.surf;
    if (!F) return;
    const t = this.add.text(640, 54, text, { color: '#ffffff', fontSize: '15px', fontStyle: 'bold', backgroundColor: hex(shadeColor(color, 0.55)) + 'ee', padding: { x: 12, y: 6 } })
      .setOrigin(0.5, 0).setDepth(24000);
    F.alerts.push(t);
    const relayout = () => { F.alerts = F.alerts.filter((a) => a.active); F.alerts.forEach((a, i) => { a.y = 54 + (F.alerts.length - 1 - i) * 32; }); };
    relayout();
    this.tweens.add({ targets: t, alpha: 0, delay: secs * 1000, duration: 500, onComplete: () => { t.destroy(); relayout(); } });
  },

  // ── Применение предмета к станции в полёте ──
  flightItemUse(pl, st) {
    const F = this.flight, it = pl.carrying, diff = this.difficulty();
    switch (st.kind) {
      case 'jettison': {
        const useful = (it.type === 'o2' && !it.bad) || (it.type === 'water' && !it.bad) || (it.type === 'food' && !it.bad) || it.type === 'kit';
        const neededInst = it.type === 'instrument' && (this.tickets || []).some((t) => t.needs.includes(it.code));
        if ((useful || neededInst) && diff <= 1 && pl.jetConfirm !== it) { pl.jetConfirm = it; this.floatText(st, `${it.name} is still useful! Press again to throw it out`, '#ffb35c'); return true; }
        if (useful || neededInst) { this.mistake(st, `Jettisoned useful ${it.name}`, true); F.wasted = (F.wasted || 0) + it.mass; }
        pl.jetConfirm = null;
        F.jettisoned.push({ name: it.name, mass: it.mass, dead: !(useful || neededInst) });
        this.removeItem(it);
        this.floatText(st, `−${it.mass} kg jettisoned`, '#8be08b');
        F.log.push(`Day ${this.day()}: jettisoned ${it.name} (${it.mass} kg)`);
        return true;
      }
      case 'air':
        if (it.code === 'O2' && !it.bad) {
          const waste = Math.max(0, F.o2 + 100 - 100);
          F.o2 = Math.min(100, F.o2 + 100);
          if (waste > 40 && diff <= 1) this.floatText(st, `Tank was ${Math.round(100 - (100 - waste))}% — some oxygen wasted`, '#ffb35c');
          else this.floatText(st, 'O2 tank refilled ✓', '#8be08b');
          // в руках остаётся пустой баллон
          Object.assign(it, { code: 'O2E', name: 'O2 cylinder — EMPTY', mass: 25, bad: 'empty cylinder', color: 0x9aa08a });
          return true;
        }
        return false;
      case 'water':
        if (it.type === 'water') {
          const add = it.bad ? 50 : 100;
          F.water = Math.min(100, F.water + add);
          this.floatText(st, it.bad ? 'Wastewater recycled: +50% ✓' : 'Water tank refilled ✓', '#8be08b');
          this.removeItem(it);
          return true;
        }
        return false;
      case 'leak':
        if (it.code === 'KIT-P' || it.code === 'PATCH') {
          const e = F.events.find((x) => x.type === 'leak' && !x.done);
          if (!e) return false;
          this.resolveEvent('leak', it.code === 'KIT-P' ? 'Leak sealed with the pressure-seal kit ✓' : 'Leak sealed with an improvised patch ✓');
          this.removeItem(it);
          e.fx.destroy(); this.stations = this.stations.filter((s) => s !== e.st); if (e.st.bubble) e.st.bubble.destroy();
          F.log.push(`Day ${this.day()}: leak sealed (${it.code === 'KIT-P' ? 'spare kit' : 'patch'})`);
          return true;
        }
        this.floatText(st, 'Needs the Pressure-seal kit or a patch from the Workbench', '#ffb35c');
        return true;
      case 'fuelcell':
        if ((it.code === 'KIT-E' || it.code === 'HARNESS') && F.power.fault) {
          F.power.cap = it.code === 'KIT-E' ? 8 : 7; F.power.fault = false;
          this.resolveEvent('power', it.code === 'KIT-E' ? 'Fuel cell repaired with the electrical kit ✓ (8 u)' : 'Rewired — 7 u available ✓');
          this.removeItem(it);
          return true;
        }
        return false;
      case 'scibay':
        if (it.type === 'instrument') {
          F.mounted.push({ code: it.code, name: it.name, calibrated: it.calibrated, calQuality: it.calQuality, mass: it.mass, power: it.power, cost: it.cost, color: it.color });
          this.removeItem(it);
          this.floatText(st, `${it.code} mounted in the Analyzer`, '#8be08b');
          return true;
        }
        return false;
      case 'o2rack':
        if (it.code === 'O2E') { F.o2Empty++; this.removeItem(it); this.floatText(st, 'Empty cylinder racked', '#8be08b'); return true; }
        if (it.code === 'O2' && !it.bad) { F.o2Full++; this.removeItem(it); this.floatText(st, 'Full cylinder racked', '#8be08b'); return true; }
        return false;
      default: return false;
    }
  },

  // ── Окна станций в полёте ──
  flightSpec(w, spec, st, pl, diff) {
    const F = this.flight, P = F.power, ok = '#8be08b';
    const ev = (type) => F.events.find((e) => e.type === type && e.active);
    switch (st.kind) {
      case 'nav': {
        spec.width = 270;
        if (F.arrived) {
          spec.info = [`In orbit around ${this.orderTarget().name}.`, `Course errors: ${F.courseErr} · landing fuel: ${this.landingFuel()} kg`];
          spec.rows = [{ kind: 'primary', label: '🪂 BEGIN DESCENT', act: () => this.startLanding(pl) }];
          break;
        }
        const e = ev('tcm');
        if (!e) { spec.info = ['Course nominal.', `Day ${this.day()} / ${F.days}`, `Corrections done: ${F.tcmDone} · missed: ${F.courseErr}`]; break; }
        w.dir = w.dir ?? 0; w.digits = w.digits && w.digits.length === 3 ? w.digits : [0, 0, 0]; w.dc = w.dc ?? 0;
        const val = Number(w.digits.join('')) / 10;
        spec.info = ['Trajectory correction required:', `Δv ${e.dv.toFixed(1)} m/s · ${BURN_DIRS[e.dir]}`,
          `Engine: ${F.armedT > 0 ? `ARMED (${Math.ceil(F.armedT)} s)` : 'not armed — Engineer: ARM at the Engine'}`];
        spec.rows = [
          { kind: 'pick', cap: 'Burn direction', label: BURN_DIRS[w.dir], adjust: (s2) => { w.dir = (w.dir + s2 + 4) % 4; } },
          { kind: 'dial', dial: { digits: w.digits, cursor: w.dc, edit: !!w.dialEdit, unit: 'm/s', point: 2, gauge: false }, act: () => { w.dialEdit = true; } },
          { kind: 'primary', label: `🔥 BURN ${val.toFixed(1)} m/s`, act: () => {
            if (F.armedT <= 0) { this.mistake(st, 'Engine is not armed — ask the Engineer'); return; }
            if (!P.on.AVI) { this.mistake(st, 'AVIONICS power is off'); return; }
            const good = w.dir === e.dir && Math.abs(val - e.dv) <= Math.max(0.3, e.dv * 0.05);
            this.openCheck(w, 'Burn result', [
              { t: `Direction ${BURN_DIRS[w.dir]}`, ok: w.dir === e.dir, why: `Should burn ${BURN_DIRS[e.dir]}` },
              { t: `Δv ${val.toFixed(1)} m/s (target ${e.dv.toFixed(1)})`, ok: Math.abs(val - e.dv) <= Math.max(0.3, e.dv * 0.05), why: 'Δv off target' },
            ], { generic: 'Burn off target', pass: () => { this.resolveEvent('tcm', 'Course corrected ✓'); F.tcmDone++; F.armedT = 0; F.log.push(`Day ${this.day()}: correction burn ${val.toFixed(1)} m/s`); },
              fail: () => { if (!good) { F.courseErr += 0.5; } } });
          } },
        ];
        break;
      }
      case 'engine2': {
        const e = ev('tcm');
        spec.info = ['Main engine', F.armedT > 0 ? `ARMED — ${Math.ceil(F.armedT)} s left to burn` : 'Safe (not armed)'];
        if (diff <= 1) spec.info.push(e ? 'A correction burn is needed — arm the engine for the Navigator.' : 'Arm only when a burn is planned.');
        spec.rows = [{ kind: 'primary', label: F.armedT > 0 ? 'ARMED ✓' : '🔑 ARM ENGINE', disabled: F.armedT > 0, act: () => {
          if (!P.on.AVI) { this.mistake(st, 'AVIONICS power is off — engine control dead'); return; }
          if (!e) { this.mistake(st, 'No burn planned — arming wastes igniter life'); return; }
          F.armedT = 30;
        } }];
        break;
      }
      case 'powerpanel': {
        spec.width = 260;
        const load = this.flightLoad();
        spec.info = [`Power: ${load} / ${P.cap} u${P.fault ? '  ⚠ fuel cell fault' : ''}`];
        if (diff <= 1) spec.info.push('Turn loads on only when needed.');
        spec.rows = FLIGHT_LOADS.map((b) => ({ kind: 'toggle', label: b.name, on: !!P.on[b.id], right: `${b.load}u`, act: () => {
          if (P.on[b.id]) { P.on[b.id] = false; if (b.id === 'LS' && diff <= 1) this.floatText(st, 'Life support OFF — air runs out 3× faster!', '#ff8a8a'); return; }
          if (this.flightLoad() + b.load > P.cap) { this.mistake(st, `OVERLOAD — ${load + b.load} > ${P.cap} u, switch something off first`); return; }
          P.on[b.id] = true;
        } }));
        if (diff <= 1) { const r = FLIGHT_LOADS[Math.max(0, Math.min(w.sel, 4))]; if (r) spec.info.push(`${r.name}: ${r.why}`); }
        break;
      }
      case 'fuelcell':
        spec.info = [`Fuel cells: ${P.cap} u available`, P.fault ? '⚠ FAULT: one stack is down (5 u)' : 'All stacks nominal'];
        if (P.fault && diff <= 1) spec.info.push('Bring the Electrical spare kit (8 u)', 'or a rewired harness from the Workbench (7 u).');
        break;
      case 'board2': {
        spec.width = 290;
        const next = F.schedule.slice(0, 4).map((s) => `Day ${Math.ceil((s.at / F.dur) * F.days)}: ${EVENT_INFO[s.type].title}`);
        const comm = ev('comm');
        spec.info = [`Day ${this.day()} / ${F.days} · ${this.orderTarget().name}`, comm ? `📡 Earth visible at bearing ${BEARINGS[comm.bearing]} (${Math.ceil(comm.left)} s)` : '📡 Earth not in view',
          '', 'Coming up:', ...(next.length ? next : ['—']), '', 'Log:', ...F.log.slice(-4)];
        break;
      }
      case 'datastore': {
        spec.width = 270;
        const lines = Object.entries(F.data).map(([tid, d]) => `${tid}: ${Math.round(d.made)} MB made · ${Math.round(d.sent)} MB sent`);
        spec.info = ['Science data on board', ...(lines.length ? lines : ['(no data yet)']), `Waiting to send: ${Math.round(this.storedData())} MB`,
          `Antenna: ${ANTENNAS[this.prep.design.ant].name} · ${DATA_RATE * ANTENNAS[this.prep.design.ant].rate} MB/s`];
        break;
      }
      case 'antenna': {
        spec.width = 260;
        const comm = ev('comm');
        w.b = w.b ?? 0;
        spec.info = [comm ? `Comm window: ${Math.ceil(comm.left)} s left` : 'No comm window — Earth is behind the Sun/planet', `Waiting to send: ${Math.round(this.storedData())} MB`];
        if (comm && diff <= 1) spec.info.push(`Mission Board: Earth at ${BEARINGS[comm.bearing]}`);
        if (!P.on.COMMS) spec.info.push('⚠ COMMS power is off');
        const pointed = comm && F.bearing === comm.bearing;
        spec.rows = [
          { kind: 'pick', cap: 'Point the dish', label: BEARINGS[w.b], right: F.bearing === w.b ? (pointed ? 'LOCKED ✓' : 'pointed') : '', adjust: (s2) => { w.b = (w.b + s2 + 8) % 8; },
            act: () => { F.bearing = w.b; if (comm && w.b !== comm.bearing) this.mistake(st, 'No signal at this bearing', false); } },
          { kind: 'primary', label: F.downlink ? '■ STOP DOWNLINK' : '▶ START DOWNLINK', act: () => {
            if (!F.downlink && !comm) { this.mistake(st, 'No comm window now'); return; }
            F.downlink = !F.downlink;
          } },
        ];
        if (F.downlink && pointed && P.on.COMMS) spec.info.push(`Sending ${DATA_RATE * ANTENNAS[this.prep.design.ant].rate} MB/s…`);
        break;
      }
      case 'jettison':
        spec.info = ['Carry an item here and press action', 'to throw it out of the airlock.', 'Less mass = less fuel for landing.',
          `Jettisoned: ${Math.round(F.jettisoned.reduce((a, j) => a + j.mass, 0))} kg`];
        break;
      case 'water': {
        const e = ev('clog');
        spec.info = [`Water: ${Math.round(F.water)} %`, 'Bring a water bag to refill (wastewater → +50%).'];
        if (e) spec.rows = [{ kind: 'primary', label: w.job ? `Cleaning… ${Math.round((w.job.t / w.job.dur) * 100)}%` : '🧽 CLEAN FILTER', disabled: !!w.job,
          act: () => this.startJob(w, 'clean', 5, () => this.resolveEvent('clog', 'Water filter clean ✓')) }];
        break;
      }
      case 'air': {
        const e = ev('co2');
        spec.info = [`Cabin O2 tank: ${Math.round(F.o2)} %`, `Full cylinders in O2 Storage: ${F.o2Full}`, 'Bring a FULL cylinder to refill.'];
        if (e) spec.rows = [{ kind: 'primary', label: '🫁 REPLACE CO2 FILTER', act: () => { F.co2Bad = false; this.resolveEvent('co2', 'CO2 filter replaced ✓'); } }];
        break;
      }
      case 'o2rack':
        spec.info = [`Full cylinders: ${F.o2Full} · empty: ${F.o2Empty}`, 'Take a full one to the Air System.'];
        spec.rows = [{ kind: 'primary', label: 'TAKE FULL CYLINDER', disabled: F.o2Full <= 0, act: () => {
          if (pl.carrying) { this.floatText(st, 'Hands are full'); return; }
          F.o2Full--; this.giveItem(pl, { name: 'O2 cylinder (full)', mass: 45, code: 'O2', type: 'o2', color: 0x9ed36a, cost: 0.8 });
          this.closeWindow(pl);
        } }];
        break;
      case 'workbench2': {
        spec.width = 250;
        w.rec = w.rec ?? 0;
        const recs = [{ code: 'PATCH', name: 'Improvised hull patch', mass: 3 }, { code: 'HARNESS', name: 'Rewired harness', mass: 2 }];
        spec.info = ['Improvise a repair part (slower than a spare kit).'];
        spec.rows = [
          { kind: 'pick', cap: 'Part', label: recs[w.rec].name, adjust: () => { w.rec = 1 - w.rec; } },
          w.job ? { kind: 'pick', cap: 'Working — stay at the bench', label: `${Math.round((w.job.t / w.job.dur) * 100)} %`, bar: w.job.t / w.job.dur }
            : { kind: 'primary', label: '🔧 BUILD (10 s)', act: () => {
              if (pl.carrying) { this.floatText(st, 'Hands are full'); return; }
              const r = recs[w.rec];
              this.startJob(w, 'build', 10, () => { if (!pl.carrying) this.giveItem(pl, { name: r.name, mass: r.mass, code: r.code, type: 'part', color: 0xe5a073 }); this.closeWindow(pl); });
            } },
        ];
        break;
      }
      case 'scibay': {
        spec.width = 280;
        const wins = F.events.filter((e) => e.type === 'sci' && e.active);
        spec.info = ['Science bay — mount instruments to observe'];
        for (const e of wins) {
          const tk = this.tickets.find((t) => t.id === e.ticket);
          spec.info.push(`🔭 ${tk.id} ${tk.name} (${Math.ceil(e.left)} s): ${tk.needs.map((n) => `${n}${F.mounted.some((m) => m.code === n) ? '✓' : ''}`).join(' + ')}`);
        }
        if (!wins.length) spec.info.push('No observation window right now.');
        if (F.obs) spec.info.push(`Observing ${F.obs.ticket}: ${Math.round((F.obs.t / F.obs.dur) * 100)} %`);
        if (!P.on.PAY) spec.info.push('⚠ PAYLOAD power is off');
        spec.rows = F.mounted.map((m) => ({ label: `⏏ Unmount ${m.code} ${m.name}`, act: () => {
          if (pl.carrying) { this.floatText(st, 'Hands are full'); return; }
          F.mounted = F.mounted.filter((x) => x !== m);
          const it = this.giveItem(pl, { name: m.name, mass: m.mass, code: m.code, type: 'instrument', cost: m.cost, power: m.power, color: m.color || 0xb98ae8 });
          it.calibrated = m.calibrated; it.calQuality = m.calQuality;
          this.closeWindow(pl);
        } }));
        const ready = wins.find((e) => this.tickets.find((t) => t.id === e.ticket).needs.every((n) => F.mounted.some((m) => m.code === n)));
        spec.rows.push({ kind: 'primary', label: F.obs ? 'OBSERVING…' : '▶ RUN OBSERVATION', disabled: !!F.obs, act: () => {
          if (!ready) { this.mistake(st, wins.length ? 'Mount every instrument the ticket needs' : 'No observation window'); return; }
          if (!P.on.PAY) { this.mistake(st, 'PAYLOAD power is off — ask the Engineer'); return; }
          F.obs = { ticket: ready.ticket, t: 0, dur: 14 };
        } });
        break;
      }
      case 'lift': {
        spec.width = 260;
        const on = this.itemsOnScale();
        const groups = {};
        for (const it of on) { const g = this.cargoGroup(it); groups[g] = (groups[g] || 0) + 1; }
        spec.info = ['Cargo Lift — also the storm shelter', ...Object.entries(groups).map(([g, n]) => `${g}: ${n}`), `On the lift: ${Math.round(this.loadedMass())} kg`,
          `Food boxes left: ${this.items.filter((it) => it.type === 'food' && !it.bad).length}`];
        break;
      }
      case 'leak':
        spec.info = ['💨 Hull breach! Air is escaping.', 'Bring the Pressure-seal kit from the Cargo Lift', 'or build a patch at the Workbench.'];
        break;
      default: break;
    }
  },

  // ── HUD полёта ──
  makeFlightHud() {
    this.fhud = this.add.container(0, 0).setDepth(10002);
    this.fhudSig = '';
  },
  drawFlightHud() {
    const F = this.flight;
    const P = F.power, load = this.flightLoad();
    const evs = F.events.filter((e) => e.active);
    const sig = JSON.stringify([Math.round(F.t * 2), Math.round(F.o2), Math.round(F.water), Math.round(F.hull), load, P.cap, Math.round(this.storedData()),
      evs.map((e) => [e.type, Math.ceil(e.left), e.warn > 0]), F.arrived, this.items.length, F.o2Full]);
    if (sig === this.fhudSig) return;
    this.fhudSig = sig;
    const c = this.fhud;
    c.removeAll(true);
    const g = this.add.graphics(); c.add(g);
    const add = (x, y, s, st = {}, ox = 0) => { const t = this.add.text(x, y, s, { color: '#e6e9ff', fontSize: '11px', ...st }).setOrigin(ox, 0); c.add(t); return t; };
    // ── прогресс перелёта
    const x0 = 12, y0 = 50, W = 290;
    g.fillStyle(0x0f1430, 0.9).fillRoundedRect(x0, y0, W, 58, 8);
    add(x0 + 10, y0 + 6, F.arrived ? `ARRIVED · ${this.orderTarget().name}` : `DAY ${this.day()} / ${F.days}  →  ${this.orderTarget().name}`, { fontSize: '13px', fontStyle: 'bold', color: '#ffcf5a' });
    const bx = x0 + 14, bw = W - 40, by = y0 + 36, fr = F.t / F.dur;
    g.fillStyle(0x070a16, 1).fillRoundedRect(bx, by, bw, 6, 3);
    g.fillStyle(0xffcf5a, 1).fillRoundedRect(bx, by, bw * fr, 6, 3);
    g.fillStyle(0x3fa7e0, 1).fillCircle(bx, by + 3, 6);
    g.fillStyle(this.orderTarget().color, 1).fillCircle(bx + bw, by + 3, 8);
    for (const s of F.schedule) { const xx = bx + bw * (s.at / F.dur); g.fillStyle(ROLES[EVENT_INFO[s.type].role].color, 1).fillTriangle(xx - 4, by - 7, xx + 4, by - 7, xx, by - 1); }
    g.fillStyle(0xffffff, 1).fillCircle(bx + bw * fr, by + 3, 4);
    // ── ресурсы
    let y = y0 + 66;
    const bars = [
      ['CABIN O2', F.o2 / 100, 0x7cc04a, `${Math.round(F.o2)}% · ${F.o2Full} spare`, F.o2 < 25],
      ['WATER', F.water / 100, 0x3fa7e0, `${Math.round(F.water)}%`, F.water < 25],
      ['HULL PRESSURE', F.hull / 100, 0x9aa3cf, `${Math.round(F.hull)}%`, F.hull < 80],
      ['POWER', load / Math.max(1, P.cap), 0xffcf5a, `${load} / ${P.cap} u${P.fault ? ' ⚠' : ''}`, P.fault],
      ['FOOD BOXES', Math.min(1, this.items.filter((it) => it.type === 'food' && !it.bad).length / Math.max(1, F.need.food)), 0xe0a050, `${this.items.filter((it) => it.type === 'food' && !it.bad).length} left`, F.hungry > 0],
      ['DATA TO SEND', Math.min(1, this.storedData() / 300), 0xa25bd6, `${Math.round(this.storedData())} MB`, false],
    ];
    for (const [label, frac, col, val, warn] of bars) { this.hudBar(g, add, x0, y, W, label, frac, col, val, warn); y += 34; }
    // ── активные события справа
    let ey = 50;
    const ex = 968, EW = 300;
    for (const e of evs) {
      const info = EVENT_INFO[e.type], col = ROLES[info.role].color;
      const lines = this.eventHelp(e);
      const h = 30 + lines.length * 14 + 8;
      g.fillStyle(0x0f1430, 0.93).fillRoundedRect(ex, ey, EW, h, 8);
      g.fillStyle(col, 1).fillRoundedRect(ex, ey, 5, h, { tl: 8, bl: 8, tr: 0, br: 0 });
      g.lineStyle(1.5, e.type === 'leak' || e.type === 'flare' ? 0xff7a7a : col, 1).strokeRoundedRect(ex, ey, EW, h, 8);
      add(ex + 12, ey + 6, `${info.icon} ${info.title}`, { fontSize: '12.5px', fontStyle: 'bold' });
      const tl = e.left > 999 ? 'until fixed' : e.type === 'flare' && e.warn > 0 ? `storm in ${Math.ceil(e.warn)} s` : `${Math.ceil(e.left)} s`;
      add(ex + EW - 10, ey + 7, tl, { color: e.left < 10 ? '#ff8a8a' : '#8c96c8', fontSize: '11px', fontStyle: 'bold' }, 1);
      lines.forEach((l, i) => add(ex + 12, ey + 26 + i * 14, l, { color: '#b9c0e6', fontSize: '10.5px' }));
      ey += h + 6;
    }
    if (F.arrived && !F.landing) {
      g.fillStyle(0x16351f, 0.95).fillRoundedRect(ex, ey, EW, 44, 8); g.lineStyle(1.5, 0x8be08b, 1).strokeRoundedRect(ex, ey, EW, 44, 8);
      add(ex + 12, ey + 6, `🪂 Arrived — ready to land`, { fontSize: '12.5px', fontStyle: 'bold', color: '#8be08b' });
      add(ex + 12, ey + 24, 'Navigator: BEGIN DESCENT at the Nav Console', { fontSize: '10.5px', color: '#b9c0e6' });
    }
  },
  // Подсказки к событию (на Hard / Extreme — короче)
  eventHelp(e) {
    const d = this.difficulty(), F = this.flight;
    if (d >= 2) return [{ comm: 'Point the antenna, send data.', tcm: 'Engine + Nav Console.', leak: 'Seal it.', power: 'Fuel Cells.', flare: 'Take shelter.', co2: 'Air System.', clog: 'Water Recycler.', cold: 'Heaters.', sci: 'Analyzer.' }[e.type]];
    switch (e.type) {
      case 'comm': return [`Earth at ${BEARINGS[e.bearing]} (see Mission Board)`, 'N: point Antenna · E: COMMS power ON', 'S/N: START DOWNLINK'];
      case 'tcm': return [`Δv ${e.dv.toFixed(1)} m/s ${BURN_DIRS[e.dir]}`, 'E: ARM at the Engine (AVIONICS on)', 'N: dial + BURN at the Nav Console'];
      case 'leak': return ['Carry the Pressure-seal kit to the leak', 'or build a patch at the Workbench'];
      case 'power': return ['Capacity 5 u — shed loads', 'Bring the Electrical kit to Fuel Cells'];
      case 'flare': return e.warn > 0 ? ['Everyone get onto the Cargo Lift', '(the shielded storm shelter)'] : ['Stay on the Cargo Lift!', `Dose so far: ${F.dose.toFixed(1)}`];
      case 'co2': return ['L: REPLACE CO2 FILTER at the Air System'];
      case 'clog': return ['L: CLEAN FILTER at the Water Recycler'];
      case 'cold': return [`E: HEATERS ON for 12 s (${Math.floor(e.heat)}/12)`, 'switch PAYLOAD off to make room'];
      case 'sci': { const tk = this.tickets.find((t) => t.id === e.ticket); return [`${tk.id} ${tk.name}`, `S: mount ${tk.needs.join(' + ')} in the Analyzer`, 'E: PAYLOAD power ON → RUN'];
      }
      default: return [];
    }
  },

  // ── Иллюминатор: цель полёта растёт по мере приближения ──
  makeCockpitView() {
    const st = this.stations.find((s) => s.id === 'cockpit');
    // стекло иллюминатора — дуга стены: строим многоугольник по кольцу
    const pts = [];
    for (let a = -112; a <= -68; a += 4) { const r = (a * Math.PI) / 180; pts.push(proj(SHIP.cx + Math.cos(r) * (SHIP.R - 9), SHIP.cy + Math.sin(r) * (SHIP.R - 9), 54)); }
    for (let a = -68; a >= -112; a -= 4) { const r = (a * Math.PI) / 180; pts.push(proj(SHIP.cx + Math.cos(r) * (SHIP.R - 9), SHIP.cy + Math.sin(r) * (SHIP.R - 9), 12)); }
    const mg = this.make.graphics({ add: false }); mg.fillStyle(0xffffff, 1).fillPoints(pts, true);
    this.cockpitG = this.add.graphics().setDepth(SHIP.cy - SHIP.R + 70);
    this.cockpitG.setMask(mg.createGeometryMask());
    this.cockpitBox = { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
    if (st) st.view = true;
  },
  drawCockpitView() {
    const F = this.flight, g = this.cockpitG;
    if (!g) return;
    const fr = F.t / F.dur, c = this.cockpitBox, col = this.orderTarget().color;
    const r = 4 + fr * fr * 46;
    g.clear();
    g.fillStyle(col, 0.25).fillCircle(c.x + 20, c.y + 2, r * 1.25);
    g.fillStyle(col, 1).fillCircle(c.x + 20, c.y + 2, r);
    g.fillStyle(0x000000, 0.28).fillCircle(c.x + 20 + r * 0.35, c.y + 2 + r * 0.15, r * 0.92);
    g.fillStyle(0xffffff, 0.18).fillCircle(c.x + 20 - r * 0.35, c.y + 2 - r * 0.35, r * 0.35);
    // Земля уменьшается в начале пути
    if (fr < 0.3) { const er = 9 * (1 - fr / 0.3); g.fillStyle(0x3f7fe0, 1).fillCircle(c.x - 70, c.y + 6, er); g.fillStyle(0x7cc04a, 1).fillCircle(c.x - 72, c.y + 4, er * 0.4); }
  },

  // ── Посадка ──
  landingFuel() {
    const F = this.flight, M = GAME.mission;
    const margin = Phaser.Math.Clamp((M.fuelLoaded || 0) - (M.fuelRequired || 0), -60, 60);
    const jet = F.jettisoned.reduce((a, j) => a + j.mass, 0);
    return Math.max(20, Math.round(150 - F.courseErr * 22 + margin * 0.5 + jet * 0.15 - (F.wasted || 0) * 0));
  },
  startLanding(pl) {
    const F = this.flight, t = this.orderTarget();
    for (const p of this.players) this.closeWindow(p);
    const gr = Math.max(0.6, Math.min(t.gravity, 6));
    F.landing = { pl, alt: 1600, v: -55, thr: 0, fuel: this.landingFuel(), fuel0: this.landingFuel(), g: gr, amax: gr * 2.4 + 2, t: 0, done: false, tries: (F.landing && F.landing.tries) || 0 };
    const c = this.add.container(0, 0).setDepth(27000);
    F.landing.c = c;
    F.landing.g2 = this.add.graphics(); c.add(F.landing.g2);
    F.landing.txt = this.add.text(0, 0, '', { color: '#e6e9ff', fontSize: '13px' }); c.add(F.landing.txt);
    F.log.push(`Descent started with ${F.landing.fuel} kg of landing fuel`);
  },
  updateLanding(dt) {
    const L = this.flight.landing, k = L.pl.keys, diff = this.difficulty();
    if (L.done) return;
    // все игроки с ролью штурмана могут управлять тягой
    const navs = this.players.filter((p) => p.roles.includes('N'));
    let up = false, down = false;
    for (const p of navs) { up = up || p.keys.up.some((x) => x.isDown); down = down || p.keys.down.some((x) => x.isDown); }
    if (navs.length) L.thr = Phaser.Math.Clamp(L.thr + ((up ? 1 : 0) - (down ? 1 : 0)) * dt * 1.6, 0, 1);
    else { // 🤖 автопилот: держим скорость чуть ниже безопасной
      const target = L.alt < 40 ? -1.5 : -Math.max(1.6, this.safeSpeed(L, L.alt) * 0.5);
      L.thr = Phaser.Math.Clamp((L.g + (target - L.v) * 1.2) / L.amax, 0, 1);
    }
    const sim = dt * 2.2; // время посадки ускорено
    const thrust = L.fuel > 0 ? L.thr * L.amax : 0;
    L.v += (thrust - L.g) * sim;
    L.alt += L.v * sim;
    L.fuel = Math.max(0, L.fuel - L.thr * 3.2 * sim);
    L.t += sim;
    if (L.alt <= 0) this.touchdown();
    this.drawLanding();
  },
  // безопасная скорость для высоты: если тормозить на 70 % тяги
  safeSpeed(L, alt) { const a = Math.max(0.3, L.amax * 0.7 - L.g); return Math.max(2, Math.sqrt(2 * a * Math.max(0, alt))); },
  drawLanding() {
    const L = this.flight.landing, g = L.g2, t = this.orderTarget(), diff = this.difficulty();
    g.clear();
    g.fillStyle(0x060a1c, 0.94).fillRect(0, 0, 1280, 720);
    // небо и поверхность (вид сбоку)
    const groundY = 610, scale = (groundY - 120) / 1600;
    const ly = groundY - L.alt * scale;
    g.fillStyle(shadeColor(t.color, 0.35), 1).fillRect(0, groundY, 1280, 110);
    g.fillStyle(shadeColor(t.color, 0.6), 1).fillRect(0, groundY, 1280, 6);
    for (let i = 0; i < 9; i++) g.fillStyle(shadeColor(t.color, 0.45), 1).fillEllipse(80 + i * 150, groundY + 30 + (i % 3) * 18, 90, 14);
    // площадка
    g.fillStyle(0xffcf5a, 1).fillRect(560, groundY - 3, 160, 4);
    // лендер: круглая капсула с опорами
    const lx = 640;
    if (L.thr > 0 && L.fuel > 0) {
      const fl = 20 + L.thr * 50 * (0.8 + Math.random() * 0.4);
      g.fillStyle(0xffb020, 0.9).fillTriangle(lx - 12, ly - 4, lx + 12, ly - 4, lx, ly + fl);
      g.fillStyle(0xffffff, 0.9).fillTriangle(lx - 6, ly - 4, lx + 6, ly - 4, lx, ly + fl * 0.5);
    }
    g.lineStyle(3, 0x9aa3cf, 1).lineBetween(lx - 22, ly - 14, lx - 34, ly); g.lineBetween(lx + 22, ly - 14, lx + 34, ly);
    g.fillStyle(0x37598f, 1).fillEllipse(lx, ly - 26, 66, 34);
    g.fillStyle(0x5a7fb8, 1).fillEllipse(lx, ly - 32, 58, 20);
    g.fillStyle(0x9df3ff, 1).fillEllipse(lx, ly - 34, 26, 8);
    // шкалы
    const panel = (x, y, label, val, frac, col) => {
      g.fillStyle(0x0f1430, 0.95).fillRoundedRect(x, y, 200, 54, 8); g.lineStyle(1.5, col, 1).strokeRoundedRect(x, y, 200, 54, 8);
      g.fillStyle(0x070a16, 1).fillRoundedRect(x + 10, y + 38, 180, 8, 4); g.fillStyle(col, 1).fillRoundedRect(x + 10, y + 38, 180 * Phaser.Math.Clamp(frac, 0, 1), 8, 4);
      return [x + 10, y + 6, label, val];
    };
    const safe = this.safeSpeed(L, L.alt), vs = -L.v;
    const vcol = vs > safe * 1.15 ? 0xff6b6b : vs > safe * 0.9 ? 0xffcf5a : 0x8be08b;
    const texts = [
      panel(40, 120, 'ALTITUDE', `${Math.max(0, Math.round(L.alt))} m`, L.alt / 1600, 0x3fa7e0),
      panel(40, 190, 'DESCENT SPEED', `${vs.toFixed(1)} m/s`, vs / 60, vcol),
      panel(40, 260, 'LANDING FUEL', `${Math.round(L.fuel)} kg`, L.fuel / L.fuel0, 0xffcf5a),
      panel(40, 330, 'THROTTLE', `${Math.round(L.thr * 100)} %`, L.thr, 0xe05a5a),
    ];
    if (diff <= 1) {
      // «безопасная скорость» для текущей высоты — держи стрелку в зелёной зоне
      texts.push(panel(1040, 120, 'SAFE SPEED NOW', `≤ ${safe.toFixed(1)} m/s`, safe / 60, 0x8be08b));
    }
    const lines = [];
    for (const [x, y, label, val] of texts) lines.push({ x, y, label, val });
    if (!L.labels) {
      L.labels = lines.map((l) => {
        const a = this.add.text(l.x, l.y, l.label, { color: '#8c96c8', fontSize: '11px', fontStyle: 'bold' });
        const b = this.add.text(l.x + 180, l.y + 8, l.val, { color: '#ffffff', fontSize: '17px', fontStyle: 'bold' }).setOrigin(1, 0);
        L.c.add([a, b]); return b;
      });
      const title = this.add.text(640, 40, `DESCENT TO ${t.name.toUpperCase()}`, { color: '#ffcf5a', fontSize: '24px', fontStyle: 'bold' }).setOrigin(0.5, 0);
      const help = this.add.text(640, 76, !this.players.some((p) => p.roles.includes('N')) ? '🤖 Navigator autopilot is flying the descent' : `Navigator: hold ▲ / ▼ (${this.players.filter((p) => p.roles.includes('N')).map((p) => p.cfg.label.split(',')[0]).join(', ')}) to change throttle · touch down below 3 m/s`,
        { color: '#b9c0e6', fontSize: '13px' }).setOrigin(0.5, 0);
      L.c.add([title, help]);
      if (diff <= 1) L.c.add(this.add.text(1040, 180, 'Keep DESCENT SPEED\nbelow the safe speed.\nLess throttle saves fuel,\nbut you must brake in time!', { color: '#8c96c8', fontSize: '12px', lineSpacing: 3 }));
    }
    L.labels.forEach((t2, i) => t2.setText(lines[i].val));
  },
  touchdown() {
    const F = this.flight, L = F.landing, diff = this.difficulty();
    L.done = true;
    const vs = -L.v;
    const res = vs <= 3 ? 'soft' : vs <= 6 ? 'hard' : 'crash';
    L.result = res; L.vTouch = vs;
    const msg = { soft: `TOUCHDOWN ✓\n${vs.toFixed(1)} m/s — perfect`, hard: `HARD LANDING\n${vs.toFixed(1)} m/s — some damage`, crash: `CRASH\n${vs.toFixed(1)} m/s` }[res];
    const t = this.add.text(640, 360, msg, { color: res === 'crash' ? '#ff7a7a' : res === 'hard' ? '#ffcf5a' : '#8be08b', fontSize: '40px', fontStyle: 'bold', align: 'center' }).setOrigin(0.5);
    L.c.add(t);
    this.cameras.main.shake(res === 'soft' ? 200 : 600, res === 'soft' ? 0.003 : 0.01);
    if (res === 'crash') {
      if (diff <= 1 && L.tries < 1) {
        // Easy / Normal: одна повторная попытка ценой ошибки
        this.mistakes++; L.tries = (L.tries || 0) + 1;
        this.time.delayedCall(2200, () => { L.c.destroy(); const tries = L.tries; F.landing = null; this.startLanding(L.pl); F.landing.tries = tries; F.landing.fuel = F.landing.fuel0 = Math.round(this.landingFuel() * 0.8); });
        t.setText(msg + '\nSimulator! One more try (Easy/Normal)');
        return;
      }
      this.time.delayedCall(1500, () => this.failMission(`Crashed on ${this.orderTarget().name} at ${vs.toFixed(1)} m/s`));
      return;
    }
    // успешная посадка → поверхность
    this.time.delayedCall(2200, () => {
      const M = GAME.mission;
      // приборы из Analyzer возвращаются в груз
      M.flight = this.flightSummary();
      M.cargo = this.cargoSnapshot().concat(F.mounted.map((m) => ({ type: 'instrument', code: m.code, name: m.name, mass: m.mass, calibrated: m.calibrated, calQuality: m.calQuality, cost: m.cost, power: m.power, color: m.color })));
      M.data = F.data; M.mistakes = this.mistakes; M.team = this.teamStats();
      M.flight.o2Full = F.o2Full;
      this.cameras.main.fadeOut(500, 6, 10, 28);
      this.time.delayedCall(550, () => this.scene.restart({ stage: 'surface' }));
    });
  },
  flightSummary() {
    const F = this.flight;
    return {
      days: F.days, o2Min: F.o2Min, hullMin: F.hullMin, waterMin: F.waterMin, hypoxiaT: F.hypoxiaT, dose: F.dose, hungry: F.hungry,
      handled: F.handled, missed: F.missed, events: F.events.length, courseErr: F.courseErr, tcmDone: F.tcmDone,
      jettisoned: F.jettisoned, wasted: F.wasted || 0, log: F.log,
      landing: F.landing ? { result: F.landing.result || 'none', v: F.landing.vTouch || 0, fuelLeft: Math.round(F.landing.fuel), fuel0: F.landing.fuel0 } : null,
    };
  },
});

// ── Этап 3: Посадка и поверхность ─────────────────────────────────────────
const EVA_TIME = [110, 85, 75, 70];   // на сколько секунд хватает скафандра снаружи
const SURFACE_TIME = [300, 260, 240, 220];

Object.assign(HangarScene.prototype, {
  buildSurface() {
    const g = this.add.graphics().setDepth(-2000);
    g.fillStyle(0x2a1208, 1).fillRect(-10, -10, 1300, 740);
    this.buildStageLevel('surfmeta', SURF_STATIONS, LANDER);
    // камни — препятствия
    for (const [x, y, r] of SURF_ROCKS) this.solids.push({ l: x - r * 0.8, t: y - r * 0.6, r: x + r * 0.8, b: y + r * 0.6, high: false, h: r });
  },

  initSurface() {
    const M = GAME.mission, diff = this.difficulty();
    // на лифт выкладываем то, что пригодится снаружи; расходники остаются в трюме
    this.spawnCargo(M.cargo.filter((c) => ['instrument', 'kit', 'part', 'sample'].includes(c.type)), LANDER, LANDER.lift);
    const S = this.surf = {
      t: 0, dur: SURFACE_TIME[diff], data: M.data || {}, sites: [], alerts: [], log: [],
      suits: M.suitsReady || 0, evaT: 0, evaIncidents: 0, storm: null, stormHits: 0, comm: null, nextComm: 25, bearing: -1, downlink: false,
      ended: false, samples: 0, analyzed: 0, autoT: 0,
    };
    const lt = (this.tickets || []).filter((tk) => tk.phase === 'L');
    const spots = Phaser.Utils.Array.Shuffle([...SITE_SPOTS]);
    lt.forEach((tk, i) => {
      const [x, y] = spots[i % spots.length];
      const st = { id: 'site_' + tk.id, name: `${tk.id} site`, kind: 'site', role: 'ANY', l: x - 22, t: y - 22, r: x + 22, b: y + 22, h: 4,
        anchor: proj(x + 6, y, 64), dynamic: true, ticket: tk, deployed: [], collect: 0, done: false, x, y };
      this.stations.push(st);
      this.makeBubble(st, 0xa25bd6);
      st.fx = this.add.graphics().setDepth(y - 30);
      S.sites.push(st);
    });
    // пыльная буря — посередине пребывания (кроме Easy — там позже и мягче)
    S.stormAt = S.dur * (diff === 0 ? 0.6 : 0.45);
    for (const p of this.players) p.eva = 100;
    this.makeSurfaceHud();
    this.cameras.main.fadeIn(600, 6, 10, 28);
    this.time.delayedCall(700, () => { if (!window.NO_TUTORIAL) this.startTutorial(); });
  },

  isOutside(x, y) { return Math.hypot(x - LANDER.cx, y - LANDER.cy) > LANDER.R; },

  updateSurface(dt) {
    const S = this.surf;
    if (!S || this.mission.failed || S.ended) return;
    this.tickJobs(dt);
    if (this.tut) { this.drawSurfaceHud(); return; }
    const diff = this.difficulty();
    S.t += dt;
    // скафандры: снаружи воздух убывает, внутри — восстанавливается
    for (const p of this.players) {
      const out = this.isOutside(p.body.x, p.body.y);
      if (out) {
        S.evaT += dt;
        p.eva -= (100 / EVA_TIME[diff]) * dt * (S.storm && S.storm.active ? 2 : 1);
        if (p.eva <= 0) this.evaEmergency(p);
      } else p.eva = Math.min(100, p.eva + 30 * dt);
    }
    // научные площадки: собирают данные, когда все приборы стоят
    for (const st of S.sites) {
      if (st.done) continue;
      if (st.ticket.needs.every((n) => st.deployed.some((d) => d.code === n))) {
        st.collect += dt;
        if (st.collect >= 14) this.finishSite(st);
      }
    }
    // окна связи с Землёй
    if (!S.comm && S.t >= S.nextComm) { S.comm = { left: 30, bearing: Phaser.Math.Between(0, 7) }; this.alert(`📡 Earth above the horizon at ${BEARINGS[S.comm.bearing]} — downlink now`, ROLES.N.color, 4); }
    if (S.comm) {
      S.comm.left -= dt;
      if (S.downlink && S.bearing === S.comm.bearing) this.sendData(dt, DATA_RATE * ANTENNAS[this.prep.design.ant].rate);
      if (S.comm.left <= 0) { S.comm = null; S.downlink = false; S.nextComm = S.t + 30; }
    }
    // пыльная буря
    if (!S.storm && S.t >= S.stormAt && diff >= 0) { S.storm = { warn: 18, left: 20, active: false }; this.alert('🌪 Dust storm in 18 s — everyone back inside the lander!', 0xffb020, 4); }
    if (S.storm && !S.storm.done) {
      if (S.storm.warn > 0) { S.storm.warn -= dt; if (S.storm.warn <= 0) { S.storm.active = true; const out = this.players.filter((p) => this.isOutside(p.body.x, p.body.y)); S.stormHits = out.length; if (out.length) { this.mistake(this.stations[0], 'Crew caught outside in the dust storm', true); this.alert('Crew caught outside — suits take damage', 0xff7a7a); } } }
      else { S.storm.left -= dt; if (S.storm.left <= 0) { S.storm.done = true; S.storm.active = false; this.alert('Storm passed — EVA can continue', 0x8be08b); } }
    }
    if (S.t >= S.dur) { this.alert('Surface stay is over — lifting off', 0xffcf5a, 3); this.endSurface(true); return; }
    this.drawSites();
    this.drawSurfaceHud();
  },

  evaEmergency(p) {
    const S = this.surf;
    S.evaIncidents++;
    this.mistake(this.stations.find((s) => s.id === 'airlock'), 'Suit air ran out — emergency return', true);
    if (p.carrying) { const it = p.carrying; it.carrier = null; p.carrying = null; it.support = null; it.z = 0; }
    p.body.body.reset(LANDER.cx - 60, LANDER.cy + 40);
    p.eva = 40;
    this.alert(`${ROLES[p.role].name}: suit air ran out — rescued back to the lander`, 0xff7a7a, 4);
  },

  sendData(dt, rate) {
    const data = (this.flight || this.surf).data;
    let budget = rate * dt;
    for (const d of Object.values(data)) {
      const left = d.made - d.sent;
      if (left <= 0) continue;
      const x = Math.min(left, budget); d.sent += x; budget -= x;
      if (budget <= 0) break;
    }
  },
  surfStored() { return Object.values(this.surf.data).reduce((a, d) => a + d.made - d.sent, 0); },

  finishSite(st) {
    const S = this.surf, tk = st.ticket;
    st.done = true;
    const q = st.deployed.reduce((a, d) => a + (d.calibrated ? d.calQuality : 40), 0) / st.deployed.length / 100;
    const d = S.data[tk.id] = S.data[tk.id] || { made: 0, sent: 0 };
    d.made += tk.pts * q;
    this.alert(`🔬 ${tk.name}: ${Math.round(tk.pts * q)} MB collected — downlink it!`, 0x8be08b, 4);
    S.log.push(`${tk.id} collected ${Math.round(tk.pts * q)} MB`);
    // керн: образец надо занести в лабораторию корабля
    if (tk.needs.includes('S04')) {
      const it = this.createItem({ name: 'Rock core sample', mass: 1.2, code: 'CORE' }, 0xc28a5a, st.x + 26, st.y + 10);
      Object.assign(it, { type: 'sample', code: 'CORE', uid: ++this.uidSeq, ticket: tk.id });
      S.samples++;
      this.alert('🪨 Rock core ready — bring it to the Sample Lab inside', 0xc28a5a, 4);
    }
  },

  drawSites() {
    const t = this.time.now / 1000;
    for (const st of this.surf.sites) {
      const g = st.fx; g.clear();
      const col = st.done ? 0x8be08b : 0xa25bd6;
      const ring = circlePts(st.x, st.y, 30, 28).map((p) => proj(p.x, p.y, 0));
      g.fillStyle(col, 0.12 + (st.done ? 0 : 0.06 * Math.sin(t * 3))).fillPoints(ring, true);
      g.lineStyle(2, col, 0.9).strokePoints(ring, true);
      // флажок
      const b = proj(st.x - 18, st.y - 18, 0), top = proj(st.x - 18, st.y - 18, 46);
      g.lineStyle(2, 0xeeeeee, 1).lineBetween(b.x, b.y, top.x, top.y);
      g.fillStyle(col, 1).fillTriangle(top.x, top.y, top.x + 16, top.y + 5, top.x, top.y + 10);
      // установленные приборы
      st.deployed.forEach((d, i) => {
        const a = (i / Math.max(1, st.ticket.needs.length)) * Math.PI * 2;
        const p0 = proj(st.x + Math.cos(a) * 12, st.y + Math.sin(a) * 12, 0), p1 = proj(st.x + Math.cos(a) * 12, st.y + Math.sin(a) * 12, 16);
        g.lineStyle(3, 0x9aa3cf, 1).lineBetween(p0.x, p0.y, p1.x, p1.y);
        g.fillStyle(0xb98ae8, 1).fillCircle(p1.x, p1.y, 5);
      });
      if (!st.done && st.collect > 0) {
        const p = proj(st.x, st.y, 60);
        g.fillStyle(0x0f1430, 0.9).fillRoundedRect(p.x - 22, p.y - 4, 44, 8, 3);
        g.fillStyle(0x8be08b, 1).fillRoundedRect(p.x - 21, p.y - 3, 42 * (st.collect / 14), 6, 3);
      }
    }
  },

  surfaceItemUse(pl, st) {
    const it = pl.carrying, S = this.surf;
    if (st.kind === 'site') {
      if (it.type !== 'instrument') { this.floatText(st, 'Bring an instrument for this site', '#ffb35c'); return true; }
      if (!st.ticket.needs.includes(it.code)) { this.mistake(st, `${it.code} is not needed here (needs ${st.ticket.needs.join(' + ')})`); return true; }
      if (st.deployed.some((d) => d.code === it.code)) { this.floatText(st, 'Already deployed'); return true; }
      st.deployed.push({ code: it.code, calibrated: it.calibrated, calQuality: it.calQuality });
      this.removeItem(it);
      this.floatText(st, `${it.code} deployed ✓`, '#8be08b');
      S.log.push(`${it.code} deployed at ${st.ticket.id}`);
      return true;
    }
    if (st.kind === 'samplelab' && it.type === 'sample') {
      const d = S.data[it.ticket] = S.data[it.ticket] || { made: 0, sent: 0 };
      const tk = this.tickets.find((t) => t.id === it.ticket);
      d.made += tk.pts * 0.4; S.analyzed++;
      this.removeItem(it);
      this.floatText(st, 'Core analyzed: +data, sample sealed for return ✓', '#8be08b');
      S.log.push('Rock core analyzed in the Sample Lab');
      return true;
    }
    return false;
  },

  surfaceSpec(w, spec, st, pl, diff) {
    const S = this.surf;
    switch (st.kind) {
      case 'suitrack': {
        const used = this.players.filter((p) => p.suited).length;
        spec.info = [`Ready EVA suits: ${S.suits} (prepared in the hangar)`, `In use: ${used}`];
        if (!S.suits && diff <= 1) spec.info.push('No suits were prepared — nobody can go outside.');
        spec.rows = [{ kind: 'primary', label: pl.suited ? 'TAKE OFF SUIT' : '🧑‍🚀 PUT ON SUIT', disabled: !pl.suited && used >= S.suits,
          act: () => { if (pl.suited) { if (pl.carrying && pl.carrying.type === 'sample') return; pl.suited = false; } else { pl.suited = true; pl.eva = 100; } this.closeWindow(pl); } }];
        break;
      }
      case 'site': {
        const tk = st.ticket;
        spec.width = 260;
        spec.info = [`${tk.id} ${tk.name}`, `Needs: ${tk.needs.map((n) => `${n}${st.deployed.some((d) => d.code === n) ? ' ✓' : ''}`).join(' + ')}`,
          st.done ? 'Data collected ✓' : st.collect > 0 ? `Collecting… ${Math.round((st.collect / 14) * 100)} %` : 'Carry the instruments here and press action.'];
        break;
      }
      case 'samplelab':
        spec.info = ['Sample Lab', `Cores analyzed: ${S.analyzed} / ${S.samples}`, 'Bring rock cores from the drill sites.'];
        break;
      case 'datastore': {
        spec.width = 270;
        const lines = Object.entries(S.data).map(([tid, d]) => `${tid}: ${Math.round(d.made)} MB made · ${Math.round(d.sent)} MB sent`);
        spec.info = ['Science data on board', ...(lines.length ? lines : ['(no data yet)']), `Waiting to send: ${Math.round(this.surfStored())} MB`];
        break;
      }
      case 'antenna': {
        spec.width = 260;
        w.b = w.b ?? 0;
        spec.info = [S.comm ? `Earth above the horizon: ${Math.ceil(S.comm.left)} s` : `Next comm window in ${Math.ceil(Math.max(0, S.nextComm - S.t))} s`, `Waiting to send: ${Math.round(this.surfStored())} MB`];
        if (S.comm && diff <= 1) spec.info.push(`Earth at ${BEARINGS[S.comm.bearing]}`);
        spec.rows = [
          { kind: 'pick', cap: 'Point the dish', label: BEARINGS[w.b], right: S.bearing === w.b ? (S.comm && S.comm.bearing === w.b ? 'LOCKED ✓' : 'pointed') : '', adjust: (s2) => { w.b = (w.b + s2 + 8) % 8; },
            act: () => { S.bearing = w.b; if (S.comm && w.b !== S.comm.bearing) this.mistake(st, 'No signal at this bearing'); } },
          { kind: 'primary', label: S.downlink ? '■ STOP DOWNLINK' : '▶ START DOWNLINK', act: () => { if (!S.comm && !S.downlink) { this.mistake(st, 'Earth is below the horizon'); return; } S.downlink = !S.downlink; } },
        ];
        break;
      }
      case 'ascent': {
        spec.width = 270;
        const out = this.players.filter((p) => this.isOutside(p.body.x, p.body.y));
        const sitesDone = S.sites.filter((x) => x.done).length;
        spec.info = [`Sites done: ${sitesDone} / ${S.sites.length} · data waiting: ${Math.round(this.surfStored())} MB`, `Surface time left: ${Math.ceil(S.dur - S.t)} s`];
        if (out.length) spec.info.push(`⚠ ${out.length} crew still outside!`);
        spec.rows = [{ kind: 'primary', label: '🚀 END MISSION · LIFT OFF', act: () => {
          if (out.length) { this.mistake(st, 'Crew still outside — bring them in first'); return; }
          this.endSurface(false);
        } }];
        break;
      }
      default: break;
    }
  },

  endSurface(timeout) {
    const S = this.surf;
    if (S.ended) return;
    S.ended = true;
    for (const p of this.players) this.closeWindow(p);
    const M = GAME.mission;
    M.surface = this.surfaceSummary(timeout);
    M.data = S.data; M.mistakes = this.mistakes; M.team = this.teamStats();
    this.cinematic(['ASCENT', '🚀 Heading home'], () => this.scene.restart({ stage: 'report' }), 900);
  },
  surfaceSummary(timeout = false) {
    const S = this.surf;
    const stranded = this.players.filter((p) => this.isOutside(p.body.x, p.body.y)).length;
    return { sites: S.sites.map((st) => ({ ticket: st.ticket.id, done: st.done, deployed: st.deployed.length, needs: st.ticket.needs.length })),
      samples: S.samples, analyzed: S.analyzed, evaT: S.evaT, evaIncidents: S.evaIncidents, stormHits: S.stormHits, timeout, stranded, log: S.log };
  },

  makeSurfaceHud() { this.shud = this.add.container(0, 0).setDepth(10002); this.shudSig = ''; },
  drawSurfaceHud() {
    const S = this.surf;
    const sig = JSON.stringify([Math.round(S.t), this.players.map((p) => [Math.round(p.eva), p.suited, this.isOutside(p.body.x, p.body.y)]), S.sites.map((s) => [s.deployed.length, s.done]),
      Math.round(this.surfStored()), S.comm && Math.ceil(S.comm.left), S.storm && [Math.ceil(S.storm.warn), S.storm.active, S.storm.done]]);
    if (sig === this.shudSig) return;
    this.shudSig = sig;
    const c = this.shud; c.removeAll(true);
    const g = this.add.graphics(); c.add(g);
    const add = (x, y, s, st = {}, ox = 0) => { const t = this.add.text(x, y, s, { color: '#e6e9ff', fontSize: '11px', ...st }).setOrigin(ox, 0); c.add(t); return t; };
    const x0 = 12, y0 = 50, W = 250;
    g.fillStyle(0x0f1430, 0.9).fillRoundedRect(x0, y0, W, 44, 8);
    add(x0 + 10, y0 + 6, `ON ${this.orderTarget().name.toUpperCase()} · ${Math.ceil(S.dur - S.t)} s left`, { fontSize: '13px', fontStyle: 'bold', color: '#ffcf5a' });
    add(x0 + 10, y0 + 25, `Suits ready: ${S.suits} · sites ${S.sites.filter((s) => s.done).length}/${S.sites.length}`, { color: '#b9c0e6' });
    let y = y0 + 52;
    for (const p of this.players) {
      if (!p.suited) continue;
      const out = this.isOutside(p.body.x, p.body.y);
      this.hudBar(g, add, x0, y, W, `${ROLES[p.role].name.toUpperCase()} · SUIT AIR${out ? ' (outside)' : ''}`, p.eva / 100, 0x7cc04a, `${Math.round(p.eva)}%`, p.eva < 30);
      y += 34;
    }
    this.hudBar(g, add, x0, y, W, 'DATA TO SEND', Math.min(1, this.surfStored() / 300), 0xa25bd6, `${Math.round(this.surfStored())} MB`, false); y += 34;
    // справа: задачи
    let ey = 50; const ex = 968, EW = 300;
    const card = (title, lines, col, warn) => {
      const h = 28 + lines.length * 14 + 6;
      g.fillStyle(0x0f1430, 0.93).fillRoundedRect(ex, ey, EW, h, 8);
      g.fillStyle(col, 1).fillRoundedRect(ex, ey, 5, h, { tl: 8, bl: 8, tr: 0, br: 0 });
      g.lineStyle(1.5, warn ? 0xff7a7a : col, 1).strokeRoundedRect(ex, ey, EW, h, 8);
      add(ex + 12, ey + 6, title, { fontSize: '12.5px', fontStyle: 'bold' });
      lines.forEach((l, i) => add(ex + 12, ey + 25 + i * 14, l, { color: '#b9c0e6', fontSize: '10.5px' }));
      ey += h + 6;
    };
    if (S.storm && !S.storm.done) card(S.storm.active ? '🌪 Dust storm!' : `🌪 Dust storm in ${Math.ceil(S.storm.warn)} s`, ['Everyone inside the lander!'], 0xffb020, true);
    if (S.comm) card(`📡 Comm window · ${Math.ceil(S.comm.left)} s`, [this.difficulty() <= 1 ? `Earth at ${BEARINGS[S.comm.bearing]} — Antenna: point + START` : 'Point the antenna, send data'], ROLES.N.color);
    for (const st of S.sites) {
      if (st.done) continue;
      card(`🔬 ${st.ticket.id} ${st.ticket.name}`, [`Deploy: ${st.ticket.needs.map((n) => `${n}${st.deployed.some((d) => d.code === n) ? '✓' : ''}`).join(' + ')}`,
        st.collect > 0 ? `Collecting ${Math.round((st.collect / 14) * 100)} %` : 'Suited crew: carry instruments out'], ROLES.S.color);
    }
    if (!S.suits) card('⚠ No EVA suits', ['Suits were not prepared in the hangar.', 'Only the autopilot rover can work outside.'], 0xff7a7a, true);
  },
});

// ── Автопилот ролей, которые никто не взял ────────────────────────────────
Object.assign(HangarScene.prototype, {
  autoRoles(dt) {
    if (this.tut) return;
    this.autoT = (this.autoT || 0) + dt;
    if (this.stage === 'hangar') this.autoHangar(dt);
    else if (this.stage === 'flight') this.autoFlight(dt);
    else if (this.stage === 'surface') this.autoSurface(dt);
  },

  // Свободное место в зоне груза (сетка с шагом 36 px)
  zoneSpot() {
    const z = this.scaleZone;
    for (let y = z.t + 26; y < z.b - 16; y += 44) for (let x = z.l + 26; x < z.r - 16; x += 44) {
      if (!this.inScaleZone(x, y)) continue;
      if (this.items.some((it) => Math.hypot(it.x - x, it.y - y) < 38)) continue;
      if (this.players.some((p) => Math.hypot(p.body.x - x, p.body.y - y) < 36)) continue;
      return { x, y };
    }
    return { x: (z.l + z.r) / 2 + Phaser.Math.Between(-40, 40), y: (z.t + z.b) / 2 + Phaser.Math.Between(-40, 40) };
  },
  autoDrop(def, extra = {}) {
    const p = this.zoneSpot();
    const it = this.createItem(def, def.color, p.x, p.y);
    Object.assign(it, { type: def.type, code: def.code, bad: def.bad, uid: ++this.uidSeq, cost: def.cost || 0, power: def.power || 0,
      calibrated: false, calQuality: 0, calRef: 50, auto: true }, extra);
    return it;
  },

  autoHangar() {
    const A = this.auto, P = this.prep;
    this.autoDone = this.autoDone || {};
    // 🤖 Scientist: приборы по тикетам — откалиброваны и уже в зоне груза
    if (A.has('S') && this.tickets && this.autoDone.S !== this.tickets.map((t) => t.id).join()) {
      this.autoDone.S = this.tickets.map((t) => t.id).join();
      for (const it of this.items.filter((x) => x.auto && x.type === 'instrument')) this.removeItem(it);
      for (const id of new Set(this.tickets.flatMap((t) => t.needs))) {
        const ins = INSTRUMENT_BY_ID[id]; ins.stock = 0;
        this.autoDrop({ name: ins.name, mass: ins.mass, code: id, type: 'instrument', cost: ins.cost, power: ins.power, color: 0xb98ae8 }, { calibrated: true, calQuality: 85 });
      }
      this.floatText(this.scaleZone, '🤖 Scientist autopilot packed the instruments', '#b98ae8');
    }
    // 🤖 Engineer: оба ремкомплекта, проверка питания, утверждение манифеста
    if (A.has('E')) {
      if (!this.autoDone.E) {
        this.autoDone.E = true;
        for (const rec of KIT_RECIPES) { P.kits.push(rec.id); this.autoDrop({ name: rec.name, mass: rec.mass, code: rec.id === 'ELEC' ? 'KIT-E' : 'KIT-P', type: 'kit', color: 0xe57373, cost: KIT_COST[rec.id] }); }
        for (const id of POWER_ORDER) P.power.on[id] = true;
        P.power.ready = true;
      }
      if (!this.manifestApproved() && this.itemsOnScale().length && this.loadedMass() <= MAX_CARGO_KG) P.manifest = this.cargoSignature();
    }
    // 🤖 Navigator: дизайн миссии и топливо
    if (A.has('N') && this.order) {
      if (P.route === null) P.route = 1;
      const m = this.launchMass() + (P.design.ant === null ? ANTENNAS[0].mass : 0);
      const gross = m * (1 + this.fuelFactor());
      const lv = LAUNCH_VEHICLES.findIndex((v) => v.cap >= gross * 1.04);
      P.design = { lv: lv < 0 ? 2 : lv, ant: P.design.ant ?? 0 };
      const req = this.requiredFuel();
      if (P.fuel.loaded !== req) { P.fuel.loaded = req; P.fuel.coupled = true; P.fuel.valve = false; }
      this.mission.fuelOk = true; this.mission.fuelValue = req;
    }
    // 🤖 Life Support: расходники под маршрут, люк, скафандры
    if (A.has('L')) {
      if (P.route !== null) {
        const need = ROUTES[P.route].need, have = this.consumablesInCargo();
        const defs = { o2: CONSUMABLES.o2[0], water: CONSUMABLES.supply[0], food: CONSUMABLES.supply[2] };
        for (const k of ['o2', 'water', 'food']) for (let i = have[k]; i < need[k]; i++) {
          const d = defs[k];
          this.autoDrop({ name: d.name, mass: d.mass, code: d.id, type: d.kind, color: 0x9ed36a, cost: CONSUMABLE_COST[d.id] });
        }
        const h2 = this.consumablesInCargo();
        if (!h2.bad.length && ['o2', 'water', 'food'].every((k) => h2[k] >= need[k])) P.consumables = this.cargoSignature();
      }
      if (P.hatch.state !== 'VERIFIED') { P.hatch.state = 'VERIFIED'; P.hatch.gasketClean = true; }
      for (let i = 0; i < SUITS_NEEDED; i++) Object.assign(P.suits[i], { o2: 100, battery: true, co2: true, ready: true });
    }
  },

  autoFlight(dt) {
    const F = this.flight, A = this.auto, P = F.power;
    if (!F || F.landing) return;
    const ev = (type) => F.events.find((e) => e.type === type && e.active);
    const age = (e) => (this.time.now - e.rt0) / 1000;
    if (A.has('E')) {
      // питание по приоритету: LS, AVI, затем то, что сейчас нужно
      const want = ['LS', 'AVI'];
      if (ev('cold')) want.push('HEAT');
      if (ev('comm') && (A.has('N') || F.downlink)) want.push('COMMS');
      if (ev('sci') || F.obs) want.push('PAY');
      for (const b of FLIGHT_LOADS) P.on[b.id] = false;
      let load = 0;
      for (const id of want) { const b = FLIGHT_LOADS.find((x) => x.id === id); if (load + b.load <= P.cap) { P.on[id] = true; load += b.load; } }
      const tcm = ev('tcm'); if (tcm && F.armedT <= 0) F.armedT = 30;
      const pw = ev('power');
      if (pw && age(pw) > 8) {
        const kit = this.items.find((it) => it.code === 'KIT-E');
        if (kit) this.removeItem(kit);
        P.cap = kit ? 8 : 7; P.fault = false; this.resolveEvent('power', `🤖 Engineer autopilot: fuel cell ${kit ? 'repaired' : 'rewired'}`);
      }
      const lk = F.events.find((e) => e.type === 'leak' && !e.done);
      if (lk && age(lk) > 10) {
        const kit = this.items.find((it) => it.code === 'KIT-P' || it.code === 'PATCH');
        if (kit || age(lk) > 22) {
          if (kit) this.removeItem(kit);
          this.resolveEvent('leak', '🤖 Engineer autopilot sealed the leak');
          lk.fx.destroy(); this.stations = this.stations.filter((s) => s !== lk.st); if (lk.st.bubble) lk.st.bubble.destroy();
        }
      }
    }
    if (A.has('N')) {
      const c = ev('comm'); if (c) { F.bearing = c.bearing; F.downlink = true; }
      const t = ev('tcm'); if (t && F.armedT > 0 && age(t) > 4) { this.resolveEvent('tcm', '🤖 Navigator autopilot: course corrected'); F.tcmDone++; F.armedT = 0; }
      if (F.arrived && !F.landing && (F.autoLandT = (F.autoLandT || 0) + dt) > 3) this.startLanding(this.players[0]);
    }
    if (A.has('L')) {
      if (F.o2 < 30 && F.o2Full > 0) { F.o2Full--; F.o2Empty++; F.o2 = Math.min(100, F.o2 + 100); }
      if (F.water < 30) { const bag = this.items.find((it) => it.type === 'water' && !it.carrier); if (bag) { this.removeItem(bag); F.water = Math.min(100, F.water + (bag.bad ? 50 : 100)); } }
      const co2 = ev('co2'); if (co2 && age(co2) > 4) { F.co2Bad = false; this.resolveEvent('co2', '🤖 Life Support autopilot replaced the CO2 filter'); }
      const cl = ev('clog'); if (cl && age(cl) > 5) this.resolveEvent('clog', '🤖 Life Support autopilot cleaned the filter');
    }
    if (A.has('S')) {
      const win = F.events.find((e) => e.type === 'sci' && e.active);
      if (win && !F.obs && age(win) > 3) {
        const tk = this.tickets.find((t) => t.id === win.ticket);
        for (const n of tk.needs) {
          if (F.mounted.some((m) => m.code === n)) continue;
          const it = this.items.find((x) => x.code === n && !x.carrier);
          if (it) { F.mounted.push({ code: it.code, name: it.name, calibrated: it.calibrated, calQuality: it.calQuality, mass: it.mass, power: it.power, cost: it.cost, color: it.color }); this.removeItem(it); }
        }
        if (tk.needs.every((n) => F.mounted.some((m) => m.code === n)) && P.on.PAY) F.obs = { ticket: tk.id, t: 0, dur: 14 };
      }
    }
  },

  autoSurface(dt) {
    const S = this.surf, A = this.auto;
    if (!S || S.ended) return;
    if (A.has('N') && S.comm) { S.bearing = S.comm.bearing; S.downlink = true; }
    // 🤖 ровер: если учёного нет или скафандров нет — сам расставляет приборы
    if (A.has('S') || !S.suits) {
      S.autoT += dt;
      if (S.autoT > 20) {
        S.autoT = 0;
        const site = S.sites.find((s) => !s.done && !s.ticket.needs.every((n) => s.deployed.some((d) => d.code === n)));
        if (site) {
          for (const n of site.ticket.needs) {
            if (site.deployed.some((d) => d.code === n)) continue;
            const it = this.items.find((x) => x.code === n && !x.carrier);
            if (it) { site.deployed.push({ code: n, calibrated: it.calibrated, calQuality: it.calQuality }); this.removeItem(it); }
          }
          this.alert(`🤖 Rover deployed instruments at ${site.ticket.id}`, ROLES.S.color);
        }
        const core = this.items.find((x) => x.type === 'sample' && !x.carrier);
        if (core && A.has('S')) { const d = S.data[core.ticket] = S.data[core.ticket] || { made: 0, sent: 0 }; d.made += this.tickets.find((t) => t.id === core.ticket).pts * 0.4; S.analyzed++; this.removeItem(core); }
      }
    }
  },

  // Один пузырёк-подпись для станции, появившейся по ходу игры (утечка, площадка)
  makeBubble(st, color) {
    const text = this.add.text(0, 0, st.name, { color: '#1d2b4a', fontSize: '12px', fontStyle: 'bold' }).setOrigin(0.5, 0);
    const w = Math.ceil(text.width) + 18, h = Math.ceil(text.height) + 13;
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 0.96).fillRoundedRect(-w / 2, 0, w, h, 8);
    g.fillTriangle(-6, h - 1, 6, h - 1, 0, h + 6);
    g.fillStyle(color, 1).fillRoundedRect(-w / 2 + 8, h - 6, w - 16, 3, 1.5);
    text.setPosition(0, 4);
    st.bubble = this.add.container(st.anchor.x, st.anchor.y - h - 6, [g, text]).setDepth(15000);
  },
});

// ── Обучение для этапов полёта и поверхности, подсказки ───────────────────
const hangarTutorial = HangarScene.prototype.tutorialSteps;
const hangarHints = HangarScene.prototype.nextHints;
Object.assign(HangarScene.prototype, {
  tutorialSteps() {
    if (this.stage === 'flight') {
      return [
        { title: 'Stage 2 · Flight', role: null, at: [],
          text: `Liftoff! ${this.flight.days} days to ${this.orderTarget().name} pass in a few minutes.\nAir, water and food run down. Problems pop up as cards on the right — fix them before their timer ends.\nEverything you packed in the hangar is here now. Missing items can't be bought in space!` },
        { title: 'Power budget', role: 'E', at: ['power', 'fuelcells'],
          text: 'Fuel Cells give 8 units. LIFE SUPPORT (3) and AVIONICS (2) stay on.\nPAYLOAD (3) runs science, COMMS (2) sends data, HEATERS (2) for cold — you can\'t run everything at once. Choose!' },
        { title: 'Air and water', role: 'L', at: ['air', 'o2rack', 'water'],
          text: 'Take a FULL cylinder from O2 Storage to the Air System when cabin O2 is low.\nWater bags go into the Water Recycler (even wastewater: +50%).\nEmpty cylinders are dead mass — throw them out at Jettison.' },
        { title: 'Cargo Lift = storm shelter', role: 'ANY', at: ['lift'],
          text: 'Your cargo is on the lift: kits, instruments, food.\nDuring a SOLAR FLARE everyone must stand on the lift — it is shielded by the cargo around it.' },
        { title: 'Science in flight', role: 'S', at: ['scibay', 'data'],
          text: 'When an observation window opens, carry the instruments to the Analyzer (they mount), ask for PAYLOAD power, RUN.\nData is stored in Data Storage — it only counts when it reaches Earth.' },
        { title: 'Talking to Earth', role: 'N', at: ['antenna', 'board'],
          text: 'Comm windows: the Mission Board shows where Earth is.\nPoint the Antenna, COMMS power on, START DOWNLINK. The high-gain dish sends 4× faster.' },
        { title: 'Course corrections', role: 'N', at: ['engine', 'nav'],
          text: 'Engineer ARMS the Engine (needs AVIONICS). Navigator dials the Δv and direction at the Nav Console and BURNS.\nMissed burns cost landing fuel.' },
        { title: 'Repairs', role: 'E', at: ['workbench', 'jettison'],
          text: 'Leaks and fuel-cell faults are fixed with the spare kits you built in the hangar — or improvised at the Workbench (slower).\nJettison dead mass: lighter lander = more landing fuel.' },
        { title: 'Landing', role: 'N', at: ['nav'],
          text: 'At arrival the Navigator starts the descent at the Nav Console.\nHold ▲ for more thrust, ▼ for less. Touch down slower than 3 m/s!\nPress H any time to see this again.' },
      ];
    }
    if (this.stage === 'surface') {
      return [
        { title: `Stage 3 · On ${this.orderTarget().name}`, role: null, at: [],
          text: `You landed! Surface time is limited (${this.surf.dur} s).\nScience sites are marked with purple flags outside.` },
        { title: 'EVA suits', role: 'L', at: ['suitrack', 'airlock'],
          text: `Only crew in an EVA suit can go through the Airlock. You prepared ${this.surf.suits} suit(s) in the hangar.\nSuit air runs out outside — come back in to refill.` },
        { title: 'Deploy instruments', role: 'S', at: ['lift'],
          text: 'Carry the instruments from the Cargo Lift to their site and press action.\nWhen a site has everything it needs, it collects data. Drill sites give a rock core — bring it to the Sample Lab.' },
        { title: 'Send it home', role: 'N', at: ['antenna', 'data'],
          text: 'Data counts only when it reaches Earth: downlink in comm windows.\nDust storm? Everyone inside!' },
        { title: 'Lift off', role: 'N', at: ['nav'],
          text: 'When you are done, everyone back inside — Navigator: END MISSION at the Nav Console.\nThen you will see the mission report.' },
      ];
    }
    return hangarTutorial.call(this);
  },
  nextHints() {
    if (this.stage !== 'hangar') return {};
    const h = hangarHints.call(this);
    for (const r of this.auto || []) h[r] = '🤖 autopilot does this role';
    return h;
  },
});

// ── Отчёт о миссии ────────────────────────────────────────────────────────
Object.assign(HangarScene.prototype, {
  computeScore() {
    const M = GAME.mission, diff = M.order ? M.order.difficulty : 0;
    const mult = DIFFICULTIES[diff].mult, max = Math.round(BASE_SCORE * mult);
    const Fl = M.flight, Su = M.surface, why = { success: [], science: [], eff: [], dec: [], team: [] };
    const clamp01 = (v) => Phaser.Math.Clamp(v, 0, 1);
    // 1) Успех миссии
    let success = 0;
    const launched = !!(Fl || M.failedStage === 'flight' || M.failedStage === 'surface');
    if (launched) { success += 0.3; why.success.push('✓ Passed every launch gate'); } else why.success.push('✗ Never launched');
    if (Fl && Fl.landing && Fl.landing.result) {
      success += 0.2; why.success.push(`✓ Reached ${TARGETS[M.order.target].name} after ${Fl.days} days`);
      const l = Fl.landing.result;
      success += l === 'soft' ? 0.3 : l === 'hard' ? 0.15 : 0;
      why.success.push(l === 'soft' ? `✓ Soft landing (${Fl.landing.v.toFixed(1)} m/s)` : l === 'hard' ? `~ Hard landing (${Fl.landing.v.toFixed(1)} m/s) — damaged the lander` : '✗ Crash landing');
    }
    let safe = 1;
    if (Fl) {
      if (Fl.hypoxiaT > 0) { safe -= 0.4; why.success.push(`✗ Cabin air or water ran out (${Fl.hypoxiaT.toFixed(0)} s)`); }
      if (Fl.hullMin < 70) { safe -= 0.2; why.success.push(`~ Hull pressure fell to ${Math.round(Fl.hullMin)}%`); }
      if (Fl.dose > 3) { safe -= 0.2; why.success.push('~ Crew outside the shelter during the solar flare'); }
      if (Fl.hungry) { safe -= 0.15; why.success.push('~ Food ran out — not enough food boxes packed'); }
    }
    if (Su) {
      if (Su.evaIncidents) { safe -= 0.2 * Su.evaIncidents; why.success.push(`✗ ${Su.evaIncidents} EVA suit emergency`); }
      if (Su.stormHits) { safe -= 0.15; why.success.push('~ Crew caught outside in the dust storm'); }
      if (Su.stranded) { safe -= 0.3; why.success.push(`✗ ${Su.stranded} crew left outside at lift-off`); }
      if (Su.sites.length) why.success.push(`${Su.sites.filter((x) => x.done).length} / ${Su.sites.length} surface science sites completed`);
    }
    if (M.failed) { safe = 0; why.success.push(`✗ ${M.failed}`); }
    if (launched) success += 0.2 * clamp01(safe);
    // 2) Наука: дошло до Земли (неотправленное — четверть, вернётся с капсулой)
    const tk = M.tickets || [];
    const total = tk.reduce((a, t) => a + t.pts, 0) || 1;
    let got = 0;
    const data = M.data || (Fl ? {} : {});
    for (const t of tk) {
      const d = data[t.id];
      if (!d) { why.science.push(`✗ ${t.id} ${t.name}: no data`); continue; }
      const v = Math.min(t.pts, d.sent + 0.25 * (d.made - d.sent));
      got += v;
      why.science.push(`${v >= t.pts * 0.8 ? '✓' : '~'} ${t.id}: ${Math.round(d.made)} MB made, ${Math.round(d.sent)} MB sent to Earth`);
    }
    if (Su && Su.analyzed) why.science.push(`✓ ${Su.analyzed} rock core(s) analyzed and sealed for return`);
    const science = clamp01(got / total + (Su && Su.analyzed ? 0.05 : 0));
    // 3) Ресурсы
    let eff = 0;
    if (M.budget) {
      const b = clamp01((M.budget - M.cost) / M.budget / 0.2);
      eff += 0.35 * b;
      why.eff.push(`${M.cost <= M.budget ? '✓' : '✗'} Spent ${money(M.cost)} of ${money(M.budget)}${b >= 1 ? ' — 20%+ saved' : ''}`);
      const mm = clamp01((M.lvCap - M.grossMass) / M.lvCap / 0.15);
      eff += 0.2 * (mm > 0.05 ? 1 : 0.5);
      why.eff.push(`Launch mass ${M.grossMass} of ${M.lvCap} kg launcher capacity`);
      const dead = (M.cargo0 || []).filter((c) => c.bad).length;
      const deadPacked = (M.gates || []).length ? (M.deadPacked || 0) : 0;
      eff += 0.2 * clamp01(1 - deadPacked / 4);
      if (deadPacked) why.eff.push(`✗ ${deadPacked} useless item(s) flew (expired, empty, distractor)`); else why.eff.push('✓ No dead mass packed');
      const fuelOk = Math.abs((M.fuelLoaded || 0) - (M.fuelRequired || 0)) <= Math.max(2, (M.fuelRequired || 0) * 0.01);
      eff += 0.15 * (fuelOk ? 1 : 0);
      why.eff.push(fuelOk ? '✓ Propellant matched the Tsiolkovsky estimate' : '✗ Propellant mass was off');
    }
    if (Fl) {
      const jet = Fl.jettisoned.filter((j) => j.dead).reduce((a, j) => a + j.mass, 0);
      eff += 0.1 * clamp01(jet / 50);
      if (jet) why.eff.push(`✓ Jettisoned ${Math.round(jet)} kg of dead mass in flight`);
      if (Fl.wasted) why.eff.push(`✗ Threw out ${Math.round(Fl.wasted)} kg of useful supplies`);
    }
    // 4) Решения
    const mistakes = M.mistakes || 0;
    let dec = 0.5 * clamp01(1 - mistakes * 0.1);
    why.dec.push(mistakes ? `${mistakes} mistake(s) (wrong parts, wrong numbers, overloads…)` : '✓ No mistakes');
    if (Fl) {
      const ratio = (Fl.handled) / Math.max(1, Fl.handled + Fl.missed);
      dec += 0.5 * ratio;
      why.dec.push(`${Fl.handled} problem(s) handled in time, ${Fl.missed} missed`);
      if (Fl.courseErr) why.dec.push(`~ ${Fl.courseErr} course correction(s) missed or off`);
    } else dec += 0.5 * clamp01(1 - mistakes * 0.1);
    // 5) Команда
    const T = M.team || { t: 1, par: 0, busy: 0 };
    const n = (GAME.roster || []).length || 1;
    let team;
    if (n <= 1) { team = clamp01((T.busy / Math.max(1, T.t)) / 0.7); why.team.push(`Solo: busy ${Math.round((100 * T.busy) / Math.max(1, T.t))}% of the time`); }
    else { team = clamp01((T.par / Math.max(1, T.t)) / 0.5); why.team.push(`Two or more crew working at once ${Math.round((100 * T.par) / Math.max(1, T.t))}% of the time`); }
    const autos = ROLE_ORDER.filter((r) => !(GAME.roster || []).some((p) => p.role === r));
    if (autos.length) why.team.push(`🤖 Autopilot covered: ${autos.map((r) => ROLES[r].name).join(', ')}`);
    const cats = [
      { key: 'success', name: 'Mission success', w: 0.3, v: clamp01(success), col: 0x8be08b },
      { key: 'science', name: 'Science value', w: 0.3, v: science, col: 0xa25bd6 },
      { key: 'eff', name: 'Resource efficiency', w: 0.15, v: clamp01(eff), col: 0xffcf5a },
      { key: 'dec', name: 'Decision quality', w: 0.15, v: clamp01(dec), col: 0x3fa7e0 },
      { key: 'team', name: 'Teamwork', w: 0.1, v: team, col: 0xe05a5a },
    ];
    const score = Math.round(max * cats.reduce((a, c) => a + c.w * c.v, 0));
    return { cats, why, score, max, diff };
  },

  buildReport() {
    this.cameras.main.fadeIn(500, 6, 10, 28);
    this.starfield(5);
    const M = GAME.mission;
    const R = this.report = this.computeScore();
    // таблица рекордов (в браузере игрока)
    let board = [];
    try { board = JSON.parse(localStorage.getItem('launchrush_scores') || '[]'); } catch (e) { board = []; }
    const entry = { score: R.score, max: R.max, target: TARGETS[M.order ? M.order.target : 1].name, diff: DIFFICULTIES[R.diff].name,
      crew: (GAME.roster || []).length, failed: !!M.failed, date: new Date().toISOString().slice(0, 10), me: true };
    board = board.map((b) => ({ ...b, me: false })).concat(entry).sort((a, b) => b.score - a.score).slice(0, 8);
    try { localStorage.setItem('launchrush_scores', JSON.stringify(board.map((b) => ({ ...b, me: false })))); } catch (e) { /* без хранилища — только эта сессия */ }
    const c = this.add.container(0, 0).setDepth(100);
    const g = this.add.graphics(); c.add(g);
    const t = (x, y, s, st = {}, ox = 0) => { const o = this.add.text(x, y, s, { color: '#e6e9ff', fontSize: '13px', ...st }).setOrigin(ox, 0); c.add(o); return o; };
    g.fillStyle(0x0f1430, 0.96).fillRoundedRect(30, 24, 1220, 672, 16);
    g.lineStyle(2, M.failed ? 0xff7a7a : 0xffcf5a, 1).strokeRoundedRect(30, 24, 1220, 672, 16);
    t(60, 40, M.failed ? 'MISSION REPORT — FAILED' : 'MISSION REPORT', { fontSize: '28px', fontStyle: 'bold', color: M.failed ? '#ff8a8a' : '#ffcf5a' });
    const o = M.order;
    if (o) t(60, 78, `${MISSION_TYPES[o.type].name} · ${TARGETS[o.target].name} · ${DIFFICULTIES[o.difficulty].name} · crew of ${(GAME.roster || []).length}`, { color: '#9aa3cf', fontSize: '14px' });
    // итог
    t(1220, 36, `${R.score}`, { fontSize: '54px', fontStyle: 'bold', color: '#ffffff' }, 1);
    t(1220, 98, `of ${R.max} points (×${DIFFICULTIES[R.diff].mult})`, { color: '#8c96c8' }, 1);
    // категории
    let y = 124;
    for (const cat of R.cats) {
      const pts = Math.round(R.max * cat.w * cat.v), maxPts = Math.round(R.max * cat.w);
      t(60, y, cat.name, { fontSize: '16px', fontStyle: 'bold', color: hex(cat.col) });
      t(560, y, `${pts} / ${maxPts}`, { fontSize: '15px', fontStyle: 'bold' }, 1);
      g.fillStyle(0x070a16, 1).fillRoundedRect(60, y + 24, 500, 8, 4);
      g.fillStyle(cat.col, 1).fillRoundedRect(60, y + 24, 500 * cat.v, 8, 4);
      const lines = R.why[cat.key].slice(0, 4);
      lines.forEach((l, i) => t(70, y + 38 + i * 16, l, { color: '#b9c0e6', fontSize: '11.5px', wordWrap: { width: 500 } }));
      y += 44 + Math.max(1, lines.length) * 16 + 8;
    }
    // справа: что произошло
    let ry = 140;
    t(620, ry, 'What happened', { fontSize: '16px', fontStyle: 'bold', color: '#ffcf5a' }); ry += 26;
    const story = [];
    if (M.design && M.route !== null && M.route !== undefined) story.push(`Hangar: ${ROUTES[M.route].name}, ${LAUNCH_VEHICLES[M.design.lv].name}, ${ANTENNAS[M.design.ant].name}; ${M.cargo0 ? M.cargo0.length : ''} items, ${Math.round(M.fuelLoaded || 0)} kg propellant.`);
    if (M.flight) story.push(...M.flight.log.slice(-7));
    if (M.surface) story.push(...M.surface.log.slice(-5));
    if (M.failed) story.push(`💀 ${M.failed}`);
    story.slice(0, 9).forEach((l) => { const o2 = t(630, ry, '• ' + l, { color: '#b9c0e6', fontSize: '11.5px', wordWrap: { width: 600 } }); ry += o2.height + 3; });
    // связь с реальностью: чему учит то, что сейчас было
    ry += 10;
    t(620, ry, 'Real spaceflight behind this mission', { fontSize: '15px', fontStyle: 'bold', color: '#ffcf5a' }); ry += 22;
    const facts = [
      'Propellant = Tsiolkovsky rocket equation: every extra kg of cargo costs fuel, and fuel itself is mass.',
      'Comm windows: real probes talk to Earth through NASA\'s Deep Space Network only when a dish can see them.',
      'Storm shelter: Orion crews hide behind stowed cargo and water during solar particle events.',
    ];
    for (const f of facts) { const o3 = t(630, ry, '• ' + f, { color: '#9aa3cf', fontSize: '11px', wordWrap: { width: 600 } }); ry += o3.height + 2; }
    if (M.design && M.route !== null && M.route !== undefined && o) {
      const code = [TARGETS[o.target].name.toUpperCase(), ROUTES[M.route].id, LAUNCH_VEHICLES[M.design.lv].id, ANTENNAS[M.design.ant].id, ...(M.cargo0 || []).filter((c) => c.type === 'instrument').map((c) => c.code)].join('-');
      ry += 6; t(630, ry, `Design code (share it): ${code}`, { color: '#8be08b', fontSize: '11.5px', fontStyle: 'bold', wordWrap: { width: 600 } }); ry += 18;
    }
    // лучшие результаты
    ry = Math.max(ry + 12, 500);
    t(620, ry, 'Best missions on this computer', { fontSize: '15px', fontStyle: 'bold', color: '#ffcf5a' }); ry += 24;
    board.slice(0, 5).forEach((b, i) => {
      t(630, ry, `${i + 1}. ${b.score} / ${b.max} · ${b.target} · ${b.diff} · ${b.crew} crew${b.failed ? ' · failed' : ''}`, { color: b.me ? '#8be08b' : '#b9c0e6', fontSize: '12px', fontStyle: b.me ? 'bold' : 'normal' });
      ry += 18;
    });
    t(640, 660, 'Action key — fly again with the same crew  ·  ▼ — change players', { color: '#8c96c8', fontSize: '14px' }, 0.5);
    const kb = this.input.keyboard;
    this.reportKeys = PLAYERS.map((cfg) => ({ use: cfg.use.map((k) => kb.addKey(k, true)), down: cfg.down.map((k) => kb.addKey(k, true)) }));
  },

  updateReport() {
    const J = Phaser.Input.Keyboard.JustDown;
    for (const k of this.reportKeys || []) {
      if (k.use.some(J)) { GAME.mission = null; this.scene.restart({ stage: 'hangar' }); return; }
      if (k.down.some(J)) { GAME.mission = null; GAME.roster = null; this.scene.restart({ stage: 'hangar' }); return; }
    }
  },
});
