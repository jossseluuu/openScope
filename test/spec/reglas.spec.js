import ava from 'ava';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import _get from 'lodash/get';
import {
    getArrivalWakeSeparationNm,
    getDepartureWakeSeparationSeconds
} from '../../src/assets/scripts/client/realism/wakeTurbulence';
import { WAKE_SCHEME } from '../../src/assets/scripts/client/realism/regulatoryProfiles';
import { RULE } from '../../src/assets/scripts/client/realism/Rulebook';

/* eslint-disable global-require, import/no-dynamic-require */

const SPEC_FILE = path.join(__dirname, '..', '..', 'docs', 'especificacion', 'reglas.yaml');
const CLIENT = path.join(__dirname, '..', '..', 'src', 'assets', 'scripts', 'client');
const spec = yaml.safeLoad(fs.readFileSync(SPEC_FILE, 'utf8'));

const CATEGORIES = {
    [WAKE_SCHEME.RECAT_EU]: ['A', 'B', 'C', 'D', 'E', 'F'],
    [WAKE_SCHEME.ICAO]: ['J', 'H', 'M', 'L'],
    [WAKE_SCHEME.FAA]: ['SUPER', 'HEAVY', 'B757', 'LARGE', 'SMALL']
};

const typeOf = (category, scheme) => {
    if (scheme === WAKE_SCHEME.RECAT_EU) {
        return { category: { recatEu: category } };
    }

    if (scheme === WAKE_SCHEME.FAA) {
        return { category: { wakeFaa: category } };
    }

    return { weightClass: category };
};

const WAKE_FUNCTIONS = {
    wakeArrival: getArrivalWakeSeparationNm,
    wakeDeparture: getDepartureWakeSeparationSeconds
};

ava('every rule has a unique id of its domain and the required fields', (t) => {
    const domains = new Set(spec.domains.map((domain) => domain.id));
    const ids = new Set();

    spec.rules.forEach((rule) => {
        t.regex(rule.id, /^[A-Z]{3}-\d{3}$/, rule.id);
        t.true(domains.has(rule.id.slice(0, 3)), `${rule.id}: unknown domain`);
        t.false(ids.has(rule.id), `${rule.id}: duplicated`);
        ids.add(rule.id);
        ['rule', 'value', 'source', 'code', 'status'].forEach((field) => {
            t.not(rule[field], undefined, `${rule.id}: missing ${field}`);
        });
        t.true(['implementado', 'parcial', 'pendiente', 'referencia'].includes(rule.status), `${rule.id}: status`);
    });
});

// one test per checked rule, so a mismatch names the rule
spec.rules.filter((rule) => rule.check).forEach((rule) => {
    const { check } = rule;

    ava(`${rule.id} matches the code`, (t) => {
        if (check.module) {
            const exported = require(path.join(CLIENT, check.module))[check.export];

            if (check.table) {
                t.deepEqual(exported, rule.value);
            } else {
                t.deepEqual(check.path ? _get(exported, check.path) : exported, check.equals);
            }

            return;
        }

        if (WAKE_FUNCTIONS[check.function]) {
            const scheme = WAKE_SCHEME[check.scheme];
            const separation = WAKE_FUNCTIONS[check.function];

            // every pair, so a pair missing from the sheet (0 = radar separation only) is checked too
            CATEGORIES[scheme].forEach((leader) => {
                CATEGORIES[scheme].forEach((follower) => {
                    const expected = (rule.value[leader] && rule.value[leader][follower]) || 0;

                    t.is(separation(typeOf(leader, scheme), typeOf(follower, scheme), scheme), expected,
                        `${leader} -> ${follower}`);
                });
            });

            return;
        }

        if (check.function === 'rulebookTiers') {
            t.deepEqual(Object.keys(rule.value).sort(), Object.keys(RULE).sort());
            Object.entries(rule.value).forEach(([id, text]) => {
                const [tier, reference] = text.split(' · ');

                t.is(RULE[id].tier, Number(tier), id);
                t.is(RULE[id].reference, reference, id);
            });

            return;
        }

        t.fail(`${rule.id}: unknown check`);
    });
});
