"""
Builds assets/airports/lepa.json and assets/airports/terrain/lepa.geojson (Palma de Mallorca)
from the ENAIRE AIP (AIRAC AMDT 10/26, WEF 29-OCT-26).

Usage (from the repo root):
    python tools/aip/build_lepa.py --aip <folder with the PDFs converted by pdftotext -raw> [--tiles <cache>]

The folder must contain, as `<name>.raw` (pdftotext -raw):
    LE_AD_2_LEPA_LESJ_SID_<1..4>_en, LE_AD_2_LEPA_LESJ_STAR_<1..4>_en, LE_AD_2_LEPA_LESJ_IAC_<n>_en,
    LE_ENR_2_1_en, LE_ENR_4_4_en
See docs/aeropuertos/crear-aeropuerto.md for where to download them.

Data that is not in a table of the AIP is written here by hand, with its source:
- runways (AD 2.12), navaids (AD 2.19 / ENR 4.1), CTR (AD 2.17), preferential runways (AD 2.20.5.1)
- conventional SIDs and STARs (textual descriptions of SID 1-4 and STAR 1, 3): radial/DME points are
  computed from the navaid with its station declination and named `_<VOR><radial>D<dme>`
- traffic (airlines and rates): estimate for a summer day, not from the AIP
"""

import argparse
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from aiplib import Coastline, distance_nm, elevation_grid, openscope_dms, openscope_latlon  # noqa: E402
from airport_builder import ROOT  # noqa: E402
from airport_builder import (  # noqa: E402
    FixBook, build_sid as _build_sid, build_star as _build_star, c, coast_rings, fix_name, leg, legs_from_table,
    map_lines, runways_json, spawn_patterns as _spawn_patterns, terrain_geojson, used_fixes, write_airport
)
from enaire_airspace import parse_sectors, sector_polygon, vertical_extent  # noqa: E402
from enaire_charts import chart_waypoints, significant_points, tabular_procedures  # noqa: E402

ICAO = 'LEPA'
AIRAC = 2610
MAG_VAR = 1.4  # tabular descriptions: -1.4 (magnetic = true - 1.4)



ARP = c('393306N 0024420E')
ELEVATION_FT = 27

# AD 2.19 and ENR 4.1: position and station declination (radials are referenced to it)
NAVAIDS = {
    'JOA': (c('393352.9N 0024447.9E'), 1),
    'MJV': (c('392606.7N 0024529.9E'), 1),
    'CDP': (c('394151.7N 0032603.7E'), 2),
    'POS': (c('395538.8N 0030652.5E'), 1),
    'MHN': (c('395149.0N 0041258.7E'), 2),
    'ADX': (c('393258.0N 0022345.1E'), 1),
    'CST': (c('393829.0N 0025456.3E'), 1),
    'PTC': (c('392538.4N 0031524.2E'), 2),
    'IZA': (c('385455.7N 0012813.5E'), 1),
}

# AD 2.12: thresholds. 06R/24L: the 06R threshold is displaced 410 m, the runway starts at the 24L end
RUNWAYS = [
    {'name': ['06L', '24R'], 'end': [(c('393249.75N 0024238.65E'), 15), (c('393343.85N 0024433.03E'), 8)],
     'ils': [True, True], 'ilsCategory': ['I', 'I']},
    {'name': ['06R', '24L'], 'end': [(c('393228.51N 0024354.25E'), 25), (c('393319.24N 0024541.52E'), 8)],
     'ils': [False, True], 'ilsCategory': [None, 'IIIA']},
]

# AD 2.17
CTR = ('393207.0N 0022956.0E; 393335.0N 0023307.0E; 393433.0N 0023827.0E; 393359.0N 0023853.0E; '
       '393645.0N 0024450.0E; 393755.9N 0024355.9E; 394254.0N 0024626.4E; 394534.8N 0025212.0E; '
       '393119.1N 0030322.6E; 392002.1N 0023914.5E')

ARPS = {'LEMH': c('395145N 0041307E')}


# ---------------------------------------------------------------- procedures

def build_sid(name, runway, legs, exit_fix):
    return _build_sid(ICAO, name, runway, legs, exit_fix)


def build_star(name, legs, transitions):
    return _build_star(ICAO, name, legs, transitions)


# IAF -> runway -> legs to the IF (IAC 1, 6, 9, 14 tables)
TRANSITIONS = {
    'ADX': {'06L': [leg('PA407', 'A35+'), leg('PA09W', 'A20+|S210-')],
            '06R': [leg('PA407', 'A35+'), leg('PA10S', 'A20+|S210-')]},
    'MJV06': {'06L': [leg('PA406', 'S220-'), leg('PA09W', 'A20+|S210-')],
              '06R': [leg('PA500', 'S220-'), leg('PA10S', 'A20+|S210-')]},
    'CDP': {'24L': [leg('BAVUM', 'A45+'), leg('PA12E', 'A30+|S210-')],
            '24R': [leg('MUROS', 'A45+'), leg('PA12N', 'A30+|S210-')]},
    'POS': {'24L': [leg('BAVUM', 'A45+'), leg('PA12E', 'A30+|S210-')],
            '24R': [leg('MUROS', 'A45+'), leg('PA12N', 'A30+|S210-')]},
    'MJV24': {'24L': [leg('PA600', 'S220-'), leg('PA12E', 'A30+|S210-')],
              '24R': [leg('PA600', 'S220-'), leg('PA12N', 'A30+|S210-')]},
}


def build_procedures(book, tables):
    sids = {}
    stars = {}
    runway_start = {
        '06R': RUNWAYS[1]['end'][0][0],
        '24R': RUNWAYS[0]['end'][1][0],
    }

    # ---- RWY 06R (SID 2: conventional; SID 3: RNAV from PETAM)
    rwy06_true = 58.58
    p_south = book.computed('JOA', book.course_until_dme(runway_start['06R'], 73 + MAG_VAR, 'JOA', 2.5))
    joa090_12 = book.computed('JOA', book.radial_point('JOA', 90, 12.0))
    joa090_85 = book.computed('JOA', book.radial_point('JOA', 90, 8.5))
    arc_to_adrol = book.arc('MJV', 15.0, book.fixes[joa090_12], 'ADROL', clockwise=True)
    south = [leg(p_south, 'A6+'), leg(joa090_12, 'S210-')] + arc_to_adrol + ['ADROL']
    sids['BAVER6B'] = build_sid('BAVER6B', '06R', south + ['IZA', leg('BAVER', 'A100+')], 'BAVER')
    sids['MEBUT6B'] = build_sid('MEBUT6B', '06R', south + [leg('MEBUT', 'A100+')], 'MEBUT')
    sids['NELUX4B'] = build_sid('NELUX4B', '06R', south + ['NELUX'], 'NELUX')
    sids['OSGAL6B'] = build_sid('OSGAL6B', '06R', south + [leg('OSGAL', 'A100+')], 'OSGAL')
    sids['CDP2E'] = build_sid('CDP2E', '06R', [leg(p_south, 'A6+'), leg(joa090_85, 'S210-'), 'CDP'], 'CDP')

    p_8dme = book.computed('JOA', book.course_until_dme(runway_start['06R'], rwy06_true, 'JOA', 8.0))
    northeast = [leg(p_8dme, 'S210-'), 'TONIS']
    sids['TONIS5E'] = build_sid('TONIS5E', '06R', northeast, 'TONIS')
    sids['ISTER6B'] = build_sid('ISTER6B', '06R', northeast + ['MHN', 'ISTER'], 'ISTER')
    sids['MEROS9B'] = build_sid('MEROS9B', '06R', northeast + [leg('MEROS', 'A145+')], 'MEROS')
    sids['MORSS7E'] = build_sid('MORSS7E', '06R', northeast + ['MHN', leg('MORSS', 'A120+')], 'MORSS')

    arc_to_petam = book.arc('MJV', 15.0, book.fixes[p_8dme], 'PETAM', clockwise=False)
    initial_r = [leg(p_8dme, 'S210-')] + arc_to_petam
    for name in ('BAVER4T', 'DRAGO5R', 'EPAMA4R', 'ESPOR5R', 'GALAT5R'):
        legs = initial_r + legs_from_table(tables[name])
        sids[name] = build_sid(name, '06R', legs, fix_name(legs[-1]))

    # ---- RWY 24R (SID 4: "A" departures)
    bakax = leg('BAKAX', 'A20+|S210-')
    sids['BAVER5A'] = build_sid('BAVER5A', '24R', [bakax] + legs_from_table(tables['BAVER5A']), 'BAVER')
    sids['DRAGO5A'] = build_sid('DRAGO5A', '24R', [bakax, 'ADX', leg('DRAGO', 'A100+')], 'DRAGO')
    sids['EPAMA4A'] = build_sid('EPAMA4A', '24R', [bakax, leg('EPAMA', 'A100+')], 'EPAMA')
    sids['ESPOR5A'] = build_sid('ESPOR5A', '24R', [bakax, 'ADX', leg('ESPOR', 'A100+')], 'ESPOR')
    sids['GALAT5A'] = build_sid('GALAT5A', '24R', [bakax, 'ADX', leg('GALAT', 'A150+')], 'GALAT')
    sids['NELUX3A'] = build_sid('NELUX3A', '24R', [bakax, 'EDULI', 'NELUX'], 'NELUX')

    joa236_7 = book.computed('JOA', book.radial_point('JOA', 236, 7.0))
    joa_11 = book.computed('JOA', book.course_until_dme(book.fixes[joa236_7], 208 + MAG_VAR, 'JOA', 11.0))
    south_a = [leg(joa236_7, 'S210-'), joa_11, 'PITUX']
    via_ptc = south_a + [leg('XURAL', 'A50+'), 'PTC']
    sids['ISTER5A'] = build_sid('ISTER5A', '24R', via_ptc + ['MHN', 'ISTER'], 'ISTER')
    sids['MEBUT6A'] = build_sid('MEBUT6A', '24R', south_a + [leg('MEBUT', 'A100+')], 'MEBUT')
    sids['MEROS6A'] = build_sid('MEROS6A', '24R', via_ptc + ['MHN', leg('MEROS', 'A145+')], 'MEROS')
    sids['MORSS6A'] = build_sid('MORSS6A', '24R', via_ptc + ['MHN', leg('MORSS', 'A120+')], 'MORSS')
    sids['OSGAL6A'] = build_sid('OSGAL6A', '24R', south_a + ['XURAL', leg('OSGAL', 'A100+')], 'OSGAL')
    sids['PTC5A'] = build_sid('PTC5A', '24R', south_a + [leg('XURAL', 'A50+'), leg('PTC', 'A100+')], 'PTC')

    # ---- STARs RWY 06 (STAR 1 conventional, STAR 2 RNAV)
    cdp343_25 = book.computed('CDP', book.radial_point('CDP', 343, 25.0))
    cdp343_20 = book.computed('CDP', book.radial_point('CDP', 343, 20.0))
    adx = leg('ADX', 'A50+')
    mjv = leg('MJV', 'A30+')
    conventional_06 = {
        'KENAS4M': ['KENAS', cdp343_25, 'CDP', leg('NAKOP', 'A70+'), mjv],
        'LUNIK4M': ['LUNIK', cdp343_25, 'CDP', leg('NAKOP', 'A70+'), mjv],
        'RIXOT3M': ['RIXOT', 'CDP', leg('NAKOP', 'A70+'), mjv],
        'MAMEB2M': ['MAMEB', 'PTC', mjv],
        'MORSS5M': ['MORSS', 'MHN', 'MAMEB', 'PTC', mjv],
        'LORES4M': ['LORES', 'POSBA', 'NUDSA', 'XOTNU', 'TAKUS', leg('EVOLI', 'A70+'), adx],
        'TOLSO4M': ['TOLSO', 'INPUS', 'NEKUG', 'TAKUS', leg('EVOLI', 'A70+'), adx],
    }
    for name, legs in conventional_06.items():
        iaf = fix_name(legs[-1])
        stars[name] = build_star(name, legs, TRANSITIONS['ADX' if iaf == 'ADX' else 'MJV06'])
    for name in ('GODOX4M', 'LAMPA2M', 'LORES2R', 'MEBUT3M', 'OSGAL3M', 'RUXET2M', 'TOLSO2R'):
        legs = legs_from_table(tables[name])
        iaf = fix_name(legs[-1])
        stars[name] = build_star(name, legs, TRANSITIONS['ADX' if iaf == 'ADX' else 'MJV06'])

    # ---- STARs RWY 24 (STAR 3 conventional, STAR 4 RNAV)
    cdp = leg('CDP', 'A45+')
    pos = leg('POS', 'A70+')
    conventional_24 = {
        'KENAS3P': ['KENAS', cdp343_20, cdp],
        'LUNIK3P': ['LUNIK', cdp343_20, cdp],
        'RIXOT2P': ['RIXOT', cdp],
        'MAMEB2P': ['MAMEB', cdp],
        'MORSS3P': ['MORSS', 'MHN', cdp],
        'LORES1P': ['LORES', 'POSBA', pos],
        'TOLSO2P': ['TOLSO', 'LISAS', pos],
    }
    for name, legs in conventional_24.items():
        stars[name] = build_star(name, legs, TRANSITIONS[fix_name(legs[-1])])
    for name in ('GODOX4P', 'LAMPA2P', 'MEBUT3P', 'OSGAL3P', 'RUXET2P'):
        legs = legs_from_table(tables[name])
        iaf = fix_name(legs[-1])
        stars[name] = build_star(name, legs, TRANSITIONS['MJV24' if iaf == 'MJV' else iaf])

    return sids, stars


# ---------------------------------------------------------------- traffic (estimate, summer day)

EUROPE = [
    ['ryr', 20], ['ewg/short', 14], ['ezy', 10], ['exs', 10], ['tui/short', 8], ['cfg/short', 6], ['tom/short', 5],
    ['dlh/short', 4], ['baw/short', 3], ['edw/short', 2], ['swr/short', 2], ['ezs', 2], ['klm/short', 2],
    ['nax/short', 2], ['sas/short', 2], ['jaf/short', 2], ['tvs', 1], ['wzz', 1], ['vlg/short', 4],
    ['ec/fastGA', 1]
]
DOMESTIC = [
    ['vlg/short', 12], ['aea/short', 10], ['ryr', 10], ['ibs', 6], ['ane', 6], ['voe/short', 4], ['ezy', 2],
    ['ec/fastGA', 1]
]

# entry fix: (rate per hour, altitude range, speed, airlines)
ARRIVAL_FLOWS = {
    'LORES': (4.0, [15000, 19000], 280, EUROPE),
    'TOLSO': (3.0, [15000, 19000], 280, EUROPE),
    'KENAS': (1.5, [16000, 20000], 280, EUROPE),
    'LUNIK': (1.5, [16000, 20000], 280, EUROPE),
    'RIXOT': (1.0, [16000, 20000], 280, EUROPE),
    'MORSS': (0.5, [13000, 17000], 280, EUROPE),
    'MAMEB': (0.5, [12000, 15000], 250, DOMESTIC),
    'GODOX': (2.0, [13000, 17000], 280, DOMESTIC),
    'RUXET': (0.5, [19000, 23000], 280, DOMESTIC),
    'LAMPA': (0.5, [10000, 13000], 250, DOMESTIC),
    'MEBUT': (0.5, [11000, 14000], 250, DOMESTIC),
    'OSGAL': (0.5, [11000, 14000], 250, DOMESTIC),
}
ARRIVALS = {
    'west': {'LORES': 'LORES1P', 'TOLSO': 'TOLSO2P', 'KENAS': 'KENAS3P', 'LUNIK': 'LUNIK3P', 'RIXOT': 'RIXOT2P',
             'MORSS': 'MORSS3P', 'MAMEB': 'MAMEB2P', 'GODOX': 'GODOX4P', 'RUXET': 'RUXET2P', 'LAMPA': 'LAMPA2P',
             'MEBUT': 'MEBUT3P', 'OSGAL': 'OSGAL3P'},
    'east': {'LORES': 'LORES2R', 'TOLSO': 'TOLSO2R', 'KENAS': 'KENAS4M', 'LUNIK': 'LUNIK4M', 'RIXOT': 'RIXOT3M',
             'MORSS': 'MORSS5M', 'MAMEB': 'MAMEB2M', 'GODOX': 'GODOX4M', 'RUXET': 'RUXET2M', 'LAMPA': 'LAMPA2M',
             'MEBUT': 'MEBUT3M', 'OSGAL': 'OSGAL3M'},
}
ARRIVAL_RUNWAY = {'west': '24L', 'east': '06L'}

# exit fix: (rate per hour, airlines)
DEPARTURE_FLOWS = {
    'MEROS': (3.0, EUROPE), 'ESPOR': (3.0, EUROPE), 'GALAT': (2.0, EUROPE), 'ISTER': (2.0, EUROPE),
    'DRAGO': (2.0, EUROPE), 'EPAMA': (2.0, DOMESTIC), 'BAVER': (1.0, DOMESTIC), 'MORSS': (0.5, EUROPE),
    'MEBUT': (0.3, DOMESTIC), 'OSGAL': (0.3, DOMESTIC), 'NELUX': (0.3, DOMESTIC),
}
DEPARTURES = {
    'west': {'MEROS': 'MEROS6A', 'ESPOR': 'ESPOR5A', 'GALAT': 'GALAT5A', 'ISTER': 'ISTER5A', 'DRAGO': 'DRAGO5A',
             'EPAMA': 'EPAMA4A', 'BAVER': 'BAVER5A', 'MORSS': 'MORSS6A', 'MEBUT': 'MEBUT6A', 'OSGAL': 'OSGAL6A',
             'NELUX': 'NELUX3A'},
    'east': {'MEROS': 'MEROS9B', 'ESPOR': 'ESPOR5R', 'GALAT': 'GALAT5R', 'ISTER': 'ISTER6B', 'DRAGO': 'DRAGO5R',
             'EPAMA': 'EPAMA4R', 'BAVER': 'BAVER6B', 'MORSS': 'MORSS7E', 'MEBUT': 'MEBUT6B', 'OSGAL': 'OSGAL6B',
             'NELUX': 'NELUX4B'},
}
DEPARTURE_RUNWAY = {'west': '24R', 'east': '06R'}


def spawn_patterns(book, sids):
    return _spawn_patterns(ICAO, book, sids, ARRIVALS, ARRIVAL_FLOWS, ARRIVAL_RUNWAY, DEPARTURES,
                           DEPARTURE_FLOWS, DEPARTURE_RUNWAY, ARP)


# ---------------------------------------------------------------- geography

def airspace(book_raw_enr21, coasts):
    sectors = parse_sectors(book_raw_enr21, 'TPAM')
    if len(sectors) != 24:
        raise SystemExit(f'expected 24 TPAM sectors, found {len(sectors)}')
    out = []
    for name, sector in sectors.items():
        ring = sector_polygon(sector['items'], ARPS, coasts)
        floor, ceiling, airspace_class = vertical_extent(sector['bands'])
        out.append({'floor': floor // 100, 'ceiling': ceiling // 100, 'airspace_class': airspace_class,
                    'poly': [openscope_latlon(*p) for p in ring]})
    ctr = [c(item.strip()) for item in CTR.split(';')]
    out.append({'floor': 0, 'ceiling': 45, 'airspace_class': 'D', 'poly': [openscope_latlon(*p) for p in ctr]})
    return out


# ---------------------------------------------------------------- main

def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--aip', required=True, help='folder with the pdftotext -raw files')
    parser.add_argument('--tiles', default=os.path.join(ROOT, '.cache', 'terrarium'), help='tile cache folder')
    args = parser.parse_args()

    def read(name):
        with open(os.path.join(args.aip, name + '.raw'), encoding='latin-1') as handle:
            return handle.read()

    book = FixBook(NAVAIDS)
    for name, point in significant_points(read('LE_ENR_4_4_en')).items():
        if distance_nm(ARP, point) < 160:
            book.add(name, point)
    chart_files = sorted(glob.glob(os.path.join(args.aip, 'LE_AD_2_LEPA_LESJ_*_en.raw')))
    for path in chart_files:
        with open(path, encoding='latin-1') as handle:
            for name, point in chart_waypoints(handle.read()).items():
                if not name.startswith('RW') and name != 'H24':
                    book.add(name, point)
    for name, (point, _) in NAVAIDS.items():
        book.add(name, point)

    tables = {}
    for part in ('SID_3', 'SID_4', 'STAR_2', 'STAR_4'):
        tables.update(tabular_procedures(read(f'LE_AD_2_LEPA_LESJ_{part}_en')))

    sids, stars = build_procedures(book, tables)
    patterns = spawn_patterns(book, sids)

    print('elevation tiles...', file=sys.stderr)
    grid, lats, lons = elevation_grid(38.3, 0.6, 40.6, 4.8, 10, args.tiles)
    coasts = {
        'Mallorca': Coastline.around((39.6, 2.9), grid, lats, lons),
        'Ibiza': Coastline.around((38.98, 1.43), grid, lats, lons),
    }

    fixes = used_fixes(book, sids, stars, patterns, ICAO, ARP)

    airport = {
        'airac': AIRAC,
        'radio': {'twr': 'Palma Tower', 'app': 'Palma Approach', 'dep': 'Palma Departure'},
        'icao': ICAO,
        'iata': 'PMI',
        'magnetic_north': 1,
        'ctr_radius': 110,
        'ctr_ceiling': 24500,
        'initial_alt': 6000,
        'position': openscope_dms(*ARP) + [f'{ELEVATION_FT}ft'],
        'rangeRings': {'enabled': True, 'center': openscope_dms(*ARP), 'radius_nm': 5},
        'has_terrain': True,
        'wind': {'angle': 240, 'speed': 8},
        'arrivalRunway': '24L',
        'departureRunway': '24R',
        'runwayConfigurations': [
            {'name': 'west', 'arrivalRunway': '24L', 'departureRunway': '24R', 'runways': ['24L', '24R']},
            {'name': 'east', 'arrivalRunway': '06L', 'departureRunway': '06R', 'runways': ['06L', '06R']},
        ],
        'taxiTimes': {'24R': 300, '24L': 360, '06R': 360, '06L': 300},
        'arrivalSpawn': {'preSpawn': False, 'minimumIntervalSeconds': 120},
        'weather': {'climatology': {'fogPerHour': 0.02, 'thunderstormsPerHour': 0.08, 'temperature': 24}},
        'defaultMaps': ['Base Map'],
        'airspace': airspace(read('LE_ENR_2_1_en'), coasts),
        'fixes': fixes,
        'runways': runways_json(RUNWAYS),
        'sids': sids,
        'stars': stars,
        'spawnPatterns': patterns,
        'maps': [{'name': 'Base Map', 'lines': map_lines(coast_rings(grid, lats, lons), RUNWAYS)}],
    }

    write_airport(ICAO, airport, terrain_geojson('lepa', grid, lats, lons, levels_ft=(1000, 2000, 3000, 4000)))

if __name__ == '__main__':
    main()
