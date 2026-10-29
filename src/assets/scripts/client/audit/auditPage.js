import { AUDIT_CHANNEL_NAME, AUDIT_MESSAGE } from './auditConstants';
import { TABS, renderTab } from './auditRenderers';

/**
 * Entry point of the bot audit page (`/bot-audit`): shows what the game open in another tab
 * of the same site records (see `AuditBroadcaster`)
 */

/**
 * Milliseconds between two "the page is open" messages to the game
 *
 * @property SUBSCRIBE_INTERVAL_MS
 * @type {number}
 * @final
 */
const SUBSCRIBE_INTERVAL_MS = 2000;

/**
 * Without a snapshot for this long, the game is shown as disconnected
 *
 * @property DISCONNECTED_AFTER_MS
 * @type {number}
 * @final
 */
const DISCONNECTED_AFTER_MS = 5000;

const STORAGE_KEY = 'openscope-bot-audit-tab';

const $ = (selector) => document.querySelector(selector);

function savedTab() {
    try {
        const tab = localStorage.getItem(STORAGE_KEY);

        return TABS.some((item) => item.id === tab) ? tab : TABS[0].id;
    } catch (error) {
        return TABS[0].id;
    }
}

function start() {
    if (typeof BroadcastChannel === 'undefined') {
        $('#status').textContent = 'Este navegador no permite comunicar pestañas (BroadcastChannel).';

        return;
    }

    const channel = new BroadcastChannel(AUDIT_CHANNEL_NAME);
    const state = { tab: savedTab(), snapshot: null, receivedAt: 0 };
    const $tabs = $('#tabs');
    const $body = $('#body');

    function render() {
        document.querySelectorAll('.tab').forEach((link) => {
            link.classList.toggle('is-active', link.dataset.tab === state.tab);
        });

        if (!state.snapshot) {
            $body.innerHTML = '<p class="audit-empty">Esperando datos de la partida…</p>';

            return;
        }

        const { scrollTop } = $body;

        $body.innerHTML = renderTab(state.tab, state.snapshot);
        $body.scrollTop = scrollTop;
    }

    function renderStatus() {
        const isConnected = Date.now() - state.receivedAt < DISCONNECTED_AFTER_MS;
        const observation = state.snapshot && state.snapshot.observation;
        const $status = $('#status');

        $status.classList.toggle('is-connected', isConnected);
        $status.textContent = isConnected && observation ?
            `Conectado: ${observation.airport.icao} · ${state.snapshot.activeBot ? `Bot ${state.snapshot.activeBot} al mando` : 'mandas tú'}` :
            'Sin partida: abre el juego en otra pestaña de este mismo sitio (por ejemplo localhost:3003)';
    }

    TABS.forEach((tab) => {
        const link = document.createElement('button');

        link.className = 'tab';
        link.dataset.tab = tab.id;
        link.textContent = tab.label;
        link.addEventListener('click', () => {
            state.tab = tab.id;

            try {
                localStorage.setItem(STORAGE_KEY, tab.id);
            } catch (error) {
                // the tab is just not remembered
            }

            render();
        });
        $tabs.appendChild(link);
    });

    channel.onmessage = (event) => {
        const message = event.data;

        if (message.type === AUDIT_MESSAGE.SNAPSHOT) {
            state.snapshot = message.snapshot;
            state.receivedAt = Date.now();
            renderStatus();
            render();
        } else if (message.type === AUDIT_MESSAGE.EXPORT) {
            const blob = new Blob([message.text], { type: 'application/x-ndjson' });
            const link = document.createElement('a');

            link.href = URL.createObjectURL(blob);
            link.download = message.filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        }
    };

    $('#export').addEventListener('click', () => channel.postMessage({ type: AUDIT_MESSAGE.EXPORT_REQUEST }));

    const subscribe = () => channel.postMessage({ type: AUDIT_MESSAGE.SUBSCRIBE });

    subscribe();
    setInterval(() => {
        subscribe();
        renderStatus();
    }, SUBSCRIBE_INTERVAL_MS);
    render();
    renderStatus();
}

let isStarted = false;

function startOnce() {
    if (!isStarted) {
        isStarted = true;
        start();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startOnce);
} else {
    startOnce();
}
