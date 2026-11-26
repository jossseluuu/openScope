"""
Shared helpers for building openScope airports from AIP data.

- coordinates in AIP format (393306N, 0024420.5E) <-> decimal degrees
- great-circle helpers (distance, bearing, destination point) and arcs
- AWS terrarium elevation tiles: download (cached), mosaic, sample
- contours of an elevation grid (via contourpy, shipped with matplotlib)
- coastline of an island extracted from the elevation grid, and the path along it between two points

Only needs numpy, Pillow and contourpy (pip install numpy pillow matplotlib).
"""

import math
import os
import re
import time
import urllib.request

import numpy as np

EARTH_RADIUS_NM = 3440.065
COORD_PAIR_RE = re.compile(r'(\d{6}(?:\.\d+)?)\s*([NS])\s*,?\s*(\d{7}(?:\.\d+)?)\s*([EW])')


# ---------------------------------------------------------------- coordinates

def dms_to_decimal(text, hemisphere):
    """`393306.5` + `N` -> 39.5518. Latitude has 2 degree digits, longitude 3."""
    whole, _, frac = text.partition('.')
    degree_digits = 2 if hemisphere in 'NS' else 3
    degrees = int(whole[:degree_digits])
    minutes = int(whole[degree_digits:degree_digits + 2])
    seconds = float(whole[degree_digits + 2:] + ('.' + frac if frac else ''))
    value = degrees + minutes / 60 + seconds / 3600
    return -value if hemisphere in 'SW' else value


def parse_coord_pair(match):
    """regex match of COORD_PAIR_RE -> (lat, lon)"""
    return dms_to_decimal(match.group(1), match.group(2)), dms_to_decimal(match.group(3), match.group(4))


def openscope_latlon(lat, lon, digits=6):
    """(39.55, 2.73) -> ['N39.550000', 'E2.730000'] (decimal form accepted by the engine)"""
    return [
        f"{'N' if lat >= 0 else 'S'}{abs(lat):.{digits}f}",
        f"{'E' if lon >= 0 else 'W'}{abs(lon):.{digits}f}"
    ]


def openscope_dms(lat, lon):
    """(39.55, 2.73) -> ['N39d33m00.00', 'E2d43m48.00'] (format used for fixes and runways)"""
    def one(value, positive, negative):
        hemisphere = positive if value >= 0 else negative
        hundredths = round(abs(value) * 360000)  # whole hundredths of a second, no float remainders
        degrees, hundredths = divmod(hundredths, 360000)
        minutes, hundredths = divmod(hundredths, 6000)
        return f'{hemisphere}{degrees}d{minutes:02d}m{hundredths / 100:05.2f}'
    return [one(lat, 'N', 'S'), one(lon, 'E', 'W')]


# ---------------------------------------------------------------- geodesy

def distance_nm(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_NM * math.asin(min(1, math.sqrt(h)))


def bearing_deg(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    y = math.sin(lon2 - lon1) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(lon2 - lon1)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def destination(origin, bearing, distance):
    lat1, lon1 = map(math.radians, origin)
    theta = math.radians(bearing)
    delta = distance / EARTH_RADIUS_NM
    lat2 = math.asin(math.sin(lat1) * math.cos(delta) + math.cos(lat1) * math.sin(delta) * math.cos(theta))
    lon2 = lon1 + math.atan2(math.sin(theta) * math.sin(delta) * math.cos(lat1),
                             math.cos(delta) - math.sin(lat1) * math.sin(lat2))
    return math.degrees(lat2), math.degrees(lon2)


def arc_points(center, radius_nm, start, end, clockwise, step_deg=5):
    """Points strictly between `start` and `end` on the arc of `radius_nm` around `center`."""
    b0 = bearing_deg(center, start)
    b1 = bearing_deg(center, end)
    sweep = (b1 - b0) % 360 if clockwise else (b0 - b1) % 360
    count = int(sweep // step_deg)
    points = []
    for i in range(1, count + 1):
        angle = i * step_deg
        if angle >= sweep - 1:
            break
        bearing = b0 + angle if clockwise else b0 - angle
        points.append(destination(center, bearing % 360, radius_nm))
    return points


# ---------------------------------------------------------------- terrarium tiles

TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'


def _tile_xy(lat, lon, zoom):
    n = 2 ** zoom
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def _tile_lat(y, zoom):
    n = 2 ** zoom
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))


def _download(url, path, retries=4):
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'openscope-airport-tools'})
            with urllib.request.urlopen(request, timeout=30) as response:
                data = response.read()
            with open(path, 'wb') as handle:
                handle.write(data)
            return
        except Exception:  # noqa: BLE001 - network hiccups: retry
            if attempt == retries - 1:
                raise
            time.sleep(1 + attempt)


def elevation_grid(south, west, north, east, zoom, cache_dir):
    """
    Mosaic of terrarium tiles covering the box. Returns (elevation_m, lats, lons):
    `elevation_m[i, j]` is at latitude `lats[i]` (north to south) and longitude `lons[j]`.
    """
    from PIL import Image

    os.makedirs(cache_dir, exist_ok=True)
    x0, y0 = _tile_xy(north, west, zoom)
    x1, y1 = _tile_xy(south, east, zoom)
    tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
    rows = []
    for ty in range(ty0, ty1 + 1):
        row = []
        for tx in range(tx0, tx1 + 1):
            path = os.path.join(cache_dir, f'{zoom}_{tx}_{ty}.png')
            if not os.path.exists(path):
                _download(TILE_URL.format(z=zoom, x=tx, y=ty), path)
            rgb = np.asarray(Image.open(path).convert('RGB'), dtype=np.float64)
            row.append(rgb[:, :, 0] * 256 + rgb[:, :, 1] + rgb[:, :, 2] / 256 - 32768)
        rows.append(np.hstack(row))
    grid = np.vstack(rows)
    size = grid.shape[0] // (ty1 - ty0 + 1)
    pixel_y = ty0 + (np.arange(grid.shape[0]) + 0.5) / size
    pixel_x = tx0 + (np.arange(grid.shape[1]) + 0.5) / size
    lats = np.array([_tile_lat(y, zoom) for y in pixel_y])
    lons = pixel_x / 2 ** zoom * 360 - 180
    # crop to the requested box
    keep_rows = (lats >= south) & (lats <= north)
    keep_cols = (lons >= west) & (lons <= east)
    return grid[keep_rows][:, keep_cols], lats[keep_rows], lons[keep_cols]


# ---------------------------------------------------------------- contours

def filled_polygons(grid, lats, lons, level):
    """
    Outer rings (lat, lon) of the areas at or above `level`. Holes are dropped (openScope terrain
    draws each level on top of the previous one, so a hole is the lower level showing through).
    """
    import contourpy

    # contourpy wants increasing y: flip north-to-south rows
    z = grid[::-1]
    y = lats[::-1]
    generator = contourpy.contour_generator(lons, y, z, fill_type=contourpy.FillType.OuterOffset)
    points_list, offsets_list = generator.filled(level, np.inf)
    rings = []
    for points, offsets in zip(points_list, offsets_list):
        outer = points[offsets[0]:offsets[1]]
        rings.append([(float(lat), float(lon)) for lon, lat in outer])
    return rings


def simplify(ring, tolerance_deg):
    """Douglas-Peucker on a closed or open list of (lat, lon)."""
    if len(ring) < 3:
        return list(ring)
    points = np.asarray(ring)
    keep = np.zeros(len(points), dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        if last - first < 2:
            continue
        a, b = points[first], points[last]
        segment = b - a
        length = np.hypot(*segment)
        inner = points[first + 1:last]
        if length == 0:
            distances = np.hypot(*(inner - a).T)
        else:
            distances = np.abs(np.cross(segment, inner - a)) / length
        index = int(np.argmax(distances))
        if distances[index] > tolerance_deg:
            keep[first + 1 + index] = True
            stack.append((first, first + 1 + index))
            stack.append((first + 1 + index, last))
    return [tuple(p) for p in points[keep]]


def ring_area(ring):
    """Signed area in degree^2 (positive = counter-clockwise in lon/lat)."""
    area = 0
    for (lat1, lon1), (lat2, lon2) in zip(ring, ring[1:] + ring[:1]):
        area += lon1 * lat2 - lon2 * lat1
    return area / 2


class Coastline:
    """Coast of an island, from the elevation grid, as a closed ring of (lat, lon)."""

    def __init__(self, ring):
        if ring[0] == ring[-1]:
            ring = ring[:-1]
        self.ring = ring

    @classmethod
    def around(cls, point, grid, lats, lons, tolerance_deg=0.0015):
        """The coastline (0 m contour) of the land mass closest to `point`."""
        rings = [r for r in filled_polygons(grid, lats, lons, 0.5) if len(r) > 50]
        best = min(rings, key=lambda r: min(distance_nm(point, p) for p in r[::5]))
        return cls(simplify(best, tolerance_deg))

    def nearest_segment(self, point):
        """Index i of the coast segment ring[i] -> ring[i + 1] closest to `point` (local planar metric)."""
        scale = math.cos(math.radians(point[0]))
        px, py = point[1] * scale, point[0]
        best, best_distance = 0, float('inf')
        n = len(self.ring)
        for i in range(n):
            (ay, ax), (by, bx) = self.ring[i], self.ring[(i + 1) % n]
            ax, bx = ax * scale, bx * scale
            dx, dy = bx - ax, by - ay
            length2 = dx * dx + dy * dy
            t = 0 if length2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / length2))
            distance = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if distance < best_distance:
                best, best_distance = i, distance
        return best

    def path(self, start, end):
        """Coast vertices strictly between `start` and `end`, going the shorter way round."""
        n = len(self.ring)
        i, j = self.nearest_segment(start), self.nearest_segment(end)
        # forward: vertices i+1 .. j ; backward: vertices i .. j+1
        forward = [self.ring[(i + 1 + k) % n] for k in range((j - i) % n)]
        backward = [self.ring[(i - k) % n] for k in range((i - j) % n)]

        def length(points):
            chain = [start] + points + [end]
            return sum(distance_nm(a, b) for a, b in zip(chain, chain[1:]))

        path = forward if length(forward) <= length(backward) else backward
        # drop coast vertices hugging either end (the AIP point is near, not exactly on, the extracted coast)
        while path and distance_nm(start, path[0]) < 0.2:
            path.pop(0)
        while path and distance_nm(path[-1], end) < 0.2:
            path.pop()
        return path
