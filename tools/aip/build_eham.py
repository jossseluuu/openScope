"""
Builds assets/airports/eham.json and assets/airports/terrain/eham.geojson (Amsterdam-Schiphol)
from the Dutch eAIP (LVNL), AIRAC AMDT 11-2026 (29 OCT 2026).

Usage (from the repo root):
    python tools/aip/build_eham.py --aip <folder> [--tiles <cache>]

The folder must contain, from https://eaip.lvnl.nl/AIRAC AMDT 11-2026_2026_10_29/eAIP/ (the server
refuses requests without a browser User-Agent):
- EH-AD 2 EHAM 1-en-GB.html saved as ad2_1.html (AD 2 with the SID coding tables in AD 2.22 and the
  STAR "abbreviated descriptions")
- EH-ENR 2.1 / 4.1 / 4.4-en-GB.html saved as ENR-2.1.html, ENR-4.1.html, ENR-4.4.html
- the chart PDFs (EHAM-SID-*.pdf, EHAM-STAR.pdf, EHAM-TRAN-*.pdf, EHAM-IAC-*.pdf), whose waypoint
  coordinate tables are read with `pdftotext -layout`
See docs/aeropuertos/crear-aeropuerto.md.

Written by hand, with their source:
- runway combinations: Schiphol selects them from a preferential runway system without a fixed table
  (AD 2.21 4.3); two common combinations are used: south (land 18R/18C, take off 24/18L) and north
  (land 36R/06, take off 36L/36C). Landing runway by IAF as in AD 2.22 2.4.2 (ARTIP east, SUGOL and
  RIVER west).
- an upper layer FL095-FL195 over SCHIPHOL TMA 1 stands for the Amsterdam ACC sectors, so arrivals
  appear inside the airspace (the TMA ends at FL095).
- traffic (airlines and rates): estimate, not from the AIP
"""

import argparse
import glob
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from aiplib import COORD_PAIR_RE, arc_points, bearing_deg, distance_nm, elevation_grid, openscope_dms, parse_coord_pair  # noqa: E402
from airport_builder import (  # noqa: E402
    ROOT, FixBook, build_sid, build_star, coast_rings, fix_name, leg, map_lines, polygon, runways_json,
    spawn_patterns, terrain_geojson, used_fixes, write_airport
)
from sia_charts import html_text  # noqa: E402

ICAO = 'EHAM'
AIRAC = 2611


def point(text):
    return parse_coord_pair(COORD_PAIR_RE.search(text))


ARP = point('521829N 0044551E')
ELEVATION_FT = -11


def runways(ad2):
    """AD 2.12: pairs of runway ends with THR coordinates and elevation."""
    section = ad2[ad2.find('EHAM AD 2.12'):ad2.find('EHAM AD 2.13')]
    ends = {}
    for match in re.finditer(r'\b(\d{2}[LCR]?) \d{3}\.\d+\S* \d+ x \d+ .*?THR: (\S+ \S+) RWY end.*?THR: (-?[\d.]+) FT',
                             section):
        ends[match.group(1)] = (point(match.group(2)), round(float(match.group(3))))
    pairs = [('04', '22'), ('06', '24'), ('09', '27'), ('18C', '36C'), ('18L', '36R'), ('18R', '36L')]
    ils = {'04': (False, None), '22': (True, 'I'), '06': (True, 'IIIA'), '24': (True, 'I'), '09': (False, None),
           '27': (True, 'IIIA'), '18C': (True, 'IIIA'), '36C': (True, 'IIIA'), '18L': (False, None),
           '36R': (True, 'IIIA'), '18R': (True, 'IIIA'), '36L': (False, None)}
    return [{'name': [a, b], 'end': [ends[a], ends[b]], 'ils': [ils[a][0], ils[b][0]],
             'ilsCategory': [ils[a][1], ils[b][1]]} for a, b in pairs]


def lateral(text):
    """Points and 'along clockwise arc (radius 8 NM, centre 521829N 0044551E)' of an LVNL limit."""
    ring = []
    arc = None
    for token in re.split(r' - ', text):
        arc_match = re.search(r'along (clockwise|anti-clockwise|counter-clockwise) arc \(radius ([\d.]+) NM, centre (\S+ \S+)\)',
                              token)
        coordinate = COORD_PAIR_RE.search(token)
        if coordinate and (not arc_match or coordinate.start() < arc_match.start()):
            value = parse_coord_pair(coordinate)
            if arc and ring:
                ring.extend(arc_points(arc[2], arc[1], ring[-1], value, arc[0]))
            arc = None
            ring.append(value)
        if arc_match:
            arc = (arc_match.group(1) == 'clockwise', float(arc_match.group(2)), point(arc_match.group(3)))
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring.pop()
    return ring


def limit_ft(text):
    text = text.replace(' ', '').upper()
    if text in ('GND', 'SFC'):
        return 0
    if text.startswith('FL'):
        return int(text[2:]) * 100
    return int(re.match(r'\d+', text).group())


def airspace(enr21, ad2):
    out = []
    tma1 = None
    for match in re.finditer(r'SCHIPHOL TMA (\d) \(EHAM\d\) (.*?)\. (FL \d+|\d+ FT AMSL) (FL \d+|\d+ FT AMSL) Airspace class: ([A-G])',
                             enr21):
        ring = lateral(match.group(2))
        out.append(polygon(ring, limit_ft(match.group(4)), limit_ft(match.group(3)), match.group(5)))
        if match.group(1) == '1':
            tma1 = ring
    out.append(polygon(tma1, 9500, 19500, 'A'))
    ctr = re.search(r'SCHIPHOL CTR \(EHAM\) (.*?)\. 3000 FT AMSL GND', ad2)
    out.append(polygon(lateral(ctr.group(1)), 0, 3000, 'C'))
    return out


# ---------------------------------------------------------------- procedures

_PT = 'IF|TF|CF|DF|CA|VA|FA|FM|VM|RF|VI|CI|HM|HA|HF'


def sid_tables(ad2):
    """{name: [(path terminator, fix, restriction)]} from the AD 2.22 SID coding tables."""
    out = {}
    blocks = re.split(r'\b([A-Z]{2,5}) (\d[A-Z]) \[[A-Z0-9]{4,7}\]', ad2)
    runway = None
    previous = blocks[0]
    for name, suffix, body in zip(blocks[1::3], blocks[2::3], blocks[3::3]):
        # each group of SIDs starts after a heading such as "RWY 24 west RF."
        heading = re.search(r'RWY (\d{2}[LCR]?)((?: (?:east|west|supplementary|RF))*)\.\s*$', previous)
        previous = body
        if heading:
            runway = (heading.group(1), 'supplementary' in heading.group(2))
        if 'Serial number' not in body[:600]:
            continue
        starts = [m.start() for m in re.finditer(rf'\b\d{{3}} (?:{_PT}) ', body)]
        legs = []
        for begin, end in zip(starts, starts[1:] + [None]):
            row = body[begin:end]
            row = re.sub(r'\s(RNAV ?1|RNP ?1|RNP APCH)\b.*$', '', row)
            tokens = row.split()
            if len(tokens) < 4:
                continue
            path_terminator, fix = tokens[1], tokens[2]
            rest = tokens[4:]
            if rest and rest[0] == '-':
                rest = rest[1:]
            else:
                rest = rest[4:]  # course "236 / (238.4)"
            # rest: navaid, distance, turn, altitude (1-3 tokens), speed, VPA
            if len(rest) < 6:
                legs.append((path_terminator, fix, None))
                continue
            altitude_tokens = rest[3:-2]
            speed = rest[-2]
            legs.append((path_terminator, fix, _restriction(altitude_tokens, speed)))
        if legs and runway:
            out[name + suffix] = (legs, runway[0], runway[1])
    return out


def _restriction(altitude_tokens, speed):
    parts = []
    text = ' '.join(altitude_tokens)
    match = re.match(r'^([+\-@])\s*(FL\s*)?(\d+)$', text)
    if match:
        sign, is_level, value = match.groups()
        hundreds = int(value) if is_level else round(int(value) / 100)
        parts.append(f"A{hundreds}{'' if sign == '@' else sign}")
    if speed.isdigit():
        parts.append(f'S{speed}-')
    return '|'.join(parts) or None


def star_tables(ad2):
    """{name: [(fix, restriction)]} from the STAR abbreviated descriptions ("NORKU [B F280 F200] IF N To ...")."""
    out = {}
    for match in re.finditer(r'\b([A-Z]{2,5}) (\d[A-Z]) RNAV 1 required\. ARINC designator.*?\[[A-Z0-9]{4,7}\] (.*?)(?=\b[A-Z]{2,5} \d[A-Z] RNAV 1 required|\d+(?:\.\d+)+ [A-Z])',
                             ad2):
        legs = []
        for item in re.finditer(r'\b([A-Z0-9]{2,5})(?: \[([^\]]+)\])? (IF|TF|DF|CF) [YN]\b', match.group(3)):
            legs.append((item.group(1), _star_restriction(item.group(2) or '')))
        if legs:
            out[match.group(1) + match.group(2)] = legs
    return out


def _star_restriction(text):
    parts = []
    for item in [p.strip() for p in text.split(',')]:
        between = re.match(r'B F(\d+) F(\d+)', item)
        if between:
            parts += [f'A{int(between.group(2))}+', f'A{int(between.group(1))}-']
            continue
        speed = re.match(r'K(\d+)([+-]?)', item)
        if speed:
            parts.append(f'S{speed.group(1)}{speed.group(2) or "-"}')
            continue
        level = re.match(r'F(\d+)([+-]?)', item)
        if level:
            parts.append(f'A{int(level.group(1))}{level.group(2)}')
            continue
        feet = re.match(r'(\d+)([+-]?)$', item)
        if feet:
            parts.append(f'A{round(int(feet.group(1)) / 100)}{feet.group(2)}')
    return '|'.join(parts) or None


# ---------------------------------------------------------------- traffic (estimate)

KLM = [['klm/short', 30], ['klm/embraers', 10], ['tra/short', 8], ['ezy', 6], ['baw/short', 3], ['dlh/short', 3],
       ['afr/short', 3], ['sas/short', 2], ['ibe/short', 2], ['vlg/short', 3], ['swr/short', 2], ['tap/short', 2],
       ['fin/short', 1], ['lot/short', 1], ['aua/short', 1], ['thy/short', 2], ['ein/short', 2], ['nax/short', 1]]
LONG = [['klm/long', 20], ['dal/long', 4], ['ual/long', 2], ['uae', 2], ['qtr/long', 2], ['sia/long', 1],
        ['cca/long', 1], ['ram/short', 2]]


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--aip', required=True)
    parser.add_argument('--tiles', default=os.path.join(ROOT, '.cache', 'terrarium'))
    args = parser.parse_args()

    ad2 = html_text(os.path.join(args.aip, 'ad2_1.html'))
    enr21 = html_text(os.path.join(args.aip, 'ENR-2.1.html'))
    rwys = runways(ad2)

    book = FixBook()
    pair = r'(\d{6}(?:\.\d+)?[NS]) (\d{7}(?:\.\d+)?[EW])'
    for match in re.finditer(r'\b([A-Z]{5}) ' + pair, html_text(os.path.join(args.aip, 'ENR-4.4.html'))):
        p = point(match.group(2) + ' ' + match.group(3))
        if distance_nm(ARP, p) < 200:
            book.add(match.group(1), p)
    for match in re.finditer(r'\b([A-Z]{2,3}) \d{3}\.\d+ (?:MHz|kHz)(?: \(\w+\))? H24 ' + pair,
                             html_text(os.path.join(args.aip, 'ENR-4.1.html'))):
        book.add(match.group(1), point(match.group(2) + ' ' + match.group(3)))
    for path in sorted(glob.glob(os.path.join(args.aip, 'EHAM-*.pdf'))):
        text = subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True,
                              encoding='latin-1').stdout
        for match in re.finditer(r'\b([A-Z0-9]{5})\s+' + pair, text):
            book.fixes.setdefault(match.group(1), point(match.group(2) + ' ' + match.group(3)))

    sids = {}
    sid_runway = {}
    supplementary = set()
    for name, (legs, runway, is_supplementary) in sid_tables(ad2).items():
        items = [leg(fix, r) for pt, fix, r in legs if pt in ('IF', 'TF', 'CF', 'DF', 'RF') and fix != '-']
        items = [i for n, i in enumerate(items) if n == 0 or fix_name(i) != fix_name(items[n - 1])]
        if not items or any(fix_name(i) not in book.fixes for i in items):
            print(f'skip SID {name}: unknown fix', file=sys.stderr)
            continue
        if is_supplementary:
            supplementary.add(name)
        sid_runway[name] = runway
        sids[name] = build_sid(ICAO, name, runway, items, fix_name(items[-1]))

    stars = {}
    landing = {'south': {'ARTIP': '18C', 'SUGOL': '18R', 'RIVER': '18R'},
               'north': {'ARTIP': '06', 'SUGOL': '36R', 'RIVER': '36R'}}
    for name, legs in star_tables(ad2).items():
        items = [leg(fix, r) for fix, r in legs]
        if any(fix_name(i) not in book.fixes for i in items):
            print(f'skip STAR {name}: unknown fix', file=sys.stderr)
            continue
        iaf = fix_name(items[-1])
        runways_for_iaf = sorted({cfg[iaf] for cfg in landing.values() if iaf in cfg}) or ['18R']
        stars[name] = build_star(ICAO, name, items, {runway: [] for runway in runways_for_iaf})

    arrivals, arrival_flows, arrival_runway = {}, {}, {}
    for config in ('south', 'north'):
        arrivals[config] = {}
        for name, star in sorted(stars.items()):
            entry = re.match(r'[A-Z]+', name).group()
            iaf = star['draw'][0][-1]
            if iaf not in landing[config] or len(name) != len(entry) + 2:
                continue
            key = f'{entry}/{config}'
            arrivals[config][key] = name
            arrival_runway[key] = landing[config][iaf]
            arrival_flows[key] = (2.0, [12000, 17000], 280, LONG if entry in ('NORKU', 'TOPPA', 'REDFA') else KLM)

    departure_runways = {'south': ('24', '18L'), 'north': ('36L', '36C')}
    departures, departure_flows, departure_runway = {}, {}, {}
    for config, allowed in departure_runways.items():
        departures[config] = {}
        options = {}  # exit fix -> {runway: SID}
        for name in sorted(sids):
            if sid_runway[name] in allowed and name not in supplementary:
                exit_fix = re.match(r'[A-Z]+', name).group()
                options.setdefault(exit_fix, {}).setdefault(sid_runway[name], name)
        for exit_fix, by_runway in options.items():
            # west and south exits from the first runway of the pair, the rest from the second
            west = 180 <= bearing_deg(ARP, book.fixes[exit_fix]) < 360
            preferred = allowed[0] if west else allowed[1]
            runway = preferred if preferred in by_runway else next(iter(by_runway))
            key = f'{exit_fix}/{config}'
            departures[config][key] = by_runway[runway]
            departure_runway[key] = runway
            departure_flows[key] = (2.0, KLM + LONG[:2])

    patterns = []
    for config in ('south', 'north'):
        for key, star in arrivals[config].items():
            fix = key.split('/')[0]
            patterns += spawn_patterns(ICAO, book, sids, {config: {fix: star}}, {fix: arrival_flows[key]},
                                       {config: arrival_runway[key]}, {}, {}, {}, ARP)
        for key, sid in departures[config].items():
            fix = key.split('/')[0]
            patterns += spawn_patterns(ICAO, book, sids, {}, {}, {}, {config: {fix: sid}},
                                       {fix: departure_flows[key]}, {config: departure_runway[key]}, ARP)
    fixes = used_fixes(book, sids, stars, patterns, ICAO, ARP, nearby_nm=30)

    print('elevation tiles...', file=sys.stderr)
    grid, lats, lons = elevation_grid(51.7, 3.4, 53.3, 6.2, 10, args.tiles)
    airport = {
        'airac': AIRAC,
        'radio': {'twr': 'Schiphol Tower', 'app': 'Schiphol Approach', 'dep': 'Schiphol Departure'},
        'icao': ICAO,
        'iata': 'AMS',
        'magnetic_north': 2,
        'ctr_radius': 70,
        'ctr_ceiling': 19500,
        'initial_alt': 6000,
        'position': openscope_dms(*ARP) + [f'{ELEVATION_FT}ft'],
        'rangeRings': {'enabled': True, 'center': openscope_dms(*ARP), 'radius_nm': 5},
        'has_terrain': False,
        'wind': {'angle': 220, 'speed': 10},
        'arrivalRunway': '18R',
        'departureRunway': '24',
        'runwayConfigurations': [
            {'name': 'south', 'arrivalRunway': '18R', 'departureRunway': '24', 'runways': ['18R', '18C', '24', '18L']},
            {'name': 'north', 'arrivalRunway': '36R', 'departureRunway': '36L', 'runways': ['36R', '06', '36L', '36C']},
        ],
        'taxiTimes': {'24': 420, '18L': 360, '36L': 900, '36C': 480, '18R': 900, '18C': 480, '36R': 360, '06': 420},
        'arrivalSpawn': {'preSpawn': False, 'minimumIntervalSeconds': 75},
        'weather': {'climatology': {'fogPerHour': 0.06, 'thunderstormsPerHour': 0.04, 'temperature': 12}},
        'defaultMaps': ['Base Map'],
        'airspace': airspace(enr21, ad2),
        'fixes': fixes,
        'runways': runways_json(rwys),
        'sids': sids,
        'stars': stars,
        'spawnPatterns': patterns,
        'maps': [{'name': 'Base Map', 'lines': map_lines(coast_rings(grid, lats, lons), rwys,
                                                       bbox=(lats.min(), lons.min(), lats.max(), lons.max()))}],
    }
    write_airport(ICAO, airport, terrain_geojson('eham', grid, lats, lons, levels_ft=(1000,)))


if __name__ == '__main__':
    main()
