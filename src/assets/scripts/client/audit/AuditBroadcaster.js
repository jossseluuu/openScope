import EventBus from '../lib/EventBus';
import { AUDIT_CHANNEL_NAME, AUDIT_MESSAGE } from './auditConstants';
import { EVENT } from '../constants/eventNames';

/**
 * Milliseconds between two snapshots sent to the bot audit page
 *
 * @property SNAPSHOT_INTERVAL_MS
 * @type {number}
 * @final
 */
const SNAPSHOT_INTERVAL_MS = 1000;

/**
 * Snapshots are only sent while the page has said it is open within this time
 *
 * @property SUBSCRIBER_TIMEOUT_MS
 * @type {number}
 * @final
 */
const SUBSCRIBER_TIMEOUT_MS = 6000;

/**
 * Path of the bot audit page, served next to the game (`localhost:3003/bot-audit`)
 *
 * @property AUDIT_PAGE_PATH
 * @type {string}
 * @final
 */
const AUDIT_PAGE_PATH = 'bot-audit';

/**
 * Sends what the `AuditController` records to the bot audit page, a separate page of the same
 * site (`/bot-audit`), through a `BroadcastChannel`. Nothing is sent while no page is open.
 * The `audit` command opens the page.
 *
 * @class AuditBroadcaster
 */
export default class AuditBroadcaster {
    /**
     * @constructor
     * @param auditController {AuditController}
     */
    constructor(auditController) {
        this._audit = auditController;
        this._lastSubscription = 0;
        this._channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(AUDIT_CHANNEL_NAME);

        EventBus.on(EVENT.AUDIT_PANEL_TOGGLE, () => this.openPage());

        if (!this._channel) {
            return;
        }

        this._channel.onmessage = (event) => this._onMessage(event.data);
        this._timer = setInterval(() => this._sendSnapshot(), SNAPSHOT_INTERVAL_MS);
    }

    /**
     * Open the bot audit page in another tab (or bring it to the front)
     *
     * @for AuditBroadcaster
     * @method openPage
     */
    openPage() {
        window.open(AUDIT_PAGE_PATH, AUDIT_CHANNEL_NAME);
    }

    _onMessage(message) {
        if (!message) {
            return;
        }

        if (message.type === AUDIT_MESSAGE.SUBSCRIBE) {
            this._lastSubscription = Date.now();
            this._sendSnapshot();

            return;
        }

        if (message.type === AUDIT_MESSAGE.EXPORT_REQUEST) {
            const { summary, observation } = this._audit.getSnapshot();
            const airport = observation ? observation.airport.icao.toLowerCase() : 'game';
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');

            this._channel.postMessage({
                type: AUDIT_MESSAGE.EXPORT,
                text: this._audit.exportJsonLines(),
                filename: `audit_${airport}_${stamp}_${summary.trainingSteps}steps.jsonl`
            });
        }
    }

    _sendSnapshot() {
        if (Date.now() - this._lastSubscription > SUBSCRIBER_TIMEOUT_MS) {
            return;
        }

        this._channel.postMessage({ type: AUDIT_MESSAGE.SNAPSHOT, snapshot: this._audit.getSnapshot() });
    }
}
