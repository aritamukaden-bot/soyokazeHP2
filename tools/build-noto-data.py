#!/usr/bin/env python3
"""能登町の立体マップ用データ（assets/js/noto-data.js）を作るスクリプト。

使い方: python3 tools/build-noto-data.py <データを置いたフォルダ>

フォルダに必要なもの（すべて公開データ）:
  pref.json   … 国土数値情報「行政区域」石川県（smartnews-smri/japan-topography の簡略版 GeoJSON）
  dem/        … 地理院タイル 標高タイル dem_png（ズーム12）と meta.json
  bv11.json, bv14.json … 地理院地図Vector（experimental_bvmap）を GeoJSON にしたもの
"""
import json, math, sys, os, heapq
from collections import Counter, defaultdict
from PIL import Image

src = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'js', 'noto-data.js')

LON0, LAT0 = 137.115, 37.325      # 画面の中心にする経度・緯度
KM_PER_UNIT = 0.9                 # 3D の 1 目盛り = 0.9km
CELL = 0.3                        # ブロック1個の幅（= 270m）
KX = math.cos(math.radians(LAT0)) * 111.32 / KM_PER_UNIT
KZ = 110.95 / KM_PER_UNIT

def to_xz(lon, lat):
    return (lon - LON0) * KX, -(lat - LAT0) * KZ

def to_ll(x, z):
    return x / KX + LON0, -z / KZ + LAT0

# ---------- 行政区域 ----------
pref = json.load(open(f'{src}/pref.json'))
def rings_of(code):
    out = []
    for f in pref['features']:
        if f['properties'].get('N03_007') == code:
            g = f['geometry']
            polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
            out += [p[0] for p in polys]
    return out

def inside(ring, x, y):
    c = False
    for i in range(len(ring)):
        x1, y1 = ring[i]; x2, y2 = ring[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c

town = rings_of('17463')[0]
neighbors = rings_of('17461') + rings_of('17204') + rings_of('17205')  # 穴水町・輪島市・珠洲市
in_town = lambda lon, lat: inside(town, lon, lat)
in_neighbor = lambda lon, lat: any(inside(r, lon, lat) for r in neighbors)

# ---------- 標高 ----------
meta = json.load(open(f'{src}/dem/meta.json'))
Z = meta['z']
tiles = {}
def elev(lon, lat):
    n = 2 ** Z
    fx = (lon + 180) / 360 * n
    fy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    tx, ty = int(fx), int(fy)
    key = (tx, ty)
    if key not in tiles:
        fn = f'{src}/dem/{Z}_{tx}_{ty}.png'
        tiles[key] = Image.open(fn).convert('RGB').load() if os.path.exists(fn) else None
    t = tiles[key]
    if t is None:
        return None
    r, g, b = t[min(255, int((fx - tx) * 256)), min(255, int((fy - ty) * 256))]
    v = r * 65536 + g * 256 + b
    if v == 8388608:
        return None            # データなし（海）
    if v > 8388608:
        v -= 16777216
    return v * 0.01

# ---------- マス目 ----------
lons = [p[0] for p in town]; lats = [p[1] for p in town]
x_min, z_min = to_xz(min(lons), max(lats))
x_max, z_max = to_xz(max(lons), min(lats))
PAD = 8
X0 = math.floor(x_min / CELL) * CELL - PAD * CELL
Z0 = math.floor(z_min / CELL) * CELL - PAD * CELL
COLS = int(math.ceil((x_max - X0) / CELL)) + PAD
ROWS = int(math.ceil((z_max - Z0) / CELL)) + PAD

def cell_of(lon, lat):
    x, z = to_xz(lon, lat)
    return int((x - X0) // CELL), int((z - Z0) // CELL)

LAND, SEA = {}, set()
raw = {}
for r in range(ROWS):
    for c in range(COLS):
        vals = []
        for dx in (0.25, 0.75):
            for dz in (0.25, 0.75):
                lon, lat = to_ll(X0 + (c + dx) * CELL, Z0 + (r + dz) * CELL)
                vals.append(elev(lon, lat))
        land = [v for v in vals if v is not None]
        lon, lat = to_ll(X0 + (c + 0.5) * CELL, Z0 + (r + 0.5) * CELL)
        raw[(c, r)] = (sum(land) / len(land) if len(land) >= 2 else None, in_town(lon, lat), in_neighbor(lon, lat))

# 町の中の陸地。海岸線は標高データのほうが細かいので、町の輪郭のすぐ外の陸も（隣の市町でなければ）含める
for (c, r), (e, t, nb) in raw.items():
    if e is not None and t:
        LAND[(c, r)] = e
for _ in range(3):
    add = {}
    for (c, r), (e, t, nb) in raw.items():
        if (c, r) in LAND or e is None or nb:
            continue
        if any((c + dc, r + dr) in LAND for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            add[(c, r)] = e
    LAND.update(add)

# 海：陸から数マス以内の「標高データなし」のマス
dist = {k: 0 for k in LAND}
frontier = list(LAND)
for d in range(1, 7):
    nxt = []
    for (c, r) in frontier:
        for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            k = (c + dc, r + dr)
            if k in dist or k not in raw:
                continue
            if raw[k][0] is None:
                dist[k] = d; SEA.add(k); nxt.append(k)
    frontier = nxt

# ---------- 土地の使われ方（地図記号から） ----------
bv14 = json.load(open(f'{src}/bv14.json'))
bv11 = json.load(open(f'{src}/bv11.json'))
SYM = {6311: 'paddy', 6312: 'field', 6321: 'broad', 6322: 'conifer', 6314: 'field', 6327: 'broad', 6323: 'broad'}
count = defaultdict(Counter)
for f in bv14['symbol']:
    kind = SYM.get(f['p'].get('ftCode'))
    if kind and f['g']['type'] == 'Point':
        count[cell_of(*f['g']['coordinates'])][kind] += 1
roads_in = Counter()
for f in bv14['road']:
    g = f['g']
    lines = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
    for line in lines:
        for lon, lat in line:
            roads_in[cell_of(lon, lat)] += 1
lake = set()
for f in bv14['waterarea']:
    g = f['g']
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    for poly in polys:
        ring = poly[0]
        xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
        c0, r0 = cell_of(min(xs), max(ys)); c1, r1 = cell_of(max(xs), min(ys))
        hit = []
        for r in range(r0, r1 + 1):
            for c in range(c0, c1 + 1):
                lon, lat = to_ll(X0 + (c + 0.5) * CELL, Z0 + (r + 0.5) * CELL)
                if (c, r) in LAND and inside(ring, lon, lat):
                    hit.append((c, r))
        if len(hit) >= 2:      # ある程度大きい池・ダム湖だけ
            lake.update(hit)

TYPES = ['grass', 'broad', 'conifer', 'paddy', 'field', 'town', 'lake']
grid_h, grid_t = [], []
stats = Counter()
for r in range(ROWS):
    for c in range(COLS):
        k = (c, r)
        if k in LAND:
            lvl = max(0, min(11, round(LAND[k] / 42)))
            cnt = count.get(k)
            if k in lake:
                t = 'lake'
            elif roads_in[k] >= 60 and LAND[k] < 60:
                t = 'town'
            elif cnt:
                t = cnt.most_common(1)[0][0]
            else:
                t = 'grass' if LAND[k] < 25 else 'broad'
            stats[t] += 1
            grid_h.append(chr(ord('a') + lvl)); grid_t.append(str(TYPES.index(t)))
        elif k in SEA:
            grid_h.append('~'); grid_t.append('0')
        else:
            grid_h.append('.'); grid_t.append('0')

# ---------- 道路・川（町の中だけ） ----------
def clip_lines(features, keep):
    out = []
    for f in features:
        if not keep(f['p']):
            continue
        g = f['g']
        lines = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
        for line in lines:
            cur = []
            for lon, lat in line:
                c, r = cell_of(lon, lat)
                if any((c + dc, r + dr) in LAND for dc in (-1, 0, 1) for dr in (-1, 0, 1)):
                    x, z = to_xz(lon, lat)
                    cur += [round(x, 2), round(z, 2)]
                else:
                    if len(cur) >= 4: out.append(cur)
                    cur = []
            if len(cur) >= 4: out.append(cur)
    return out

national = clip_lines(bv11['road'], lambda p: p.get('rdCtg') == 0)
prefectural = clip_lines(bv11['road'], lambda p: p.get('rdCtg') == 1)
rivers = clip_lines(bv11['river'], lambda p: True)

# 国道249号をつないで、車が走る1本の道にする
def longest_route(lines):
    key = lambda x, z: (round(x, 1), round(z, 1))
    graph = defaultdict(list)
    for line in lines:
        pts = [(line[i], line[i + 1]) for i in range(0, len(line), 2)]
        a, b = key(*pts[0]), key(*pts[-1])
        length = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
        graph[a].append((b, length, pts)); graph[b].append((a, length, pts[::-1]))
    def dijkstra(s):
        d = {s: 0}; prev = {}; pq = [(0, s)]
        while pq:
            dd, u = heapq.heappop(pq)
            if dd > d[u]: continue
            for v, w, pts in graph[u]:
                if dd + w < d.get(v, 1e9):
                    d[v] = dd + w; prev[v] = (u, pts); heapq.heappush(pq, (d[v], v))
        return d, prev
    best = None
    for s in list(graph):
        d, prev = dijkstra(s)
        e = max(d, key=d.get)
        if best is None or d[e] > best[0]:
            best = (d[e], s, e, prev)
    _, s, e, prev = best
    path = []
    while e != s:
        u, pts = prev[e]
        path = pts + path
        e = u
    out = []
    for x, z in path:
        if not out or (x, z) != (out[-2], out[-1]):
            out += [x, z]
    return out

route = longest_route(national)

# ---------- 場所（地理院地図の注記・そよかぜのマップのピン） ----------
def P(lat, lon):
    x, z = to_xz(lon, lat)
    return [round(x, 2), round(z, 2)]
places = {
    'yakuba':    P(37.3104, 137.1478),   # 能登町役場
    'port':      P(37.3055, 137.1524),   # 宇出津港
    'abare':     P(37.3128, 137.1474),   # あばれ祭り（そよかぜのマップのピン）
    'tsunagu':   P(37.3100, 137.1500),   # つなぐマーケット・大乗寺（そよかぜのマップのピン）
    'post':      P(37.3054, 137.1465),   # 能都郵便局
    'benten':    P(37.3028, 137.1678),   # 弁天島（遠島山）
    'mizuho':    P(37.2797, 137.0482),   # 瑞穂（マルガージェラート）
    'sakura':    P(37.3314, 137.0113),   # 道の駅 桜峠
    'yanagida':  P(37.3733, 137.0801),   # 柳田
    'park':      P(37.3364, 137.1392),   # 柳田植物公園（満天星）
    'bokujo':    P(37.3444, 137.1747),   # 内浦放牧場
    'mawaki':    P(37.3056, 137.2075),   # 真脇遺跡
    'ogi':       P(37.3006, 137.2233),   # 小木（小木港）
    'tsukumo':   P(37.3112, 137.2378),   # 越坂（九十九湾・イカの駅つくモール）
    'matsunami': P(37.3552, 137.2384),   # 松波城址公園
    'matsupost': P(37.3568, 137.2419),   # 松波郵便局
    'koiji':     P(37.3685, 137.2378),   # 恋路（恋路海岸）
    'ukawa':     P(37.2568, 137.0802),   # 鵜川
}

data = {
    'cell': CELL, 'x0': round(X0, 3), 'z0': round(Z0, 3), 'cols': COLS, 'rows': ROWS,
    'height': ''.join(grid_h), 'type': ''.join(grid_t), 'types': TYPES,
    'national': national, 'prefectural': prefectural, 'rivers': rivers, 'route': route,
    'places': places,
}
with open(OUT, 'w', encoding='utf-8') as f:
    f.write('// 能登町の立体マップ用データ（tools/build-noto-data.py で作成。手で直さないでください）\n')
    f.write('// 出典：国土数値情報（行政区域）／国土地理院 標高タイル・地理院地図Vector を加工して作成\n')
    f.write('export const NOTO = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
print('grid', COLS, ROWS, 'land', len(LAND), 'sea', len(SEA), dict(stats))
print('max elev', max(LAND.values()), 'roads', len(national), len(prefectural), 'rivers', len(rivers), 'route pts', len(route) // 2)
print('size', os.path.getsize(OUT))
for k, v in places.items():
    c, r = int((v[0] - X0) // CELL), int((v[1] - Z0) // CELL)
    print(k, v, 'land' if (c, r) in LAND else ('sea' if (c, r) in SEA else 'OUT'), round(LAND.get((c, r), -1)))
# 確認用の絵
im = Image.new('RGB', (COLS * 8, ROWS * 8), (191, 230, 228))
px = im.load()
COL = {'grass': (159, 209, 108), 'broad': (98, 184, 92), 'conifer': (63, 157, 85), 'paddy': (214, 226, 120), 'field': (226, 200, 140), 'town': (250, 235, 205), 'lake': (70, 150, 220)}
for r in range(ROWS):
    for c in range(COLS):
        h = grid_h[r * COLS + c]
        if h == '.': continue
        col = (102, 201, 220) if h == '~' else tuple(min(255, int(v * (0.8 + (ord(h) - 97) * 0.04))) for v in COL[TYPES[int(grid_t[r * COLS + c])]])
        for i in range(8):
            for j in range(8): px[c * 8 + i, r * 8 + j] = col
from PIL import ImageDraw
dr = ImageDraw.Draw(im)
S = 8 / CELL
for lines, col, w in ((rivers, (40, 120, 220), 1), (prefectural, (255, 255, 255), 1), (national, (240, 110, 40), 2), ([route], (200, 0, 0), 1)):
    for l in lines:
        dr.line([((l[i] - X0) * S, (l[i + 1] - Z0) * S) for i in range(0, len(l), 2)], fill=col, width=w)
for k, v in places.items():
    x, y = (v[0] - X0) * S, (v[1] - Z0) * S
    dr.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(230, 30, 60)); dr.text((x + 6, y - 5), k, fill=(0, 0, 0))
im.save(f'{src}/preview.png')
