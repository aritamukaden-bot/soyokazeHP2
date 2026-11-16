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
import { NOTO } from './noto-data.js';

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
// key: 見つめる場所（noto-data.js の places） / t: そこからのずらし / spotKey・s: 点線の先
// az: 町を回る角度（0 で北が上） / el: 見下ろす角度 / dist: 距離
const STOPS = [
  { key: null, t: [-1.2, 0, 0.4], spotKey: 'yakuba', s: [0, 1.2, 0], az: 6, el: 44, dist: 80 },            // ホーム：能登町の全体
  { key: 'sakura', t: [0.6, 0.5, 0.2], s: [0, 1.1, 0], az: -52, el: 33, dist: 20 },                        // 団体概要：町の入口・桜峠
  { key: 'port', t: [-0.3, 0.4, -0.2], s: [0, 0.85, 0], az: -6, el: 34, dist: 17 },                        // 代表挨拶：宇出津港
  { key: 'yakuba', t: [0.1, 0.5, -0.5], spotKey: 'abare', s: [-1.35, 1.75, -0.4], az: 34, el: 33, dist: 18 }, // 活動紹介：あばれ祭り・つなぐマーケット
  { key: 'tsukumo', t: [-1.5, 0.4, 0.3], s: [0, 0.9, 0], az: 96, el: 33, dist: 20 },                       // 魅力発信：九十九湾・小木・真脇
  { key: 'matsupost', t: [-0.3, 0.4, -0.5], s: [0.1, 1.0, -0.1], az: 150, el: 33, dist: 17 },              // お問い合わせ：松波の郵便局
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
  // 能登町の地形
  // 町の輪郭・標高・森や田んぼ・集落・道路・川は、noto-data.js の実データから作る
  // ===================================================
  const G = NOTO;
  const COLS = G.cols;
  const ROWS = G.rows;
  const CELL = G.cell;
  const SEA_Y = -0.14;   // 海面の高さ
  const BASE_Y = -1.5;   // 土台の底
  const STEP = 0.13;     // 標高1段ぶんの高さ（約42m）
  const T = { grass: 0, broad: 1, conifer: 2, paddy: 3, field: 4, town: 5, lake: 6, plaza: 7 };
  const TYPE_COLOR = [0x9fd16c, 0x86c765, 0x6db565, 0xd3df7c, 0xe3cf95, 0xf1e7cf, 0x5bb8e0, 0xf6e8c6];

  const kind = new Uint8Array(COLS * ROWS);   // 0:なし 1:海 2:陸
  const topY = new Float32Array(COLS * ROWS);
  const type = new Uint8Array(COLS * ROWS);
  const used = new Uint8Array(COLS * ROWS);   // 名所を置いたマス（木や家を置かない）
  for (let i = 0; i < COLS * ROWS; i++) {
    const ch = G.height[i];
    if (ch === '.') continue;
    if (ch === '~') {
      kind[i] = 1;
      topY[i] = SEA_Y;
    } else {
      kind[i] = 2;
      topY[i] = 0.1 + (ch.charCodeAt(0) - 97) * STEP;
      type[i] = +G.type[i];
    }
  }

  function cellAt(x, z) {
    const c = Math.floor((x - G.x0) / CELL);
    const r = Math.floor((z - G.z0) / CELL);
    return c < 0 || r < 0 || c >= COLS || r >= ROWS ? -1 : c + r * COLS;
  }
  function groundY(x, z) {
    const i = cellAt(x, z);
    return i >= 0 && kind[i] === 2 ? topY[i] : 0.1;
  }

  // 名所を置く場所：まわりを平らにならして、そこにグループを作る
  // key は noto-data.js の places の名前。dx,dz は見やすくするための少しのずらし
  function site(key, dx, dz, rad, rotDeg, scale) {
    const x = G.places[key][0] + dx;
    const z = G.places[key][1] + dz;
    const y = groundY(x, z);
    if (cellAt(x, z) < 0 || kind[cellAt(x, z)] !== 2) console.warn('陸の上にありません:', key);
    const n = Math.ceil(rad / CELL);
    const c0 = Math.floor((x - G.x0) / CELL);
    const r0 = Math.floor((z - G.z0) / CELL);
    for (let r = r0 - n; r <= r0 + n; r++) {
      for (let c = c0 - n; c <= c0 + n; c++) {
        if (c < 0 || r < 0 || c >= COLS || r >= ROWS) continue;
        const i = c + r * COLS;
        const cx = G.x0 + (c + 0.5) * CELL;
        const cz = G.z0 + (r + 0.5) * CELL;
        if (kind[i] !== 2 || Math.hypot(cx - x, cz - z) > rad) continue;
        topY[i] = y;
        type[i] = T.plaza;
        used[i] = 1;
      }
    }
    const g = group(world, x, y, z, rotDeg * DEG);
    g.scale.setScalar(scale);
    return g;
  }
  const placePos = (key, dx = 0, dy = 0, dz = 0) => {
    const x = G.places[key][0] + dx;
    const z = G.places[key][1] + dz;
    return [x, groundY(x, z) + dy, z];
  };

  // 地形を1つの立体にまとめる（マスごとに上の面と、段差・がけの面を張る）
  function buildTerrain() {
    const make = () => ({ pos: [], nor: [], col: [], idx: [] });
    const land = make();
    const sea = make();
    const color = new THREE.Color();
    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    const vn = new THREE.Vector3();
    function quad(buf, p, n, hex, shade = 1) {
      // 面の向きが n と合うように並べ直す
      va.set(p[3] - p[0], p[4] - p[1], p[5] - p[2]);
      vb.set(p[6] - p[0], p[7] - p[1], p[8] - p[2]);
      const flip = vn.crossVectors(va, vb).dot(va.set(n[0], n[1], n[2])) < 0;
      const base = buf.pos.length / 3;
      buf.pos.push(...p);
      color.setHex(hex).multiplyScalar(shade);
      for (let k = 0; k < 4; k++) {
        buf.nor.push(n[0], n[1], n[2]);
        buf.col.push(color.r, color.g, color.b);
      }
      if (flip) buf.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      else buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = c + r * COLS;
        if (!kind[i]) continue;
        const isLand = kind[i] === 2;
        const buf = isLand ? land : sea;
        const x0 = G.x0 + c * CELL, x1 = x0 + CELL;
        const z0 = G.z0 + r * CELL, z1 = z0 + CELL;
        const h = topY[i];
        const hex = isLand ? TYPE_COLOR[type[i]] : C.water;
        const shade = isLand ? 0.95 + ((c + r) % 2) * 0.035 + Math.min(0.06, (h - 0.1) * 0.05) : 1 - ((c * 7 + r * 3) % 5) * 0.012;
        quad(buf, [x0, h, z0, x0, h, z1, x1, h, z1, x1, h, z0], [0, 1, 0], hex, shade);
        for (const [dc, dr] of SIDES) {
          const cc = c + dc, rr = r + dr;
          const j = cc < 0 || rr < 0 || cc >= COLS || rr >= ROWS ? -1 : cc + rr * COLS;
          const nk = j < 0 ? 0 : kind[j];
          const nh = nk ? topY[j] : BASE_Y;
          if (nh >= h) continue;
          let sideHex;
          if (!isLand) sideHex = C.waterDeep;
          else if (nk === 0) sideHex = C.soil;        // 隣の市町との境（切り口）
          else if (nk === 1) sideHex = 0xe6d5a4;      // 海岸
          else sideHex = hex;                          // 段差
          const k = isLand && nk === 2 ? 0.8 : 1;
          const p = dc
            ? [dc > 0 ? x1 : x0, h, z0, dc > 0 ? x1 : x0, h, z1, dc > 0 ? x1 : x0, nh, z1, dc > 0 ? x1 : x0, nh, z0]
            : [x0, h, dr > 0 ? z1 : z0, x1, h, dr > 0 ? z1 : z0, x1, nh, dr > 0 ? z1 : z0, x0, nh, dr > 0 ? z1 : z0];
          quad(buf, p, [dc, 0, dr], sideHex, k);
        }
      }
    }
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    [[land, true], [sea, false]].forEach(([buf, cast]) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
      geo.setIndex(buf.idx);
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      world.add(mesh);
    });
  }

  // 森の木・集落の家・道路・川（数が多いので1つにまとめて描く）
  function buildCover() {
    const items = [];
    const put = (x, y, z, sx, sy, sz, rot, hex) => items.push([x, y + sy / 2, z, sx, sy, sz, rot, hex]);
    const BROAD = [0x62b85c, 0x55ab58, 0x74c468];
    const CONIFER = [0x3f9d55, 0x358a4d];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = c + r * COLS;
        if (kind[i] !== 2 || used[i]) continue;
        const x = G.x0 + (c + 0.2 + rand() * 0.6) * CELL;
        const z = G.z0 + (r + 0.2 + rand() * 0.6) * CELL;
        const y = topY[i];
        const t = type[i];
        if (t === T.broad && rand() < 0.5) {
          const hex = rand() < 0.04 ? C.pink : pick(BROAD);
          const s = 0.8 + rand() * 0.5;
          put(x, y + 0.03, z, 0.2 * s, 0.13 * s, 0.2 * s, rand() * 3, hex);
          put(x, y + 0.03 + 0.13 * s, z, 0.13 * s, 0.11 * s, 0.13 * s, rand() * 3, hex);
        } else if (t === T.conifer && rand() < 0.6) {
          const hex = pick(CONIFER);
          const s = 0.8 + rand() * 0.5;
          put(x, y + 0.02, z, 0.17 * s, 0.14 * s, 0.17 * s, 0, hex);
          put(x, y + 0.02 + 0.14 * s, z, 0.1 * s, 0.17 * s, 0.1 * s, 0, hex);
        } else if (t === T.town) {
          // 能登の家は黒い瓦屋根
          const n = rand() < 0.6 ? 2 : 1;
          for (let k = 0; k < n; k++) {
            const hx = G.x0 + (c + 0.25 + k * 0.5) * CELL + (rand() - 0.5) * 0.05;
            const hz = G.z0 + (r + 0.3 + rand() * 0.4) * CELL;
            const rot = rand() < 0.5 ? 0 : Math.PI / 2;
            put(hx, y, hz, 0.11, 0.07, 0.085, rot, rand() < 0.5 ? C.white : C.cream);
            put(hx, y + 0.07, hz, 0.13, 0.035, 0.1, rot, 0x3d4148);
          }
        }
      }
    }
    // 線（道路・川）を地面に沿って小さな板でつなぐ
    function strip(line, w, hex, lift) {
      for (let i = 0; i + 3 < line.length; i += 2) {
        const ax = line[i], az = line[i + 1], bx = line[i + 2], bz = line[i + 3];
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.ceil(len / 0.16));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
          put(x, groundY(x, z) + lift, z, len / n + 0.03, 0.02, w, -Math.atan2(bz - az, bx - ax), hex);
        }
      }
    }
    G.rivers.forEach((l) => strip(l, 0.07, 0x4fa9e0, 0.004));
    G.prefectural.forEach((l) => strip(l, 0.05, 0xfffaf0, 0.01));
    G.national.forEach((l) => strip(l, 0.085, 0xf7b24a, 0.016));

    const mesh = new THREE.InstancedMesh(unit, new THREE.MeshLambertMaterial({ color: 0xffffff }), items.length);
    mesh.userData.dynamic = true;
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    items.forEach((it, i) => {
      dummy.position.set(it[0], it[1], it[2]);
      dummy.scale.set(it[3], it[4], it[5]);
      dummy.rotation.set(0, it[6], 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, col.setHex(it[7]));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    world.add(mesh);
  }

  // 地名・名所の札（いつもカメラのほうを向く）
  const labels = [];
  function label(text, pos, { soyokaze = false, major = false, lift = 0 } = {}) {
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    const font = '900 44px "Zen Maru Gothic", "Hiragino Maru Gothic ProN", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif';
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 56;
    const h = 76;
    cv.width = w;
    cv.height = h + 14;
    ctx.font = font;
    ctx.fillStyle = 'rgba(23,65,74,0.22)';
    ctx.beginPath();
    ctx.roundRect(2, 8, w - 4, h - 4, 36);
    ctx.fill();
    ctx.fillStyle = soyokaze ? '#f28c28' : '#ffffff';
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, h - 4, 36);
    ctx.fill();
    ctx.fillStyle = soyokaze ? '#ffffff' : '#17414a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, transparent: true }));
    sp.center.set(0.5, 0);
    sp.position.set(pos[0], pos[1] + lift, pos[2]);
    sp.renderOrder = 10;
    sp.userData = { aspect: cv.width / cv.height, major };
    scene.add(sp);
    labels.push(sp);
    return sp;
  }

  // ===================================================
  // 名所（位置は国土地理院の地図と、そよかぜのマップのピンから）
  // ===================================================

  // 黒い瓦の屋根（段々に重ねる）
  function tileRoof(g, w, d, y, hex = 0x3d4148) {
    box(g, w + 0.5, 0.28, d + 0.6, 0, y, 0, hex);
    box(g, w + 0.5, 0.28, d * 0.62, 0, y + 0.28, 0, hex);
    box(g, w + 0.5, 0.26, d * 0.26, 0, y + 0.56, 0, hex);
  }

  // ---------- 宇出津：能登町役場 ----------
  function buildTownHall() {
    const g = site('yakuba', 0, 0, 0.45, 0, 0.36);
    box(g, 3.6, 2.2, 1.8, 0, 0, 0, C.cream);
    box(g, 3.8, 0.2, 2.0, 0, 2.2, 0, C.grey);
    box(g, 1.2, 0.8, 1.2, -0.8, 2.4, 0, C.cream);
    for (const x of [-1.3, -0.65, 0.65, 1.3]) {
      box(g, 0.4, 0.45, 0.1, x, 1.4, 0.92, C.teal);
      box(g, 0.4, 0.45, 0.1, x, 0.6, 0.92, C.teal);
    }
    box(g, 0.7, 1.1, 0.1, 0, 0, 0.92, C.navy);
    box(g, 0.1, 3.2, 0.1, 2.3, 0, 0.9, C.grey);
    box(g, 0.8, 0.5, 0.05, 2.75, 2.7, 0.9, C.white);
    label('能登町役場', placePos('yakuba', 0, 1.0, 0));
  }

  // ---------- 宇出津：大乗寺とつなぐマーケット（団体の活動の場） ----------
  function buildTemple() {
    const g = site('tsunagu', 1.25, -0.55, 0.62, 30, 0.36);
    // 本堂
    box(g, 3.6, 0.3, 2.8, 0, 0, -1.2, C.stone);
    box(g, 3.0, 1.5, 2.2, 0, 0.3, -1.2, C.cream);
    for (const x of [-1.4, -0.7, 0, 0.7, 1.4]) box(g, 0.14, 1.5, 0.14, x, 0.3, -0.05, C.darkBrown);
    box(g, 1.0, 1.1, 0.1, 0, 0.3, -0.08, C.brown);
    const roof = group(g, 0, 0, -1.2);
    tileRoof(roof, 3.4, 2.6, 1.8);
    box(g, 1.4, 0.15, 0.6, 0, 0, 0.35, C.stone);
    // つなぐマーケットのテント
    const tents = [[-2.2, 1.6, C.white], [-0.4, 2.2, C.yellow], [1.5, 1.7, C.white]];
    tents.forEach(([x, z, c]) => {
      for (const [px, pz] of [[-0.55, -0.45], [0.55, -0.45], [-0.55, 0.45], [0.55, 0.45]]) box(g, 0.07, 1.0, 0.07, x + px, 0, z + pz, C.grey);
      box(g, 1.4, 0.14, 1.2, x, 1.0, z, c);
      box(g, 0.9, 0.14, 0.75, x, 1.14, z, c);
      box(g, 1.0, 0.45, 0.5, x, 0, z, C.wood);
      box(g, 0.2, 0.2, 0.2, x - 0.25, 0.45, z, C.coral);
      box(g, 0.2, 0.2, 0.2, x + 0.2, 0.45, z, C.teal);
      person(g, x, z - 0.5, 0, { s: 0.8 });
    });
    // 子どもの遊び場（射的・なげなわ）
    box(g, 0.9, 0.7, 0.2, 2.9, 0, 0.4, C.wood);
    box(g, 0.2, 0.2, 0.2, 2.65, 0.7, 0.4, C.red);
    box(g, 0.2, 0.2, 0.2, 3.1, 0.7, 0.4, C.yellow);
    person(g, 2.6, 1.3, Math.PI, { s: 0.6 });
    person(g, 3.2, 1.4, Math.PI, { s: 0.6 });
    person(g, 0.6, 3.0, Math.PI, { shirt: C.coral, s: 0.8 });
    person(g, -1.2, 3.1, Math.PI + 0.3, { s: 0.6 });
    photoBoard(g, 'assets/image/thumb/board-market.jpg', 1.9, 1.42, -3.3, 0.2, 0.5);
    label('大乗寺・つなぐマーケット', placePos('tsunagu', 1.25, 1.15, -0.55), { soyokaze: true });
  }

  // ---------- 宇出津：あばれ祭り ----------
  function buildFestival() {
    const g = site('abare', -1.35, -0.4, 0.62, -20, 0.36);
    function kiriko(x, z, h, phase) {
      const k = dynamic(group(g, x, 0, z));
      box(k, 3.0, 0.12, 0.12, 0, 0.78, -0.38, C.brown);
      box(k, 3.0, 0.12, 0.12, 0, 0.78, 0.38, C.brown);
      box(k, 1.1, 0.25, 1.1, 0, 0.84, 0, C.red);
      box(k, 0.86, h, 0.86, 0, 1.09, 0, 0xfff0c2, { glow: 0.5 });
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(k, 0.1, h, 0.1, sx * 0.44, 1.09, sz * 0.44, C.black);
      box(k, 0.96, 0.1, 0.96, 0, 1.09 + h * 0.5, 0, C.red);
      box(k, 1.3, 0.22, 1.3, 0, 1.09 + h, 0, C.black);
      box(k, 0.9, 0.2, 0.9, 0, 1.31 + h, 0, C.red);
      box(k, 0.4, 0.3, 0.4, 0, 1.51 + h, 0, C.yellow);
      for (const [px, pz] of [[-1.3, -0.38], [1.3, -0.38], [-1.3, 0.38], [1.3, 0.38]]) {
        person(k, px, pz * 1.9, pz > 0 ? Math.PI : 0, { shirt: C.white, pants: C.navy, s: 0.85 });
      }
      animated.push((t) => {
        k.position.y = Math.abs(Math.sin(t * 2.6 + phase)) * 0.16;
        k.rotation.z = Math.sin(t * 1.3 + phase) * 0.045;
      });
    }
    kiriko(0, 0, 3.4, 0);
    kiriko(-2.4, 0.5, 2.8, 1.3);
    kiriko(2.3, 0.6, 2.5, 2.4);

    // 神輿（あばれるほど良い）
    const mikoshi = dynamic(group(g, 0.3, 0, 2.6));
    box(mikoshi, 2.2, 0.1, 0.1, 0, 0.75, -0.3, C.brown);
    box(mikoshi, 2.2, 0.1, 0.1, 0, 0.75, 0.3, C.brown);
    box(mikoshi, 0.9, 0.7, 0.9, 0, 0.82, 0, C.black);
    box(mikoshi, 0.95, 0.12, 0.95, 0, 1.2, 0, C.yellow);
    box(mikoshi, 1.3, 0.2, 1.3, 0, 1.52, 0, C.yellow);
    box(mikoshi, 0.8, 0.2, 0.8, 0, 1.72, 0, C.black);
    box(mikoshi, 0.25, 0.3, 0.25, 0, 1.92, 0, C.yellow);
    for (const [px, pz] of [[-0.9, -0.6], [0.9, -0.6], [-0.9, 0.6], [0.9, 0.6]]) {
      person(mikoshi, px, pz, pz > 0 ? Math.PI : 0, { shirt: C.white, pants: C.white, s: 0.85 });
    }
    animated.push((t) => {
      mikoshi.rotation.z = Math.sin(t * 5.2) * 0.14;
      mikoshi.position.y = Math.abs(Math.sin(t * 4.1)) * 0.2;
    });

    // 大松明
    const torch = group(g, 2.9, 0, 2.6);
    box(torch, 0.25, 2.6, 0.25, 0, 0, 0, C.darkBrown);
    box(torch, 0.6, 0.35, 0.6, 0, 2.6, 0, C.brown);
    const flames = [C.red, C.orange, C.yellow].map((c, i) => {
      const f = box(torch, 0.55 - i * 0.13, 0.5, 0.55 - i * 0.13, 0, 2.95 + i * 0.35, 0, c, { glow: 0.8, cast: false });
      f.userData.dynamic = true;
      return f;
    });
    animated.push((t) => {
      flames.forEach((f, i) => {
        f.scale.y = 0.5 * (1 + Math.sin(t * 9 + i * 2.1) * 0.22);
        f.position.x = Math.sin(t * 7 + i) * 0.05;
      });
    });
    photoBoard(g, 'assets/image/thumb/board-festival.jpg', 2.1, 1.4, -3.0, 2.6, 0.5);
    label('あばれ祭り', placePos('abare', -1.35, 1.75, -0.4), { soyokaze: true });
  }

  // ---------- 宇出津：酒蔵（竹葉） ----------
  function buildBrewery() {
    const g = site('port', -1.7, -0.05, 0.42, 10, 0.36);
    box(g, 3.0, 0.5, 2.0, 0, 0, 0, C.darkBrown);
    box(g, 3.0, 1.3, 2.0, 0, 0.5, 0, C.white);
    tileRoof(g, 3.0, 2.0, 1.8);
    box(g, 0.8, 1.1, 0.1, -0.6, 0, 1.02, C.brown);
    box(g, 0.34, 0.34, 0.34, -0.6, 1.3, 1.15, 0x7a8f4a);   // 杉玉
    sign(g, '竹葉', 1.1, 0.5, 0.75, 1.2, 1.02, { bg: '#4c3526', fg: '#fff1d2' });
    for (const x of [1.9, 2.5]) {
      box(g, 0.5, 0.55, 0.5, x, 0, 0.8, C.cream);
      box(g, 0.52, 0.12, 0.52, x, 0.2, 0.8, C.red);
    }
    label('宇出津の酒蔵「竹葉」', placePos('port', -1.7, 0.95, -0.05));
  }

  // ---------- 宇出津港と弁天島 ----------
  function fishingBoat(x, z, rot, lamps) {
    const boat = dynamic(group(world, x, SEA_Y, z, rot));
    boat.scale.setScalar(0.3);
    box(boat, 2.6, 0.5, 1.0, 0, 0, 0, C.white);
    box(boat, 2.2, 0.2, 0.8, 0, -0.12, 0, C.blue);
    box(boat, 0.9, 0.7, 0.75, -0.5, 0.5, 0, C.cream);
    box(boat, 1.1, 0.12, 0.95, -0.5, 1.2, 0, C.blue);
    if (lamps) {
      // イカ釣り船の集魚灯
      box(boat, 0.06, 1.3, 0.06, -1.1, 0.5, 0, C.grey);
      box(boat, 0.06, 1.3, 0.06, 1.1, 0.5, 0, C.grey);
      box(boat, 2.3, 0.05, 0.05, 0, 1.75, 0, C.grey);
      for (let i = 0; i < 5; i++) box(boat, 0.2, 0.2, 0.2, -0.9 + i * 0.45, 1.52, 0, 0xfff3a0, { glow: 0.9, cast: false });
    }
    const ph = x * 1.7;
    animated.push((t) => {
      boat.position.y = SEA_Y + Math.sin(t * 1.5 + ph) * 0.02;
      boat.rotation.z = Math.sin(t * 1.1 + ph) * 0.06;
    });
  }

  function buildPort() {
    const [px, , pz] = placePos('port');
    fishingBoat(px + 0.25, pz + 0.75, 0.3, false);
    fishingBoat(px + 0.95, pz + 1.05, -0.5, false);
    fishingBoat(px - 0.3, pz + 1.3, 1.0, false);
    // 港で手をふる代表
    const g = site('port', -0.1, -0.1, 0.3, 0, 0.36);
    box(g, 2.2, 0.12, 0.8, 0.4, 0, 0.6, C.stone);
    const rep = person(g, 0, 0.2, 0, { shirt: C.yellow, pants: C.black, s: 1.3 });
    const arm = rep.userData.armR;
    dynamic(rep, (t) => {
      arm.position.set(0.34, 0.72, 0);
      arm.rotation.z = -0.5 + Math.sin(t * 5) * 0.45;
      rep.position.y = Math.abs(Math.sin(t * 2.5)) * 0.06;
    });
    person(g, 0.8, 0.3, -0.3, { s: 1.0 });
    person(g, 1.3, 0.1, 0.2, { s: 0.8 });
    sign(g, 'ただいま', 1.6, 0.5, 0.5, 1.9, 0.2, { bg: '#fff1d2', fg: '#c84a36', both: true });
    box(g, 0.08, 1.7, 0.08, -0.25, 0, 0.2, C.brown);
    box(g, 0.08, 1.7, 0.08, 1.25, 0, 0.2, C.brown);
    label('宇出津港', placePos('port', 0.4, 0.2, 0.9));

    // 弁天島（遠島山の先の小さな島）
    const b = site('benten', 0, 0, 0.2, 0, 0.36);
    box(b, 1.0, 0.5, 0.9, 0, 0, 0, C.grey);
    box(b, 0.12, 0.9, 0.12, -0.28, 0.5, 0.2, C.red);
    box(b, 0.12, 0.9, 0.12, 0.28, 0.5, 0.2, C.red);
    box(b, 0.9, 0.12, 0.14, 0, 1.3, 0.2, C.red);
    tree(b, 0.1, -0.2, { s: 0.6 });
  }

  // ---------- 瑞穂：マルガージェラート ----------
  function cow(g, x, z, rot) {
    const c = group(g, x, 0, z, rot);
    for (const [lx, lz] of [[-0.3, -0.15], [0.3, -0.15], [-0.3, 0.15], [0.3, 0.15]]) box(c, 0.12, 0.3, 0.12, lx, 0, lz, C.white);
    box(c, 0.95, 0.45, 0.5, 0, 0.3, 0, C.white);
    box(c, 0.35, 0.3, 0.52, -0.15, 0.4, 0, C.black);
    box(c, 0.35, 0.35, 0.4, 0.6, 0.5, 0, C.white);
    box(c, 0.16, 0.14, 0.42, 0.72, 0.5, 0, C.pink);
    return c;
  }

  function buildGelato() {
    const g = site('mizuho', 0, 0, 0.5, -30, 0.36);
    box(g, 2.6, 1.4, 1.8, -0.6, 0, -0.4, C.cream);
    box(g, 3.0, 0.3, 2.2, -0.6, 1.4, -0.4, C.teal);
    box(g, 2.2, 0.3, 1.4, -0.6, 1.7, -0.4, C.teal);
    box(g, 0.7, 1.0, 0.1, -1.0, 0, 0.52, C.brown);
    box(g, 0.9, 0.6, 0.1, 0, 0.5, 0.52, C.white);
    sign(g, 'ジェラート', 2.0, 0.42, -0.6, 1.25, 0.53, { bg: '#ffffff', fg: '#2bb3a8' });
    // 大きなジェラート
    const cone = group(g, 1.9, 0, 0.6);
    box(cone, 0.25, 0.4, 0.25, 0, 0, 0, C.wood);
    box(cone, 0.4, 0.4, 0.4, 0, 0.4, 0, 0xe2b272);
    box(cone, 0.56, 0.4, 0.56, 0, 0.8, 0, 0xe2b272);
    box(cone, 0.8, 0.5, 0.8, 0, 1.2, 0, C.white);
    box(cone, 0.66, 0.45, 0.66, 0, 1.7, 0, C.pink);
    box(cone, 0.46, 0.38, 0.46, 0, 2.15, 0, 0xbfe3a0);
    cow(g, -2.4, 1.4, 0.4);
    cow(g, 0.2, 2.0, 2.6);
    person(g, 1.0, 1.4, 0.5);
    label('マルガージェラート', placePos('mizuho', 0, 1.0, 0));
  }

  // ---------- 道の駅 桜峠：関東から車で着く町の入口 ----------
  function buildSakura() {
    const g = site('sakura', 0, 0, 0.5, -55, 0.36);
    box(g, 2.6, 1.2, 1.5, 0, 0, -0.6, C.cream);
    box(g, 3.0, 0.3, 1.9, 0, 1.2, -0.6, C.red);
    box(g, 2.2, 0.28, 1.2, 0, 1.5, -0.6, C.red);
    box(g, 0.7, 0.9, 0.1, 0, 0, 0.17, C.navy);
    tree(g, -2.2, -0.4, { sakura: true });
    tree(g, 2.3, -0.6, { sakura: true, s: 1.1 });
    tree(g, 1.6, -1.7, { sakura: true, s: 0.9 });
    // そよかぜの車
    const car = group(g, -0.6, 0, 1.5, 0.2);
    box(car, 1.7, 0.6, 0.85, 0, 0.16, 0, C.orange);
    box(car, 1.1, 0.4, 0.8, -0.15, 0.76, 0, C.white);
    box(car, 0.9, 0.26, 0.84, -0.15, 0.8, 0, C.navy);
    for (const [wx, wz] of [[-0.5, 0.4], [0.5, 0.4], [-0.5, -0.4], [0.5, -0.4]]) box(car, 0.32, 0.32, 0.12, wx, 0, wz, C.black);
    person(g, 0.9, 1.5, 0.3, { shirt: C.coral });
    person(g, 1.5, 1.3, -0.2, { shirt: C.teal });
    person(g, 2.0, 1.6, 0.1, { s: 0.8 });
    // 道しるべ
    const post = group(g, -2.3, 0, 1.3);
    box(post, 0.12, 2.3, 0.12, 0, 0, 0, C.brown);
    box(post, 1.9, 0.5, 0.08, 0.2, 1.7, 0, C.white);
    sign(post, '関東から車で約7時間', 1.8, 0.4, 0.2, 1.95, 0.05, { bg: '#f28c28', fg: '#ffffff' });
    box(post, 1.3, 0.42, 0.08, 0.2, 1.15, 0, C.white);
    sign(post, '宇出津へ', 1.2, 0.34, 0.2, 1.36, 0.05, { bg: '#2bb3a8', fg: '#ffffff' });
    label('道の駅 桜峠', placePos('sakura', 0, 0.85, 0));
  }

  // ---------- 柳田植物公園（天文台 満天星） ----------
  function buildObservatory() {
    const g = site('park', 0, 0, 0.42, 20, 0.36);
    box(g, 2.0, 1.2, 1.6, 0, 0, 0, C.cream);
    box(g, 2.2, 0.15, 1.8, 0, 1.2, 0, C.grey);
    box(g, 1.3, 0.4, 1.3, 0, 1.35, 0, C.white);
    box(g, 1.05, 0.35, 1.05, 0, 1.75, 0, C.white);
    box(g, 0.65, 0.25, 0.65, 0, 2.1, 0, C.white);
    box(g, 0.2, 0.9, 0.7, 0, 1.5, 0.4, C.navy);
    [C.pink, C.yellow, C.coral, C.purple, C.white].forEach((c, i) => {
      box(g, 0.3, 0.14, 0.3, -1.6 + i * 0.45, 0, 1.4, c, { cast: false });
      box(g, 0.3, 0.14, 0.3, -1.4 + i * 0.45, 0, 1.9, c, { cast: false });
    });
    label('柳田植物公園・満天星', placePos('park', 0, 0.9, 0));
  }

  // ---------- 内浦放牧場 ----------
  function buildPasture() {
    const g = site('bokujo', 0, 0, 0.42, 0, 0.36);
    cow(g, -0.8, 0.2, 0.3);
    cow(g, 0.7, -0.5, 2.4);
    cow(g, 0.5, 0.9, -0.6);
    for (let i = 0; i < 7; i++) box(g, 0.1, 0.4, 0.1, -1.8 + i * 0.6, 0, 1.6, C.white);
    box(g, 3.7, 0.08, 0.08, 0, 0.26, 1.6, C.white);
    label('内浦放牧場', placePos('bokujo', 0, 0.45, 0));
  }

  // ---------- 真脇遺跡（縄文の環状木柱列） ----------
  function buildMawaki() {
    const g = site('mawaki', 0, -0.25, 0.45, 0, 0.36);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const p = box(g, 0.34, 1.7, 0.2, Math.cos(a) * 1.3, 0, Math.sin(a) * 1.3 + 0.4, C.brown);
      p.rotation.y = -a + Math.PI / 2;
    }
    // 竪穴住居
    const hut = group(g, -2.0, 0, -0.9);
    box(hut, 1.5, 0.3, 1.5, 0, 0, 0, 0xcfae6a);
    box(hut, 1.15, 0.3, 1.15, 0, 0.3, 0, 0xc4a25e);
    box(hut, 0.8, 0.3, 0.8, 0, 0.6, 0, 0xcfae6a);
    box(hut, 0.4, 0.25, 0.4, 0, 0.9, 0, 0xc4a25e);
    box(hut, 0.4, 0.4, 0.1, 0, 0, 0.76, C.darkBrown);
    person(g, 1.9, 1.3, -0.6);
    label('真脇遺跡', placePos('mawaki', 0, 0.75, -0.25));
  }

  // ---------- 小木港（イカ釣り船）と九十九湾のイカキング ----------
  function buildSquid() {
    const [ox, , oz] = placePos('ogi');
    fishingBoat(ox + 0.1, oz + 0.75, 0.2, true);
    fishingBoat(ox + 0.9, oz + 0.95, -0.4, true);
    label('小木港', placePos('ogi', 0, 0.2, 0.2), { major: true });

    const g = site('tsukumo', 0, 0, 0.5, 100, 0.36);
    // イカの駅
    box(g, 2.4, 1.1, 1.4, -1.4, 0, -1.0, C.white);
    box(g, 2.7, 0.25, 1.7, -1.4, 1.1, -1.0, C.blue);
    box(g, 0.6, 0.8, 0.1, -1.4, 0, -0.28, C.navy);
    // イカキング（大きなスルメイカのモニュメント）
    const k = group(g, 0.9, 0, 0.6, -0.5);
    const SQ = 0xf2a9a2;
    box(k, 2.4, 1.0, 1.0, 0, 0.5, 0, SQ);
    box(k, 0.9, 0.8, 0.8, -1.6, 0.6, 0, SQ);
    box(k, 0.5, 0.5, 0.5, -2.2, 0.75, 0, SQ);
    box(k, 0.9, 0.12, 1.8, -1.6, 0.94, 0, 0xf6c0b8);   // ひれ
    box(k, 2.4, 0.3, 0.9, 0, 0.32, 0, C.white);
    box(k, 0.8, 0.8, 0.9, 1.5, 0.4, 0, 0xf6c0b8);
    box(k, 0.26, 0.26, 0.1, 1.5, 0.85, 0.46, C.white);
    box(k, 0.26, 0.26, 0.1, 1.5, 0.85, -0.46, C.white);
    box(k, 0.13, 0.13, 0.12, 1.55, 0.9, 0.48, C.black);
    box(k, 0.13, 0.13, 0.12, 1.55, 0.9, -0.48, C.black);
    // 足
    [[-0.6, 0.5], [-0.3, 1.1], [0, 1.4], [0.3, 1.1], [0.6, 0.5]].forEach(([z, up]) => {
      box(k, 1.0, 0.2, 0.18, 2.3, 0.2, z, SQ);
      box(k, 0.2, up, 0.18, 2.9, 0.2, z, SQ);
    });
    person(g, 1.6, 2.3, Math.PI, { s: 0.85 });
    person(g, 0.6, 2.4, Math.PI - 0.3, { s: 0.6 });
    label('九十九湾・イカキング', placePos('tsukumo', 0, 0.95, 0));
  }

  // ---------- 松波：城址公園と郵便局（お問い合わせ） ----------
  function buildMatsunami() {
    const c = site('matsunami', -0.75, 0.35, 0.4, 150, 0.36);
    box(c, 3.0, 0.7, 2.2, 0, 0, -0.6, C.stone);
    box(c, 2.4, 0.5, 1.7, 0, 0.7, -0.6, C.grey);
    box(c, 0.18, 1.5, 0.18, -0.7, 0, 1.0, C.darkBrown);
    box(c, 0.18, 1.5, 0.18, 0.7, 0, 1.0, C.darkBrown);
    box(c, 2.0, 0.18, 0.22, 0, 1.3, 1.0, C.darkBrown);
    tree(c, -0.6, -0.7, { s: 0.9 }).position.y = 1.2;
    tree(c, 0.7, -0.5, { s: 0.75 }).position.y = 1.2;
    label('松波城址公園', placePos('matsunami', -0.75, 0.9, 0.35));

    const g = site('matsupost', 0.1, -0.1, 0.4, 150, 0.36);
    box(g, 2.2, 1.3, 1.5, -0.3, 0, -0.9, C.cream);
    box(g, 2.5, 0.25, 1.8, -0.3, 1.3, -0.9, C.orange);
    box(g, 0.6, 0.9, 0.1, -0.3, 0, -0.13, C.navy);
    sign(g, '〒 松波郵便局', 1.9, 0.36, -0.3, 1.1, -0.12, { bg: '#ffffff', fg: '#e8533d' });
    // 赤いポスト
    const post = group(g, 1.5, 0, 0.3);
    box(post, 0.6, 0.15, 0.55, 0, 0, 0, C.stone);
    box(post, 0.55, 1.0, 0.5, 0, 0.15, 0, C.red);
    box(post, 0.62, 0.14, 0.56, 0, 1.15, 0, C.red);
    box(post, 0.34, 0.06, 0.05, 0, 0.9, 0.26, C.black);
    // ふわふわ浮かぶ手紙
    const letter = dynamic(group(g, 1.5, 2.0, 0.3));
    box(letter, 1.1, 0.72, 0.1, 0, 0, 0, C.white);
    box(letter, 1.1, 0.1, 0.12, 0, 0.62, 0, C.coral);
    box(letter, 0.7, 0.1, 0.12, 0, 0.52, 0, C.coral);
    box(letter, 0.36, 0.1, 0.12, 0, 0.42, 0, C.coral);
    box(letter, 0.2, 0.2, 0.14, 0, 0.16, 0, C.red);
    animated.push((t) => {
      letter.position.y = 2.0 + Math.sin(t * 1.8) * 0.16;
      letter.rotation.y = Math.sin(t * 0.9) * 0.5;
    });
    person(g, 0.6, 0.8, 0.9, { shirt: C.teal });
    person(g, 0.1, 1.2, 0.6, { s: 0.75 });
  }

  // ---------- 恋路海岸 ----------
  function buildKoiji() {
    const g = site('koiji', 0, 0, 0.45, 110, 0.36);
    // 恋路のカレー屋さん
    box(g, 2.0, 1.2, 1.5, -1.0, 0, -0.8, C.yellow);
    box(g, 2.3, 0.25, 1.8, -1.0, 1.2, -0.8, C.brown);
    box(g, 2.0, 0.12, 0.7, -1.0, 1.0, 0.25, C.red);
    box(g, 0.6, 0.85, 0.1, -1.4, 0, -0.03, C.darkBrown);
    sign(g, 'カレー', 1.2, 0.4, -1.0, 1.75, -0.02, { bg: '#c84a36', fg: '#fff1d2' });
    // 幸せの鐘
    const bell = group(g, 1.4, 0, 0.2);
    box(bell, 0.16, 1.7, 0.16, -0.5, 0, 0, C.white);
    box(bell, 0.16, 1.7, 0.16, 0.5, 0, 0, C.white);
    box(bell, 1.3, 0.18, 0.2, 0, 1.7, 0, C.white);
    const b = box(bell, 0.4, 0.42, 0.4, 0, 1.2, 0, C.yellow);
    b.userData.dynamic = true;
    animated.push((t) => {
      b.rotation.z = Math.sin(t * 2.2) * 0.3;
    });
    person(g, 0.9, 1.0, 0.6, { shirt: C.pink });
    person(g, 1.5, 1.1, -0.4, { shirt: C.blue });
    // 海の鳥居
    const [kx, , kz] = placePos('koiji');
    const torii = group(world, kx + 0.85, SEA_Y, kz + 0.25, Math.PI / 2);
    torii.scale.setScalar(0.3);
    box(torii, 0.22, 2.2, 0.22, -0.8, 0, 0, C.red);
    box(torii, 0.22, 2.2, 0.22, 0.8, 0, 0, C.red);
    box(torii, 2.1, 0.18, 0.22, 0, 1.6, 0, C.red);
    box(torii, 2.6, 0.22, 0.3, 0, 2.1, 0, C.red);
    label('恋路海岸', placePos('koiji', 0, 0.85, 0));
  }

  // ---------- 国道249号を走る車・雲・風に舞う葉っぱ ----------
  function buildMoving() {
    const pts = [];
    for (let i = 0; i < G.route.length; i += 2) pts.push([G.route[i], G.route[i + 1]]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1];
    const bus = dynamic(group(world));
    bus.scale.setScalar(0.24);
    box(bus, 1.9, 0.75, 0.9, 0, 0.18, 0, C.orange);
    box(bus, 1.9, 0.12, 0.9, 0, 0.93, 0, C.white);
    box(bus, 1.5, 0.3, 0.94, -0.05, 0.52, 0, C.navy);
    for (const [wx, wz] of [[-0.6, 0.42], [0.6, 0.42], [-0.6, -0.42], [0.6, -0.42]]) box(bus, 0.34, 0.34, 0.14, wx, 0, wz, C.black);
    let seg = 1;
    let busY = 0.1;
    animated.push((t) => {
      // 行って、戻る
      const u = (t * 0.55) % (total * 2);
      const back = u > total;
      const d = back ? total * 2 - u : u;
      if (cum[seg - 1] > d) seg = 1;
      while (seg < pts.length - 1 && cum[seg] < d) seg++;
      const a = pts[seg - 1], b = pts[seg];
      const k = (d - cum[seg - 1]) / Math.max(1e-6, cum[seg] - cum[seg - 1]);
      const x = a[0] + (b[0] - a[0]) * k;
      const z = a[1] + (b[1] - a[1]) * k;
      busY += (groundY(x, z) - busY) * 0.15;
      bus.position.set(x, busY + 0.04, z);
      bus.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]) + (back ? Math.PI : 0);
    });

    // 雲
    [[-15, 6.5, -9], [12, 7.5, -11], [-4, 7, 10], [17, 6.8, 6]].forEach(([x, y, z], i) => {
      const c = dynamic(group(world, x, y, z));
      c.scale.setScalar(0.55);
      box(c, 2.6, 0.6, 1.4, 0, 0, 0, C.white, { cast: false });
      box(c, 1.5, 0.6, 1.1, 0.3, 0.5, 0, C.white, { cast: false });
      box(c, 1.1, 0.5, 0.9, -1.2, 0.1, 0.2, C.white, { cast: false });
      animated.push((t) => {
        c.position.x = x + Math.sin(t * 0.08 + i * 2) * 2.5;
      });
    });

    // そよかぜに舞う葉っぱ・花びら
    const COUNT = isSmall() ? 36 : 64;
    const leafGeo = new THREE.BoxGeometry(0.12, 0.02, 0.08);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), COUNT);
    leaves.userData.dynamic = true;
    const colors = [C.pink, 0xf6c4cd, C.leaf, C.white, C.yellow];
    const col = new THREE.Color();
    const data = [];
    for (let i = 0; i < COUNT; i++) {
      leaves.setColorAt(i, col.set(colors[i % colors.length]));
      data.push({ x: rand() * 44, y: 1.5 + rand() * 7, z: -13 + rand() * 24, sp: 1.2 + rand() * 1.6, ph: rand() * 10 });
    }
    world.add(leaves);
    const dummy = new THREE.Object3D();
    animated.push((t) => {
      for (let i = 0; i < COUNT; i++) {
        const p = data[i];
        const x = ((p.x + t * p.sp) % 44) - 22;
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

  // 名所を置く（ここで地面をならす）→ 地形 → 木・家・道の順に作る
  buildTownHall();
  buildTemple();
  buildFestival();
  buildBrewery();
  buildPort();
  buildGelato();
  buildSakura();
  buildObservatory();
  buildPasture();
  buildMawaki();
  buildSquid();
  buildMatsunami();
  buildKoiji();
  label('宇出津', placePos('yakuba', 0.1, 2.3, 0.2), { major: true });
  label('柳田', placePos('yanagida', 0, 0.3, 0), { major: true });
  label('松波', placePos('matsunami', 0.3, 1.6, -0.3), { major: true });
  label('鵜川', placePos('ukawa', 0, 0.3, 0), { major: true });
  label('瑞穂', placePos('mizuho', 0.2, 1.7, 0.2), { major: true });
  buildTerrain();
  buildCover();
  buildMoving();
  bakeStatic();

  // カメラが止まる場所を、実際の位置から計算する
  STOPS.forEach((s) => {
    const base = s.key ? placePos(s.key) : [0, 0, 0];
    s.target = [base[0] + s.t[0], base[1] + s.t[1], base[2] + s.t[2]];
    const sp = s.spotKey ? placePos(s.spotKey) : base;
    s.spot = [sp[0] + s.s[0], sp[1] + s.s[1], sp[2] + s.s[2]];
  });

  // 島の下の影
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.ShadowMaterial({ opacity: 0.16, color: 0x17414a }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = BASE_Y - 0.02;
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
    let dist = lerp(a.dist, b.dist, k) + Math.sin(Math.PI * f) * 12 + (1 - introK) * 26;
    if (isSmall()) dist *= width / height < 0.62 ? 1.55 : 1.35;
    tgt.set(lerp(a.target[0], b.target[0], k), lerp(a.target[1], b.target[1], k), lerp(a.target[2], b.target[2], k));

    camera.position.set(
      tgt.x + dist * Math.cos(el) * Math.sin(az),
      tgt.y + dist * Math.sin(el),
      tgt.z + dist * Math.cos(el) * Math.cos(az)
    );
    camera.lookAt(tgt);

    for (const fn of animated) fn(time);

    // 札の大きさは画面上で一定に。細かい札は近づいたときだけ見せる
    const labelH = (isSmall() ? 17 : 22) / height * 2 * Math.tan((camera.fov * DEG) / 2);
    const near = dist / (isSmall() ? 1.45 : 1) < 48;
    for (const sp of labels) {
      sp.scale.set(labelH * sp.userData.aspect, labelH, 1);
      const want = sp.userData.major ? (near ? 0 : 1) : near ? 1 : 0;
      sp.material.opacity += (want - sp.material.opacity) * Math.min(1, dt * 6);
      sp.visible = sp.material.opacity > 0.02;
    }
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
