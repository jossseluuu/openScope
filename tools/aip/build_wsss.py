"""
Builds assets/airports/wsss.json and assets/airports/terrain/wsss.geojson (Singapore Changi)
from the Singapore eAIP (CAAS), AIRAC 29 OCT 2026.

Usage (from the repo root):
    python tools/aip/build_wsss.py --aip <folder> [--tiles <cache>]

The folder must contain, from https://aim-sg.caas.gov.sg/aim-content/uploads/aip/16-NOV-2026/AIP/
2026-10-29-000000/html/eAIP/:
- SG-AD-2-WSSS-en-GB.html saved as ad2.html; SG-ENR-2.1/4.1/4.4-en-GB.html as SG-ENR-2.1.html, ...
- the SID and STAR chart PDFs converted with `pdftotext -table` to `.tbl` (their back page carries the
  formal and abbreviated descriptions read by caas_charts.py)
See docs/aeropuertos/crear-aeropuerto.md.

Written by hand, with their source:
- airspace: SINGAPORE/JOHOR AIRSPACE COMPLEX (ENR 2.1: 2000 ft to FL250; the lower limit varies from
  2000 to 3500 ft and is modelled as 2000 ft) and CHANGI CTR (AD 2.17, surface to 3000 ft; its edge
  along the Kuala Lumpur/Singapore FIR boundary is drawn as a straight line)
- runway use: 02R/20L is not available for civil use; arrivals on 02L/20R and departures on 02C/20C
- traffic (airlines and rates): estimate, not from the AIP
"""

import argparse
import glob
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from aiplib import COORD_PAIR_RE, distance_nm, elevation_grid, openscope_dms, parse_coord_pair  # noqa: E402
from airport_builder import (  # noqa: E402
    ROOT, FixBook, build_sid, build_star, coast_rings, leg, map_lines, polygon, runways_json, spawn_patterns,
    terrain_geojson, used_fixes, write_airport
)
from caas_charts import procedures  # noqa: E402
from sia_charts import html_text  # noqa: E402

ICAO = 'WSSS'
AIRAC = 2611


def point(text):
    return parse_coord_pair(COORD_PAIR_RE.search(text))


ARP = point('012133N 1035920E')
ELEVATION_FT = 22

RUNWAYS = [
    {'name': ['02L', '20R'], 'end': [(point('012056.27N 1035838.82E'), 22), (point('012256.13N 1035929.42E'), 15)],
     'ils': [True, True], 'ilsCategory': ['I', 'I']},
    {'name': ['02C', '20C'], 'end': [(point('011943.51N 1035905.86E'), 16), (point('012143.37N 1035956.46E'), 16)],
     'ils': [True, True], 'ilsCategory': ['I', 'I']},
    {'name': ['02R', '20L'], 'end': [(point('011920.59N 1035959.45E'), 16), (point('012120.45N 1040050.05E'), 15)],
     'ils': [False, False], 'ilsCategory': [None, None]},
]

COMPLEX = '022600N 1025605E, 022600N 1043400E, 004300N 1043400E, 004300N 1025605E'
CTR = '013300N 1040149E, 013042N 1040654E, 012542N 1040448E, 012000N 1041218E, 010018N 1035524E, 011100N 1035134E'

ASIA = [['sia/long', 25], ['sia/short', 15], ['cpa/short', 3], ['mas/short', 3], ['tha/short', 3],
        ['gia/short', 3], ['qfa/long', 3], ['uae', 3], ['qtr/long', 2], ['jal/long', 2], ['ana/long', 2],
        ['cca/long', 2], ['ces/short', 2], ['klm/long', 1], ['baw/long', 1], ['dlh/long', 1], ['afr/long', 1],
        ['axm', 4], ['tgw', 3], ['ual/long', 1]]


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--aip', required=True)
    parser.add_argument('--tiles', default=os.path.join(ROOT, '.cache', 'terrarium'))
    args = parser.parse_args()

    book = FixBook()
    pair = r'(\d{6}(?:\.\d+)?[NS]) (\d{7}(?:\.\d+)?[EW])'
    for match in re.finditer(r'\b([A-Z]{5}) ' + pair, html_text(os.path.join(args.aip, 'SG-ENR-4.4.html'))):
        p = point(match.group(2) + ' ' + match.group(3))
        if distance_nm(ARP, p) < 250:
            book.add(match.group(1), p)
    for match in re.finditer(r'\b([A-Z]{2,3}) [\d.]+ ?(?:MHz|MHZ|kHz|KHZ)[^A-Z]{0,30}?(?:\(CH \w+\) )?(?:H24 |from [^A-Z]*)?'
                             + pair, html_text(os.path.join(args.aip, 'SG-ENR-4.1.html'))):
        book.fixes.setdefault(match.group(1), point(match.group(2) + ' ' + match.group(3)))

    charts = {}
    for path in sorted(glob.glob(os.path.join(args.aip, '*WSSS*.tbl'))):
        with open(path, encoding='latin-1') as handle:
            charts.update(procedures(handle.read()))

    sids, stars, skipped = {}, {}, []
    for name, (kind, runways, legs) in sorted(charts.items()):
        items = [leg(fix, restriction) for fix, restriction, _ in legs]
        if any(fix not in book.fixes for fix, _, _ in legs):
            skipped.append(name)
            continue
        if kind == 'SID':
            sids[name] = build_sid(ICAO, name, runways, items, legs[-1][0])
        else:
            stars[name] = build_star(ICAO, name, items, {runway: [] for runway in runways})
    if skipped:
        print(f'skipped (unknown fixes): {skipped}', file=sys.stderr)

    config_runways = {'north': ('02L', '02C'), 'south': ('20R', '20C')}
    arrivals, arrival_flows, departures, departure_flows = {}, {}, {}, {}
    for config, (arrival_runway, departure_runway) in config_runways.items():
        arrivals[config] = {}
        departures[config] = {}
        for name, star in stars.items():
            if f'{ICAO}{arrival_runway}' in star['rwy']:
                entry = star['draw'][0][0].rstrip('*')
                arrivals[config][entry] = name
                arrival_flows[entry] = (2.0, [12000, 16000], 280, ASIA)
        for name, sid in sids.items():
            if f'{ICAO}{departure_runway}' in sid['rwy']:
                exit_fix = list(sid['exitPoints'])[0]
                departures[config][exit_fix] = name
                departure_flows[exit_fix] = (2.5, ASIA)
    patterns = spawn_patterns(ICAO, book, sids, arrivals, arrival_flows,
                              {c: r[0] for c, r in config_runways.items()}, departures, departure_flows,
                              {c: r[1] for c, r in config_runways.items()}, ARP)
    fixes = used_fixes(book, sids, stars, patterns, ICAO, ARP, nearby_nm=40)

    print('elevation tiles...', file=sys.stderr)
    grid, lats, lons = elevation_grid(0.6, 103.3, 2.5, 104.7, 10, args.tiles)
    airport = {
        'airac': AIRAC,
        'radio': {'twr': 'Singapore Tower', 'app': 'Singapore Approach', 'dep': 'Singapore Departure'},
        'icao': ICAO,
        'iata': 'SIN',
        'magnetic_north': 0,
        'ctr_radius': 70,
        'ctr_ceiling': 25000,
        'initial_alt': 3000,
        'position': openscope_dms(*ARP) + [f'{ELEVATION_FT}ft'],
        'rangeRings': {'enabled': True, 'center': openscope_dms(*ARP), 'radius_nm': 5},
        'has_terrain': False,
        'wind': {'angle': 20, 'speed': 6},
        'arrivalRunway': '02L',
        'departureRunway': '02C',
        'runwayConfigurations': [
            {'name': 'north', 'arrivalRunway': '02L', 'departureRunway': '02C', 'runways': ['02L', '02C']},
            {'name': 'south', 'arrivalRunway': '20R', 'departureRunway': '20C', 'runways': ['20R', '20C']},
        ],
        'taxiTimes': {'02C': 480, '20C': 480, '02L': 420, '20R': 420},
        'arrivalSpawn': {'preSpawn': False, 'minimumIntervalSeconds': 90},
        'weather': {'climatology': {'fogPerHour': 0.0, 'thunderstormsPerHour': 0.3, 'temperature': 30}},
        'defaultMaps': ['Base Map'],
        'airspace': [
            polygon([point(p) for p in COMPLEX.split(', ')], 2000, 25000, 'A'),
            polygon([point(p) for p in CTR.split(', ')], 0, 3000, 'C'),
        ],
        'fixes': fixes,
        'runways': runways_json(RUNWAYS),
        'sids': sids,
        'stars': stars,
        'spawnPatterns': patterns,
        'maps': [{'name': 'Base Map', 'lines': map_lines(coast_rings(grid, lats, lons, minimum_area=0.0005), RUNWAYS,
                                                       bbox=(lats.min(), lons.min(), lats.max(), lons.max()))}],
    }
    write_airport(ICAO, airport, terrain_geojson('wsss', grid, lats, lons, levels_ft=(1000,)))


if __name__ == '__main__':
    main()
