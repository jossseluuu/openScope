/* global ort */
import SafetyShield from '../safetyShield';
import { ACTION_COUNT, ACTION_INDEX, actionToCommand } from '../actionSpace';
import {
    FEATURE_COUNT, FEATURE_VERSION, GLOBAL_FEATURE_COUNT, MAX_AIRCRAFT, encodeObservation
} from './featureEncoder';

/**
 * ONNX Runtime Web, loaded on demand the first time Bot B is activated
 *
 * @property ONNX_RUNTIME_URL
 * @type {string}
 * @final
 */
const ONNX_RUNTIME_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.min.js';

/**
 * Where the trained model is published (see `openscope_bots.export_onnx`)
 *
 * @property MODEL_URL
 * @type {string}
 * @final
 */
const MODEL_URL = 'assets/bots/botB.onnx';

const loadScript = (url) => new Promise((resolve, reject) => {
    const script = document.createElement('script');

    script.src = url;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`unable to load ${url}`));
    document.head.appendChild(script);
});

/**
 * Runs Bot B's network in the browser.
 *
 * It encodes the observation exactly as during training, picks the most likely
 * allowed action for every aircraft, and applies the safety shield's imposed
 * actions on top.
 *
 * @class BotBRuntime
 */
export default class BotBRuntime {
    /**
     * Load ONNX Runtime and the trained model
     *
     * @for BotBRuntime
     * @method load
     * @static
     * @return {Promise<BotBRuntime>}
     */
    static load() {
        // promises rather than async/await: the build has no regenerator runtime
        const runtimeReady = typeof ort === 'undefined' ? loadScript(ONNX_RUNTIME_URL) : Promise.resolve();

        return runtimeReady
            .then(() => fetch(MODEL_URL.replace('.onnx', '.json')))
            .then((response) => {
                if (!response.ok) {
                    throw new Error('no trained model found in assets/bots (train Bot B and run export_onnx first)');
                }

                return response.json();
            })
            .then((metadata) => {
                if (metadata.featureVersion !== FEATURE_VERSION || metadata.actionCount !== ACTION_COUNT ||
                    metadata.featureCount !== FEATURE_COUNT || metadata.maxAircraft !== MAX_AIRCRAFT) {
                    throw new Error('the model was trained with a different version of the bot code; export it again');
                }

                return ort.InferenceSession.create(MODEL_URL);
            })
            .then((session) => new BotBRuntime(session));
    }

    /**
     * @constructor
     * @param session {ort.InferenceSession}
     */
    constructor(session) {
        this._session = session;
        this.shield = new SafetyShield();
    }

    /**
     * Decisions for the current observation
     *
     * @for BotBRuntime
     * @method decide
     * @param observation {object}
     * @return {Promise<array<object>>} `{ callsign, action, command, reason }`
     */
    decide(observation) {
        const encoded = encodeObservation(observation, this.shield);
        const feeds = {
            tokens: new ort.Tensor('float32', Float32Array.from(encoded.tokens), [1, MAX_AIRCRAFT, FEATURE_COUNT]),
            token_mask: new ort.Tensor('float32', Float32Array.from(encoded.tokenMask), [1, MAX_AIRCRAFT]),
            action_mask: new ort.Tensor('float32', Float32Array.from(encoded.actionMask), [1, MAX_AIRCRAFT, ACTION_COUNT]),
            global: new ort.Tensor('float32', Float32Array.from(encoded.global), [1, GLOBAL_FEATURE_COUNT])
        };
        return this._session.run(feeds).then(({ logits }) => this._decisionsFromLogits(observation, encoded, logits.data));
    }

    _decisionsFromLogits(observation, encoded, logits) {
        const required = this.shield.getRequiredActions(observation);
        const decisions = [];

        encoded.callsigns.forEach((callsign, slot) => {
            if (!callsign) {
                return;
            }

            let action = ACTION_INDEX.NOOP;
            let best = -Infinity;

            for (let i = 0; i < ACTION_COUNT; i++) {
                const value = logits[slot * ACTION_COUNT + i];

                if (encoded.actionMask[slot * ACTION_COUNT + i] && value > best) {
                    best = value;
                    action = i;
                }
            }

            const reason = required[callsign] !== undefined ? 'safety shield' : 'network';

            if (required[callsign] !== undefined) {
                action = required[callsign];
            }

            if (action === ACTION_INDEX.NOOP) {
                return;
            }

            const aircraft = observation.aircraft.find((candidate) => candidate.callsign === callsign);

            decisions.push({
                callsign, action, command: actionToCommand(action, aircraft, observation), reason
            });
        });

        return decisions;
    }
}
