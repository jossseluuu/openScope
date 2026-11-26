"""
Pieces shared by the airport build scripts (build_<icao>.py): fix book with computed radial/DME
points, SID/STAR assembly in openScope format, spawn patterns, terrain, base map and output.
"""

import json
import os
import re
import sys

from aiplib import (
    COORD_PAIR_RE, arc_points, bearing_deg, destination, distance_nm, dms_to_decimal, filled_polygons,
    openscope_dms, openscope_latlon, parse_coord_pair, ring_area, simplify
)
from enaire_charts import restriction

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def c(text):
    """'393306N 0024420E' -> (lat, lon)"""
    lat, lon = text.split()
    return dms_to_decimal(lat[:-1], lat[-1]), dms_to_decimal(lon[:-1], lon[-1])


def read_raw(folder, name):
    with open(os.path.join(folder, name + '.raw'), encoding='latin-1') as handle:
        return handle.read()


_NAVAID_RE = re.compile(r'^([A-Z]{2,3}) \d{3,4}(?:\.\d+)?(?: (?:MHz|kHz))?$')


def navaids_from_enr41(raw):
    """VOR, DME and NDB positions of ENR 4.1 (`pdftotext -raw`) -> {ident: (lat, lon)}"""
    lines = raw.splitlines()
    navaids = {}
    for index, line in enumerate(lines):
        match = _NAVAID_RE.match(line.strip())
        if not match or match.group(1) in navaids:
            continue
        chunk = re.sub(r'\n(?=\.\d)', '', '\n'.join(lines[index:index + 8]))
        coordinate = COORD_PAIR_RE.search(chunk.replace('\n', ' '))
        if coordinate:
            navaids[match.group(1)] = parse_coord_pair(coordinate)
    return navaids


# ---------------------------------------------------------------- fixes

class FixBook:
    """Named points; `navaids` = {ident: ((lat, lon), station declination)} for radial/DME points."""

    def __init__(self, navaids=None):
        self.fixes = {}
        self.navaids = navaids or {}

    def add(self, name, point):
        self.fixes[name] = point
        return name

    def radial_point(self, vor, radial, dme):
        position, declination = self.navaids[vor]
        return destination(position, (radial + declination) % 360, dme)

    def course_until_dme(self, start, true_course, vor, dme):
        """Point on `true_course` from `start` where the distance to `vor` grows to `dme`."""
        position = self.navaids[vor][0]
        previous = distance_nm(start, position)
        travelled = 0
        while travelled < 60:
            travelled += 0.02
            point = destination(start, true_course, travelled)
            current = distance_nm(point, position)
            if current >= dme and current >= previous:
                return point
            previous = current
        raise ValueError(f'no {dme} DME {vor} on course {true_course} from {start}')

    def name_of(self, vor, point):
        position, declination = self.navaids[vor]
        radial = round((bearing_deg(position, point) - declination) % 360)
        dme = distance_nm(position, point)
        dme_text = f'{dme:04.1f}'.replace('.', 'P') if abs(dme - round(dme)) > 0.05 else f'{round(dme):02d}'
        return f'_{vor}{radial:03d}D{dme_text}'

    def computed(self, vor, point):
        return self.add(self.name_of(vor, point), point)

    def arc(self, vor, radius, start, end_name, clockwise, step=10):
        """Names of the points of the DME arc from `start` to the fix `end_name`."""
        center = self.navaids[vor][0]
        first = destination(center, bearing_deg(center, start), radius)
        names = [self.computed(vor, first)]
        for point in arc_points(center, radius, first, self.fixes[end_name], clockwise, step):
            names.append(self.computed(vor, point))
        return names


# ---------------------------------------------------------------- procedures

def leg(fix, text=None):
    return [fix, text] if text else fix


def fix_name(item):
    return item if isinstance(item, str) else item[0]


def legs_from_table(table_legs):
    """openScope legs from the AIP tabular description (CA/VA/FM/HM legs have no fix to fly to)."""
    out = []
    for entry in table_legs:
        if entry.path_terminator not in ('IF', 'TF', 'DF', 'CF', 'RF') or entry.fix == '-':
            continue
        item = leg(entry.fix, restriction(entry.altitude, entry.speed))
        if out and fix_name(out[-1]) == entry.fix:
            out[-1] = item
        else:
            out.append(item)
    return out


def build_sid(icao, name, runways, legs, exit_fix):
    """`legs` from the runway to the exit fix; `runways` is one runway or a list of runways."""
    if isinstance(runways, str):
        runways = [runways]
    exit_leg = legs[-1] if fix_name(legs[-1]) == exit_fix else exit_fix
    body = legs[:-1] if fix_name(legs[-1]) == exit_fix else legs
    return {
        'icao': name,
        'name': name,
        'rwy': {f'{icao}{runway}': body for runway in runways},
        'body': [],
        'exitPoints': {exit_fix: [exit_leg]},
        'draw': [[fix_name(item) for item in body] + [f'{exit_fix}*']]
    }


def build_star(icao, name, legs, transitions):
    """`legs` from the entry fix to the IAF; `transitions` = {runway: [legs from the IAF to the IF]}."""
    entry = legs[0]
    body = legs[1:]
    last = fix_name(body[-1] if body else entry)
    draw = [[f'{fix_name(entry)}*'] + [fix_name(item) for item in body]]
    rwy = {}
    for runway, segment in transitions.items():
        segment = [item for item in segment if fix_name(item) != last] if segment else []
        rwy[f'{icao}{runway}'] = segment
        if segment:
            draw.append([last] + [fix_name(item) for item in segment])
    return {
        'icao': name,
        'name': name,
        'entryPoints': {fix_name(entry): [entry]},
        'body': body,
        'rwy': rwy,
        'draw': draw
    }


def spawn_patterns(icao, book, sids, arrivals, arrival_flows, arrival_runway, departures, departure_flows,
                   departure_runway, airport_position):
    """
    arrivals = {config: {entry fix: STAR}}, arrival_flows = {entry fix: (rate, [alt range], speed, airlines)}
    departures = {config: {exit fix: SID}}, departure_flows = {exit fix: (rate, airlines)}
    """
    patterns = []
    for config, routes in arrivals.items():
        for entry, star in routes.items():
            rate, altitude, speed, airlines = arrival_flows[entry]
            patterns.append({
                'origin': '', 'destination': icao, 'category': 'arrival',
                'route': f'{entry}.{star}.{icao}{arrival_runway[config]}',
                'altitude': altitude, 'speed': speed, 'method': 'random',
                'runwayConfiguration': config, 'rate': rate, 'airlines': airlines
            })
    for config, routes in departures.items():
        for exit_fix, sid in routes.items():
            rate, airlines = departure_flows[exit_fix]
            # a point 30 NM beyond the exit, along the last leg, so departures leave the airspace
            draw = sids[sid]['draw'][0]
            before = book.fixes[draw[-2]] if len(draw) > 1 else airport_position
            after = book.fixes[exit_fix]
            beyond = book.add(f'_{exit_fix}_X', destination(after, bearing_deg(before, after), 30))
            patterns.append({
                'origin': icao, 'destination': '', 'category': 'departure',
                'route': f'{icao}{departure_runway[config]}.{sid}.{exit_fix}..{beyond}',
                'altitude': '', 'speed': '', 'method': 'random',
                'runwayConfiguration': config, 'rate': rate, 'airlines': airlines
            })
    return patterns


def used_fixes(book, sids, stars, patterns, icao, airport_position, nearby_nm=60):
    """Fixes used by procedures and routes, plus named points within `nearby_nm` (for direct-to)."""
    used = set()
    for procedure in list(sids.values()) + list(stars.values()):
        for line in procedure['draw']:
            used.update(name.rstrip('*') for name in line)
    for pattern in patterns:
        used.update(part for part in pattern['route'].split('.') if part and not part.startswith(icao))
    missing = sorted(name for name in used if name not in book.fixes and name not in sids and name not in stars)
    if missing:
        raise SystemExit(f'fixes without coordinates: {missing}')
    return {
        name: openscope_dms(*point)
        for name, point in sorted(book.fixes.items())
        if name in used or (not name.startswith('_') and distance_nm(airport_position, point) < nearby_nm)
    }


# ---------------------------------------------------------------- geography

def _area(ring):
    return abs(ring_area(ring))


def coast_rings(grid, lats, lons, tolerance=0.002, minimum_area=0.002):
    """Coastlines (0 m contour) as simplified closed rings; islands smaller than `minimum_area` deg² are dropped."""
    rings = [r for r in filled_polygons(grid, lats, lons, 0.5) if _area(r) >= minimum_area]
    return [simplify(r, tolerance) for r in rings]


def terrain_geojson(name, grid, lats, lons, levels_ft=(1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000),
                    tolerance=0.002, minimum_area=0.0003):
    """Contours at each level; areas smaller than `minimum_area` deg² (about 2 km²) are dropped."""
    features = []
    for level_ft in levels_ft:
        level_m = round(level_ft * 0.3048, 1)
        for ring in filled_polygons(grid, lats, lons, level_m):
            if _area(ring) < minimum_area:
                continue
            ring = simplify(ring, tolerance)
            if len(ring) < 4:
                continue
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            coordinates = [[round(lon, 5), round(lat, 5)] for lat, lon in ring]
            features.append({'type': 'Feature', 'properties': {'elevation': level_m},
                             'geometry': {'type': 'Polygon', 'coordinates': [coordinates]}})
    return {'type': 'FeatureCollection', 'name': name,
            'crs': {'type': 'name', 'properties': {'name': 'urn:ogc:def:crs:OGC:1.3:CRS84'}},
            'features': features}


def map_lines(rings, runways, centreline_nm=15, bbox=None):
    """
    Coastline segments and dashed extended centrelines of the ILS runways. With `bbox` (south, west,
    north, east of the elevation grid), segments along its edge (where land was cut off) are skipped.
    """
    def on_edge(point):
        if not bbox:
            return False
        margin = 0.01
        return (abs(point[0] - bbox[0]) < margin or abs(point[0] - bbox[2]) < margin or
                abs(point[1] - bbox[1]) < margin or abs(point[1] - bbox[3]) < margin)

    lines = []
    for ring in rings:
        closed = ring + [ring[0]]
        for a, b in zip(closed, closed[1:]):
            if on_edge(a) and on_edge(b):
                continue
            lines.append(openscope_latlon(*a) + openscope_latlon(*b))
    for runway in runways:
        for index in (0, 1):
            if not runway['ils'][index]:
                continue
            threshold = runway['end'][index][0]
            other = runway['end'][1 - index][0]
            outbound = bearing_deg(other, threshold)
            for mile in range(1, centreline_nm, 2):
                a = destination(threshold, outbound, mile)
                b = destination(threshold, outbound, mile + 1)
                lines.append(openscope_latlon(*a) + openscope_latlon(*b))
    return lines


def runways_json(runways):
    return [
        {'name': r['name'],
         'end': [openscope_dms(*point) + [f'{elevation}ft'] for point, elevation in r['end']],
         'ils': r['ils'], 'ilsCategory': r['ilsCategory']}
        for r in runways
    ]


def polygon(points, floor_ft, ceiling_ft, airspace_class):
    return {'floor': floor_ft // 100, 'ceiling': ceiling_ft // 100, 'airspace_class': airspace_class,
            'poly': [openscope_latlon(*p) for p in points]}


def write_airport(icao, airport, terrain):
    out_path = os.path.join(ROOT, 'assets', 'airports', f'{icao.lower()}.json')
    with open(out_path, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(airport, handle, indent=4, ensure_ascii=False)
        handle.write('\n')
    terrain_path = os.path.join(ROOT, 'assets', 'airports', 'terrain', f'{icao.lower()}.geojson')
    with open(terrain_path, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(terrain, handle)
        handle.write('\n')
    print(f'{os.path.relpath(out_path, ROOT)}: {len(airport["fixes"])} fixes, {len(airport["sids"])} SIDs, '
          f'{len(airport["stars"])} STARs, {len(airport["airspace"])} airspace polygons, '
          f'{len(airport["spawnPatterns"])} spawn patterns', file=sys.stderr)
