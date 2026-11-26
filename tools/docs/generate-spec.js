/* eslint-disable no-console, import/no-extraneous-dependencies */
/**
 * Generates the pages of the specification sheet (docs/especificacion/*.md) from its single
 * source, docs/especificacion/reglas.yaml.
 *
 * Usage:
 *   node tools/docs/generate-spec.js           write the pages
 *   node tools/docs/generate-spec.js --check   exit 1 if any page is out of date (CI)
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..', '..');
const SPEC_DIR = path.join(ROOT, 'docs', 'especificacion');
const isCheck = process.argv.includes('--check');

const PAGE_TITLES = {
    'unidades-atmosfera': 'Unidades, atmósfera y viento',
    aeronaves: 'Aeronaves: velocidades, rendimiento y aproximación',
    separacion: 'Separación radar, estela y pistas paralelas',
    operaciones: 'Salidas, torre y emergencias',
    'espacio-aereo-terreno': 'Espacio aéreo y terreno',
    puntuacion: 'Puntuación y niveles de las reglas',
    alertas: 'Alertas de colisión (STCA y TCAS)',
    meteorologia: 'Meteorología'
};

const STATUS_LABEL = {
    implementado: 'implementado',
    parcial: 'parcial',
    pendiente: 'pendiente',
    referencia: 'referencia'
};

const GENERATED_NOTE = '<!-- Página generada por tools/docs/generate-spec.js desde reglas.yaml. No la edites a mano. -->';

function escapeCell(text) {
    return String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function isTable(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Value as shown in the summary table: tables are shown below the table
 *
 * @function inlineValue
 */
function inlineValue(rule) {
    if (isTable(rule.value)) {
        return `ver tabla ${rule.id}`;
    }

    return `${rule.value}${rule.unit ? ` ${rule.unit}` : ''}`;
}

/**
 * A nested table (leader -> follower) as a matrix, a flat one as two columns
 *
 * @function tableMarkdown
 */
function tableMarkdown(rule) {
    const rows = Object.entries(rule.value);
    const isMatrix = rows.every(([, row]) => isTable(row));
    const unit = rule.unit ? ` (${rule.unit})` : '';

    if (!isMatrix) {
        return [
            `| Clave | Valor${unit} |`,
            '|---|---|',
            ...rows.map(([key, value]) => `| ${escapeCell(key)} | ${escapeCell(value)} |`)
        ].join('\n');
    }

    const columns = [...new Set(rows.flatMap(([, row]) => Object.keys(row)))];

    return [
        `| Líder ↓ / seguidor →${unit} | ${columns.join(' | ')} |`,
        `|---|${columns.map(() => '---:').join('|')}|`,
        ...rows.map(([leader, row]) => `| **${leader}** | ${columns.map((column) => (row[column] === undefined ? '—' : row[column])).join(' | ')} |`)
    ].join('\n');
}

function domainSection(domain, rules) {
    const lines = [
        `## ${domain.title} (${domain.id})`,
        '',
        '| ID | Regla | Valor | Fuente | Implementado en | Estado |',
        '|---|---|---|---|---|---|'
    ];

    rules.forEach((rule) => {
        lines.push(`| <a id="${rule.id.toLowerCase()}"></a>**${rule.id}** | ${escapeCell(rule.rule)} | ${escapeCell(inlineValue(rule))} | ` +
            `${escapeCell(rule.source)} | \`${escapeCell(rule.code)}\` | ${STATUS_LABEL[rule.status]}${rule.check ? ' ✔︎' : ''} |`);
    });

    rules.filter((rule) => isTable(rule.value)).forEach((rule) => {
        lines.push('', `### ${rule.id}: ${rule.rule}`, '', tableMarkdown(rule));
    });

    const notes = rules.filter((rule) => rule.notes);

    if (notes.length > 0) {
        lines.push('', '**Notas**', '');
        notes.forEach((rule) => lines.push(`- **${rule.id}:** ${String(rule.notes).trim()}`));
    }

    return lines.join('\n');
}

function buildPages(spec) {
    const pages = {};

    Object.keys(PAGE_TITLES).forEach((page) => {
        const domains = spec.domains.filter((domain) => domain.page === page);

        if (domains.length === 0) {
            return;
        }

        const sections = domains.map((domain) => domainSection(domain, spec.rules.filter((rule) => rule.id.startsWith(`${domain.id}-`))));

        pages[`${page}.md`] = `${GENERATED_NOTE}\n\n# ${PAGE_TITLES[page]}\n\n` +
            '✔︎ = valor comprobado automáticamente contra el código (`test/spec/reglas.spec.js`).\n\n' +
            `${sections.join('\n\n')}\n`;
    });

    const counts = {};

    spec.rules.forEach((rule) => {
        counts[rule.status] = (counts[rule.status] || 0) + 1;
    });

    const pageOfDomain = Object.fromEntries(spec.domains.map((domain) => [domain.id, domain.page]));
    const traceability = spec.rules.map((rule) => `| [${rule.id}](${pageOfDomain[rule.id.slice(0, 3)]}.md#${rule.id.toLowerCase()}) | ` +
        `${escapeCell(rule.rule)} | ${STATUS_LABEL[rule.status]} | ${rule.check ? 'sí' : '—'} |`);

    pages['index.md'] = `${GENERATED_NOTE}\n\n# Hoja de especificaciones físicas y reglas de dominio\n\n` +
        'Una única fuente de verdad con las constantes físicas y las reglas ATC del simulador: valor, unidad, ' +
        'norma de la que salen, dónde están implementadas y si un test comprueba que el código coincide.\n\n' +
        '- **Fuente:** `docs/especificacion/reglas.yaml`. Estas páginas se generan con ' +
        '`node tools/docs/generate-spec.js`; CI falla si no están al día.\n' +
        '- **Comprobación:** `test/spec/reglas.spec.js` compara cada regla que tiene `check` con el valor del código.\n' +
        '- **Identificadores:** `DOMINIO-NNN`. Son estables: el código y los tests los citan en comentarios ' +
        '(por ejemplo `// SEP-002`). No se reutiliza un identificador borrado.\n\n' +
        `## Resumen\n\n${spec.rules.length} reglas: ${Object.entries(counts).map(([status, count]) => `${count} ${status}`).join(', ')}; ` +
        `${spec.rules.filter((rule) => rule.check).length} comprobadas contra el código.\n\n` +
        `| Dominio | Página |\n|---|---|\n${spec.domains.map((domain) => `| ${domain.id} — ${domain.title} | [${PAGE_TITLES[domain.page]}](${domain.page}.md) |`).join('\n')}\n\n` +
        '## Matriz de trazabilidad\n\n| Regla | Enunciado | Estado | Test |\n|---|---|---|---|\n' +
        `${traceability.join('\n')}\n\n` +
        '## Añadir o cambiar una regla\n\n' +
        '1. Edita `reglas.yaml` (añade `check` si el valor está exportado en el código).\n' +
        '2. Ejecuta `node tools/docs/generate-spec.js` y `npx ava test/spec/reglas.spec.js`.\n' +
        '3. Cita el identificador en el código y en los tests que la implementan.\n';

    return pages;
}

function main() {
    const spec = yaml.safeLoad(fs.readFileSync(path.join(SPEC_DIR, 'reglas.yaml'), 'utf8'));
    const pages = buildPages(spec);
    const outdated = [];

    Object.entries(pages).forEach(([file, content]) => {
        const target = path.join(SPEC_DIR, file);
        const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : null;

        if (current === content) {
            return;
        }

        if (isCheck) {
            outdated.push(file);
        } else {
            fs.writeFileSync(target, content);
            console.log(`written docs/especificacion/${file}`);
        }
    });

    if (isCheck && outdated.length > 0) {
        console.error(`out of date: ${outdated.join(', ')}. Run node tools/docs/generate-spec.js`);
        process.exitCode = 1;
    }
}

main();
