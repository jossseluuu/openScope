"""
Readers for the Singapore eAIP (CAAS, https://aim-sg.caas.gov.sg/aip/): SID and STAR charts carry, on
their back page, a "Formal & Abbreviated Descriptions" table (`pdftotext -table`):

    ANITO 7A (SID) RNAV GNSS   RWY 02C - DESCRIPTIONS
    To MOXIB on course 023° at or above 2000ft, turn right.   MOXIB [M023; A020+; R] -   CF   N
    To VIRET at or above FL160, turn left.                     VIRET [FL160+; L] -        TF   N

`procedures(text)` returns {name: (kind, [runways], [(fix, restriction, path terminator)])}.
Restrictions in brackets: Mddd course (ignored), A020+ / A090- / A050 (hundreds of feet),
FL160+ (flight level), K250- (speed), L/R turn (ignored), "A040+A060-" windows.
"""

import re

_HEADER_RE = re.compile(r'^\s*([A-Z]{2,5}) (\d[A-Z]) \((SID|STAR)\).*?RWY\s+((?:\d{2}[LCR]?\s*/?\s*)+)')
_ROW_RE = re.compile(r'\b([A-Z0-9]{2,5})(?: \[([^\]]*)\])?\s*-?\s+(IF|TF|CF|DF|RF)\s+[YN]\b')


def _restriction(text):
    parts = []
    for item in re.split(r'[;,]', text or ''):
        item = item.strip().replace(' ', '')
        for match in re.finditer(r'(FL|A)(\d{2,3})([+-]?)', item):
            kind, value, sign = match.groups()
            hundreds = int(value)
            parts.append(f'A{hundreds}{sign}')
        speed = re.match(r'K(\d{3})([+-]?)$', item)
        if speed:
            parts.append(f'S{speed.group(1)}{speed.group(2) or "-"}')
    return '|'.join(parts) or None


def procedures(text):
    out = {}
    current = None
    for line in text.splitlines():
        header = _HEADER_RE.match(line)
        if header:
            name = header.group(1) + header.group(2)
            runways = re.findall(r'\d{2}[LCR]?', header.group(4))
            current = name
            out[name] = (header.group(3), runways, [])
            continue
        if current is None:
            continue
        if line.strip().startswith('Tabular Description'):
            current = None
            continue
        row = _ROW_RE.search(line)
        if row:
            out[current][2].append((row.group(1), _restriction(row.group(2)), row.group(3)))
    return {name: value for name, value in out.items() if value[2]}


_DMS_RE = re.compile(r"(\d{2,3})\D{1,2}\s*(\d{2})'\s*(\d{2}(?:\.\d+)?)''\s*([NSEW])")


def chart_points(text):
    """Waypoint names followed (on the next lines, same column) by `01° 29' 33'' N` / `104° 03' 15'' E`."""
    lines = text.splitlines()
    points = {}
    for index, line in enumerate(lines):
        for match in re.finditer(r'\b([A-Z]{5})\b', line):
            column = match.start()
            found = []
            for following in lines[index + 1:index + 4]:
                window = following[max(0, column - 6):column + 20]
                coordinate = _DMS_RE.search(window)
                if coordinate:
                    found.append(coordinate)
            if len(found) >= 2 and found[0].group(4) in 'NS' and found[1].group(4) in 'EW':
                lat = _value(found[0])
                lon = _value(found[1])
                points.setdefault(match.group(1), (lat, lon))
    return points


def _value(match):
    degrees, minutes, seconds, hemisphere = match.groups()
    value = int(degrees) + int(minutes) / 60 + float(seconds) / 3600
    return -value if hemisphere in 'SW' else value
