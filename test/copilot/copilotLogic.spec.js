import ava from 'ava';
import { AGENT } from '../../src/assets/scripts/client/bot/botC/agents';
import {
    SECTORS,
    SUGGESTIONS,
    explain,
    isDelegated,
    parseTarget,
    partitionDecisions,
    urgencyOf
} from '../../src/assets/scripts/client/copilot/copilotLogic';

const decision = (callsign, agent, reason, command = 'fh 270') => ({
    callsign, agent, reason, command, action: 3
});

const noDelegation = () => ({ callsigns: new Set(), agents: new Set() });

ava('an aircraft is delegated by callsign or by the sector of its agent', (t) => {
    const delegation = { callsigns: new Set(['IBE1']), agents: new Set([AGENT.TOWER]) };

    t.true(isDelegated(decision('IBE1', AGENT.ARRIVALS, ''), delegation));
    t.true(isDelegated(decision('RYR2', AGENT.TOWER, ''), delegation));
    t.false(isDelegated(decision('RYR2', AGENT.ILS, ''), delegation));
});

ava('delegated decisions are executed, the rest suggested, safety first', (t) => {
    const delegation = { callsigns: new Set(), agents: new Set([AGENT.TOWER]) };
    const { execute, suggest } = partitionDecisions([
        decision('IBE1', AGENT.ARRIVALS, 'speed for the sequence', 'sp 210'),
        decision('RYR2', AGENT.TOWER, 'takeoff', 'cto'),
        decision('VLG3', AGENT.ILS, 'safety: spacing on final', 'ga'),
        decision('AEA4', AGENT.SEPARATION, 'conflict with IBE1', 'a 60')
    ], delegation);

    t.deepEqual(execute.map((item) => item.callsign), ['RYR2']);
    t.deepEqual(suggest.map((item) => item.callsign), ['VLG3', 'AEA4', 'IBE1']);
});

ava('decisions without a command are ignored and suggestions are capped', (t) => {
    const many = Array.from({ length: 10 }, (value, index) => decision(`IBE${index}`, AGENT.ARRIVALS, 'route'));
    const { suggest } = partitionDecisions([...many, { callsign: 'X', agent: AGENT.ARRIVALS, command: null }], noDelegation());

    t.is(suggest.length, SUGGESTIONS.MAX);
    t.false(suggest.some((item) => item.callsign === 'X'));
});

ava('urgency: safety, then separation, then sequence, then the rest', (t) => {
    t.is(urgencyOf(decision('A', AGENT.SHIELD, 'anything')), 0);
    t.is(urgencyOf(decision('A', AGENT.ILS, 'safety: higher airspace floor ahead')), 0);
    t.is(urgencyOf(decision('A', AGENT.ARRIVALS, 'conflict with RYR2')), 1);
    t.is(urgencyOf(decision('A', AGENT.ILS, 'spacing behind IBE1 on final')), 2);
    t.is(urgencyOf(decision('A', AGENT.DEPARTURES, 'climb on the SID')), 3);
});

ava('the explanation names the agent, the urgency and the reason', (t) => {
    t.is(explain(decision('IBE1', AGENT.TOWER, 'safety: spacing on final', 'ga')),
        '[Torre · URGENTE] IBE1 ga — safety: spacing on final');
});

ava('delegation targets: sectors in English and Spanish, or a callsign', (t) => {
    t.deepEqual(parseTarget('tower'), { kind: 'sector', agents: [AGENT.TOWER] });
    t.deepEqual(parseTarget('salidas'), { kind: 'sector', agents: [AGENT.DEPARTURES] });
    t.is(parseTarget('all').agents.length, Object.keys(AGENT).length);
    t.deepEqual(parseTarget('ibe1234'), { kind: 'callsign', callsign: 'IBE1234' });
    t.true(SECTORS.approach.includes(AGENT.ILS));
});
