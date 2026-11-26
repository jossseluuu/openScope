/* eslint-disable no-console, global-require, import/no-extraneous-dependencies */ // development tool
/**
 * Generates the bot pages that depend on the code:
 * - docs/bots/matriz-comandos.md, from the action space (bot/actionSpace.js), the authority of the Bot C
 *   agents (bot/botC/agents.js) and the actions Bot A's code refers to;
 * - docs/bots/parametros.md, from bot/botA/botAParameters.js.
 *
 * Usage:
 *   node tools/docs/generate-bot-docs.js           write the pages
 *   node tools/docs/generate-bot-docs.js --check   exit 1 if a page is out of date (CI)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CLIENT = path.join(ROOT, 'src', 'assets', 'scripts', 'client');

require('@babel/register')({
    cwd: ROOT,
    only: [path.join(ROOT, 'src')]
});

const { ACTIONS, ACTION_TYPE, ACTION_COUNT } = require('../../src/assets/scripts/client/bot/actionSpace');
const {
    AGENT, AGENT_LABEL, AGENT_AUTHORITY, TOWER_CEILING_AGL_FT
} = require('../../src/assets/scripts/client/bot/botC/agents');
const { BOT_A_PARAMETER_SPACE } = require('../../src/assets/scripts/client/bot/botA/botAParameters');

const isCheck = process.argv.includes('--check');
const GENERATED_NOTE = '<!-- Página generada por tools/docs/generate-bot-docs.js desde el código. No la edites a mano. -->';

/**
 * What each kind of action means for a controller: the simulator command it becomes, the phraseology
 * (English as spoken in the sim, Spanish as used by Spanish ATC), and when it is available (the action
 * mask of `getApplicableActions`). The voice assistant (task #1) reuses the phraseology.
 *
 * @property ACTION_DOCS
 */
const ACTION_DOCS = {
    NOOP: {
        command: '—',
        en: '—',
        es: '—',
        mask: 'siempre',
        meaning: 'no dar ninguna orden en este ciclo'
    },
    HEADING: {
        command: 'fh l/r {rumbo}',
        en: 'turn left/right heading {hdg}',
        es: 'vire a la izquierda/derecha rumbo {rumbo}',
        mask: 'en el aire',
        meaning: 'cambio de rumbo relativo al actual o al asignado'
    },
    ALTITUDE: {
        command: 'a {nivel} [ex]',
        en: 'climb/descend and maintain {alt} [expedite]',
        es: 'ascienda/descienda y mantenga {altitud} [expedito]',
        mask: 'en el aire, hasta el techo de la aeronave; `ex` (expedito) solo en emergencia y bajando 1000 ft o más',
        meaning: 'altitud autorizada'
    },
    SPEED: {
        command: 'sp {kt}',
        en: 'reduce/increase speed {kt}',
        es: 'reduzca/aumente velocidad {nudos}',
        mask: 'en el aire, entre la mínima + 10 kt y la máxima (250 kt por debajo de 10 000 ft)',
        meaning: 'velocidad indicada'
    },
    DIRECT_NEXT: {
        command: 'pd {fijo}',
        en: 'proceed direct {fix}',
        es: 'proceda directo a {fijo}',
        mask: 'si tiene un siguiente fijo con posición',
        meaning: 'directo al siguiente fijo de la ruta'
    },
    PROCEDURE: {
        command: 'dvs (llegadas) / cvs (salidas)',
        en: 'descend via STAR / climb via SID',
        es: 'descienda según la STAR / ascienda según la SID',
        mask: 'si tiene un siguiente fijo y no es un sobrevuelo',
        meaning: 'volver a seguir el perfil vertical del procedimiento'
    },
    ILS: {
        command: 'i {pista}',
        en: 'cleared ILS runway {rwy} approach',
        es: 'autorizado aproximación ILS pista {pista}',
        mask: 'llegadas a una pista con ILS',
        meaning: 'autorización de aproximación ILS'
    },
    PARALLEL_RUNWAY: {
        command: 'e {pista}',
        en: 'expect runway {rwy}',
        es: 'espere pista {pista}',
        mask: 'llegadas aún no en aproximación, con una pista paralela',
        meaning: 'cambio a la pista paralela'
    },
    HOLD: {
        command: 'hold {fijo}',
        en: 'hold at {fix} as published',
        es: 'mantenga en espera sobre {fijo} según publicado',
        mask: 'con un siguiente fijo, sin espera asignada y no en emergencia (los pilotos en emergencia la rechazan)',
        meaning: 'espera en el siguiente fijo'
    },
    EXIT_HOLD: {
        command: 'xh',
        en: 'exit hold, proceed on course',
        es: 'abandone la espera, prosiga en ruta',
        mask: 'con espera asignada',
        meaning: 'salir de la espera'
    },
    GO_AROUND: {
        command: 'ga',
        en: 'go around',
        es: 'motor y al aire',
        mask: 'llegadas en aproximación',
        meaning: 'frustrada'
    },
    TAXI: {
        command: 'caf taxi {pista} cvs',
        en: 'cleared as filed, taxi to runway {rwy}',
        es: 'autorizado según plan de vuelo, ruede a pista {pista}',
        mask: 'salidas en plataforma (APRON)',
        meaning: 'autorización y rodaje a la pista de salida'
    },
    TAKEOFF: {
        command: 'cto',
        en: 'runway {rwy}, cleared for takeoff',
        es: 'pista {pista}, autorizado a despegar',
        mask: 'salidas en el punto de espera o alineadas, cuando ya pueden salir',
        meaning: 'autorización de despegue'
    },
    CANCEL_TAKEOFF: {
        command: 'abort',
        en: 'hold position, cancel takeoff clearance / stop immediately',
        es: 'mantenga posición, cancelo autorización de despegue / pare inmediatamente',
        mask: 'en el punto de espera, alineada, o en la carrera por debajo de V1',
        meaning: 'cancelar el despegue'
    },
    LINE_UP: {
        command: 'lineup',
        en: 'runway {rwy}, line up and wait',
        es: 'pista {pista}, alinee y espere',
        mask: 'la siguiente en salir, en el punto de espera y lista',
        meaning: 'alinear en pista'
    }
};

// actions the safety shield can impose (getRequiredActions): go-around or turn off final, climb to a higher floor
const SHIELD_TYPES = new Set([ACTION_TYPE.GO_AROUND, ACTION_TYPE.HEADING, ACTION_TYPE.ALTITUDE]);

function readSources(directory) {
    return fs.readdirSync(directory)
        .filter((file) => file.endsWith('.js'))
        .map((file) => fs.readFileSync(path.join(directory, file), 'utf8'))
        .join('\n');
}

/**
 * Action types Bot A's planner refers to (directly or through the heading/altitude/speed helpers)
 *
 * @function botATypes
 */
function botATypes() {
    const source = readSources(path.join(CLIENT, 'bot', 'botA'));
    const types = new Set();

    Object.keys(ACTION_TYPE).forEach((type) => {
        if (new RegExp(`ACTION_(INDEX|TYPE)\\.${type}\\b`).test(source)) {
            types.add(type);
        }
    });

    [['headingAction(', 'HEADING'], ['altitudeAction(', 'ALTITUDE'], ['speedAction(', 'SPEED']].forEach(([helper, type]) => {
        if (source.includes(helper)) {
            types.add(type);
        }
    });

    return types;
}

function valuesOfType(type) {
    return ACTIONS.filter((action) => action.type === type && action.value !== undefined).map((action) => action.value);
}

function matrixPage() {
    const typesInOrder = [...new Set(ACTIONS.map((action) => action.type))];
    const usedByBotA = botATypes();
    const agents = Object.keys(AGENT_AUTHORITY);
    const agentsOf = (type) => agents.filter((agent) => AGENT_AUTHORITY[agent].includes(type)).map((agent) => AGENT_LABEL[agent]);
    const check = (condition) => (condition ? '✔' : '—');
    const lines = [
        GENERATED_NOTE,
        '',
        '# Matriz de comandos de los bots',
        '',
        `Las ${ACTION_COUNT} acciones que puede elegir un bot en cada ciclo para cada aeronave (\`bot/actionSpace.js\`), ` +
        'qué comando del simulador dan, cuándo están disponibles (máscara de acciones) y quién puede usarlas. Los bots ' +
        'no tienen atajos: cada acción es un comando normal, como el que teclearía el jugador.',
        '',
        '## Resumen por tipo de acción',
        '',
        '| Acción | Nº | Comando | Fraseología (EN) | Fraseología (ES) | Bot A | Escudo | Bot B | Agentes del Bot C |',
        '|---|---:|---|---|---|:-:|:-:|:-:|---|'
    ];

    typesInOrder.forEach((type) => {
        const doc = ACTION_DOCS[type] || {};
        const count = ACTIONS.filter((action) => action.type === type).length;
        const agentLabels = type === ACTION_TYPE.NOOP ? 'todos' : agentsOf(type).join(', ') || '—';

        lines.push(`| \`${type}\` | ${count} | \`${doc.command}\` | ${doc.en} | ${doc.es} | ` +
            `${check(type === ACTION_TYPE.NOOP || usedByBotA.has(type))} | ${check(SHIELD_TYPES.has(type))} | ✔ | ${agentLabels} |`);
    });

    lines.push(
        '',
        '- **Bot A:** acciones que usa su planificador (detectado en `bot/botA/`). No usa `LINE_UP` ni `CANCEL_TAKEOFF`; ' +
        'eso lo hace la Torre del Bot C.',
        '- **Escudo:** acciones que el escudo de seguridad puede imponer a cualquier bot (`safetyShield.getRequiredActions`): ' +
        'frustrada o viraje de separación en final y ascenso ante un suelo de espacio aéreo más alto.',
        '- **Bot B:** la red puede elegir cualquier acción que la máscara permita; el escudo filtra y corrige.',
        '- **Bot C:** cada aeronave tiene un agente dueño; un agente solo puede dar las acciones de su competencia ' +
        '(`bot/botC/agents.js`, `AGENT_AUTHORITY`). La Torre es dueña de todo lo que está en tierra o a menos de ' +
        `${TOWER_CEILING_AGL_FT} ft sobre el aeropuerto.`,
        '',
        '## Disponibilidad (máscara de acciones)',
        '',
        '| Acción | Disponible cuando | Para qué sirve |',
        '|---|---|---|'
    );

    typesInOrder.forEach((type) => {
        const doc = ACTION_DOCS[type] || {};

        lines.push(`| \`${type}\` | ${doc.mask} | ${doc.meaning} |`);
    });

    lines.push(
        '',
        'En tierra solo hay acciones de salida (`TAXI`, `TAKEOFF`, `LINE_UP`, `CANCEL_TAKEOFF`); una aeronave no ' +
        'controlable solo admite `NOOP`.',
        '',
        '## Valores discretos',
        '',
        `- **Rumbo** (grados respecto al rumbo de referencia; negativo = izquierda): ${valuesOfType(ACTION_TYPE.HEADING).join(', ')}.`,
        `- **Altitud** (ft): ${valuesOfType(ACTION_TYPE.ALTITUDE).join(', ')}.`,
        `- **Velocidad** (kt IAS): ${valuesOfType(ACTION_TYPE.SPEED).join(', ')}.`,
        '',
        '## Competencias de los agentes del Bot C',
        '',
        `| Agente | ${typesInOrder.filter((type) => type !== ACTION_TYPE.NOOP).map((type) => `\`${type}\``).join(' | ')} |`,
        `|---|${typesInOrder.filter((type) => type !== ACTION_TYPE.NOOP).map(() => ':-:').join('|')}|`
    );

    agents.forEach((agent) => {
        lines.push(`| ${AGENT_LABEL[agent]} | ${typesInOrder.filter((type) => type !== ACTION_TYPE.NOOP)
            .map((type) => check(AGENT_AUTHORITY[agent].includes(type))).join(' | ')} |`);
    });

    lines.push(
        '',
        `El ${AGENT_LABEL[AGENT.SHIELD]} (escudo) puede imponer cualquier acción por seguridad. ` +
        'Ver [Bot C](bot-c.md) y [niveles de automatización](automatizacion.md).',
        ''
    );

    return lines.join('\n');
}

function parametersPage() {
    const lines = [
        GENERATED_NOTE,
        '',
        '# Parámetros del Bot A',
        '',
        'Valores por defecto y rango que explora el ajuste automático (CMA-ES, `bots/python/openscope_bots/tune_bot_a.py`). ' +
        'Fuente: `bot/botA/botAParameters.js`. Distancias en NM, velocidades en kt, tiempos en s, altitudes en ft.',
        '',
        '| Parámetro | Valor | Mínimo | Máximo | Descripción |',
        '|---|---:|---:|---:|---|'
    ];

    Object.entries(BOT_A_PARAMETER_SPACE).forEach(([name, parameter]) => {
        lines.push(`| \`${name}\` | ${parameter.value} | ${parameter.min} | ${parameter.max} | ` +
            `${parameter.description || ''}${parameter.integer ? ' (entero)' : ''} |`);
    });

    lines.push(
        '',
        'Los parámetros ajustados se guardan en `bots/params/botA_tuned.json` y se usan con ' +
        '`run-bot.js --params`. El ajuste guardado es anterior a los cambios de ILS y separación de noviembre de 2026: ' +
        'hay que repetirlo antes de usarlo.',
        ''
    );

    return lines.join('\n');
}

function main() {
    const pages = {
        'matriz-comandos.md': matrixPage(),
        'parametros.md': parametersPage()
    };
    const outdated = [];

    Object.entries(pages).forEach(([file, content]) => {
        const target = path.join(ROOT, 'docs', 'bots', file);
        const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : null;

        if (current === content) {
            return;
        }

        if (isCheck) {
            outdated.push(file);
        } else {
            fs.writeFileSync(target, content);
            console.log(`written docs/bots/${file}`);
        }
    });

    if (isCheck && outdated.length > 0) {
        console.error(`out of date: ${outdated.join(', ')}. Run node tools/docs/generate-bot-docs.js`);
        process.exitCode = 1;
    }
}

main();
