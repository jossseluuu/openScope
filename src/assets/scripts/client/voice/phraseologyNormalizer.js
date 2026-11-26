/**
 * Normalizes spoken or typed ATC phraseology (English and Spanish) into a compact text the interpreter can
 * read: lower case, no accents or punctuation, numbers as digits ("one two zero" -> "120", "five thousand" ->
 * "5000", "flight level one two zero" / "nivel de vuelo uno dos cero" -> "fl120").
 */

/**
 * Words for digits, including the ICAO pronunciations ("tree", "fife", "niner")
 *
 * @property DIGIT_WORDS
 * @type {object}
 * @final
 */
export const DIGIT_WORDS = {
    zero: 0,
    cero: 0,
    one: 1,
    wun: 1,
    uno: 1,
    una: 1,
    two: 2,
    too: 2,
    dos: 2,
    three: 3,
    tree: 3,
    tres: 3,
    four: 4,
    fower: 4,
    cuatro: 4,
    five: 5,
    fife: 5,
    cinco: 5,
    six: 6,
    seis: 6,
    seven: 7,
    siete: 7,
    eight: 8,
    ait: 8,
    ocho: 8,
    nine: 9,
    niner: 9,
    nueve: 9
};

/**
 * Multipliers ("five thousand", "cinco mil", "tres mil quinientos")
 *
 * @property MULTIPLIER_WORDS
 */
const THOUSAND_WORDS = ['thousand', 'mil'];
const HUNDRED_WORDS = ['hundred', 'cientos'];
// Spanish hundreds spoken as one word
const SPANISH_HUNDREDS = {
    cien: 100,
    ciento: 100,
    doscientos: 200,
    trescientos: 300,
    cuatrocientos: 400,
    quinientos: 500,
    seiscientos: 600,
    setecientos: 700,
    ochocientos: 800,
    novecientos: 900
};

/**
 * Remove accents, punctuation and repeated spaces
 *
 * @function cleanText
 * @param text {string}
 * @return {string}
 */
export function cleanText(text) {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9 ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Turns number words into digits. Consecutive digit words join into one number ("one two zero" -> "120");
 * "thousand"/"mil" and "hundred"/"cientos" multiply ("three thousand five hundred" -> "3500").
 *
 * @function wordsToNumbers
 * @param text {string} cleaned text
 * @return {string}
 */
export function wordsToNumbers(text) {
    const words = text.split(' ');
    const output = [];
    let digits = '';
    let total = null;

    const flush = () => {
        if (total !== null) {
            output.push(String(total + (digits ? Number(digits) : 0)));
        } else if (digits) {
            output.push(digits);
        }

        digits = '';
        total = null;
    };

    words.forEach((word) => {
        if (word in DIGIT_WORDS) {
            digits += String(DIGIT_WORDS[word]);
        } else if (/^\d+$/.test(word)) {
            digits += word;
        } else if (THOUSAND_WORDS.includes(word)) {
            total = (total || 0) + (digits ? Number(digits) : 1) * 1000;
            digits = '';
        } else if (HUNDRED_WORDS.includes(word) && digits) {
            total = (total || 0) + Number(digits) * 100;
            digits = '';
        } else if (word in SPANISH_HUNDREDS) {
            total = (total || 0) + SPANISH_HUNDREDS[word];
        } else if ((word === 'y' || word === 'and') && total !== null) {
            // "tres mil y quinientos", "three thousand and five hundred"
        } else {
            flush();
            output.push(word);
        }
    });

    flush();

    return output.join(' ');
}

/**
 * Flight levels as `fl` + number
 *
 * @function joinFlightLevels
 */
export function joinFlightLevels(text) {
    return text
        .replace(/\bflight level (\d{2,3})\b/g, 'fl$1')
        .replace(/\bnivel de vuelo (\d{2,3})\b/g, 'fl$1')
        .replace(/\bnivel (\d{2,3})\b/g, 'fl$1')
        .replace(/\bfl (\d{2,3})\b/g, 'fl$1');
}

/**
 * Runway sides as the letter of the runway name ("32 left" / "32 izquierda" -> "32l")
 *
 * @function joinRunwaySides
 */
export function joinRunwaySides(text) {
    return text
        .replace(/\b(\d{1,2}) (left|izquierda)\b/g, '$1l')
        .replace(/\b(\d{1,2}) (right|derecha)\b/g, '$1r')
        .replace(/\b(\d{1,2}) (center|centre|centro)\b/g, '$1c');
}

/**
 * @function normalizePhraseology
 * @param text {string} as heard or typed
 * @return {string}
 */
export function normalizePhraseology(text) {
    return joinFlightLevels(wordsToNumbers(cleanText(text)));
}
