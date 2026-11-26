import { cleanText, normalizePhraseology } from './phraseologyNormalizer';

/**
 * Interprets ATC phraseology in English or Spanish ("Iberia one two three four, turn left heading two seven
 * zero, descend and maintain five thousand" / "IBE1234 vire a la izquierda rumbo 270 y baje a 5000") into a
 * canonical simulator command ("IBE1234 fh l 270 a 50").
 *
 * Deterministic: a grammar per instruction, no external service. The callsign is looked up only among the
 * aircraft on the scope, by ICAO code or by the airline's radio telephony.
 *
 * The phraseology of each instruction follows the bot command matrix (docs/bots/matriz-comandos.md).
 */

/**
 * Edit distance, for small slips of the speech recognition in airline names and fixes
 *
 * @function levenshtein
 */
export function levenshtein(a, b) {
    const previous = Array.from({ length: b.length + 1 }, (value, index) => index);

    for (let i = 1; i <= a.length; i++) {
        let diagonal = previous[0];

        previous[0] = i;

        for (let j = 1; j <= b.length; j++) {
            const above = previous[j];

            previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
            diagonal = above;
        }
    }

    return previous[b.length];
}

/**
 * Finds the aircraft the message is addressed to, at the start of the text
 *
 * @function findCallsign
 * @param text {string} normalized
 * @param aircraft {array<object>} `{ callsign: 'IBE1234', telephony: 'Iberia' }` of the aircraft on the scope
 * @return {object|null} `{ callsign, rest }`
 */
export function findCallsign(text, aircraft) {
    const compact = text.replace(/ /g, '');
    let best = null;

    aircraft.forEach(({ callsign, telephony }) => {
        const flight = callsign.slice(3).toLowerCase();
        const words = text.split(' ');

        // "ibe1234" or "ibe 1234"
        if (compact.startsWith(callsign.toLowerCase())) {
            let consumed = '';
            let index = 0;

            while (index < words.length && consumed.length < callsign.length) {
                consumed += words[index];
                index += 1;
            }

            best = best || { callsign, rest: words.slice(index).join(' '), score: 0 };

            return;
        }

        // "iberia 1234" (telephony): the name may be heard as one to three words ("ryan air") with a small slip
        if (telephony) {
            const name = cleanText(telephony).replace(/ /g, '');
            const tolerance = Math.max(1, Math.floor(name.length / 5));

            for (let count = 1; count <= 3 && count < words.length; count++) {
                const distance = levenshtein(name, words.slice(0, count).join(''));
                const number = words[count] || '';

                if (distance <= tolerance && number === flight && (!best || distance < best.score)) {
                    best = { callsign, rest: words.slice(count + 1).join(' '), score: distance };
                }
            }
        }

        // just the flight number, when only one aircraft has it
        if (!best && words[0] === flight && aircraft.filter((other) => other.callsign.slice(3).toLowerCase() === flight).length === 1) {
            best = { callsign, rest: words.slice(1).join(' '), score: 2 };
        }

        return null;
    });

    return best ? { callsign: best.callsign, rest: best.rest } : null;
}

/**
 * Fix name heard, matched against the fixes of the airport (one slip allowed for names of 4 letters or more)
 *
 * @function matchFix
 */
export function matchFix(heard, fixes = []) {
    const upper = heard.toUpperCase();

    if (fixes.includes(upper)) {
        return upper;
    }

    const candidates = fixes.filter((fix) => fix.length >= 4 && levenshtein(fix, upper) <= 1);

    return candidates.length === 1 ? candidates[0] : null;
}

const runwayName = (text) => {
    const match = text.match(/^(\d{1,2})\s*(l|r|c|left|right|center|centre|izquierda|derecha|centro)?$/);

    if (!match) {
        return null;
    }

    const side = {
        left: 'l', izquierda: 'l', right: 'r', derecha: 'r', center: 'c', centre: 'c', centro: 'c'
    }[match[2]] || match[2] || '';

    return `${match[1].padStart(2, '0')}${side}`.toUpperCase();
};

const RUNWAY = '(?:runway|pista)\\s+(\\d{1,2}(?:\\s*(?:l|r|c|left|right|center|centre|izquierda|derecha|centro))?)';

/**
 * Grammar: each instruction is a regular expression over the normalized text and a builder of the command.
 * Order matters only for overlapping phrases (the more specific first).
 *
 * @property INSTRUCTIONS
 * @type {array<object>}
 */
export const INSTRUCTIONS = [
    {
        name: 'ils',
        pattern: new RegExp(`(?:cleared|autorizad[oa])\\s+(?:for\\s+)?(?:the\\s+)?(?:ils|aproximacion(?:\\s+ils)?)\\s+(?:approach\\s+)?${RUNWAY}`),
        build: (match) => `i ${runwayName(match[1])}`
    },
    {
        name: 'land',
        pattern: new RegExp(`(?:cleared to land|autorizad[oa] a aterrizar)(?:\\s+${RUNWAY})?`),
        build: () => 'land'
    },
    {
        name: 'takeoff',
        pattern: /(?:cleared for take ?off|autorizad[oa] a despegar)/,
        build: () => 'cto'
    },
    {
        name: 'lineUp',
        pattern: /(?:line up and wait|alinee y espere|alinee y mantenga)/,
        build: () => 'lineup'
    },
    {
        name: 'abort',
        pattern: /(?:cancel take ?off clearance|stop immediately|cancelo autorizacion de despegue|pare inmediatamente|aborte el despegue)/,
        build: () => 'abort'
    },
    {
        name: 'taxi',
        pattern: new RegExp(`(?:taxi|ruede)\\s+(?:to\\s+|hasta\\s+(?:la\\s+)?|a\\s+(?:la\\s+)?)?(?:holding point\\s+)?${RUNWAY}`),
        build: (match) => `taxi ${runwayName(match[1])}`
    },
    {
        name: 'goAround',
        pattern: /(?:go around|motor y al aire|frustre|ejecute frustrada)/,
        build: () => 'ga'
    },
    {
        name: 'climbViaSid',
        pattern: /(?:climb via (?:the )?sid|ascienda (?:segun|por) la sid|suba segun la sid)/,
        build: () => 'cvs'
    },
    {
        name: 'descendViaStar',
        pattern: /(?:descend via (?:the )?star|descienda (?:segun|por) la star|baje segun la star)/,
        build: () => 'dvs'
    },
    {
        name: 'heading',
        pattern: /(?:(?:turn|vire|gire)\s+(?:a\s+la\s+)?(left|right|izquierda|derecha)\s+)?(?:heading|rumbo)\s+(\d{1,3})\b/,
        build: (match) => {
            const direction = {
                left: 'l', izquierda: 'l', right: 'r', derecha: 'r'
            }[match[1]];
            const heading = String(Number(match[2]) % 360 || 360).padStart(3, '0');

            return direction ? `fh ${direction} ${heading}` : `fh ${heading}`;
        }
    },
    {
        name: 'altitude',
        pattern: /(?:climb|descend|maintain|ascienda|descienda|suba|baje|mantenga)(?:\s+(?:and maintain|y mantenga|a|hasta|to))*\s+(fl\d{2,3}|\d{3,5})(?:\s*(?:feet|ft|pies))?(\s+(?:expedite|expedito|expedita|rapido))?/,
        build: (match) => {
            const value = match[1].startsWith('fl') ? Number(match[1].slice(2)) : Math.round(Number(match[1]) / 100);

            return `a ${value}${match[2] ? ' ex' : ''}`;
        }
    },
    {
        name: 'speed',
        pattern: /(?:speed|velocidad|reduce|reduzca|increase|aumente|maintain speed|mantenga velocidad)(?:\s+(?:speed|velocidad|to|a))*\s+(\d{2,3})(?:\s*(?:knots|kt|nudos))?/,
        build: (match) => `sp ${match[1]}`
    },
    {
        name: 'direct',
        pattern: /(?:proceed direct(?: to)?|direct to|direct|proceda directo a|directo a|directo)\s+([a-z]{2,5})\b/,
        build: (match, context) => {
            const fix = matchFix(match[1], context.fixes);

            return fix ? `pd ${fix}` : null;
        }
    },
    {
        name: 'hold',
        pattern: /(?:hold(?: at| over)?|mantenga en espera sobre|espere sobre|espera sobre)\s+([a-z]{2,5})\b/,
        build: (match, context) => {
            const fix = matchFix(match[1], context.fixes);

            return fix ? `hold ${fix}` : null;
        }
    },
    {
        name: 'squawk',
        pattern: /(?:squawk|transponda|transpondedor)\s+(\d{4})\b/,
        build: (match) => `sq ${match[1]}`
    }
];

/**
 * Interprets a message
 *
 * @function interpretCommand
 * @param text {string} as heard or typed
 * @param context {object} `{ aircraft: [{ callsign, telephony }], fixes: ['NANDO', ...] }`
 * @return {object|null} `{ callsign, commands: ['fh l 270', 'a 50'], text: 'IBE1234 fh l 270 a 50', instructions }`
 *   or null if nothing was understood
 */
export function interpretCommand(text, context) {
    const normalized = normalizePhraseology(text);
    const target = findCallsign(normalized, context.aircraft || []);

    if (!target) {
        return null;
    }

    let rest = ` ${target.rest} `;
    const found = [];

    INSTRUCTIONS.forEach((instruction) => {
        const match = rest.match(instruction.pattern);

        if (!match) {
            return;
        }

        const command = instruction.build(match, context);

        if (command) {
            found.push({ index: match.index, name: instruction.name, command });
            // each phrase is used once
            rest = `${rest.slice(0, match.index)}${' '.repeat(match[0].length)}${rest.slice(match.index + match[0].length)}`;
        }
    });

    if (found.length === 0) {
        return null;
    }

    // in the order they were said
    found.sort((a, b) => a.index - b.index);

    const commands = found.map((item) => item.command);

    return {
        callsign: target.callsign,
        commands,
        instructions: found.map((item) => item.name),
        text: `${target.callsign} ${commands.join(' ')}`
    };
}
