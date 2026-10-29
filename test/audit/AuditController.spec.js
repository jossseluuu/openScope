import ava from 'ava';
import sinon from 'sinon';

import AuditController, { OUTCOME } from '../../src/assets/scripts/client/audit/AuditController';
import TimeKeeper from '../../src/assets/scripts/client/engine/TimeKeeper';

const createAudit = () => new AuditController({ aircraft: { list: [] } }, null);

ava.afterEach(() => sinon.restore());

ava('a clearance followed by a separation loss of that aircraft is marked as such', (t) => {
    const audit = createAudit();

    sinon.stub(TimeKeeper, 'accumulatedDeltaTime').get(() => 100);
    audit._onCommand({
        source: 'bot A', callsign: 'IBE1', command: 'fh 270', accepted: true
    });
    audit._onViolation({
        time: 150, rule: 'RADAR_SEPARATION', tier: 1, callsigns: ['IBE1', 'RYR2'], details: '2.1 nm'
    });

    const outcome = audit._outcomeFor('IBE1', 100);

    t.is(outcome.status, OUTCOME.SEPARATION);
    t.deepEqual(outcome.violations, ['RADAR_SEPARATION: 2.1 nm']);
    // a violation after the horizon does not count
    t.is(audit._outcomeFor('RYR2', -500).status, OUTCOME.OK);
});

ava('an arrival lost or landed within the horizon gives the outcome of the clearance', (t) => {
    const audit = createAudit();

    audit.lifecycle.IBE1 = { category: 'arrival', status: 'active', endTime: null };
    audit.lifecycle.RYR2 = { category: 'arrival', status: 'active', endTime: null };
    audit._onScore({
        time: 200, event: 'AIRSPACE_BUST', points: -200, callsigns: ['IBE1']
    });
    audit._onScore({
        time: 220, event: 'ARRIVAL', points: 10, callsigns: ['RYR2']
    });

    t.is(audit._outcomeFor('IBE1', 100).status, OUTCOME.LOST);
    t.is(audit._outcomeFor('RYR2', 100).status, OUTCOME.LANDED);
    t.is(audit.getSummary().pointsByEvent.AIRSPACE_BUST, -200);
});

ava('the export starts with a header that describes the encoding', (t) => {
    const header = JSON.parse(createAudit().exportJsonLines().split('\n')[0]);

    t.is(header.type, 'header');
    t.true(Number.isInteger(header.featureVersion));
    t.is(header.actionNames.length, header.actionCount);
});
