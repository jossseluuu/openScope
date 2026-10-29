# Scoring

Scoring is based on many separate variables. The score is computed by
summing all of the variables after multiplying each one by its own
unique factor (so that a fatal collision docks many more points than a
crosswind landing, for example.)

## Arrival

Each arriving aircraft that is successfully landed gives you 10 points.

## Departure

Each departing aircraft that is successfully routed out of the airspace
with a clearance onto their filed departure route earns you 10 points.

## Failed arrival

You lose 200 points for every arriving aircraft that leaves the area
(and therefore hasn't landed).

## Failed Departures

We must clear all aircraft onto their flightplan route before they leave
our airspace. If they exit the airspace without being cleared to their
desired fix (usually we do this via a SID), you will lose 25 points.

## Restricted areas

You lose 200 points whenever a plane penetrates into a restricted area.

## Windy landings

When an aircraft is forced to land with a crosswind or a tailwind, you
lose 2 points per knot, multiplied by the angle (i.e. if it's a
direct headwind, you lose 0 points; if it's a direct 10kt tailwind,
you lose 20 points.)

## Collisions

1000 points are lost whenever two aircraft collide (within 50 or so feet
vertically and 165 feet laterally), or an aircraft flies into terrain.

## Runway incursions

You lose 500 points whenever an aircraft lands or starts its takeoff roll
on a runway that is occupied by another aircraft. Landing aircraft occupy the
runway for their runway occupancy time (45 to 70 seconds depending on their
size), departures until they are airborne past the runway end.

## Loss of separation

You lose 200 points each time two aircraft under your control lose radar
separation (3 nm or 1000 ft), or get closer than the minimum on the same final
approach. Each loss is counted once, however long it lasts. Aircraft that
enter your airspace already too close are given 60 seconds to be separated.

You also lose 200 points when a departure starts its takeoff roll while an
arrival is less than 2 nm from the threshold of the same runway.

## Wake turbulence

You lose 100 points when wake turbulence separation is not respected:
distance between consecutive aircraft on the same final, or time between
departures from the same runway (or from parallel runways less than 2500 ft
apart). The minima depend on the airport's regulatory profile: RECAT-EU in
Europe, FAA JO 7110.65 in the US and ICAO Doc 4444 elsewhere.

## Minimum vectoring altitude

At airports with terrain data, you lose 150 points each time an aircraft
flying a heading you assigned descends more than 100 ft below the minimum
vectoring altitude (1000 ft above the terrain within 3 nm).

## Go-arounds

You lose 50 points for each go-around, whether you instructed it or the
pilot had to: aircraft go around when they are not stable at 1000 ft above
the runway (not established, or more than 20 kt above their landing speed) or
when the runway is occupied at 200 ft.

## Windy takeoffs

Takeoffs beyond the tailwind (5 kt) or crosswind (20 kt) limit of the
regulatory profile cost the same as a high tailwind or crosswind landing.

## ~~Warning~~

~~Any time a warning is issued for an aircraft 5 points are lost.  The
most common warning is when two aircraft are separated by less 3
nautical miles or less than 1000 feet of altitude.  However there are
a number of situations where aircraft can be separated by less, for
complete details refer to the
[aircraft separation rules](aircraft-separation.md)~~

## ~~Aborted taxi~~

~~2 points are lost whenever an aircraft's taxiing is aborted (i.e. when
you want to assign it a different runway.)~~
