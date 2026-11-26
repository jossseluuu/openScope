"""
Builds assets/airports/lfpg.json and assets/airports/terrain/lfpg.geojson (Paris-Charles de Gaulle)
from the French eAIP (SIA), AIRAC 2610 (29 OCT 2026).

Usage (from the repo root):
    python tools/aip/build_lfpg.py --aip <folder> [--tiles <cache>]

The folder must contain, from https://www.sia.aviation-civile.gouv.fr/media/dvd/eAIP_29_OCT_2026/FRANCE/
AIRAC-2026-10-29/html/eAIP/:
- FR-AD-2.LFPG-fr-FR.html saved as ad2.html, and FR-AD-2.LFOB and LFPO saved as ad2_<ICAO>.html, FR-ENR-2.1/4.1/4.4-fr-FR.html saved as ENR-2.1.html,
  ENR-4.1.html and ENR-4.4.html
- every Cartes/LFPG/AD_2_LFPG_DATA_*.pdf converted with `pdftotext -table` to `.tbl`
See docs/aeropuertos/crear-aeropuerto.md.

Every SID, STAR and initial approach of LFPG is RNAV1 and has a coding table, so all of them are read
from the tables. Written by hand, with their source:
- runway use (AD 2.20 and charts GMC): outer runways for arrivals (27R, 26L / 08R, 09L), inner runways
  for departures (27L, 26R / 09R, 08L); arrivals and departures split between the north and south pairs
- TMA PARIS parts 1-10 (ENR 2.1) and CTR PARIS (AD 2.17). The TMA ends at FL115; an upper layer
  FL115-FL195 over part 1 stands for the PARIS CTA/ACC sectors so that arrivals appear inside the airspace.
- traffic (airlines and rates): estimate, not from the AIP
"""

import argparse
import glob
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from aiplib import distance_nm, elevation_grid, openscope_dms  # noqa: E402
from airport_builder import (  # noqa: E402
    ROOT, FixBook, build_sid, build_star, fix_name, legs_from_table, map_lines, polygon, runways_json,
    spawn_patterns, terrain_geojson, used_fixes, write_airport
)
from sia_charts import (  # noqa: E402
    _PAIR_RE, airspace_parts, coded_approach_blocks, coded_procedures, html_text, lateral_polygon, pair_value,
    waypoints_table
)

ICAO = 'LFPG'
AIRAC = 2610


def dms(text):
    return pair_value(_PAIR_RE.search(text))


ARP = dms('49°00\'35"N 002°32\'52"E')
ELEVATION_FT = 392

# AD 2.12 (THR positions; 26R and 27L have displaced thresholds, the runway ends are used)
RUNWAYS = [
    {'name': ['08L', '26R'], 'end': [(dms('48°59\'44.47"N 002°33\'09.88"E'), 338),
                                     (dms('48°59\'55.32"N 002°36\'32.99"E'), 316)],
     'ils': [True, True], 'ilsCategory': ['IIIA', 'IIIA']},
    {'name': ['08R', '26L'], 'end': [(dms('48°59\'34.49"N 002°33\'56.38"E'), 337),
                                     (dms('48°59\'41.56"N 002°36\'08.77"E'), 317)],
     'ils': [True, True], 'ilsCategory': ['IIIA', 'IIIA']},
    {'name': ['09L', '27R'], 'end': [(dms('49°01\'28.99"N 002°31\'29.62"E'), 378),
                                     (dms('49°01\'36.10"N 002°33\'42.09"E'), 391)],
     'ils': [True, True], 'ilsCategory': ['IIIA', 'IIIA']},
    {'name': ['09R', '27L'], 'end': [(dms('49°01\'14.22"N 002°30\'47.01"E'), 371),
                                     (dms('49°01\'25.29"N 002°34\'13.06"E'), 386)],
     'ils': [True, True], 'ilsCategory': ['IIIA', 'IIIA']},
]

ARRIVAL_RUNWAYS = {'west': ('27R', '26L'), 'east': ('09L', '08R')}
DEPARTURE_RUNWAYS = {'west': ('27L', '26R'), 'east': ('09R', '08L')}


def navaids(text):
    pattern = re.compile(r'\b(?:VOR-DME|VORTAC|VOR|DME|NDB|TACAN)\s+([A-Z]{2,3})\s+[\d.,]+\s*(?:MHz|kHz)(?=(.{0,80}))')
    out = {}
    for match in pattern.finditer(text):
        coordinate = _PAIR_RE.search(match.group(2))
        if coordinate and match.group(1) not in out:
            out[match.group(1)] = pair_value(coordinate)
    return out


def significant_points(text):
    return {m.group(1): pair_value(m, 1) for m in re.finditer(r'\b([A-Z]{5})\s+' + _PAIR_RE.pattern, text)}


def airspace(enr21, ad2):
    parts = airspace_parts(enr21, 'TMA PARIS partie')
    out = [polygon(ring, floor, ceiling, cls) for ring, floor, ceiling, cls in parts.values()]
    upper = parts['TMA PARIS partie 1'][0]
    out.append(polygon(upper, 11500, 19500, 'A'))
    ctr_text = ad2[ad2.find('CTR PARIS'):]
    ctr_text = ctr_text[:re.search(r'\bD\s+2000\s*ft', ctr_text).start()]
    out.append(polygon(lateral_polygon(ctr_text), 0, 2000, 'D'))
    return out


def build_procedures(folder):
    def read(path):
        with open(path, encoding='latin-1') as handle:
            return handle.read()

    sids = {}
    for path in sorted(glob.glob(os.path.join(folder, 'AD_2_LFPG_DATA_SID_RWY*_RNAV_CODE_*.tbl'))):
        if 'POGO' in path:
            continue
        runways = re.search(r'SID_RWY(\w+)-(\w+)_RNAV', path).groups()
        for name, table_legs in coded_procedures(read(path)).items():
            legs = legs_from_table(table_legs)
            if legs:
                sids[name] = build_sid(ICAO, name, list(runways), legs, fix_name(legs[-1]))

    transitions = {}  # IAF -> runway -> legs to the point where vectoring starts (day "1W"/"1E")
    for path in sorted(glob.glob(os.path.join(folder, 'AD_2_LFPG_DATA_RWY*_INA_RNAV_CODE_01.tbl'))):
        runway = re.search(r'DATA_RWY(\w+)_INA', path).group(1)
        for name, table_legs in coded_approach_blocks(read(path)).items():
            if name[-2] != '1' or name[-1] not in 'WE':
                continue
            legs = legs_from_table(table_legs)
            transitions.setdefault(fix_name(legs[0]), {})[runway] = legs[1:]

    stars = {}
    star_runways = {}
    star_legs = {}
    for path in sorted(glob.glob(os.path.join(folder, 'AD_2_LFPG_DATA_STAR_RWY*_RNAV_CODE_*.tbl'))):
        runway = re.search(r'STAR_RWY(\w+)_RNAV', path).group(1)
        for name, table_legs in coded_procedures(read(path)).items():
            star_legs.setdefault(name, legs_from_table(table_legs))
            star_runways.setdefault(name, []).append(runway)
    for name, legs in star_legs.items():
        iaf = fix_name(legs[-1])
        segments = {runway: transitions.get(iaf, {}).get(runway, []) for runway in star_runways[name]}
        stars[name] = build_star(ICAO, name, legs, segments)
    return sids, stars


# ---------------------------------------------------------------- traffic (estimate)

EUROPE = [
    ['afr/short', 30], ['afr/hop', 6], ['ezy', 8], ['dlh/short', 3], ['klm/short', 3], ['baw/short', 2],
    ['swr/short', 2], ['ibe/short', 2], ['vlg/short', 3], ['tap/short', 2], ['sas/short', 2], ['fin/short', 1],
    ['lot/short', 1], ['aua/short', 1], ['aee', 1], ['thy/short', 2], ['wzz', 1], ['ein/short', 1]
]
LONG_HAUL = [
    ['afr/long', 20], ['dal/long', 3], ['aal/long', 2], ['ual/long', 2], ['uae', 3], ['qtr/long', 2],
    ['sia/long', 1], ['cca/long', 1], ['ram/short', 2], ['thy/long', 1]
]
MIXED = EUROPE + [['afr/long', 6], ['ram/short', 2]]

# entry fix: (rate, altitudes, speed, airlines). STAR "W" (west) and "E" (east) for each entry
ARRIVAL_FLOWS = {
    'ENORI': (3.0, [12000, 15000], 280, MIXED),
    'MATIX': (2.0, [15000, 19000], 280, MIXED),
    'MOPIL': (3.0, [15000, 19000], 280, LONG_HAUL),
    'VEDUS': (2.0, [15000, 19000], 280, EUROPE),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--aip', required=True)
    parser.add_argument('--tiles', default=os.path.join(ROOT, '.cache', 'terrarium'))
    args = parser.parse_args()

    enr21 = html_text(os.path.join(args.aip, 'ENR-2.1.html'))
    ad2 = html_text(os.path.join(args.aip, 'ad2.html'))
    book = FixBook()
    for name, point in significant_points(html_text(os.path.join(args.aip, 'ENR-4.4.html'))).items():
        if distance_nm(ARP, point) < 250:
            book.add(name, point)
    for name, point in navaids(html_text(os.path.join(args.aip, 'ENR-4.1.html'))).items():
        if distance_nm(ARP, point) < 250:
            book.add(name, point)
    for name, point in navaids(ad2).items():
        book.add(name, point)
    # navaids of other aerodromes referenced by the DATA lists ("REF AD2 LFOB.19"), saved as ad2_<ICAO>.html
    for path in sorted(glob.glob(os.path.join(args.aip, 'ad2_LF*.html'))):
        for name, point in navaids(html_text(path)).items():
            book.fixes.setdefault(name, point)
    for path in sorted(glob.glob(os.path.join(args.aip, 'AD_2_LFPG_DATA_0*.tbl'))):
        with open(path, encoding='latin-1') as handle:
            for name, point in waypoints_table(handle.read()).items():
                book.add(name, point)

    sids, stars = build_procedures(args.aip)

    # arrivals: the outer runway of the pair on the side of the IAF (north pair 27R/09L, south 26L/08R)
    arrivals = {'west': {}, 'east': {}}
    arrival_flows = {}
    arrival_runway = {}
    for name in sorted(stars):
        if name[-1] not in 'WE':
            continue
        config = 'west' if name[-1] == 'W' else 'east'
        entry = re.match(r'[A-Z]+', name).group()
        iaf = stars[name]['draw'][0][-1]
        north = book.fixes[iaf][0] > ARP[0]
        runway = ARRIVAL_RUNWAYS[config][0 if north else 1]
        key = f'{entry}/{config}'
        arrivals[config][key] = name
        arrival_runway[key] = runway
        bearing = bearing_from_arp(book.fixes[entry])
        airlines = LONG_HAUL if 180 <= bearing < 330 else (MIXED if bearing >= 330 or bearing < 120 else EUROPE)
        arrival_flows[key] = (1.8, [15000, 19000], 280, airlines)

    # departures: day SIDs, from the inner runway of the pair on the side of the exit
    departures = {'west': {}, 'east': {}}
    departure_flows = {}
    departure_runway = {}
    for config, suffixes in (('west', ('7A', '7B')), ('east', ('6G', '6H'))):
        for name in sorted(sids):
            if name[-2:] not in suffixes:
                continue
            exit_fix = re.match(r'[A-Z]+', name).group()
            runways = [r[len(ICAO):] for r in sids[name]['rwy']]
            north_pair = any(r in ('27L', '27R', '09L', '09R') for r in runways)
            exit_north = book.fixes[exit_fix][0] > ARP[0]
            if north_pair != exit_north:
                continue
            key = f'{exit_fix}/{config}'
            departures[config][key] = name
            departure_runway[key] = DEPARTURE_RUNWAYS[config][0 if north_pair else 1]
            bearing = bearing_from_arp(book.fixes[exit_fix])
            airlines = LONG_HAUL if 180 <= bearing < 330 else EUROPE
            departure_flows[key] = (1.8, airlines)

    patterns = _spawn_patterns_per_route(book, sids, arrivals, arrival_flows, arrival_runway,
                                         departures, departure_flows, departure_runway)
    fixes = used_fixes(book, sids, stars, patterns, ICAO, ARP, nearby_nm=40)

    print('elevation tiles...', file=sys.stderr)
    grid, lats, lons = elevation_grid(48.2, 1.2, 49.8, 3.9, 10, args.tiles)

    airport = {
        'airac': AIRAC,
        'radio': {'twr': 'De Gaulle Tower', 'app': 'De Gaulle Approach', 'dep': 'De Gaulle Departure'},
        'icao': ICAO,
        'iata': 'CDG',
        'magnetic_north': 2,
        'ctr_radius': 80,
        'ctr_ceiling': 19500,
        'initial_alt': 5000,
        'position': openscope_dms(*ARP) + [f'{ELEVATION_FT}ft'],
        'rangeRings': {'enabled': True, 'center': openscope_dms(*ARP), 'radius_nm': 5},
        'has_terrain': True,
        'wind': {'angle': 250, 'speed': 8},
        'arrivalRunway': '27R',
        'departureRunway': '27L',
        'runwayConfigurations': [
            {'name': 'west', 'arrivalRunway': '27R', 'departureRunway': '27L', 'runways': ['27R', '26L', '27L', '26R']},
            {'name': 'east', 'arrivalRunway': '09L', 'departureRunway': '09R', 'runways': ['09L', '08R', '09R', '08L']},
        ],
        'taxiTimes': {'27L': 480, '26R': 420, '09R': 600, '08L': 540, '27R': 600, '26L': 540, '09L': 480, '08R': 420},
        'arrivalSpawn': {'preSpawn': False, 'minimumIntervalSeconds': 60},
        'weather': {'climatology': {'fogPerHour': 0.06, 'thunderstormsPerHour': 0.05, 'temperature': 14}},
        'defaultMaps': ['Base Map'],
        'airspace': airspace(enr21, ad2),
        'fixes': fixes,
        'runways': runways_json(RUNWAYS),
        'sids': sids,
        'stars': stars,
        'spawnPatterns': patterns,
        'maps': [{'name': 'Base Map', 'lines': map_lines([], RUNWAYS)}],
    }
    write_airport(ICAO, airport, terrain_geojson('lfpg', grid, lats, lons, levels_ft=(500, 1000)))


def bearing_from_arp(point):
    from aiplib import bearing_deg
    return bearing_deg(ARP, point)


def _spawn_patterns_per_route(book, sids, arrivals, arrival_flows, arrival_runway, departures, departure_flows,
                              departure_runway):
    """spawn_patterns with one runway per route: keys are 'FIX/config', runways per key."""
    patterns = []
    for config in ('west', 'east'):
        arr = {config: {key.split('/')[0]: star for key, star in arrivals[config].items()}}
        flows = {key.split('/')[0]: arrival_flows[key] for key in arrivals[config]}
        for key in arrivals[config]:
            fix = key.split('/')[0]
            patterns += spawn_patterns(ICAO, book, sids, {config: {fix: arr[config][fix]}}, flows,
                                       {config: arrival_runway[key]}, {}, {}, {}, ARP)
        for key, sid in departures[config].items():
            fix = key.split('/')[0]
            patterns += spawn_patterns(ICAO, book, sids, {}, {}, {}, {config: {fix: sid}},
                                       {fix: departure_flows[key]}, {config: departure_runway[key]}, ARP)
    return patterns


if __name__ == '__main__':
    main()
