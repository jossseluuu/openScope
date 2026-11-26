"""
Builds assets/airports/lebl.json and assets/airports/terrain/lebl.geojson (Barcelona-El Prat)
from the ENAIRE AIP (AD 2-LEBL AIRAC AMDT 09/26; charts of several AMDTs, see the AIRAC of each chart).

Usage (from the repo root):
    python tools/aip/build_lebl.py --aip <folder with the pdftotext -raw files> [--tiles <cache>]

The folder must contain LE_AD_2_LEBL_{SID_5,SID_9,STAR_2,STAR_3,TRAN_2..TRAN_5}_en.raw (and the other
LEBL charts for their WPT COORD tables), LE_ENR_2_1_en.raw, LE_ENR_4_1_en.raw and LE_ENR_4_4_en.raw.
See docs/aeropuertos/crear-aeropuerto.md.

Every SID, STAR and approach transition of LEBL is RNAV1 with a tabular description, so all of
them are read from the charts. Written by hand, with their source:
- runways and ILS (AD 2.12, AD 2.19), preferential configurations (AD 2.20.4), CTR (AD 2.17)
- TMA BARCELONA (ENR 2.1). Its floor is "MAX ALT VFR SECTOR", which is only drawn on the VAC chart:
  approximated as 3500 ft (TMA) and 2500 ft (Area 1). The Spanish-French border is approximated.
- traffic (airlines and rates): estimate, not from the AIP
"""

import argparse
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from aiplib import bearing_deg, destination, distance_nm, elevation_grid, openscope_dms  # noqa: E402
from airport_builder import (  # noqa: E402
    ROOT, FixBook, build_sid, build_star, c, coast_rings, fix_name, legs_from_table, map_lines,
    navaids_from_enr41, polygon, read_raw, runways_json, spawn_patterns, terrain_geojson, used_fixes,
    write_airport
)
from enaire_charts import chart_waypoints, significant_points, tabular_procedures  # noqa: E402

ICAO = 'LEBL'
AIRAC = 2609
ARP = c('411749N 0020442E')
ELEVATION_FT = 14

# AD 2.12 thresholds, AD 2.19 ILS categories
RUNWAYS = [
    {'name': ['02', '20'], 'end': [(c('411715.93N 0020505.38E'), 7), (c('411833.46N 0020540.75E'), 12)],
     'ils': [True, False], 'ilsCategory': ['I', None]},
    {'name': ['06L', '24R'], 'end': [(c('411741.44N 0020419.00E'), 8), (c('411820.61N 0020613.40E'), 10)],
     'ils': [True, True], 'ilsCategory': ['IIIA', 'IIIA']},
    {'name': ['06R', '24L'], 'end': [(c('411656.32N 0020427.63E'), 8), (c('411731.99N 0020611.78E'), 8)],
     'ils': [True, True], 'ilsCategory': ['IIIA', 'IIIA']},
]

# ---------------------------------------------------------------- airspace

# AD 2.17: two half circles of 12 NM around TEBLA and ASTEK joined by their common tangents
TEBLA = c('412252N 0021930E')
ASTEK = c('411232N 0014919E')

# ENR 2.1 TMA BARCELONA, clockwise from the coast at the French border
TMA = ('422600N 0031000E, 420132N 0032339E, 415633N 0032321E, 410645N 0032026E, 404026N 0025749E, '
       '404013N 0025505E, 403811N 0022913E, 403602N 0020312E, 403404N 0014024E, 403222N 0012123E, '
       '404431N 0004310E, 405225N 0004059E, 411512N 0003437E, 411859N 0003334E, 413618N 0002842E, '
       '414040N 0002445E, 414859N 0001922E, 415338N 0001642E, 415908N 0002443E, 420418N 0003209E, '
       '425101N 0004500E')
# Spanish-French border from 425101N 0004500E to 422600N 0031000E (approximate, west to east)
BORDER = [(42.78, 0.99), (42.70, 1.10), (42.62, 1.44), (42.50, 1.72), (42.45, 1.98), (42.36, 2.24),
          (42.43, 2.52), (42.47, 2.72), (42.43, 2.90)]
AREA1_CENTER = c('411743N 0020507E')
TMA_FLOOR_FT = 3500     # "MAX ALT VFR SECTOR" (VAC chart), approximated
AREA1_FLOOR_FT = 2500   # idem


def circle(center, radius, start=0, end=360, step=10):
    return [destination(center, bearing % 360, radius) for bearing in range(start, end, step)]


def stadium(a, b, radius):
    axis = bearing_deg(b, a)  # from b towards a
    around_a = [destination(a, (axis + angle) % 360, radius) for angle in range(-90, 91, 10)]
    around_b = [destination(b, (axis + 180 + angle) % 360, radius) for angle in range(-90, 91, 10)]
    return around_a + around_b


def airspace():
    tma = [c(item.strip()) for item in TMA.split(',')] + BORDER
    return [
        polygon(tma, TMA_FLOOR_FT, 24500, 'D'),
        polygon(circle(AREA1_CENTER, 24), AREA1_FLOOR_FT, 19500, 'A'),
        polygon(stadium(TEBLA, ASTEK, 12), 0, 7500, 'D'),
    ]


# ---------------------------------------------------------------- procedures

SID_CHARTS = {'24L': 'SID_9', '06R': 'SID_5'}
STAR_CHARTS = {'west': ('STAR_3', 'W'), 'east': ('STAR_2', 'E')}
# approach transitions (trombones) to each runway, by IAF
TRANSITION_CHARTS = {'24R': 'TRAN_5', '24L': 'TRAN_4', '06L': 'TRAN_2', '06R': 'TRAN_3'}
CONFIG_RUNWAYS = {'west': ('24R', '24L'), 'east': ('06L', '06R')}


def build_procedures(folder):
    sids = {}
    for runway, chart in SID_CHARTS.items():
        for name, table_legs in tabular_procedures(read_raw(folder, f'LE_AD_2_LEBL_{chart}_en')).items():
            legs = legs_from_table(table_legs)
            if legs:
                sids[name] = build_sid(ICAO, name, runway, legs, fix_name(legs[-1]))

    transitions = {}  # IAF -> runway -> legs
    for runway, chart in TRANSITION_CHARTS.items():
        for name, table_legs in tabular_procedures(read_raw(folder, f'LE_AD_2_LEBL_{chart}_en')).items():
            legs = legs_from_table(table_legs)
            transitions.setdefault(fix_name(legs[0]), {})[runway] = legs[1:]

    stars = {}
    for config, (chart, letter) in STAR_CHARTS.items():
        for name, table_legs in tabular_procedures(read_raw(folder, f'LE_AD_2_LEBL_{chart}_en')).items():
            legs = legs_from_table(table_legs)
            iaf = fix_name(legs[-1])
            runway_legs = {runway: transitions.get(iaf, {}).get(runway, []) for runway in CONFIG_RUNWAYS[config]}
            stars[name] = build_star(ICAO, name, legs, runway_legs)
    return sids, stars


# ---------------------------------------------------------------- traffic (estimate)

NORTH = [
    ['vlg/short', 14], ['ryr', 12], ['ezy', 8], ['baw/short', 4], ['dlh/short', 3], ['afr/short', 3],
    ['klm/short', 3], ['ewg/short', 3], ['wzz', 3], ['swr/short', 2], ['tra/short', 2], ['tvf/short', 2],
    ['sas/short', 2], ['nax/short', 2], ['ein/short', 2], ['eju', 2], ['fin/short', 1], ['lot/short', 1],
    ['aua/short', 1], ['bel/short', 1], ['ezs', 1], ['exs', 1], ['aal/long', 1], ['dal/long', 1],
    ['ual/long', 1], ['ec/fastGA', 1]
]
EAST = [
    ['vlg/short', 10], ['ryr', 8], ['wzz', 4], ['thy/short', 3], ['ezy', 2], ['aee', 2], ['uae', 1],
    ['qtr/long', 1], ['ely/long', 1]
]
SOUTH_WEST = [
    ['vlg/short', 14], ['ibe/short', 6], ['ryr', 6], ['aea/short', 4], ['ane', 4], ['voe/short', 3],
    ['ibs', 3], ['tap/short', 2], ['ram/short', 2], ['aea/long', 1], ['ibe/long', 1], ['ec/fastGA', 1]
]

ARRIVAL_FLOWS = {
    'PUMAL': (3.5, [15000, 19000], 280, NORTH),
    'ALBER': (3.0, [17000, 21000], 280, NORTH),
    'BISBA': (3.0, [17000, 21000], 280, NORTH),
    'GRAUS': (1.5, [17000, 21000], 280, NORTH),
    'VERSO': (2.0, [16000, 20000], 280, EAST),
    'OSTUR': (1.5, [11000, 15000], 250, EAST),
    'NEPAL': (1.0, [11000, 15000], 250, SOUTH_WEST),
    'MARTA': (2.5, [15000, 19000], 280, SOUTH_WEST),
    'MATEX': (2.5, [17000, 21000], 280, SOUTH_WEST),
    'CASPE': (2.0, [17000, 21000], 280, SOUTH_WEST),
    'LOBAR': (1.0, [17000, 21000], 280, SOUTH_WEST),
}
DEPARTURE_FLOWS = {
    'AGENA': (2.5, EAST), 'DALIN': (2.0, NORTH), 'DIPES': (1.5, EAST), 'DUNES': (1.5, EAST),
    'LARPA': (1.5, SOUTH_WEST), 'LOTOS': (2.5, SOUTH_WEST), 'SENIA': (2.5, SOUTH_WEST), 'LOBAR': (1.0, SOUTH_WEST),
    'GRAUS': (1.0, NORTH), 'MOPAS': (2.0, NORTH), 'NATPI': (2.5, NORTH), 'OLOXO': (2.5, NORTH),
}
ARRIVAL_RUNWAY = {'west': '24R', 'east': '06L'}
DEPARTURE_RUNWAY = {'west': '24L', 'east': '06R'}


def pick(procedures, fix, suffix_runway, kind):
    """The procedure of `kind` ('sid' or 'star') for this fix and runway or STAR letter."""
    for name, procedure in sorted(procedures.items()):
        if not name.startswith(fix):
            continue
        if kind == 'sid' and f'{ICAO}{suffix_runway}' in procedure['rwy']:
            return name
        if kind == 'star' and name.endswith(suffix_runway):
            return name
    raise SystemExit(f'no {kind} for {fix} {suffix_runway}')


# ---------------------------------------------------------------- main

def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--aip', required=True)
    parser.add_argument('--tiles', default=os.path.join(ROOT, '.cache', 'terrarium'))
    args = parser.parse_args()

    navaids = navaids_from_enr41(read_raw(args.aip, 'LE_ENR_4_1_en'))
    book = FixBook()
    for name, point in significant_points(read_raw(args.aip, 'LE_ENR_4_4_en')).items():
        if distance_nm(ARP, point) < 150:
            book.add(name, point)
    for name, point in navaids.items():
        if distance_nm(ARP, point) < 150:
            book.add(name, point)
    for path in sorted(glob.glob(os.path.join(args.aip, 'LE_AD_2_LEBL_*_en.raw'))):
        with open(path, encoding='latin-1') as handle:
            for name, point in chart_waypoints(handle.read()).items():
                if not name.startswith('RW') and name != 'H24':
                    book.add(name, point)

    sids, stars = build_procedures(args.aip)
    arrivals = {config: {fix: pick(stars, fix, STAR_CHARTS[config][1], 'star') for fix in ARRIVAL_FLOWS}
                for config in STAR_CHARTS}
    departures = {config: {fix: pick(sids, fix, DEPARTURE_RUNWAY[config], 'sid') for fix in DEPARTURE_FLOWS}
                  for config in DEPARTURE_RUNWAY}
    patterns = spawn_patterns(ICAO, book, sids, arrivals, ARRIVAL_FLOWS, ARRIVAL_RUNWAY, departures,
                              DEPARTURE_FLOWS, DEPARTURE_RUNWAY, ARP)
    fixes = used_fixes(book, sids, stars, patterns, ICAO, ARP)

    print('elevation tiles...', file=sys.stderr)
    grid, lats, lons = elevation_grid(40.4, 0.2, 43.0, 3.5, 10, args.tiles)

    airport = {
        'airac': AIRAC,
        'radio': {'twr': 'Barcelona Tower', 'app': 'Barcelona Approach', 'dep': 'Barcelona Departure'},
        'icao': ICAO,
        'iata': 'BCN',
        'magnetic_north': 1,
        'ctr_radius': 100,
        'ctr_ceiling': 24500,
        'initial_alt': 6000,
        'position': openscope_dms(*ARP) + [f'{ELEVATION_FT}ft'],
        'rangeRings': {'enabled': True, 'center': openscope_dms(*ARP), 'radius_nm': 5},
        'has_terrain': True,
        'wind': {'angle': 230, 'speed': 8},
        'arrivalRunway': '24R',
        'departureRunway': '24L',
        'runwayConfigurations': [
            {'name': 'west', 'arrivalRunway': '24R', 'departureRunway': '24L', 'runways': ['24R', '24L']},
            {'name': 'east', 'arrivalRunway': '06L', 'departureRunway': '06R', 'runways': ['06L', '06R']},
        ],
        'taxiTimes': {'24L': 360, '24R': 480, '06R': 300, '06L': 480},
        'arrivalSpawn': {'preSpawn': False, 'minimumIntervalSeconds': 90},
        'weather': {'climatology': {'fogPerHour': 0.03, 'thunderstormsPerHour': 0.1, 'temperature': 20}},
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
    write_airport(ICAO, airport, terrain_geojson('lebl', grid, lats, lons,
                                                 levels_ft=tuple(range(1000, 11000, 1000))))


if __name__ == '__main__':
    main()
