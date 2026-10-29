/**
 * Enum containing all triggerable events triggered via the `EventBus`
 *
 * Before adding an event, every effort should be made to communicate
 * accross classes with direct imports. Events are available but can
 * be harder to debug and follow. Use with caution.
 *
 * @property EVENT
 * @type {Object}
 * @final
 */
export const EVENT = {
    /**
     * The player typed `bot a`, `bot b` or `bot off`
     *
     * @memberof EVENT
     * @property BOT_COMMAND
     * @type {string}
     */
    BOT_COMMAND: 'bot-command',

    /**
     * The player typed `audit`: open the bot audit page (`/bot-audit`)
     *
     * @memberof EVENT
     * @property AUDIT_PANEL_TOGGLE
     * @type {string}
     */
    AUDIT_PANEL_TOGGLE: 'audit-panel-toggle',

    /**
     * Add an aircraft to the simulation
     *
     * @memberof EVENT
     * @property ADD_AIRCRAFT
     * @type {string}
     */
    ADD_AIRCRAFT: 'add-aircraft',

    /**
     * @memberof EVENT
     * @property AIRPORT_CHANGE
     * @type {string}
     */
    AIRPORT_CHANGE: 'airport-change',

    /**
     * @memberof EVENT
     * @property CHAT_LOG_DURATION_CHANGE
     * @type {string}
     */
    CHAT_LOG_DURATION_CHANGE: 'chat-log-duration-change',

    /**
     * A click was registered outside of a specific `StripViewModel`
     * and the active strip, if any, should have the `active`
     * css classname removed
     *
     * @memberof EVENT
     * @property DESELECT_AIRCRAFT
     * @type {string}
     */
    DESELECT_AIRCRAFT: 'deselect-aircraft',

    /**
     * Event used to notify the `CanvasController` when a re-draw
     * should happen outside of the usual game loop.
     *
     * This should only occur as a result of a user action
     *
     * @memberof EVENT
     * @property MARK_SHALLOW_RENDER
     * @type {string}
     */
    MARK_SHALLOW_RENDER: 'mark-shallow-render',

    /**
     * @memberof EVENT
     * @property MEASURE_TOOL_STYLE_CHANGE
     * @type {string}
     */
    MEASURE_TOOL_STYLE_CHANGE: 'measure-tool-style-change',

    /**
     * A pan event has been detected necessitating an entire redraw of each canvas
     *
     * This may constitute a pan-in-progress and not the completion of a panning action
     *
     * @memberof EVENT
     * @property PAN_VIEWPORT
     * @type {string}
     */
    PAN_VIEWPORT: 'pan-viewport',

    /**
     * Fired when the update loop should be either paused or resumed.
     *
     * Usually called when airport data is changing (ie, when a new airport
     * is being loaded).
     *
     * @memberof EVENT
     * @property PAUSE_UPDATE_LOOP
     * @type {string}
     */
    PAUSE_UPDATE_LOOP: 'pause-update-loop',

    /**
     * Increase the length of the PTL lines on the scope
     *
     * @memberof EVENT
     * @property PTL_DECREASE_LENGTH
     * @type {string}
     */
    PTL_DECREASE_LENGTH: 'ptl-decrease-length',

    /**
     * Increase the length of the PTL lines on the scope
     *
     * @memberof EVENT
     * @property PTL_INCREASE_LENGTH
     * @type {string}
     */
    PTL_INCREASE_LENGTH: 'ptl-increase-length',

    /**
     * Remove an aircraft from the sim
     *
     * Usually as a result of the `del` user command
     *
     * @memberof EVENT
     * @property REMOVE_AIRCRAFT
     * @type {string}
     */
    REMOVE_AIRCRAFT: 'remove-aircraft',

    /**
     * Remove an `AircraftConflict` for an aircraft
     *
     * @memberof EVENT
     * @property REMOVE_AIRCRAFT_CONFLICT
     * @type {string}
     */
    REMOVE_AIRCRAFT_CONFLICT: 'remove-aircraft-conflict',

    /**
     * An aircraft has been located and needs to be centered in the view
     *
     * @memberof EVENT
     * @property REQUEST_TO_CENTER_POINT_IN_VIEW
     * @type {string}
     */
    REQUEST_TO_CENTER_POINT_IN_VIEW: 'request-to-center-point-in-view',

    /**
     * An aircraft radar return was double clicked and the corresponding
     * `StripViewModel` must be scrolled into view
     *
     * @memberof EVENT
     * @property SCROLL_TO_AIRCRAFT
     * @type {string}
     */
    SCROLL_TO_AIRCRAFT: 'scroll-to-aircraft',

    /**
     * An aircraft radar return was clicked and the corresponding
     * `StripViewModel` must also be selected
     *
     * @memberof EVENT
     * @property SELECT_AIRCRAFT
     * @type {string}
     */
    SELECT_AIRCRAFT: 'select-aircraft',

    /**
     * An aircraft progress strip was clicked
     *
     * @memberof EVENT
     * @property STRIP_CLICK
     * @type {string}
     */
    STRIP_CLICK: 'strip-click',

    /**
     * An aircraft progress strip was double clicked
     *
     * @memberof EVENT
     * @property STRIP_DOUBLE_CLICK
     * @type {string}
     */
    STRIP_DOUBLE_CLICK: 'strip-double-click',

    /**
     * Change the active theme to the specified theme name
     *
     * @memberof EVENT
     * @property SET_THEME
     * @type {string}
     */
    SET_THEME: 'set-theme',

    /**
     * Step through pre-defined timewarp speeds
     *
     * @memberof EVENT
     * @property TIMEWARP_TOGGLE
     * @type {string}
     */
    TIMEWARP_TOGGLE: 'timewarp-toggle',

    /**
     * An request has been made to clear and respawn traffic at the current airport
     *
     * @memberof EVENT
     * @property TRAFFIC_RESET
     * @type {string}
     */
    TRAFFIC_RESET: 'traffic-reset',

    /**
     * @memberof EVENT
     * @property TOGGLE_AIRPORT_GUIDE
     * @type {string}
     */
    TOGGLE_AIRPORT_GUIDE: 'toggle-airport-guide',

    /**
     * @memberof EVENT
     * @property TOGGLE_AIRSPACE
     * @type {string}
     */
    TOGGLE_AIRSPACE: 'toggle-airspace',

    /**
     * @memberof EVENT
     * @property TOGGLE_CHANGELOG
     * @type {string}
     */
    TOGGLE_CHANGELOG: 'toggle-changelog',

    /**
     * @memberof EVENT
     * @property TOGGLE_LABELS
     * @type {string}
     */
    TOGGLE_LABELS: 'toggle-labels',

    /**
     * Pause/unpause the game loop
     *
     * @memberof EVENT
     * @property TOGGLE_PAUSE
     * @type {string}
     */
    TOGGLE_PAUSE: 'toggle-pause',

    /**
     * @memberof EVENT
     * @property TOGGLE_RESTRICTED_AREAS
     * @type {string}
     */
    TOGGLE_RESTRICTED_AREAS: 'toggle-restricted-areas',

    /**
     * @memberof EVENT
     * @property TOGGLE_SID_MAP
     * @type {string}
     */
    TOGGLE_SID_MAP: 'toggle-sid-map',

    /**
     * @memberof EVENT
     * @property TOGGLE_STAR_MAP
     * @type {string}
     */
    TOGGLE_STAR_MAP: 'toggle-star-map',

    /**
     * @memberof EVENT
     * @property TOGGLE_TERRAIN
     * @type {string}
     */
    TOGGLE_TERRAIN: 'toggle-terrain',

    /**
     * @memberof EVENT
     * @property TOGGLE_TRAFFIC
     * @type {string}
     */
    TOGGLE_TRAFFIC: 'toggle-traffic',

    /**
     * Open/close the tutorial modal
     *
     * @memberof EVENT
     * @property TOGGLE_TUTORIAL
     * @type {string}
     */
    TOGGLE_TUTORIAL: 'toggle-tutorial',

    /**
     * @memberof EVENT
     * @property TOGGLE_VIDEO_MAP
     * @type {string}
     */
    TOGGLE_VIDEO_MAP: 'toggle-video-map',

    /**
     * @memberof EVENT
     * @property RANGE_RINGS_CHANGE
     * @type {string}
     */
    RANGE_RINGS_CHANGE: 'range-rings-change',

    /**
     * A click has been registered in the unpause button shown within the
     * screen overlay whil the app is paused
     *
     * @memberof EVENT
     * @property UNPAUSE
     * @type {string}
     */
    UNPAUSE: 'unpause',

    /**
     * @memberof EVENT
     * @property WIND_CHANGE
     * @type {string}
     */
    WIND_CHANGE: 'wind-change',

    /**
     * The zoom level has changed necessitating an entire redraw of each canvas
     *
     * @memberof EVENT
     * @property ZOOM_VIEWPORT
     * @type {string}
     */
    ZOOM_VIEWPORT: 'zoom-viewport'
};

export const AIRCRAFT_EVENT = {
    /**
     * Triggered when the aircraft received takeoff clearance.
     *
     * @memberof AIRCRAFT_EVENT
     * @property TAKEOFF
     * @type {string}
     */
    TAKEOFF: 'takeoff',

    /**
     * Trigged when the aircraft enters the approach
     *
     * @memberof AIRCRAFT_EVENT
     * @property APPROACH
     * @type {string}
     */
    APPROACH: 'approach',

    /**
     * Trigged when the aircraft reaches its final approach
     *
     * @memberof AIRCRAFT_EVENT
     * @property FINAL_APPROACH
     * @type {string}
     */
    FINAL_APPROACH: 'final-approach',

    /**
     * FOR FUTURE USE. Should be trigged when the aircraft landed on the runway.
     *
     * @memberof AIRCRAFT_EVENT
     * @property LANDING
     * @type {string}
     */
    LANDING: 'landing',

    /**
     * The aircraft discontinued its approach, either on its own (unstable
     * approach, runway occupied) or because the controller instructed it
     *
     * @memberof AIRCRAFT_EVENT
     * @property GO_AROUND
     * @type {string}
     */
    GO_AROUND: 'go-around',

    /**
     * The aircraft landed and came to a fullstop.
     *
     * @memberof AIRCRAFT_EVENT
     * @property FULLSTOP
     * @type {string}
     */
    FULLSTOP: 'fullstop',

    /**
     * Triggered when the aircraft exits the airspace.
     *
     * @memberof AIRCRAFT_EVENT
     * @property AIRSPACE_EXIT
     * @type {string}
     */
    AIRSPACE_EXIT: 'airspace-exit'
};

/**
 * Events recorded by the decision audit (see `DecisionAudit`)
 *
 * @property AUDIT_EVENT
 * @type {Object}
 * @final
 */
export const AUDIT_EVENT = {
    /**
     * A new airborne aircraft passed the spawn safety check and was created: `{ route, callsign, altitude, note }`
     *
     * @memberof AUDIT_EVENT
     * @property SPAWNED
     * @type {string}
     */
    SPAWNED: 'audit-spawned',

    /**
     * A spawn was postponed because it would not be safe: `{ route, reason }`
     *
     * @memberof AUDIT_EVENT
     * @property SPAWN_DELAYED
     * @type {string}
     */
    SPAWN_DELAYED: 'audit-spawn-delayed',

    /**
     * A rule of the Rulebook was broken: the violation object
     *
     * @memberof AUDIT_EVENT
     * @property RULE_VIOLATION
     * @type {string}
     */
    RULE_VIOLATION: 'audit-rule-violation',

    /**
     * The score changed: `{ event, points, score }`
     *
     * @memberof AUDIT_EVENT
     * @property SCORE_EVENT
     * @type {string}
     */
    SCORE_EVENT: 'audit-score-event',

    /**
     * A clearance was issued, by the player or a bot: `{ source, callsign, command, reason, accepted, message }`
     *
     * @memberof AUDIT_EVENT
     * @property COMMAND_ISSUED
     * @type {string}
     */
    COMMAND_ISSUED: 'audit-command-issued',

    /**
     * A bot took a decision: `{ name, observation, decisions }`
     *
     * @memberof AUDIT_EVENT
     * @property BOT_STEP
     * @type {string}
     */
    BOT_STEP: 'audit-bot-step'
};
