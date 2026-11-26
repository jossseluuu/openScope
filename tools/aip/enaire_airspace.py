"""
Sectors of a Spanish TMA from ENAIRE's ENR 2.1 (text from `pdftotext -raw LE_ENR_2_1_en.pdf`).

Each sector (e.g. TPAM-1 ... TPAM-24) has lateral limits made of coordinates, arcs around an ARP
("arco de radio // arc of radius 11.0 NM centrado en // centred in ARP LEMH y sentido horario hasta")
and stretches of coastline ("siguiendo la línea de costa de la isla de Mallorca hasta"), then one
or more vertical bands ("2500 ft AMSL - 3500 ft AMSL... D", "FL195 - FL245... C").

`parse_sectors()` reads them; `sector_polygon()` turns the lateral limits into a ring of (lat, lon),
resolving arcs (with the given ARPs) and coastline (with `aiplib.Coastline`). Neighbouring sectors
that name the same points get exactly the same vertices, so shared edges stay welded.
"""

import re

from aiplib import COORD_PAIR_RE, arc_points, parse_coord_pair

_PAGE_LINE_RE = re.compile(r'^(AIP|ESPA.A|ENR 2\.1-\d+|WEF .*|AIS-ESPA.A.*)$')
_ARC_RE = re.compile(
    r'arc of radius\s*([\d.]+)\s*NM\s*centrado en\s*//\s*centred in ARP\s*(\w{4})\s*y sentido\s*(horario|antihorario)',
    re.IGNORECASE
)
_COAST_RE = re.compile(r'following the coastline of\s+(\w+)\s+island', re.IGNORECASE)
_BAND_RE = re.compile(
    r'(SFC|GND|FL\s*\d{3}|\d+\s*ft\s*(?:AMSL|AGL))\s*-\s*(UNL|FL\s*\d{3}|\d+\s*ft\s*(?:AMSL|AGL))\s*\.*\s*([A-G])\b'
)


def _clean(raw):
    lines = [line.strip() for line in raw.splitlines()]
    lines = [line for line in lines if line and not _PAGE_LINE_RE.match(line)]
    text = '\n'.join(lines)
    # pdftotext splits "392637.0N" into "392637\n.0N"
    text = re.sub(r'\n(?=\.\d)', '', text)
    return re.sub(r'\s+', ' ', text)


def level_to_ft(text):
    text = text.replace(' ', '').upper()
    if text in ('SFC', 'GND'):
        return 0
    if text == 'UNL':
        return 99900
    if text.startswith('FL'):
        return int(text[2:]) * 100
    return int(re.match(r'\d+', text).group())


def parse_sectors(raw, prefix):
    """
    `prefix` like 'TPAM'. Returns {name: {'items': [...], 'bands': [(floor_ft, ceiling_ft, class)]}}
    where items are ('point', (lat, lon)), ('arc', radius_nm, arp, clockwise) or ('coast', island),
    always followed by the point where the arc or coastline ends.
    """
    text = _clean(raw)
    parts = re.split(rf'\b({prefix}-\d+)\b', text)
    sectors = {}
    for name, body in zip(parts[1::2], parts[2::2]):
        if 'LATERAL LIMITS' not in body.upper():
            continue
        lateral, _, vertical = body.partition('VERTICAL LIMITS')
        # stop at the next unrelated block (ATS unit, next TMA...)
        vertical = re.split(r'DEPENDENCIA ATS|TMA [A-Z]|CTR [A-Z]', vertical)[0]
        events = []
        for match in COORD_PAIR_RE.finditer(lateral):
            events.append((match.start(), ('point', parse_coord_pair(match))))
        for match in _ARC_RE.finditer(lateral):
            clockwise = match.group(3).lower() == 'horario'
            events.append((match.start(), ('arc', float(match.group(1)), match.group(2).upper(), clockwise)))
        for match in _COAST_RE.finditer(lateral):
            events.append((match.start(), ('coast', match.group(1).capitalize())))
        events.sort(key=lambda e: e[0])
        items = [e[1] for e in events]
        bands = [(level_to_ft(a), level_to_ft(b), c) for a, b, c in _BAND_RE.findall(vertical)]
        sectors[name] = {'items': items, 'bands': bands}
    return sectors


def sector_polygon(items, arps, coastlines):
    """
    Ring of (lat, lon) (not closed). `arps` = {'LEMH': (lat, lon)}; `coastlines` = {'Mallorca': Coastline}.
    """
    ring = []
    pending = None
    for item in items:
        if item[0] != 'point':
            pending = item
            continue
        point = item[1]
        if pending and ring:
            start = ring[-1]
            if pending[0] == 'arc':
                _, radius, arp, clockwise = pending
                ring.extend(arc_points(arps[arp], radius, start, point, clockwise))
            else:
                ring.extend(coastlines[pending[1]].path(start, point))
        pending = None
        ring.append(point)
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring.pop()
    return ring


def vertical_extent(bands):
    """Lowest floor and highest ceiling of the sector, and the class of the lowest band."""
    lowest = min(bands, key=lambda b: b[0])
    return lowest[0], max(b[1] for b in bands), lowest[2]
