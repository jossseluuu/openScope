"""
Readers for the French eAIP (SIA, https://www.sia.aviation-civile.gouv.fr/):

- `html_text(path)`: an eAIP HTML page as plain text (tags removed, spaces collapsed)
- `dms_points(text)`: every `48°59'44.47"N 002°33'09.88"E` (or with `''` and `,` decimals) in a text
- `airspace_parts(text, prefix)`: parts of a TMA/CTR in ENR 2.1 / AD 2.17 ("TMA PARIS partie 2"):
  polygon (with arcs "arc horaire/anti-horaire de N NM de rayon centré sur ...") and vertical limits
- `waypoints_table(text)`: the AD 2 <AD> DATA waypoint lists, from `pdftotext -table`
- `coded_procedures(text)`: the RNAV coding tables (DATA SID/STAR/INA ... RNAV CODE), from
  `pdftotext -table`, as {procedure: [Leg]} with the same Leg as enaire_charts

The coding tables have one row per leg; the middle columns (bearings, distance) are sometimes
displaced, so a row is read from both ends: path terminator and fix from the start, turn direction,
minimum altitude, maximum altitude, maximum speed and accuracy from the end.
"""

import html
import re

from aiplib import arc_points
from enaire_charts import Leg

_DMS = r'(\d{2,3})\D{1,2}(\d{2})\'(\d{2}(?:[.,]\d+)?)(?:"|\'\')\s*([NSEW])'
_PAIR_RE = re.compile(_DMS + r'\s*,?\s*' + _DMS)
_PATH_TERMINATORS = {'IF', 'TF', 'DF', 'CF', 'CA', 'VA', 'FA', 'FM', 'VM', 'RF', 'VI', 'CI', 'FC', 'FD', 'VD',
                     'CD', 'AF', 'HM', 'HA', 'HF', 'PI'}


def html_text(path):
    with open(path, encoding='utf-8', errors='ignore') as handle:
        text = handle.read()
    text = html.unescape(re.sub(r'<[^>]+>', ' ', text))
    return re.sub(r'\s+', ' ', text)


def _value(degrees, minutes, seconds, hemisphere):
    value = int(degrees) + int(minutes) / 60 + float(seconds.replace(',', '.')) / 3600
    return -value if hemisphere in 'SW' else value


def pair_value(match, offset=0):
    g = match.groups()[offset:offset + 8]
    return _value(*g[0:4]), _value(*g[4:8])


def dms_points(text):
    return [pair_value(m) for m in _PAIR_RE.finditer(text)]


# ---------------------------------------------------------------- airspace

_LIMIT = r'(?:FL\s*\d+|\d+\s*ft\s*(?:AMSL|ASFC|AGL)|SFC|GND|UNL)'
_LIMITS_RE = re.compile(rf'\b([A-G])\s+({_LIMIT})\s*-{{3,}}\s*({_LIMIT})')
_ARC_RE = re.compile(r'arc (horaire|anti-horaire) de ([\d.,]+) NM de rayon centr. sur\s*' + _DMS + r'\s*,?\s*' + _DMS)


def limit_ft(text):
    text = text.replace(' ', '').upper()
    if text in ('SFC', 'GND'):
        return 0
    if text == 'UNL':
        return 99900
    if text.startswith('FL'):
        return int(text[2:]) * 100
    return int(re.match(r'\d+', text).group())


def lateral_polygon(text):
    """Polygon of a lateral-limits text made of points and arcs (the arc ends at the next point)."""
    events = [(m.start(), 'point', pair_value(m)) for m in _PAIR_RE.finditer(text)]
    arcs = [(m.start(), 'arc', m) for m in _ARC_RE.finditer(text)]
    # the centre of an arc is also matched as a point: drop it
    centres = {m.start(0) + m.group(0).find(m.group(3)) for _, _, m in arcs}
    events = [e for e in events if not any(abs(e[0] - c) < 3 for c in centres)]
    events = sorted(events + arcs, key=lambda e: e[0])
    ring, pending = [], None
    for _, kind, value in events:
        if kind == 'arc':
            pending = value
            continue
        if pending is not None and ring:
            clockwise = pending.group(1) == 'horaire'
            radius = float(pending.group(2).replace(',', '.'))
            centre = (_value(*pending.groups()[2:6]), _value(*pending.groups()[6:10]))
            ring.extend(arc_points(centre, radius, ring[-1], value, clockwise))
        pending = None
        ring.append(value)
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring.pop()
    return ring


def airspace_parts(text, prefix):
    """{part name: (ring, floor_ft, ceiling_ft, class)} for every '<prefix> <n>' in the text."""
    parts = re.split(rf'({re.escape(prefix)}\s*[\d.]+)', text)
    out = {}
    for name, body in zip(parts[1::2], parts[2::2]):
        limits = _LIMITS_RE.search(body)
        if not limits:
            continue
        ring = lateral_polygon(body[:limits.start()])
        if len(ring) >= 3:
            out[name.strip()] = (ring, limit_ft(limits.group(3)), limit_ft(limits.group(2)), limits.group(1))
    return out


# ---------------------------------------------------------------- AD 2 DATA tables

_WAYPOINT_ROW_RE = re.compile(r'^\s*([A-Z0-9]{2,5})\s+' + _DMS + r'\s+' + _DMS)


def waypoints_table(text):
    points = {}
    for line in text.splitlines():
        match = _WAYPOINT_ROW_RE.match(line)
        if match:
            points[match.group(1)] = pair_value(match, 1)
    return points


_PROCEDURE_RE = re.compile(r'^\s*([A-Z]{2,5}) ?(\d[A-Z])\b(?!\s+(?:' + '|'.join(_PATH_TERMINATORS) + r')\s)')


def coded_procedures(text):
    procedures = {}
    current = None
    for line in text.splitlines():
        if not line.strip():
            continue
        tokens = line.split()
        start = 1 if tokens[0].startswith('RWY') or tokens[0] == '-' else 0
        if len(tokens) > start + 1 and tokens[start] in _PATH_TERMINATORS:
            if current is None:
                continue
            fix = tokens[start + 1]
            if len(tokens) < start + 7:
                continue
            speed, maximum, minimum = tokens[-2], tokens[-3], tokens[-4]
            altitude = ' '.join(a for a in (_signed(minimum, '+'), _signed(maximum, '-')) if a) or '-'
            procedures[current].append(Leg(tokens[start], fix, tokens[start + 2] == 'Y', altitude,
                                           f'-{speed}' if speed.isdigit() else '-'))
            continue
        match = _PROCEDURE_RE.match(line)
        if match and not line.strip().startswith(('AIP', 'RWY', 'RMK')):
            current = match.group(1) + match.group(2)
            procedures.setdefault(current, [])
    return {name: legs for name, legs in procedures.items() if legs}


_NAME_ANYWHERE_RE = re.compile(r'\b([A-Z]{2,5}) (\d[A-Z])\b')


def coded_approach_blocks(text):
    """
    Initial approach (INA) coding tables: each block starts with an IF leg and its name ("LORNI 1W")
    appears somewhere inside the block, sometimes on the same line as a leg. These tables have one
    more column (vertical angle) before the accuracy, and altitude notes such as "(R) (1)".
    """
    blocks = []
    current = None
    for line in text.splitlines():
        line = re.sub(r'\((?:R|H|\d)\)', ' ', line)
        name = _NAME_ANYWHERE_RE.search(line)
        if name:
            line = line[:name.start()] + ' ' + line[name.end():]
        tokens = [t for t in line.split() if t not in ('INA', 'NIGHT', 'HLDG')]
        if tokens and tokens[0] in _PATH_TERMINATORS and len(tokens) >= 8:
            if tokens[0] == 'IF':
                current = {'name': None, 'legs': []}
                blocks.append(current)
            if current is not None:
                speed, maximum, minimum = tokens[-3], tokens[-4], tokens[-5]
                altitude = ' '.join(a for a in (_signed(minimum, '+'), _signed(maximum, '-')) if a) or '-'
                current['legs'].append(Leg(tokens[0], tokens[1], tokens[2] == 'Y', altitude,
                                           f'-{speed}' if speed.isdigit() else '-'))
        if name and current is not None and current['name'] is None:
            current['name'] = name.group(1) + name.group(2)
    return {block['name']: block['legs'] for block in blocks if block['name']}


def _signed(value, sign):
    """'FL070' -> '+FL070' (minimum) or '-FL070' (maximum); '4000' -> '+4000'; '-' -> None"""
    value = value.replace('ft', '')
    if re.fullmatch(r'FL\d{2,3}|\d{3,5}', value):
        return f'{sign}{value}'
    return None
