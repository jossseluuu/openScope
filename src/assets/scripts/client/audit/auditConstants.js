/**
 * Outcome of a clearance, from the worst to the best
 *
 * @property OUTCOME
 * @type {object}
 * @final
 */
export const OUTCOME = {
    PENDING: 'pending',
    LOST: 'lost',
    SAFETY: 'safety',
    SEPARATION: 'separation',
    PROCEDURE: 'procedure',
    LANDED: 'landed',
    DEPARTED: 'departed',
    OK: 'ok'
};

/**
 * Name of the `BroadcastChannel` between the game and the bot audit page (`/bot-audit`)
 *
 * @property AUDIT_CHANNEL_NAME
 * @type {string}
 * @final
 */
export const AUDIT_CHANNEL_NAME = 'openscope-bot-audit';

/**
 * Messages on the audit channel
 *
 * @property AUDIT_MESSAGE
 * @type {object}
 * @final
 */
export const AUDIT_MESSAGE = {
    // page -> game: the page is open (sent every few seconds)
    SUBSCRIBE: 'subscribe',
    // game -> page: `{ snapshot }`
    SNAPSHOT: 'snapshot',
    // page -> game: send the full export
    EXPORT_REQUEST: 'export-request',
    // game -> page: `{ text, filename }`
    EXPORT: 'export'
};
