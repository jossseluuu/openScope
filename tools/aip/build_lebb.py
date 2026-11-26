"""
Builds assets/airports/lebb.json and assets/airports/terrain/lebb.geojson (Bilbao)
from the ENAIRE AIP (AD 2-LEBB AIRAC AMDT 10/26).

Usage (from the repo root):
    python tools/aip/build_lebb.py --aip <folder with the pdftotext -raw files> [--tiles <cache>]

The SID, STAR and approach charts of LEBB are only published in Spanish (`..._es.pdf`); their WPT
COORD and tabular description tables are bilingual, so they are read the same way. The folder
must contain LE_AD_2_LEBB_{SID_2,SID_4,STAR_1,STAR_2,IAC_*}_es.raw, LE_ENR_4_1_en.raw and
LE_ENR_4_4_en.raw. See docs/aeropuertos/crear-aeropuerto.md.

Written by hand, with their source:
- runways and ILS (AD 2.12, AD 2.19); the AIP gives no preferential runway for IFR, so there is
  one configuration per direction (30 and 12), each using the same runway for arrivals and departures
- TMA BILBAO (ENR 2.1): Part 1 from 1000 ft AGL (modelled from the surface) and Part 2 from FL095,
  both up to FL145. The CTR (surface to 1000 ft AGL) lies inside Part 1.
- approach transitions from the IAF to the IF: initial segments of the RNP approaches (IAC 1, 8)
- traffic (airlines and rates): estimate, not from the AIP
"""

import argparse
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from aiplib import distance_nm, elevation_grid, openscope_dms  # noqa: E402
from airport_builder import (  # noqa: E402
    ROOT, FixBook, build_sid, build_star, c, coast_rings, fix_name, leg, legs_from_table, map_lines,
    navaids_from_enr41, polygon, read_raw, runways_json, spawn_patterns, terrain_geojson, used_fixes,
    write_airport
)
from enaire_charts import chart_waypoints, significant_points, tabular_procedures  # noqa: E402

ICAO = 'LEBB'
AIRAC = 2610
ARP = c('431804N 0025438W')
ELEVATION_FT = 136

# AD 2.12. 12/30: the 30 threshold is displaced 460 m; 10/28 is used preferentially for VFR
RUNWAYS = [
    {'name': ['12', '30'], 'end': [(c('431822.87N 0025529.75W'), 119), (c('431751.75N 0025404.86W'), 128)],
     'ils': [True, True], 'ilsCategory': ['I', 'I']},
    {'name': ['10', '28'], 'end': [(c('431811.73N 0025609.30W'), 116), (c('431806.65N 0025509.59W'), 118)],
     'ils': [False, False], 'ilsCategory': [None, None]},
]

# ENR 2.1
TMA_PART1 = ('434052N 0032423W, 434100N 0023526W, 431530N 0020738W, 425836N 0014923W, 425300N 0015800W, '
             '424814N 0020518W, 425800N 0022600W, 430500N 0024100W, 424836N 0030620W, 430305N 0032637W, '
             '431000N 0031900W, 433447N 0031900W')
TMA_PART2 = '430500N 0024100W, 425800N 0022600W, 424814N 0020518W, 424836N 0030620W'


def airspace():
    part1 = [c(item.strip()) for item in TMA_PART1.split(',')]
    part2 = [c(item.strip()) for item in TMA_PART2.split(',')]
    return [polygon(part1, 0, 14500, 'D'), polygon(part2, 9500, 14500, 'D')]


# IAF -> runway -> legs to the IF (IAC 1 and 8)
TRANSITIONS = {
    'ASPES': {'12': [leg('BB803', 'S230-'), leg('BB13W', 'A35+')]},
    'KUXUN': {'12': [leg('BB803', 'S230-'), leg('BB13W', 'A35+')]},
    'OLMET': {'12': [leg('BB803', 'S230-'), leg('BB13W', 'A35+')]},
    'SUNIR': {'12': [leg('BB802', 'S230-'), 'ASPES', 'BB803', leg('BB13W', 'A35+')]},
    'DIRXA': {'30': [leg('IFASA', 'A49+')]},
    'IFASA': {'30': []},
}
SID_CHARTS = {'30': 'SID_4', '12': 'SID_2'}
STAR_CHARTS = {'30': 'STAR_2', '12': 'STAR_1'}


def build_procedures(folder):
    sids = {}
    for runway, chart in SID_CHARTS.items():
        for name, table_legs in tabular_procedures(read_raw(folder, f'LE_AD_2_LEBB_{chart}_es')).items():
            legs = legs_from_table(table_legs)
            sids[name] = build_sid(ICAO, name, runway, legs, fix_name(legs[-1]))
    stars = {}
    for runway, chart in STAR_CHARTS.items():
        for name, table_legs in tabular_procedures(read_raw(folder, f'LE_AD_2_LEBB_{chart}_es')).items():
            legs = legs_from_table(table_legs)
            iaf = fix_name(legs[-1])
            stars[name] = build_star(ICAO, name, legs, TRANSITIONS.get(iaf, {runway: []}))
    return sids, stars


# ---------------------------------------------------------------- traffic (estimate)

DOMESTIC = [
    ['vlg/short', 16], ['ibe/short', 6], ['ane', 6], ['voe/short', 6], ['aea/short', 3], ['ibs', 2],
    ['ec/fastGA', 1]
]
EUROPE = [
    ['vlg/short', 8], ['dlh/short', 4], ['ezy', 4], ['afr/short', 3], ['klm/short', 3], ['baw/short', 2],
    ['tap/short', 2], ['bel/short', 2], ['swr/short', 1], ['ein/short', 1], ['voe/short', 2], ['ryr', 2],
    ['ec/fastGA', 1]
]

ARRIVAL_FLOWS = {
    'DGO': (2.5, [11000, 14000], 280, DOMESTIC),
    'SSN': (2.0, [11000, 14000], 280, EUROPE),
    'PPN': (1.5, [11000, 14000], 280, DOMESTIC),
    'MAPAX': (1.0, [10000, 12000], 250, EUROPE),
    'DOSUL': (0.5, [10000, 12000], 250, EUROPE),
    'SNR': (0.5, [11000, 14000], 250, DOMESTIC),
}
DEPARTURE_FLOWS = {
    'AMTOS': (2.5, DOMESTIC), 'SSN': (1.5, EUROPE), 'PPN': (1.5, DOMESTIC), 'XIZCA': (1.0, EUROPE),
    'MAPAX': (0.5, EUROPE), 'DOSUL': (0.5, EUROPE), 'CALCE': (0.5, DOMESTIC),
}
CONFIG_RUNWAY = {'west': '30', 'east': '12'}


def pick(procedures, fix, runway):
    for name in sorted(procedures):
        if name.startswith(fix) and name[len(fix)].isdigit() and f'{ICAO}{runway}' in procedures[name]['rwy']:
            return name
    raise SystemExit(f'no procedure for {fix} {runway}')


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--aip', required=True)
    parser.add_argument('--tiles', default=os.path.join(ROOT, '.cache', 'terrarium'))
    args = parser.parse_args()

    book = FixBook()
    for name, point in significant_points(read_raw(args.aip, 'LE_ENR_4_4_en')).items():
        if distance_nm(ARP, point) < 120:
            book.add(name, point)
    for name, point in navaids_from_enr41(read_raw(args.aip, 'LE_ENR_4_1_en')).items():
        if distance_nm(ARP, point) < 120:
            book.add(name, point)
    for path in sorted(glob.glob(os.path.join(args.aip, 'LE_AD_2_LEBB_*_es.raw'))):
        with open(path, encoding='latin-1') as handle:
            for name, point in chart_waypoints(handle.read()).items():
                if not name.startswith('RW') and name != 'H24':
                    book.add(name, point)

    sids, stars = build_procedures(args.aip)
    # the STAR of each entry fix for each runway: the one whose transitions include that runway
    arrivals = {}
    for config, runway in CONFIG_RUNWAY.items():
        arrivals[config] = {}
        for fix in ARRIVAL_FLOWS:
            names = [n for n in sorted(stars) if n.startswith(fix) and n[len(fix)].isdigit()
                     and f'{ICAO}{runway}' in stars[n]['rwy']]
            if not names:
                raise SystemExit(f'no STAR for {fix} {runway}')
            arrivals[config][fix] = names[0]
    departures = {config: {fix: pick(sids, fix, runway) for fix in DEPARTURE_FLOWS}
                  for config, runway in CONFIG_RUNWAY.items()}
    patterns = spawn_patterns(ICAO, book, sids, arrivals, ARRIVAL_FLOWS, CONFIG_RUNWAY, departures,
                              DEPARTURE_FLOWS, CONFIG_RUNWAY, ARP)
    fixes = used_fixes(book, sids, stars, patterns, ICAO, ARP, nearby_nm=40)

    print('elevation tiles...', file=sys.stderr)
    grid, lats, lons = elevation_grid(42.7, -3.6, 43.8, -1.7, 10, args.tiles)

    airport = {
        'airac': AIRAC,
        'radio': {'twr': 'Bilbao Tower', 'app': 'Bilbao Approach', 'dep': 'Bilbao Departure'},
        'icao': ICAO,
        'iata': 'BIO',
        'magnetic_north': -1,
        'ctr_radius': 60,
        'ctr_ceiling': 14500,
        'initial_alt': 6000,
        'position': openscope_dms(*ARP) + [f'{ELEVATION_FT}ft'],
        'rangeRings': {'enabled': True, 'center': openscope_dms(*ARP), 'radius_nm': 5},
        'has_terrain': True,
        'wind': {'angle': 300, 'speed': 8},
        'arrivalRunway': '30',
        'departureRunway': '30',
        'runwayConfigurations': [
            {'name': 'west', 'arrivalRunway': '30', 'departureRunway': '30', 'runways': ['30']},
            {'name': 'east', 'arrivalRunway': '12', 'departureRunway': '12', 'runways': ['12']},
        ],
        'taxiTimes': {'30': 300, '12': 300},
        'arrivalSpawn': {'preSpawn': False, 'minimumIntervalSeconds': 180},
        'weather': {'climatology': {'fogPerHour': 0.05, 'thunderstormsPerHour': 0.06, 'temperature': 16}},
        'defaultMaps': ['Base Map'],
        'airspace': airspace(),
        'fixes': fixes,
        'runways': runways_json(RUNWAYS),
        'sids': sids,
        'stars': stars,
        'spawnPatterns': patterns,
        'maps': [{'name': 'Base Map', 'lines': map_lines(coast_rings(grid, lats, lons), RUNWAYS,
                                                       bbox=(lats.min(), lons.min(), lats.max(), lons.max()))}],
    }
    write_airport(ICAO, airport, terrain_geojson('lebb', grid, lats, lons,
                                                 levels_ft=tuple(range(1000, 9000, 1000))))


if __name__ == '__main__':
    main()
