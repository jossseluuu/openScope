"""
Readers for ENAIRE chart texts (`pdftotext -raw`):

- `significant_points(enr44_raw)`: every 5-letter point of ENR 4.4 -> (lat, lon)
- `chart_waypoints(raw)`: the "WPT COORD" tables of SID/STAR/IAC charts -> {name: (lat, lon)}
- `tabular_procedures(raw)`: the "PROCEDURE TABULAR DESCRIPTION" of RNAV SIDs and STARs ->
  {procedure name: [Leg, ...]} (consecutive names before a block share its legs)
- `restriction()`: AIP altitude and speed columns -> openScope restriction text ("A50+|S230-")
"""

import re
from collections import namedtuple

from aiplib import COORD_PAIR_RE, dms_to_decimal, parse_coord_pair

Leg = namedtuple('Leg', 'path_terminator fix fly_over altitude speed')

_ALT = r'[+\-@]?(?:FL)?\d+'
_LEG_RE = re.compile(
    r'^\d{3} (?P<pt>[A-Z]{2}) (?P<fix>\S+) (?P<fo>\S+) (?:-|\d{3} ?\(\S+\)) \S+ \S+ \S+ '
    rf'(?P<alt>{_ALT}(?: {_ALT})?|-) (?P<spd>[+\-]?\d{{3}}|-) \S+ (?:RNAV1|RNP APCH|RNP1)\s*$'
)
_LEG_START_RE = re.compile(r'^\d{3}(?: [A-Z]{2} |$)')
_LEG_END_RE = re.compile(r'(RNAV1|RNP APCH|RNP1)\s*$')
_NAME_RE = re.compile(r'^([A-Z]{2,5}\d[A-Z])(?: RNAV1.*)?$')
_WPT_RE = re.compile(r'^([A-Z0-9]{2,5})(?: \((?:IAF|IF|FAF|FAP|MAPT)[^)]*\))? (\d{6}(?:\.\d+)?[NS] \d{7}(?:\.\d+)?[EW])$')
_ENR44_RE = re.compile(r'^([A-Z]{5}) (\d{6}[NS])\s*\n\s*(\d{7}[EW])', re.MULTILINE)


def significant_points(raw):
    points = {}
    for name, lat, lon in _ENR44_RE.findall(raw):
        points[name] = (dms_to_decimal(lat[:-1], lat[-1]), dms_to_decimal(lon[:-1], lon[-1]))
    return points


_WPT_SYMBOLS_RE = re.compile(
    r'^([A-Z0-9]{2,5})(?: \((?:IAF|IF|FAF|FAP|MAPT)[^)]*\))? '
    r'(\d{2})\D{1,2}(\d{2})\'(\d{2}(?:\.\d+)?)"([NS]) (\d{3})\D{1,2}(\d{2})\'(\d{2}(?:\.\d+)?)"([EW])'
)


def chart_waypoints(raw):
    """WPT COORD tables, as 393306.5N 0024420.1E or as 39°33'06.5"N 002°44'20.1"E."""
    points = {}
    for line in raw.splitlines():
        line = line.strip()
        match = _WPT_RE.match(line)
        if match:
            points[match.group(1)] = parse_coord_pair(COORD_PAIR_RE.search(match.group(2)))
            continue
        match = _WPT_SYMBOLS_RE.match(line)
        if match:
            name, lat_d, lat_m, lat_s, ns, lon_d, lon_m, lon_s, ew = match.groups()
            lat = int(lat_d) + int(lat_m) / 60 + float(lat_s) / 3600
            lon = int(lon_d) + int(lon_m) / 60 + float(lon_s) / 3600
            points[name] = (-lat if ns == 'S' else lat, -lon if ew == 'W' else lon)
    return points


def _joined_lines(raw):
    """Lines of the text, with table rows whose cells wrap onto several lines joined back into one."""
    pending = None
    for line in raw.splitlines():
        line = line.strip()
        if pending is not None:
            pending = f'{pending} {line}'
            if _LEG_END_RE.search(line) or len(pending) > 200:
                yield pending
                pending = None
            continue
        if _LEG_START_RE.match(line) and not _LEG_END_RE.search(line):
            pending = line
            continue
        yield line
    if pending is not None:
        yield pending


def tabular_procedures(raw):
    """
    Names come before their legs (several names can share one block). A leg numbered 001 starts a
    block for the names read since the previous block; a leg numbered n + 1 continues the current
    block, also after a page break, where the table header is repeated.
    """
    procedures = {}
    pending = []
    current = []
    last_serial = 0
    in_table = False
    for line in _joined_lines(raw):
        if 'TABULAR DESCRIPTION' in line or re.match(r'^DESCRIPCI.N TABULAR', line):
            in_table = True
            pending = []
            current = []
            last_serial = 0
            continue
        if not in_table:
            continue
        name = _NAME_RE.match(line)
        if name:
            pending.append(name.group(1))
            continue
        # some charts put a space before the decimal point: "17 .5", "(277 .9)"
        leg = _LEG_RE.match(re.sub(r'(\d) \.(\d)', r'.', line)) if _LEG_START_RE.match(line) else None
        if leg:
            serial = int(line[:3])
            if serial == 1:
                current, pending = pending, []
            elif serial != last_serial + 1:
                current = []
            last_serial = serial
            entry = Leg(leg.group('pt'), leg.group('fix'), leg.group('fo') == 'Y', leg.group('alt'), leg.group('spd'))
            for procedure in current:
                procedures.setdefault(procedure, []).append(entry)
        elif line.startswith(('CIRCUITOS DE ESPERA', 'COORDENADAS WAYPOINTS', 'OBST')):
            in_table = False
            pending = []
            current = []
    return procedures


def _altitude(text):
    """'+FL100' -> 'A100+', '-FL140' -> 'A140-', '@3000' -> 'A30', '+5000' -> 'A50+' ('-' -> None)"""
    match = re.match(r'^([+\-@]?)(FL)?(\d+)$', text)
    if not match:
        return None
    sign, is_level, value = match.groups()
    hundreds = int(value) if is_level else round(int(value) / 100)
    suffix = {'+': '+', '-': '-', '@': '', '': ''}[sign]
    return f'A{hundreds}{suffix}'


def restriction(altitude='-', speed='-'):
    parts = []
    if altitude and altitude != '-':
        for value in altitude.split():
            alt = _altitude(value)
            if alt:
                parts.append(alt)
    match = re.match(r'^([+\-]?)(\d{3})$', speed or '-')
    if match:
        parts.append(f"S{match.group(2)}{match.group(1)}")
    return '|'.join(parts) or None
