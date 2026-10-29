import { OUTCOME } from './auditConstants';

/**
 * HTML of the tabs of the bot audit page (`/bot-audit`), built from a snapshot of the
 * `AuditController` (see `AuditController#getSnapshot`)
 */

/**
 * Rows shown in the long lists (decisions, score, spawns), most recent first
 *
 * @property MAX_ROWS
 * @type {number}
 * @final
 */
const MAX_ROWS = 300;

export const TABS = [
    { id: 'aircraft', label: 'Aeronaves' },
    { id: 'decisions', label: 'Decisiones' },
    { id: 'score', label: 'Puntuación' },
    { id: 'spawns', label: 'Spawns' },
    { id: 'summary', label: 'Resumen' }
];

const OUTCOME_LABEL = {
    [OUTCOME.PENDING]: 'pendiente',
    [OUTCOME.LOST]: 'perdido',
    [OUTCOME.SAFETY]: 'seguridad',
    [OUTCOME.SEPARATION]: 'separación',
    [OUTCOME.PROCEDURE]: 'procedimiento',
    [OUTCOME.LANDED]: 'aterrizó',
    [OUTCOME.DEPARTED]: 'salió',
    [OUTCOME.OK]: 'ok'
};

const escape = (value) => String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const clock = (seconds) => {
    const total = Math.max(0, Math.round(seconds || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = total % 60;
    const pad = (value) => String(value).padStart(2, '0');

    return `${hours > 0 ? `${hours}:` : ''}${pad(minutes)}:${pad(rest)}`;
};

const level = (altitude) => (Number.isFinite(altitude) && altitude > 0 ? Math.round(altitude) : '-');

const table = (headers, rows) => `
    <table class="audit-table">
        <thead><tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead>
        <tbody>${rows.join('')}</tbody>
    </table>`;

function renderAircraft(snapshot) {
    const { observation } = snapshot;

    if (!observation) {
        return '<p class="audit-empty">Sin datos todavía.</p>';
    }

    const aircraft = observation.aircraft.slice().sort((a, b) => (a.category === b.category ?
        (a.distance || 0) - (b.distance || 0) : a.category.localeCompare(b.category)));
    // aircraft that broke a rule in the last minute are highlighted
    const recentlyInvolved = {};

    snapshot.violations.filter((violation) => violation.time >= observation.time - 60).forEach((violation) => {
        violation.callsigns.forEach((callsign) => {
            recentlyInvolved[callsign] = violation.rule;
        });
    });

    const rows = aircraft.map((item) => {
        const next = (item.waypoints || []).find((waypoint) => waypoint.name === item.nextWaypoint);
        const toNext = next && Number.isFinite(next.x) ? Math.hypot(next.x - item.x, next.y - item.y) : null;
        const runway = item.category === 'arrival' ? item.arrivalRunway : item.departureRunway;
        const nextPoint = item.isEstablishedOnCourse ? `ILS ${runway}` : item.nextWaypoint;
        const clearance = item.clearance || {};
        const minimum = Math.max(item.minimumVectoringAltitude || 0, item.airspaceFloor || 0);
        // the minimum vectoring altitude does not apply on the ILS
        const isBelowMinimum = !item.isOnGround && item.isControllable && !item.isEstablishedOnCourse &&
            item.altitude < minimum - 100;
        const flags = [
            item.isControllable ? '' : 'no controlado',
            item.hasApproachClearance ? 'aprox. autorizada' : '',
            item.isEstablishedOnCourse ? 'establecido' : '',
            item.isHoldAssigned ? 'en espera' : '',
            recentlyInvolved[item.callsign] ? `INFRACCIÓN: ${recentlyInvolved[item.callsign]}` : '',
            isBelowMinimum ? 'BAJO MÍNIMOS' : '',
            item.conflicts.length ? `tráfico próximo: ${item.conflicts.join(', ')}` : ''
        ].filter(Boolean).join(' · ');
        const rowClass = [
            item.isControllable ? '' : 'is-uncontrolled',
            recentlyInvolved[item.callsign] || isBelowMinimum ? 'is-warning' : ''
        ].join(' ');

        return `<tr class="${rowClass}">
            <td><b>${escape(item.callsign)}</b></td>
            <td>${escape(item.type)} <span class="audit-dim">${escape(item.recatEu || item.wakeCategory || '')}</span></td>
            <td>${item.category === 'arrival' ? 'LLG' : 'SAL'}</td>
            <td>${escape(item.flightPhase)}</td>
            <td>${level(item.altitude)} <span class="audit-dim">→ ${level(clearance.altitude)}</span></td>
            <td>${Math.round(item.speed || 0)} <span class="audit-dim">GS ${Math.round(item.groundSpeed || 0)} → ${clearance.speed || '-'}</span></td>
            <td>${Math.round(item.heading || 0)}°</td>
            <td>${Number.isFinite(item.distance) ? item.distance.toFixed(1) : '-'}</td>
            <td>${escape(nextPoint || '-')} <span class="audit-dim">${toNext === null || item.isEstablishedOnCourse ? '' : `${toNext.toFixed(1)} nm`}</span></td>
            <td>${escape(runway || '-')}</td>
            <td class="audit-dim">${escape((item.route || '').split('.').slice(0, 3).join('.'))}</td>
            <td class="audit-dim">${minimum ? Math.round(minimum) : '-'}</td>
            <td>${escape(flags)}</td>
        </tr>`;
    });

    return `${`<p class="audit-caption">${aircraft.length} aeronaves · hora de juego ${clock(observation.time)} · ` +
        `puntuación ${observation.score} · viento ${observation.airport.wind.angle}°/${observation.airport.wind.speed} kt · ` +
        `configuración ${escape(observation.airport.runwayConfiguration || '-')}</p>`}${
        table(['Indicativo', 'Tipo', 'Cat', 'Fase', 'Alt → autorizada', 'IAS · GS → autorizada', 'Rumbo', 'Dist (nm)',
            'Próximo punto', 'Pista', 'Ruta', 'Mín. (ft)', 'Estado'], rows)}`;
}

function renderDecisions(snapshot) {
    const decisions = snapshot.decisions.slice(-MAX_ROWS).reverse();
    const rows = decisions.map((decision) => {
        const { before } = decision;
        const { after } = decision.outcome;
        const change = before && after ?
            `${level(before.altitude)} ft ${before.speed} kt ${before.distance} nm → ${level(after.altitude)} ft ${after.speed} kt ${after.distance} nm` :
            '';

        return `<tr>
            <td>${clock(decision.time)}</td>
            <td>${escape(decision.source)}</td>
            <td><b>${escape(decision.callsign)}</b></td>
            <td>${escape(decision.command)}${decision.accepted ? '' : ' <span class="audit-bad">(rechazada)</span>'}</td>
            <td class="audit-dim">${escape(decision.reason || decision.message)}</td>
            <td><span class="audit-outcome is-${decision.outcome.status}">${OUTCOME_LABEL[decision.outcome.status]}</span></td>
            <td class="audit-dim">${escape(decision.outcome.violations.join(' | '))}</td>
            <td class="audit-dim">${escape(change)}</td>
        </tr>`;
    });

    return `<p class="audit-caption">Cada orden y lo que le pasó a esa aeronave en los 3 minutos siguientes.</p>${
        table(['Hora', 'Quién', 'Aeronave', 'Orden', 'Motivo', 'Consecuencia', 'Infracciones', 'Antes → después'], rows)}`;
}

function renderScore(snapshot) {
    const entries = snapshot.ledger.slice(-MAX_ROWS).reverse();
    const totals = snapshot.summary.pointsByEvent;
    const totalRows = Object.keys(totals).sort((a, b) => totals[a] - totals[b]).map((event) => `<tr>
        <td>${escape(event)}</td><td class="${totals[event] < 0 ? 'audit-bad' : 'audit-good'}">${totals[event]}</td></tr>`);
    const rows = entries.map((entry) => `<tr>
        <td>${clock(entry.time)}</td>
        <td class="${entry.points < 0 ? 'audit-bad' : 'audit-good'}">${entry.points > 0 ? '+' : ''}${entry.points}</td>
        <td>${escape(entry.event)}</td>
        <td><b>${escape(entry.callsigns.join(' / '))}</b></td>
        <td class="audit-dim">${escape(entry.details)}</td>
        <td>${entry.score}</td>
    </tr>`);

    return `<p class="audit-caption">Total por motivo</p>${table(['Motivo', 'Puntos'], totalRows)
    }<p class="audit-caption">Cada cambio de la puntuación</p>${
        table(['Hora', 'Puntos', 'Motivo', 'Aeronaves', 'Detalle', 'Puntuación'], rows)}`;
}

function renderSpawns(snapshot) {
    const spawns = snapshot.spawns.slice(-MAX_ROWS).reverse();
    const rows = spawns.map((spawn) => `<tr class="${spawn.created ? '' : 'is-warning'}">
        <td>${clock(spawn.time)}</td>
        <td>${spawn.created ? 'creada' : 'aplazada'}</td>
        <td><b>${escape(spawn.callsign || '')}</b></td>
        <td class="audit-dim">${escape(spawn.route)}</td>
        <td>${spawn.altitude ? Math.round(spawn.altitude) : ''}</td>
        <td class="audit-dim">${escape(spawn.reason || spawn.note || '')}</td>
    </tr>`);

    return `${'<p class="audit-caption">Antes de crear una aeronave se comprueba la separación con todo el tráfico ' +
        '(mínimo radar + 5 nm o vertical + 1000 ft) y que no quede por debajo del suelo del sector ni de la MVA.</p>'}${
        table(['Hora', 'Resultado', 'Aeronave', 'Ruta', 'Altitud', 'Motivo'], rows)}`;
}

function renderSummary(snapshot) {
    const { summary } = snapshot;
    const metrics = summary.metrics || {};
    const pairs = [
        ['Hora de juego', clock(summary.time)],
        ['Puntuación', summary.score],
        ['Aterrizajes', metrics.landings],
        ['Despegues', metrics.takeoffs],
        ['Movimientos por hora', Number.isFinite(metrics.movementsPerHour) ? metrics.movementsPerHour.toFixed(1) : '-'],
        ['Frustradas', metrics.goArounds],
        ['Segundos sin separación', metrics.separationLossSeconds],
        ['Tiempo medio de llegada en el espacio aéreo (s)', Math.round(metrics.averageArrivalTimeInAirspaceSeconds || 0)],
        ['Órdenes registradas', summary.decisions],
        ['Pasos de entrenamiento para el Bot B', summary.trainingSteps],
        ['Spawns creados / aplazados', `${summary.spawns} / ${summary.delayedSpawns}`]
    ].map(([name, value]) => `<tr><td>${name}</td><td>${escape(value === undefined ? '-' : value)}</td></tr>`);
    const outcomes = Object.keys(summary.outcomes).map((status) => `<tr>
        <td><span class="audit-outcome is-${status}">${OUTCOME_LABEL[status]}</span></td><td>${summary.outcomes[status]}</td></tr>`);
    const violations = Object.keys(summary.violationCounts || {}).filter((rule) => summary.violationCounts[rule] > 0)
        .map((rule) => `<tr><td>${escape(rule)}</td><td class="audit-bad">${summary.violationCounts[rule]}</td></tr>`);

    return `${table(['Dato', 'Valor'], pairs)
    }<p class="audit-caption">Consecuencias de las órdenes</p>${table(['Consecuencia', 'Órdenes'], outcomes)
    }<p class="audit-caption">Infracciones por regla</p>${
        violations.length ? table(['Regla', 'Veces'], violations) : '<p class="audit-empty">Ninguna.</p>'}`;
}

/**
 * @function renderTab
 * @param tab {string} one of `TABS`
 * @param snapshot {object}
 * @return {string} html
 */
export function renderTab(tab, snapshot) {
    const renderers = {
        aircraft: renderAircraft,
        decisions: renderDecisions,
        score: renderScore,
        spawns: renderSpawns,
        summary: renderSummary
    };

    return renderers[tab](snapshot);
}
