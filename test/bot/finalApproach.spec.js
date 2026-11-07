import ava from 'ava';

import {
    advanceOnFinal,
    finalSpeedAt,
    finalState,
    minimumGapOnFinal,
    timeToThreshold
} from '../../src/assets/scripts/client/bot/botA/finalApproach';
import { FinalApproachFrame } from '../../src/assets/scripts/client/bot/botGeometry';
import { joinPattern, patternGeometry } from '../../src/assets/scripts/client/bot/botA/arrivalPlanner';
import { getDefaultBotAParameters } from '../../src/assets/scripts/client/bot/botA/botAParameters';

const onFinal = (along, clearedSpeed, landingSpeed = 130) => ({
    along, clearedSpeed, landingSpeed, elevation: 0
});

ava('finalSpeedAt() keeps the cleared speed down to 5 nm, then slows down to the landing speed', (t) => {
    t.is(finalSpeedAt(8, 160, 130), 160);
    t.is(finalSpeedAt(5, 160, 130), 160);
    t.is(finalSpeedAt(2, 160, 130), 130);
    t.true(finalSpeedAt(4.5, 160, 130) < 160 && finalSpeedAt(4.5, 160, 130) > 130);
});

ava('finalState() takes the speed cleared to the aircraft unless one is given', (t) => {
    const aircraft = { speed: 175, clearance: { speedMode: 'HOLD', speed: 160 }, speedLimits: { landing: 135 } };

    t.is(finalState(aircraft, 10, 0).clearedSpeed, 160);
    t.is(finalState(aircraft, 10, 0, 150).clearedSpeed, 150);
    t.is(finalState(aircraft, 10, 0).landingSpeed, 135);
});

ava('advanceOnFinal() and timeToThreshold() agree', (t) => {
    const state = onFinal(10, 160);
    const time = timeToThreshold(state);

    t.true(time > 10 / 160 * 3600);
    t.true(advanceOnFinal(state, time - 10).along > 0);
    t.true(advanceOnFinal(state, time + 10).along <= 0);
});

ava('minimumGapOnFinal() shows the compression behind a leader slowing down to land', (t) => {
    // 3.7 nm apart at the same cleared speed: the gap shrinks while the leader slows down
    const gap = minimumGapOnFinal(onFinal(6, 160), onFinal(9.7, 160));

    t.true(gap < 3.4);
    t.true(gap > 2.5);
});

ava('minimumGapOnFinal() keeps the gap when the follower flies slower', (t) => {
    const gap = minimumGapOnFinal(onFinal(6, 160), onFinal(10, 130));

    t.true(gap >= 3.9);
});

ava('joinPattern() joins lower when closer in, never above the nominal intercept altitude', (t) => {
    const frame = new FinalApproachFrame({
        name: '32L', heading: 322, threshold: { x: 0, y: 0 }, elevation: 2000
    });
    const parameters = getDefaultBotAParameters();
    const pattern = patternGeometry(frame, parameters, 4000);
    const far = joinPattern(pattern, frame, 18);
    const near = joinPattern(pattern, frame, pattern.minimumJoinAlong);

    t.true(pattern.minimumJoinAlong <= pattern.interceptAlong);
    t.true(pattern.minimumJoinAlong >= parameters.minimumJoinDistanceNm);
    t.is(far.interceptAltitude, pattern.interceptAltitude);
    t.true(near.interceptAltitude >= 4000);
    // the glidepath is still captured from below, at least 2 nm after joining
    t.true((near.interceptAltitude - frame.elevation) / 318 <= near.interceptAlong - 2 + 1e-6);
    t.is(far.baseTurnAlong - far.interceptAlong, pattern.baseTurnAlong - pattern.interceptAlong);
});
