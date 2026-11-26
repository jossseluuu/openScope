import UiController from '../ui/UiController';
import { interpretCommand } from './commandInterpreter';

/**
 * Key held down to talk (push-to-talk)
 *
 * @property PUSH_TO_TALK_KEY
 * @type {string}
 * @final
 */
export const PUSH_TO_TALK_KEY = 'F2';

/**
 * Recognition languages by game option value
 *
 * @property VOICE_LANGUAGE
 * @type {object}
 * @final
 */
export const VOICE_LANGUAGE = {
    en: 'en-US',
    es: 'es-ES'
};

/**
 * Voice commands with the Web Speech API (Chrome and Edge): hold F2, speak an instruction in English or
 * Spanish phraseology, release. The transcription is interpreted (`commandInterpreter`) and written in the
 * command bar for the controller to check and send with Enter; nothing is sent without that confirmation.
 *
 * Note: in Chrome the audio is processed by Google's speech service.
 *
 * @class SpeechRecognitionController
 */
export default class SpeechRecognitionController {
    /**
     * @constructor
     * @param options {object}
     * @param options.getLanguage {function} returns 'off', 'en' or 'es' (the game option)
     * @param options.getContext {function} returns `{ aircraft: [{ callsign, telephony }], fixes: [...] }`
     * @param options.onInterpreted {function} called with the canonical command text
     */
    constructor({ getLanguage, getContext, onInterpreted }) {
        this._getLanguage = getLanguage;
        this._getContext = getContext;
        this._onInterpreted = onInterpreted;
        this._recognition = null;
        this._isListening = false;
        this._onKeyDown = this._handleKeyDown.bind(this);
        this._onKeyUp = this._handleKeyUp.bind(this);

        if (typeof window !== 'undefined' && typeof document !== 'undefined') {
            document.addEventListener('keydown', this._onKeyDown);
            document.addEventListener('keyup', this._onKeyUp);
        }
    }

    /**
     * Whether the browser offers speech recognition
     *
     * @for SpeechRecognitionController
     * @property isSupported
     * @type {boolean}
     */
    get isSupported() {
        return typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    }

    /**
     * @for SpeechRecognitionController
     * @method destroy
     */
    destroy() {
        if (typeof document !== 'undefined') {
            document.removeEventListener('keydown', this._onKeyDown);
            document.removeEventListener('keyup', this._onKeyUp);
        }

        this.stop();
    }

    /**
     * @for SpeechRecognitionController
     * @method start
     */
    start() {
        const language = VOICE_LANGUAGE[this._getLanguage()];

        if (!language || this._isListening) {
            return;
        }

        if (!this.isSupported) {
            UiController.ui_log('voice commands need Chrome or Edge (Web Speech API)', true);

            return;
        }

        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        this._recognition = new Recognition();
        this._recognition.lang = language;
        this._recognition.interimResults = false;
        this._recognition.maxAlternatives = 3;
        this._recognition.onresult = (event) => this._handleResult(event);
        this._recognition.onerror = (event) => UiController.ui_log(`voice: ${event.error}`, true);
        this._recognition.onend = () => {
            this._isListening = false;
        };
        this._isListening = true;
        this._recognition.start();
        UiController.ui_log('listening… (release F2 to finish)');
    }

    /**
     * @for SpeechRecognitionController
     * @method stop
     */
    stop() {
        if (this._recognition && this._isListening) {
            this._recognition.stop();
        }
    }

    _handleKeyDown(event) {
        if (event.key === PUSH_TO_TALK_KEY && !event.repeat) {
            event.preventDefault();
            this.start();
        }
    }

    _handleKeyUp(event) {
        if (event.key === PUSH_TO_TALK_KEY) {
            event.preventDefault();
            this.stop();
        }
    }

    /**
     * The first alternative that the interpreter understands wins
     *
     * @for SpeechRecognitionController
     * @method _handleResult
     * @private
     */
    _handleResult(event) {
        const result = event.results[event.results.length - 1];
        const alternatives = Array.from({ length: result.length }, (value, index) => result[index].transcript);
        const context = this._getContext();
        const understood = alternatives.map((text) => ({ text, interpretation: interpretCommand(text, context) }))
            .find((candidate) => candidate.interpretation);

        if (!understood) {
            UiController.ui_log(`voice: "${alternatives[0]}" not understood, say again`, true);

            return;
        }

        UiController.ui_log(`voice: "${understood.text}" → ${understood.interpretation.text} (Enter to send)`);
        this._onInterpreted(understood.interpretation.text);
    }
}
