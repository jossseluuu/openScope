import ava from 'ava';
import { findCallsign, interpretCommand, matchFix } from '../../src/assets/scripts/client/voice/commandInterpreter';
import { normalizePhraseology, wordsToNumbers } from '../../src/assets/scripts/client/voice/phraseologyNormalizer';

const CONTEXT = {
    aircraft: [
        { callsign: 'IBE1234', telephony: 'Iberia' },
        { callsign: 'VLG21K', telephony: 'Vueling' },
        { callsign: 'RYR4512', telephony: 'Ryanair' },
        { callsign: 'AEA051', telephony: 'Europa' },
        { callsign: 'BAW478', telephony: 'Speedbird' },
        { callsign: 'DLH1866', telephony: 'Lufthansa' }
    ],
    fixes: ['NANDO', 'TOBEK', 'RESBI', 'ASBIN', 'CCS', 'TLD', 'SIE', 'BRITO']
};

// [phrase as heard or typed, expected canonical command]
const CORPUS_EN = [
    ['iberia one two three four turn left heading two seven zero', 'IBE1234 fh l 270'],
    ['Iberia 1234, turn right heading 090', 'IBE1234 fh r 090'],
    ['iberia one two three four fly heading three six zero', 'IBE1234 fh 360'],
    ['iberia one two three four descend and maintain five thousand', 'IBE1234 a 50'],
    ['Iberia 1234 climb and maintain flight level one two zero', 'IBE1234 a 120'],
    ['iberia one two three four climb flight level two four zero', 'IBE1234 a 240'],
    ['iberia one two three four descend to four thousand feet expedite', 'IBE1234 a 40 ex'],
    ['iberia one two three four maintain three thousand five hundred', 'IBE1234 a 35'],
    ['iberia one two three four reduce speed one eight zero knots', 'IBE1234 sp 180'],
    ['iberia one two three four increase speed to two five zero', 'IBE1234 sp 250'],
    ['iberia one two three four proceed direct nando', 'IBE1234 pd NANDO'],
    ['iberia one two three four direct to tobek', 'IBE1234 pd TOBEK'],
    ['iberia one two three four cleared ils runway three two left', 'IBE1234 i 32L'],
    ['iberia one two three four cleared ils approach runway one eight right', 'IBE1234 i 18R'],
    ['iberia one two three four cleared to land runway three two left', 'IBE1234 land'],
    ['iberia one two three four hold at resbi', 'IBE1234 hold RESBI'],
    ['iberia one two three four go around', 'IBE1234 ga'],
    ['iberia one two three four descend via star', 'IBE1234 dvs'],
    ['iberia one two three four climb via the sid', 'IBE1234 cvs'],
    ['iberia one two three four squawk four five two one', 'IBE1234 sq 4521'],
    ['vueling two one kilo taxi to runway three six left', null],
    ['VLG21K taxi to runway 36L', 'VLG21K taxi 36L'],
    ['VLG21K runway 36L line up and wait', 'VLG21K lineup'],
    ['VLG21K runway 36L cleared for takeoff', 'VLG21K cto'],
    ['VLG21K stop immediately cancel takeoff clearance', 'VLG21K abort'],
    ['ryanair four five one two turn left heading two two zero descend and maintain six thousand', 'RYR4512 fh l 220 a 60'],
    ['ryanair four five one two descend and maintain four thousand reduce speed two one zero', 'RYR4512 a 40 sp 210'],
    ['speedbird four seven eight turn right heading one two zero, climb flight level one five zero', 'BAW478 fh r 120 a 150'],
    ['lufthansa one eight six six cleared ils runway one four right', 'DLH1866 i 14R'],
    ['europa zero five one descend and maintain niner thousand', 'AEA051 a 90'],
    ['ryan air four five one two direct to nando', 'RYR4512 pd NANDO'],
    ['iberia one two three four turn left heading tree four zero', 'IBE1234 fh l 340'],
    ['iberia one two three four reduce speed one six zero', 'IBE1234 sp 160'],
    ['IBE1234 descend 3000', 'IBE1234 a 30'],
    ['ibe 1234 turn right heading 180', 'IBE1234 fh r 180']
];

const CORPUS_ES = [
    ['iberia uno dos tres cuatro vire a la izquierda rumbo dos siete cero', 'IBE1234 fh l 270'],
    ['Iberia 1234, vire a la derecha rumbo 090', 'IBE1234 fh r 090'],
    ['iberia uno dos tres cuatro rumbo tres seis cero', 'IBE1234 fh 360'],
    ['iberia uno dos tres cuatro descienda y mantenga cinco mil pies', 'IBE1234 a 50'],
    ['iberia uno dos tres cuatro ascienda y mantenga nivel de vuelo uno dos cero', 'IBE1234 a 120'],
    ['iberia uno dos tres cuatro suba a nivel dos cuatro cero', 'IBE1234 a 240'],
    ['iberia uno dos tres cuatro baje a tres mil quinientos', 'IBE1234 a 35'],
    ['iberia uno dos tres cuatro descienda a cuatro mil expedito', 'IBE1234 a 40 ex'],
    ['iberia uno dos tres cuatro reduzca velocidad uno ocho cero nudos', 'IBE1234 sp 180'],
    ['iberia uno dos tres cuatro aumente a dos cinco cero nudos', 'IBE1234 sp 250'],
    ['iberia uno dos tres cuatro proceda directo a nando', 'IBE1234 pd NANDO'],
    ['iberia uno dos tres cuatro directo a tobek', 'IBE1234 pd TOBEK'],
    ['iberia uno dos tres cuatro autorizado aproximacion ils pista tres dos izquierda', 'IBE1234 i 32L'],
    ['iberia uno dos tres cuatro autorizado ils pista uno ocho derecha', 'IBE1234 i 18R'],
    ['iberia uno dos tres cuatro autorizado a aterrizar pista tres dos izquierda', 'IBE1234 land'],
    ['iberia uno dos tres cuatro mantenga en espera sobre resbi', 'IBE1234 hold RESBI'],
    ['iberia uno dos tres cuatro motor y al aire', 'IBE1234 ga'],
    ['iberia uno dos tres cuatro descienda segun la star', 'IBE1234 dvs'],
    ['iberia uno dos tres cuatro ascienda segun la sid', 'IBE1234 cvs'],
    ['iberia uno dos tres cuatro transponda cuatro cinco dos uno', 'IBE1234 sq 4521'],
    ['VLG21K ruede a la pista 36L', 'VLG21K taxi 36L'],
    ['VLG21K pista 36L alinee y espere', 'VLG21K lineup'],
    ['VLG21K pista 36L autorizado a despegar', 'VLG21K cto'],
    ['VLG21K pare inmediatamente, cancelo autorización de despegue', 'VLG21K abort'],
    ['ryanair cuatro cinco uno dos vire a la izquierda rumbo dos dos cero y descienda a seis mil', 'RYR4512 fh l 220 a 60'],
    ['ryanair cuatro cinco uno dos baje a cuatro mil y reduzca velocidad dos uno cero', 'RYR4512 a 40 sp 210'],
    ['lufthansa uno ocho seis seis autorizado aproximación ILS pista uno cuatro derecha', 'DLH1866 i 14R'],
    ['europa cero cinco uno descienda y mantenga nueve mil', 'AEA051 a 90'],
    ['iberia uno dos tres cuatro gire a la derecha rumbo cero cuatro cinco', 'IBE1234 fh r 045'],
    ['IBE1234 baje a 3000', 'IBE1234 a 30']
];

const check = (t, [phrase, expected]) => {
    const result = interpretCommand(phrase, CONTEXT);

    t.is(result ? result.text : null, expected, phrase);
};

ava('English phraseology corpus', (t) => {
    CORPUS_EN.forEach((entry) => check(t, entry));
});

ava('Spanish phraseology corpus', (t) => {
    CORPUS_ES.forEach((entry) => check(t, entry));
});

ava('numbers are normalized from words, ICAO pronunciation included', (t) => {
    t.is(wordsToNumbers('one two zero'), '120');
    t.is(wordsToNumbers('tree fife niner'), '359');
    t.is(wordsToNumbers('five thousand'), '5000');
    t.is(wordsToNumbers('three thousand five hundred'), '3500');
    t.is(wordsToNumbers('tres mil quinientos'), '3500');
    t.is(wordsToNumbers('cinco mil'), '5000');
    t.is(normalizePhraseology('Flight Level one two zero'), 'fl120');
    t.is(normalizePhraseology('nivel de vuelo dos cuatro cero'), 'fl240');
});

ava('a message for an aircraft that is not on the scope is never sent to another one', (t) => {
    t.is(interpretCommand('iberia nine nine nine nine turn left heading 270', CONTEXT), null);
    t.is(interpretCommand('air france one two three descend 5000', CONTEXT), null);
});

ava('a slip in the airline name is tolerated, one in the flight number is not', (t) => {
    t.is(findCallsign('iberya 1234 heading 270', CONTEXT.aircraft).callsign, 'IBE1234');
    t.is(findCallsign('iberia 1235 heading 270', CONTEXT.aircraft), null);
});

ava('fixes are matched with one slip at most, and only if unambiguous', (t) => {
    t.is(matchFix('nando', CONTEXT.fixes), 'NANDO');
    t.is(matchFix('nanda', CONTEXT.fixes), 'NANDO');
    t.is(matchFix('xxxxx', CONTEXT.fixes), null);
});

ava('nothing understood gives null', (t) => {
    t.is(interpretCommand('iberia one two three four good morning', CONTEXT), null);
});
