// ===================================================
// トップページの「立体の街」
// 箱（ブロック）を積み上げて、そよかぜの活動を表す小さな島をつくり、
// スクロールに合わせてカメラを島のまわりに回します。
//
// 場面を足したいとき：
//   1. index.html の .cards の中に <section class="panel"> を足す
//   2. このファイルの STOPS に、その場面のカメラ位置を1行足す
// ===================================================

import * as THREE from './vendor/three.module.min.js';

const root = document.documentElement;
const journey = document.getElementById('journey');
const stage = document.getElementById('stage');
const canvas = document.getElementById('worldCanvas');
const cardsEl = document.getElementById('cards');
const lineEl = document.querySelector('#stageLine path');
const spotEl = document.getElementById('stageSpot');
const progressEl = document.getElementById('progress');
const hintEl = document.getElementById('scrollHint');
const panels = [...document.querySelectorAll('.panel')];

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEG = Math.PI / 180;

// ---------- 色 ----------
const C = {
  grass: 0x9fd16c, grassDark: 0x86c05a, soil: 0xc9955c, soilDark: 0xa87a47,
  sand: 0xf4e2b0, water: 0x66c9dc, waterDeep: 0x45b0cc, path: 0xf6e8c6,
  white: 0xffffff, cream: 0xfff1d2, stone: 0xd9d4c7,
  red: 0xe8533d, coral: 0xf47c6a, pink: 0xf8aebb, orange: 0xf59e2d, yellow: 0xfad04a,
  teal: 0x2bb3a8, blue: 0x4a97dc, navy: 0x2d4b70, purple: 0x8f7bd6,
  wood: 0xb47a48, brown: 0x8a5a35, darkBrown: 0x4c3526,
  leaf: 0x62b85c, leafDark: 0x3f9d55, skin: 0xf7d0a8, black: 0x2c2724, grey: 0xaab4b8,
};

// ---------- カメラが止まる場所（カードと同じ順番） ----------
// target: 見つめる点 / az: 島を回る角度 / el: 見下ろす角度 / dist: 距離 / spot: 点線の先
const STOPS = [
  { target: [0, 1.6, -1.0],   az: 35,  el: 31, dist: 74, spot: [0, 8.1, -3] },     // ホーム：風車
  { target: [5.2, 1.8, -0.3], az: 80,  el: 27, dist: 40, spot: [6.9, 5.0, -0.3] }, // 団体概要：みんなの拠点
  { target: [4.8, 1.6, -5.8], az: 138, el: 27, dist: 38, spot: [5.6, 3.9, -6.4] }, // 代表挨拶：ただいまの家
  { target: [-4.8, 2.0, -5.6], az: 222, el: 27, dist: 40, spot: [-5.6, 5.3, -6.2] }, // 活動紹介：あばれ祭り
  { target: [-5.2, 1.6, -0.3], az: 292, el: 27, dist: 38, spot: [-6.6, 3.7, -0.3] }, // 魅力発信：うまいもん商店
  { target: [0.6, 1.4, 4.6],  az: 372, el: 25, dist: 40, spot: [1.5, 3.3, 5.0] },  // お問い合わせ：ポスト
];

// ===================================================
// 3D の準備
// ===================================================

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) {
  renderer = null;
}

if (renderer && panels.length === STOPS.length) {
  start();
}

function start() {
  root.classList.add('is-3d');

  const isSmall = () => window.innerWidth <= 820;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 1, 200);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xf3d9b0, 2.1));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.3);
  sun.position.set(14, 24, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(isSmall() ? 1024 : 2048, isSmall() ? 1024 : 2048);
  sun.shadow.camera.left = -22;
  sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  const world = new THREE.Group();
  scene.add(world);

  // ---------- ブロックを置く道具 ----------
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const matCache = new Map();
  function mat(color, glow = 0) {
    const key = color + '|' + glow;
    if (!matCache.has(key)) {
      const m = new THREE.MeshLambertMaterial({ color });
      if (glow) {
        m.emissive = new THREE.Color(color);
        m.emissiveIntensity = glow;
      }
      matCache.set(key, m);
    }
    return matCache.get(key);
  }

  // box(親, 幅, 高さ, 奥行き, x, 底のy, z, 色)
  function box(parent, w, h, d, x, y, z, color, opt = {}) {
    const m = new THREE.Mesh(unit, mat(color, opt.glow || 0));
    m.scale.set(w, h, d);
    m.position.set(x, y + h / 2, z);
    m.castShadow = opt.cast !== false;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  function group(parent, x = 0, y = 0, z = 0, rotY = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    parent.add(g);
    return g;
  }

  // 動くもの（毎フレーム呼ぶ関数）を登録する
  const animated = [];
  function dynamic(g, update) {
    g.userData.dynamic = true;
    if (update) animated.push(update);
    return g;
  }

  // いつも同じ並びになる乱数
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  // 文字の看板（画像として描いて板に貼る）
  function sign(parent, text, w, h, x, y, z, { bg = '#ffffff', fg = '#17414a', rotY = 0, both = false } = {}) {
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = Math.round((512 * h) / w);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = cv.height * 0.62;
    const font = (s) => `900 ${s}px "Zen Maru Gothic", "Hiragino Maru Gothic ProN", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif`;
    ctx.font = font(size);
    const max = cv.width * 0.88;
    const tw = ctx.measureText(text).width;
    if (tw > max) {
      size *= max / tw;
      ctx.font = font(size);
    }
    ctx.fillText(text, cv.width / 2, cv.height / 2 + size * 0.04);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshLambertMaterial({ map: tex, side: both ? THREE.DoubleSide : THREE.FrontSide })
    );
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    parent.add(m);
    return m;
  }

  // 写真の立て看板（実際の活動写真）
  const texLoader = new THREE.TextureLoader();
  function photoBoard(parent, src, w, h, x, z, rotY) {
    const g = group(parent, x, 0, z, rotY);
    box(g, 0.14, 1.0, 0.14, -w * 0.3, 0, 0, C.brown);
    box(g, 0.14, 1.0, 0.14, w * 0.3, 0, 0, C.brown);
    box(g, w + 0.3, h + 0.3, 0.16, 0, 0.9, 0, C.white);
    const tex = texLoader.load(src);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
    m.position.set(0, 0.9 + (h + 0.3) / 2, 0.09);
    g.add(m);
    return g;
  }

  // 人
  const SHIRTS = [C.coral, C.yellow, C.teal, C.blue, C.pink, C.orange, C.white, C.purple];
  const HAIRS = [C.black, C.darkBrown, C.brown];
  function person(parent, x, z, rotY = 0, { shirt, pants = C.navy, hair, s = 1 } = {}) {
    const g = group(parent, x, 0, z, rotY);
    g.scale.setScalar(s);
    const sh = shirt ?? pick(SHIRTS);
    box(g, 0.16, 0.3, 0.18, -0.1, 0, 0, pants);
    box(g, 0.16, 0.3, 0.18, 0.1, 0, 0, pants);
    box(g, 0.42, 0.4, 0.26, 0, 0.3, 0, sh);
    const armL = box(g, 0.12, 0.34, 0.16, -0.27, 0.34, 0, sh);
    const armR = box(g, 0.12, 0.34, 0.16, 0.27, 0.34, 0, sh);
    box(g, 0.34, 0.32, 0.3, 0, 0.7, 0, C.skin);
    box(g, 0.38, 0.14, 0.34, 0, 0.96, 0, hair ?? pick(HAIRS));
    box(g, 0.38, 0.2, 0.1, 0, 0.78, -0.14, hair ?? C.black);
    g.userData.armL = armL;
    g.userData.armR = armR;
    return g;
  }

  // 木
  function tree(parent, x, z, { sakura = false, s = 1 } = {}) {
    const g = group(parent, x, 0, z, rand() * Math.PI);
    g.scale.setScalar(s);
    const a = sakura ? C.pink : C.leaf;
    const b = sakura ? 0xf6c4cd : C.leafDark;
    box(g, 0.3, 0.9, 0.3, 0, 0, 0, C.brown);
    box(g, 1.3, 0.7, 1.3, 0, 0.8, 0, b);
    box(g, 1.0, 0.6, 1.0, 0.05, 1.5, 0.05, a);
    box(g, 0.55, 0.45, 0.55, -0.05, 2.1, 0, a);
    return g;
  }

  function flower(parent, x, z, color) {
    box(parent, 0.06, 0.2, 0.06, x, 0, z, C.leafDark, { cast: false });
    box(parent, 0.18, 0.14, 0.18, x, 0.2, z, color, { cast: false });
  }

  // ===================================================
  // 島
  // ===================================================
  function buildIsland() {
    // 草地・土・砂浜・海
    box(world, 24, 0.5, 18, 0, -0.5, -3, C.grass);
    box(world, 24, 1.3, 18, 0, -1.8, -3, C.soil);
    box(world, 24.4, 0.4, 18.4, 0, -2.2, -3, C.soilDark);
    box(world, 24, 0.42, 1.6, 0, -0.5, 6.8, C.sand);
    box(world, 24, 1.3, 1.6, 0, -1.8, 6.8, C.soil);
    box(world, 24, 0.3, 4.6, 0, -0.62, 9.9, C.water, { cast: false });
    box(world, 24, 1.2, 4.6, 0, -1.82, 9.9, C.waterDeep);
    box(world, 24.4, 0.4, 6.4, 0, -2.2, 9.2, C.soilDark);

    // ぐるっと一周する道
    const X = 9.8, Z0 = -9.8, Z1 = 3.5, W = 1.25;
    box(world, X * 2 + W, 0.06, W, 0, 0, Z0, C.path, { cast: false });
    box(world, X * 2 + W, 0.06, W, 0, 0, Z1, C.path, { cast: false });
    box(world, W, 0.06, Z1 - Z0 - W, -X, 0, (Z0 + Z1) / 2, C.path, { cast: false });
    box(world, W, 0.06, Z1 - Z0 - W, X, 0, (Z0 + Z1) / 2, C.path, { cast: false });
    // 風車へ続く小道
    box(world, 0.9, 0.05, 4.2, 0, 0, 1.1, C.path, { cast: false });
    box(world, 0.9, 0.05, 2.0, 0, 0, 4.9, C.path, { cast: false });

    // 草のむら
    for (let i = 0; i < 46; i++) {
      const x = -11.4 + rand() * 22.8;
      const z = -11.4 + rand() * 16.6;
      const onRoad = Math.abs(Math.abs(x) - X) < 0.9 || Math.abs(z - Z0) < 0.9 || Math.abs(z - Z1) < 0.9;
      if (onRoad) continue;
      box(world, 0.5 + rand() * 0.6, 0.04, 0.5 + rand() * 0.6, x, 0, z, C.grassDark, { cast: false });
    }

    // 外まわりの木と丘
    const outer = [
      [-11, -11.2], [-8.6, -11.3], [-4.5, -11.2], [-1.5, -11.4], [2.5, -11.2], [6, -11.3], [9, -11.2], [11.2, -11],
      [-11.3, -7.5], [-11.2, -3.5], [-11.3, 0.5], [-11.2, 4.6],
      [11.3, -7], [11.2, -3], [11.3, 1.5], [11.2, 4.8],
    ];
    outer.forEach(([x, z], i) => tree(world, x, z, { sakura: i % 3 === 1, s: 0.8 + rand() * 0.35 }));
    // 道の内側
    [[-2.6, -8.2], [2.8, -8.3], [0.2, -7.6], [-8.6, -3.4], [8.6, -3.4], [-2.8, 1.8], [2.9, 1.9]]
      .forEach(([x, z], i) => tree(world, x, z, { sakura: i % 2 === 0, s: 0.75 + rand() * 0.3 }));

    // 丘（奥の角）
    const hill = group(world, -10.6, 0, -10.4);
    box(hill, 2.6, 0.6, 2.6, 0, 0, 0, C.grassDark);
    box(hill, 1.8, 0.6, 1.8, 0.1, 0.6, 0.1, C.leaf);
    box(hill, 1.0, 0.5, 1.0, 0.1, 1.2, 0.1, C.leafDark);

    // 花
    const flowerColors = [C.pink, C.yellow, C.white, C.coral];
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2;
      const r = 3.2 + rand() * 1.2;
      flower(world, Math.cos(a) * r, -3 + Math.sin(a) * r * 0.9, pick(flowerColors));
    }
  }

  // ---------- 風車（ホーム） ----------
  function buildWindmill() {
    const g = group(world, 0, 0, -3, 35 * DEG);
    box(g, 3.4, 0.5, 3.4, 0, 0, 0, C.stone);
    const widths = [2.7, 2.5, 2.3, 2.1, 1.9, 1.7];
    widths.forEach((w, i) => box(g, w, 1.1, w, 0, 0.5 + i * 1.1, 0, i === 2 ? C.coral : C.white));
    box(g, 2.1, 0.9, 2.1, 0, 7.1, 0, C.cream);
    box(g, 2.5, 0.35, 2.5, 0, 8.0, 0, C.red);
    box(g, 1.7, 0.35, 1.7, 0, 8.35, 0, C.red);
    box(g, 0.9, 0.3, 0.9, 0, 8.7, 0, C.coral);
    // とびらと窓
    box(g, 0.8, 1.2, 0.12, 0, 0.5, 1.36, C.brown);
    box(g, 0.5, 0.5, 0.12, 0, 3.0, 1.18, C.navy);
    box(g, 0.5, 0.5, 0.12, 0, 5.1, 1.0, C.navy);
    box(g, 0.12, 0.5, 0.5, 1.18, 3.9, 0, C.navy);

    // 羽根（回る）
    const hub = dynamic(group(g, 0, 7.55, 1.2));
    box(hub, 0.5, 0.5, 0.5, 0, -0.25, 0, C.darkBrown);
    for (let i = 0; i < 4; i++) {
      const blade = group(hub);
      blade.rotation.z = (i * Math.PI) / 2;
      box(blade, 0.16, 4.0, 0.12, 0, 0.1, 0.2, C.brown);
      box(blade, 0.95, 2.9, 0.07, 0.55, 1.1, 0.2, C.cream);
      for (let k = 0; k < 4; k++) box(blade, 0.95, 0.07, 0.1, 0.55, 1.3 + k * 0.7, 0.2, C.brown);
    }
    animated.push((t) => {
      hub.rotation.z = -t * 0.55;
    });

    // 風車の前のベンチと人
    box(world, 1.3, 0.12, 0.4, 1.9, 0.3, -0.2, C.wood);
    box(world, 0.12, 0.3, 0.4, 1.4, 0, -0.2, C.brown);
    box(world, 0.12, 0.3, 0.4, 2.4, 0, -0.2, C.brown);
    person(world, -1.5, -0.3, 0.6);
    person(world, -1.0, 0.1, -2.2, { s: 0.75 });
  }

  // ---------- みんなの拠点（団体概要） ----------
  function buildBase() {
    const g = group(world, 6.2, 0, -0.3, 90 * DEG);
    box(g, 5.2, 0.2, 3.4, 0, 0, -0.6, C.stone);
    box(g, 5.0, 2.6, 3.0, 0, 0.2, -0.6, C.cream);
    box(g, 5.4, 0.35, 3.4, 0, 2.8, -0.6, C.blue);
    box(g, 2.2, 1.5, 3.0, 0, 3.15, -0.6, C.cream);
    box(g, 2.6, 0.35, 3.4, 0, 4.65, -0.6, C.blue);
    box(g, 1.6, 0.3, 2.4, 0, 5.0, -0.6, C.navy);
    // 時計
    box(g, 0.9, 0.9, 0.12, 0, 3.4, 0.92, C.white);
    box(g, 0.08, 0.34, 0.14, 0, 3.85, 0.94, C.navy);
    box(g, 0.28, 0.08, 0.14, 0.12, 3.82, 0.94, C.navy);
    // 窓ととびら
    for (const x of [-1.9, -1.1, 1.1, 1.9]) {
      box(g, 0.55, 0.65, 0.1, x, 1.6, 0.92, C.teal);
      box(g, 0.55, 0.55, 0.1, x, 0.6, 0.92, C.teal);
    }
    box(g, 1.0, 1.5, 0.12, 0, 0.2, 0.92, C.orange);
    box(g, 1.4, 0.14, 0.6, 0, 1.75, 1.1, C.coral);
    sign(g, 'そよかぜ', 1.9, 0.5, 0, 2.48, 0.93, { bg: '#ffffff', fg: '#17414a' });
    // 旗
    box(g, 0.12, 4.2, 0.12, 3.1, 0, 1.4, C.grey);
    const flag = dynamic(group(g, 3.16, 3.5, 1.4));
    box(flag, 1.2, 0.75, 0.06, 0.6, 0, 0, C.teal);
    box(flag, 0.35, 0.35, 0.08, 0.6, 0.2, 0, C.white);
    animated.push((t) => {
      flag.rotation.y = Math.sin(t * 2.4) * 0.28;
    });
    // 前庭の人たち
    person(g, -1.6, 2.1, 0.3);
    person(g, -0.9, 2.3, -0.4);
    person(g, 1.3, 2.2, 0.1);
    person(g, 2.0, 2.4, -0.3, { s: 0.75 });
    photoBoard(world, 'assets/image/thumb/board-group.jpg', 1.5, 2.0, 8.2, 2.3, 70 * DEG);
  }

  // ---------- ただいまの家（代表挨拶） ----------
  function buildHome() {
    const g = group(world, 5.6, 0, -6.4, 138 * DEG);
    box(g, 3.4, 2.2, 2.8, 0, 0, 0, C.white);
    box(g, 4.0, 0.45, 3.6, 0, 2.2, 0, C.red);
    box(g, 4.0, 0.45, 2.6, 0, 2.65, 0, C.red);
    box(g, 4.0, 0.45, 1.5, 0, 3.1, 0, C.coral);
    box(g, 4.0, 0.3, 0.5, 0, 3.55, 0, C.coral);
    box(g, 0.5, 1.2, 0.5, 1.1, 2.9, -0.7, C.stone);
    // 明かりのついたとびらと窓
    box(g, 0.9, 1.5, 0.1, -0.6, 0, 1.42, C.yellow, { glow: 0.55 });
    box(g, 0.5, 1.5, 0.08, -1.25, 0, 1.6, C.brown).rotation.y = 0.9;
    box(g, 0.8, 0.7, 0.1, 0.9, 0.9, 1.42, C.yellow, { glow: 0.55 });
    box(g, 0.1, 0.7, 0.8, 1.72, 0.9, 0, C.yellow, { glow: 0.55 });
    sign(g, 'ただいま', 1.5, 0.48, 0.2, 1.95, 1.43, { bg: '#fff1d2', fg: '#c84a36' });
    // 柵と花
    for (let i = 0; i < 6; i++) box(g, 0.12, 0.5, 0.12, -2.4 + i * 0.3, 0, 2.6, C.white);
    box(g, 1.7, 0.1, 0.1, -1.65, 0.3, 2.6, C.white);
    [C.pink, C.yellow, C.coral, C.white].forEach((c, i) => flower(g, 1.0 + i * 0.35, 1.8, c));
    // 煙
    const puffs = [0, 1, 2].map((i) => {
      const p = box(g, 0.4, 0.4, 0.4, 1.1, 4.2, -0.7, C.white, { cast: false });
      p.userData.dynamic = true;
      p.userData.off = i / 3;
      return p;
    });
    animated.push((t) => {
      puffs.forEach((p) => {
        const k = (t * 0.22 + p.userData.off) % 1;
        p.position.set(1.1 + k * 0.7, 4.3 + k * 2.0, -0.7);
        p.scale.setScalar(0.25 + k * 0.5 * (1 - k * 0.6));
      });
    });
    // 手をふる代表
    const rep = person(g, -0.2, 2.2, 0, { shirt: C.yellow, pants: C.black, s: 1.15 });
    const arm = rep.userData.armR;
    dynamic(rep, (t) => {
      arm.position.set(0.34, 0.72, 0);
      arm.rotation.z = -0.5 + Math.sin(t * 5) * 0.45;
      rep.position.y = Math.abs(Math.sin(t * 2.5)) * 0.06;
    });
    person(g, 1.3, 2.6, -0.5, { s: 0.75 });
    tree(g, 2.8, 0.6, { sakura: true });
  }

  // ---------- あばれ祭り（活動紹介） ----------
  function buildFestival() {
    const g = group(world, -5.6, 0, -6.2, 222 * DEG);

    // 切子（きりこ）：大きな灯ろうをみんなで担ぐ
    function kiriko(x, z, h, phase) {
      const k = dynamic(group(g, x, 0, z));
      box(k, 3.0, 0.12, 0.12, 0, 0.78, -0.38, C.brown);
      box(k, 3.0, 0.12, 0.12, 0, 0.78, 0.38, C.brown);
      box(k, 1.1, 0.25, 1.1, 0, 0.84, 0, C.red);
      box(k, 0.86, h, 0.86, 0, 1.09, 0, 0xfff0c2, { glow: 0.5 });
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        box(k, 0.1, h, 0.1, sx * 0.44, 1.09, sz * 0.44, C.black);
      }
      box(k, 0.96, 0.1, 0.96, 0, 1.09 + h * 0.5, 0, C.red);
      box(k, 1.3, 0.22, 1.3, 0, 1.09 + h, 0, C.black);
      box(k, 0.9, 0.2, 0.9, 0, 1.31 + h, 0, C.red);
      box(k, 0.4, 0.3, 0.4, 0, 1.51 + h, 0, C.yellow);
      for (const [px, pz] of [[-1.3, -0.38], [1.3, -0.38], [-1.3, 0.38], [1.3, 0.38], [-0.8, 0.38], [0.8, -0.38]]) {
        person(k, px, pz * 1.9, pz > 0 ? Math.PI : 0, { shirt: C.white, pants: C.navy, s: 0.85 });
      }
      animated.push((t) => {
        k.position.y = Math.abs(Math.sin(t * 2.6 + phase)) * 0.16;
        k.rotation.z = Math.sin(t * 1.3 + phase) * 0.045;
      });
    }
    kiriko(0, 0, 3.3, 0);
    kiriko(-2.5, -0.6, 2.6, 1.3);
    kiriko(2.4, -0.9, 2.2, 2.4);

    // たいまつ
    const torch = group(g, 2.6, 0, 1.6);
    box(torch, 0.5, 0.2, 0.5, 0, 0, 0, C.stone);
    box(torch, 0.2, 2.2, 0.2, 0, 0.2, 0, C.darkBrown);
    box(torch, 0.5, 0.3, 0.5, 0, 2.4, 0, C.brown);
    const flames = [C.red, C.orange, C.yellow].map((c, i) => {
      const f = box(torch, 0.42 - i * 0.1, 0.45, 0.42 - i * 0.1, 0, 2.7 + i * 0.3, 0, c, { glow: 0.8, cast: false });
      f.userData.dynamic = true;
      return f;
    });
    animated.push((t) => {
      flames.forEach((f, i) => {
        const s = 1 + Math.sin(t * 9 + i * 2.1) * 0.22;
        f.scale.y = 0.45 * s;
        f.position.x = Math.sin(t * 7 + i) * 0.05;
      });
    });

    // ちょうちんの列
    box(g, 0.12, 2.3, 0.12, -3.6, 0, 2.2, C.brown);
    box(g, 0.12, 2.3, 0.12, 0.6, 0, 2.4, C.brown);
    box(g, 4.3, 0.06, 0.06, -1.5, 2.2, 2.3, C.darkBrown);
    for (let i = 0; i < 6; i++) {
      box(g, 0.3, 0.38, 0.3, -3.2 + i * 0.68, 1.78, 2.3, i % 2 ? C.white : C.red, { glow: 0.35 });
    }
    // 太鼓
    box(g, 0.9, 0.5, 0.9, -2.2, 0, 2.9, C.wood);
    box(g, 0.8, 0.5, 0.8, -2.2, 0.5, 2.9, C.red);
    box(g, 0.7, 0.08, 0.7, -2.2, 1.0, 2.9, C.cream);
    person(g, -1.4, 3.0, -1.2, { shirt: C.navy });
    person(g, 1.2, 2.9, 2.8, { s: 0.75 });
    photoBoard(world, 'assets/image/thumb/board-festival.jpg', 2.1, 1.4, -8.0, -8.4, 228 * DEG);
  }

  // ---------- うまいもん商店（魅力発信） ----------
  function buildMarket() {
    const g = group(world, -6.2, 0, -0.3, 292 * DEG);

    function stall(x, z, stripe, label) {
      const s = group(g, x, 0, z);
      box(s, 3.4, 0.9, 1.1, 0, 0, 0, C.wood);
      box(s, 3.6, 0.1, 1.3, 0, 0.9, 0, C.cream);
      for (const [px, pz] of [[-1.65, -0.5], [1.65, -0.5], [-1.65, 0.5], [1.65, 0.5]]) {
        box(s, 0.12, 2.5, 0.12, px, 0, pz, C.brown);
      }
      // しましまの屋根
      const awning = group(s, 0, 2.5, 0);
      awning.rotation.x = 0.22;
      for (let i = 0; i < 8; i++) {
        box(awning, 0.46, 0.14, 2.0, -1.61 + i * 0.46, 0, 0.15, i % 2 ? C.white : stripe);
      }
      if (label) sign(s, label, 3.0, 0.62, 0, 3.15, 0.7, { bg: '#17414a', fg: '#ffffff' });
      // 売り物
      const goods = [C.leafDark, C.orange, C.yellow, C.red, C.teal, C.pink];
      for (let i = 0; i < 6; i++) {
        const bottle = i % 2 === 0;
        box(s, bottle ? 0.2 : 0.42, bottle ? 0.55 : 0.28, bottle ? 0.2 : 0.42, -1.3 + i * 0.52, 1.0, 0.1, goods[i]);
        if (bottle) box(s, 0.1, 0.16, 0.1, -1.3 + i * 0.52, 1.55, 0.1, C.white);
      }
      person(s, 0.4, -0.95, 0, { shirt: C.red });
      return s;
    }
    stall(0, 0, C.red, 'うまいもん商店');
    stall(0.4, -3.0, C.teal, null).rotation.y = 0.25;

    // 木箱
    box(g, 0.8, 0.6, 0.8, 2.6, 0, 0.6, C.wood);
    box(g, 0.7, 0.5, 0.7, 2.55, 0.6, 0.6, C.brown);
    box(g, 0.25, 0.25, 0.25, 2.4, 1.1, 0.5, C.orange);
    box(g, 0.25, 0.25, 0.25, 2.7, 1.1, 0.7, C.red);
    box(g, 0.8, 0.6, 0.8, -2.7, 0, 0.9, C.wood);

    // お客さん
    person(g, -0.9, 1.5, Math.PI + 0.2);
    person(g, 0.3, 1.7, Math.PI - 0.2);
    person(g, 1.2, 1.5, Math.PI, { s: 0.75 });

    // 三角の旗
    box(g, 0.1, 3.2, 0.1, -3.2, 0, 2.6, C.brown);
    box(g, 0.1, 3.2, 0.1, 3.2, 0, 2.6, C.brown);
    const bunting = dynamic(group(g, 0, 3.0, 2.6));
    const flagColors = [C.coral, C.yellow, C.teal, C.pink, C.blue, C.orange];
    for (let i = 0; i < 12; i++) {
      const sag = Math.pow((i - 5.5) / 5.5, 2) * 0.45 - 0.45;
      box(bunting, 0.3, 0.32, 0.04, -3.0 + i * 0.545, sag, 0, flagColors[i % 6], { cast: false });
    }
    animated.push((t) => {
      bunting.rotation.x = Math.sin(t * 2) * 0.12;
    });
    photoBoard(world, 'assets/image/thumb/board-market.jpg', 1.9, 1.42, -8.2, 2.5, 300 * DEG);
  }

  // ---------- ポストと海（お問い合わせ） ----------
  function buildContact() {
    const g = group(world, 1.5, 0, 5.0, 12 * DEG);
    // 赤いポスト
    box(g, 0.9, 0.2, 0.8, 0, 0, 0, C.stone);
    box(g, 0.8, 1.3, 0.7, 0, 0.2, 0, C.red);
    box(g, 0.9, 0.18, 0.8, 0, 1.5, 0, C.red);
    box(g, 0.5, 0.08, 0.06, 0, 1.2, 0.36, C.black);
    box(g, 0.36, 0.06, 0.05, 0, 0.92, 0.36, C.white);
    box(g, 0.26, 0.06, 0.05, 0, 0.8, 0.36, C.white);
    box(g, 0.06, 0.26, 0.05, 0, 0.54, 0.36, C.white);

    // ふわふわ浮かぶ手紙
    const letter = dynamic(group(g, 0, 2.4, 0));
    box(letter, 1.3, 0.85, 0.12, 0, 0, 0, C.white);
    box(letter, 1.3, 0.12, 0.14, 0, 0.73, 0, C.coral);
    box(letter, 0.9, 0.12, 0.14, 0, 0.61, 0, C.coral);
    box(letter, 0.5, 0.12, 0.14, 0, 0.49, 0, C.coral);
    box(letter, 0.22, 0.22, 0.16, 0, 0.2, 0, C.red);
    animated.push((t) => {
      letter.position.y = 2.35 + Math.sin(t * 1.8) * 0.18;
      letter.rotation.y = Math.sin(t * 0.9) * 0.5;
    });

    // 手紙を出しにきた人
    person(g, -0.9, 0.5, 1.2, { shirt: C.teal });
    person(g, -1.5, 0.3, 1.0, { s: 0.75 });

    // 行き先の矢印
    const post = group(world, -1.6, 0, 5.2, 8 * DEG);
    box(post, 0.14, 2.6, 0.14, 0, 0, 0, C.brown);
    [['能登', '#f2705b', 2.1, 0.25], ['東北', '#2bb3a8', 1.6, -0.2], ['関東', '#f28c28', 1.1, 0.15]].forEach(([txt, bg, y, r]) => {
      const b = group(post, 0, y, 0, r);
      box(b, 1.2, 0.4, 0.08, 0.45, 0, 0, C.white);
      sign(b, txt, 1.1, 0.34, 0.45, 0.2, 0.05, { bg, fg: '#ffffff' });
    });
    // ベンチ
    box(world, 1.4, 0.12, 0.45, 4.0, 0.32, 5.2, C.wood);
    box(world, 0.12, 0.32, 0.4, 3.45, 0, 5.2, C.brown);
    box(world, 0.12, 0.32, 0.4, 4.55, 0, 5.2, C.brown);
    box(world, 1.4, 0.5, 0.1, 4.0, 0.44, 4.98, C.wood);

    // 海の鳥居
    const torii = group(world, -5.5, -0.5, 9.0);
    box(torii, 0.26, 2.6, 0.26, -0.9, 0, 0, C.red);
    box(torii, 0.26, 2.6, 0.26, 0.9, 0, 0, C.red);
    box(torii, 2.5, 0.2, 0.26, 0, 2.0, 0, C.red);
    box(torii, 3.0, 0.24, 0.34, 0, 2.6, 0, C.red);
    box(torii, 3.2, 0.12, 0.4, 0, 2.84, 0, C.black);

    // 灯台
    const light = group(world, 10.2, -0.1, 7.0);
    box(light, 1.8, 0.5, 1.8, 0, 0, 0, C.stone);
    [C.white, C.red, C.white, C.red, C.white].forEach((c, i) => box(light, 1.3 - i * 0.1, 0.8, 1.3 - i * 0.1, 0, 0.5 + i * 0.8, 0, c));
    box(light, 1.2, 0.12, 1.2, 0, 4.5, 0, C.navy);
    const lamp = box(light, 0.6, 0.6, 0.6, 0, 4.62, 0, C.yellow, { glow: 0.9 });
    lamp.userData.dynamic = true;
    box(light, 0.9, 0.3, 0.9, 0, 5.22, 0, C.red);
    animated.push((t) => {
      lamp.rotation.y = t * 1.2;
    });

    // 漁船
    const boat = dynamic(group(world, 5.2, -0.42, 10.0, -0.4));
    box(boat, 2.6, 0.5, 1.1, 0, 0, 0, C.white);
    box(boat, 2.2, 0.2, 0.9, 0, -0.15, 0, C.blue);
    box(boat, 0.6, 0.35, 0.8, 1.5, 0.1, 0, C.white);
    box(boat, 0.9, 0.7, 0.8, -0.5, 0.5, 0, C.cream);
    box(boat, 1.1, 0.12, 1.0, -0.5, 1.2, 0, C.blue);
    box(boat, 0.08, 1.2, 0.08, 0.5, 0.5, 0, C.brown);
    box(boat, 0.5, 0.32, 0.05, 0.78, 1.36, 0, C.coral);
    animated.push((t) => {
      boat.position.y = -0.42 + Math.sin(t * 1.5) * 0.07;
      boat.rotation.z = Math.sin(t * 1.1) * 0.05;
      boat.position.x = 5.2 + Math.sin(t * 0.25) * 1.6;
    });

    // 波
    for (let i = 0; i < 9; i++) {
      const w = box(world, 0.9 + rand() * 0.9, 0.05, 0.14, -11 + rand() * 22, -0.33, 8.2 + rand() * 3.4, C.white, { cast: false });
      w.userData.dynamic = true;
      const base = w.position.x;
      const off = rand() * 6;
      animated.push((t) => {
        w.position.x = base + Math.sin(t * 0.6 + off) * 0.5;
        w.scale.x = 1.1 + Math.sin(t * 0.9 + off) * 0.5;
      });
    }
    // 岩
    box(world, 0.9, 0.5, 0.8, -9.6, -0.5, 8.3, C.grey);
    box(world, 0.5, 0.35, 0.5, -8.9, -0.5, 8.6, C.stone);
  }

  // ---------- 道を走るバス・雲・風に舞う葉っぱ ----------
  function buildMoving() {
    const X = 9.8, Z0 = -9.8, Z1 = 3.5;
    const corners = [[-X, Z1], [X, Z1], [X, Z0], [-X, Z0]];
    const lens = corners.map((c, i) => {
      const n = corners[(i + 1) % 4];
      return Math.hypot(n[0] - c[0], n[1] - c[1]);
    });
    const total = lens.reduce((a, b) => a + b, 0);

    const bus = dynamic(group(world));
    box(bus, 1.9, 0.75, 0.9, 0, 0.18, 0, C.orange);
    box(bus, 1.9, 0.12, 0.9, 0, 0.93, 0, C.white);
    box(bus, 1.5, 0.3, 0.94, -0.05, 0.52, 0, C.navy);
    box(bus, 0.1, 0.3, 0.7, 0.92, 0.52, 0, C.navy);
    for (const [wx, wz] of [[-0.6, 0.42], [0.6, 0.42], [-0.6, -0.42], [0.6, -0.42]]) {
      box(bus, 0.34, 0.34, 0.14, wx, 0, wz, C.black);
    }
    animated.push((t) => {
      let d = (t * 1.5) % total;
      let i = 0;
      while (d > lens[i]) {
        d -= lens[i];
        i++;
      }
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      const k = d / lens[i];
      bus.position.set(a[0] + (b[0] - a[0]) * k, 0.06, a[1] + (b[1] - a[1]) * k);
      bus.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    });

    // 雲
    [[-7, 12.5, -6], [6, 13.5, -9], [1, 12, 6], [-11, 13, 3], [11, 12.4, 1]].forEach(([x, y, z], i) => {
      const c = dynamic(group(world, x, y, z));
      box(c, 2.6, 0.6, 1.4, 0, 0, 0, C.white, { cast: false });
      box(c, 1.5, 0.6, 1.1, 0.3, 0.5, 0, C.white, { cast: false });
      box(c, 1.1, 0.5, 0.9, -1.2, 0.1, 0.2, C.white, { cast: false });
      animated.push((t) => {
        c.position.x = ((x + t * (0.25 + i * 0.04) + 16) % 32) - 16;
      });
    });

    // そよかぜに舞う葉っぱ・花びら
    const COUNT = isSmall() ? 36 : 64;
    const leafGeo = new THREE.BoxGeometry(0.2, 0.03, 0.13);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), COUNT);
    leaves.userData.dynamic = true;
    const colors = [C.pink, 0xf6c4cd, C.leaf, C.white, C.yellow];
    const col = new THREE.Color();
    const data = [];
    for (let i = 0; i < COUNT; i++) {
      leaves.setColorAt(i, col.set(colors[i % colors.length]));
      data.push({ x: rand() * 34, y: 1.5 + rand() * 9, z: -13 + rand() * 26, sp: 1.2 + rand() * 1.6, ph: rand() * 10 });
    }
    world.add(leaves);
    const dummy = new THREE.Object3D();
    animated.push((t) => {
      for (let i = 0; i < COUNT; i++) {
        const p = data[i];
        const x = ((p.x + t * p.sp) % 34) - 17;
        dummy.position.set(x, p.y + Math.sin(t * 1.3 + p.ph) * 0.6, p.z + Math.sin(t * 0.7 + p.ph) * 0.8);
        dummy.rotation.set(t * 1.7 + p.ph, t * 1.1 + p.ph, t * 0.6);
        dummy.updateMatrix();
        leaves.setMatrixAt(i, dummy.matrix);
      }
      leaves.instanceMatrix.needsUpdate = true;
    });
  }

  // 動かないブロックは色ごとに1つにまとめて、描く回数を減らす
  function bakeStatic() {
    world.updateMatrixWorld(true);
    const buckets = new Map();
    const done = [];
    world.traverse((o) => {
      if (!o.isMesh || o.geometry !== unit) return;
      for (let p = o; p; p = p.parent) if (p.userData.dynamic) return;
      const key = o.material.uuid + '|' + o.castShadow;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(o);
      done.push(o);
    });
    const bp = unit.attributes.position.array;
    const bn = unit.attributes.normal.array;
    const bi = unit.index.array;
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3();
    buckets.forEach((list) => {
      const pos = new Float32Array(list.length * 72);
      const nor = new Float32Array(list.length * 72);
      const idx = new Uint32Array(list.length * 36);
      list.forEach((o, i) => {
        nm.getNormalMatrix(o.matrixWorld);
        for (let k = 0; k < 24; k++) {
          v.fromArray(bp, k * 3).applyMatrix4(o.matrixWorld).toArray(pos, i * 72 + k * 3);
          v.fromArray(bn, k * 3).applyMatrix3(nm).normalize().toArray(nor, i * 72 + k * 3);
        }
        for (let k = 0; k < 36; k++) idx[i * 36 + k] = bi[k] + i * 24;
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      const mesh = new THREE.Mesh(geo, list[0].material);
      mesh.castShadow = list[0].castShadow;
      mesh.receiveShadow = true;
      world.add(mesh);
    });
    done.forEach((o) => o.parent.remove(o));
  }

  buildIsland();
  buildWindmill();
  buildBase();
  buildHome();
  buildFestival();
  buildMarket();
  buildContact();
  buildMoving();
  bakeStatic();

  // 島の下の影
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.ShadowMaterial({ opacity: 0.16, color: 0x17414a }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2.2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ===================================================
  // スクロールとカメラ
  // ===================================================
  const N = STOPS.length;
  let stepPx = 1;      // 1場面ぶんのスクロール量
  let width = 1;
  let height = 1;
  let targetP = 0;     // スクロール位置から決まる場面（小数）
  let p = 0;           // なめらかに追いかける値
  let active = -1;
  let pointerX = 0;
  let pointerY = 0;
  let sway = 0;
  let tilt = 0;
  let cardRect = null;
  let visible = true;
  let intro = reduceMotion ? 1 : 0;

  // 進み具合のボタン
  panels.forEach((panel, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', panel.dataset.label);
    b.innerHTML = `<span>${panel.dataset.label}</span>`;
    b.addEventListener('click', () => goTo(i));
    progressEl.appendChild(b);
  });
  const dots = [...progressEl.children];

  function goTo(i, smooth = true) {
    const top = journey.offsetTop + i * stepPx;
    window.scrollTo({ top, behavior: smooth && !reduceMotion ? 'smooth' : 'auto' });
  }

  function setActive(i) {
    if (i === active) return;
    active = i;
    panels.forEach((el, k) => {
      const on = k === i;
      el.classList.toggle('is-active', on);
      el.toggleAttribute('inert', !on);
    });
    dots.forEach((el, k) => {
      el.classList.toggle('is-active', k === i);
      if (k === i) el.setAttribute('aria-current', 'step');
      else el.removeAttribute('aria-current');
    });
    hintEl.classList.toggle('is-hidden', i !== 0);
    cardRect = null;
  }

  function layout() {
    width = stage.clientWidth;
    height = stage.clientHeight;
    stepPx = Math.round(window.innerHeight * 0.9);
    journey.style.height = `${stepPx * (N - 1) + height}px`;
    renderer.setSize(width, height, false);

    // 3D の中心をカードのない側へずらす
    camera.aspect = width / height;
    if (isSmall()) {
      camera.fov = 34;
      const cardH = cardsEl.offsetHeight + 26;
      camera.setViewOffset(width, height, 0, Math.round(cardH * 0.5), width, height);
    } else {
      camera.fov = 26;
      const used = cardsEl.offsetLeft + cardsEl.offsetWidth;
      camera.setViewOffset(width, height, -Math.round(used * 0.5), -Math.round(height * 0.02), width, height);
    }
    camera.updateProjectionMatrix();
    cardRect = null;
    onScroll();
  }

  function onScroll() {
    const y = window.scrollY - journey.offsetTop;
    targetP = Math.min(N - 1, Math.max(0, y / stepPx));
    setActive(Math.round(targetP));
  }

  // 同じページ内リンク（#about など）で場面へ移動する
  function panelIndexFromHash(hash) {
    if (!hash || hash.length < 2) return -1;
    return panels.findIndex((el) => '#' + el.id === hash);
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const url = new URL(a.href, location.href);
    if (url.pathname !== location.pathname || a.target === '_blank') return;
    const i = panelIndexFromHash(url.hash);
    if (i < 0) return;
    e.preventDefault();
    history.replaceState(null, '', url.hash);
    goTo(i);
  });

  window.addEventListener('hashchange', () => {
    const i = panelIndexFromHash(location.hash);
    if (i >= 0) goTo(i);
  });

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', layout);
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    pointerX = (e.clientX / window.innerWidth) * 2 - 1;
    pointerY = (e.clientY / window.innerHeight) * 2 - 1;
  });

  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
  }).observe(stage);

  // ---------- 毎フレーム ----------
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = (k) => k * k * (3 - 2 * k);
  const tgt = new THREE.Vector3();
  const spotV = new THREE.Vector3();
  const clock = new THREE.Clock();
  let time = 0;

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!visible || document.hidden) return;

    if (!reduceMotion) time += dt;
    intro = Math.min(1, intro + dt / 1.8);
    const introK = 1 - Math.pow(1 - intro, 3);

    p = reduceMotion ? targetP : p + (targetP - p) * (1 - Math.exp(-dt * 4.5));
    sway += (pointerX - sway) * (1 - Math.exp(-dt * 3));
    tilt += (pointerY - tilt) * (1 - Math.exp(-dt * 3));

    const i = Math.min(N - 2, Math.floor(p));
    const f = p - i;
    const k = ease(f);
    const a = STOPS[i];
    const b = STOPS[i + 1];

    const az = (lerp(a.az, b.az, k) - sway * 5 - (1 - introK) * 70) * DEG;
    const el = (lerp(a.el, b.el, k) + tilt * 2.5 + (1 - introK) * 14) * DEG;
    // 移動の途中は少し引いて、島全体が見えるようにする
    let dist = lerp(a.dist, b.dist, k) + Math.sin(Math.PI * f) * 9 + (1 - introK) * 26;
    if (isSmall()) dist *= width / height < 0.62 ? 1.55 : 1.35;
    tgt.set(lerp(a.target[0], b.target[0], k), lerp(a.target[1], b.target[1], k), lerp(a.target[2], b.target[2], k));

    camera.position.set(
      tgt.x + dist * Math.cos(el) * Math.sin(az),
      tgt.y + dist * Math.sin(el),
      tgt.z + dist * Math.cos(el) * Math.cos(az)
    );
    camera.lookAt(tgt);

    for (const fn of animated) fn(time);
    renderer.render(scene, camera);

    // 点線：カードの角 → 街の中の点
    spotV.set(lerp(a.spot[0], b.spot[0], k), lerp(a.spot[1], b.spot[1], k), lerp(a.spot[2], b.spot[2], k)).project(camera);
    const sx = (spotV.x * 0.5 + 0.5) * width;
    const sy = (-spotV.y * 0.5 + 0.5) * height;
    spotEl.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;

    if (!cardRect) {
      // 今のカードの右上の丸の位置（カードの切り替えアニメーションに左右されない測り方）
      const s = stage.getBoundingClientRect();
      const c = cardsEl.getBoundingClientRect();
      const el = panels[Math.max(0, active)];
      cardRect = { x: c.left - s.left + el.offsetLeft + el.offsetWidth - 23.5, y: c.top - s.top + el.offsetTop + 23.5 };
    }
    const x0 = cardRect.x;
    const y0 = cardRect.y;
    const cx = isSmall() ? x0 - 30 : (x0 + sx) / 2;
    const cy = isSmall() ? (y0 + sy) / 2 : Math.min(y0, sy) - 60;
    lineEl.setAttribute('d', `M${x0.toFixed(1)} ${y0.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${sx.toFixed(1)} ${sy.toFixed(1)}`);
  }

  layout();
  // 開いたときに #contact などが付いていたら、その場面から始める
  const first = panelIndexFromHash(location.hash);
  if (first > 0) {
    goTo(first, false);
    onScroll();
    p = targetP;
  }
  // フォントやナビが読み込まれるとカードの大きさが変わるので測り直す
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  window.addEventListener('load', layout);

  requestAnimationFrame(() => {
    root.classList.add('is-ready');
    frame();
  });

  // 動作確認用
  window.__soyokaze = { goTo, stops: STOPS, renderer };
}
