/* eslint-disable no-console */ // development tool
/**
 * Generates the format reference pages from the JSON schemas, so the reference cannot drift from what
 * the validator checks:
 * - docs/referencia/esquema-aeropuerto.md  from assets/airports/schema/airport.schema.json
 * - docs/referencia/esquema-aeronave.md    from tools/validate/schema/aircraft.schema.json
 * - docs/referencia/esquema-aerolinea.md   from tools/validate/schema/airline.schema.json
 *
 * Usage:
 *   node tools/docs/generate-schema-docs.js           write the pages
 *   node tools/docs/generate-schema-docs.js --check   exit 1 if a page is out of date (CI)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'docs', 'referencia');
const GENERATED_NOTE = '<!-- Página generada por tools/docs/generate-schema-docs.js desde el schema. No la edites a mano. -->';

const PAGES = [
    {
        file: 'esquema-aeropuerto.md',
        title: 'Esquema de aeropuerto',
        schema: 'assets/airports/schema/airport.schema.json',
        intro: 'Cada aeropuerto es un archivo `assets/airports/<icao>.json`. La guía explicada con ejemplos está en ' +
            '[Formato de aeropuerto](../aeropuertos/formato-aeropuerto.md); las reglas de coherencia, en el ' +
            '[validador](../aeropuertos/validador.md).'
    },
    {
        file: 'esquema-aeronave.md',
        title: 'Esquema de tipo de aeronave',
        schema: 'tools/validate/schema/aircraft.schema.json',
        intro: 'Cada tipo de aeronave es un archivo `assets/aircraft/<tipo>.json`. Guía: ' +
            '[Formato de aeronave](../motor/formato-aeronave.md). Se valida con `npm run validate:fleet`.'
    },
    {
        file: 'esquema-aerolinea.md',
        title: 'Esquema de aerolínea',
        schema: 'tools/validate/schema/airline.schema.json',
        intro: 'Cada aerolínea es un archivo `assets/airlines/<icao>.json`. Guía: ' +
            '[Formato de aerolínea](../motor/formato-aerolinea.md). Se valida con `npm run validate:fleet`.'
    }
];

const escape = (text) => String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
// GitHub-style slug of the definition heading, valid on GitHub, MkDocs and the Wiki
const anchorOf = (name) => name.toLowerCase();

/**
 * Short readable type of a schema node
 *
 * @function typeOf
 */
function typeOf(node) {
    if (!node || typeof node !== 'object') {
        return 'cualquiera';
    }

    if (node.$ref) {
        const name = node.$ref.split('/').pop();

        return `[${name}](#${anchorOf(name)})`;
    }

    if (node.enum) {
        return node.enum.map((value) => `\`${JSON.stringify(value)}\``).join(', ');
    }

    if (node.const !== undefined) {
        return `\`${JSON.stringify(node.const)}\``;
    }

    const alternatives = node.oneOf || node.anyOf;

    if (alternatives) {
        return alternatives.map(typeOf).join(' o ');
    }

    const types = Array.isArray(node.type) ? node.type : [node.type].filter(Boolean);

    if (types.includes('array')) {
        if (Array.isArray(node.items)) {
            return `[${node.items.map(typeOf).join(', ')}]`;
        }

        return node.items ? `lista de ${typeOf(node.items)}` : 'lista';
    }

    if (types.length === 0 && node.properties) {
        return 'objeto';
    }

    return types.length > 0 ? types.map((type) => ({
        string: 'texto', number: 'número', integer: 'entero', boolean: 'booleano', object: 'objeto', null: 'null'
    }[type] || type)).join(' o ') : 'cualquiera';
}

/**
 * Limits of a schema node (minimum, pattern...) as text
 *
 * @function limitsOf
 */
function limitsOf(node) {
    if (!node || typeof node !== 'object') {
        return '';
    }

    const limits = [];

    if (node.minimum !== undefined) limits.push(`≥ ${node.minimum}`);
    if (node.exclusiveMinimum !== undefined) limits.push(`> ${node.exclusiveMinimum}`);
    if (node.maximum !== undefined) limits.push(`≤ ${node.maximum}`);
    if (node.exclusiveMaximum !== undefined) limits.push(`< ${node.exclusiveMaximum}`);
    if (node.minItems !== undefined) limits.push(`mín. ${node.minItems} elementos`);
    if (node.maxItems !== undefined) limits.push(`máx. ${node.maxItems} elementos`);
    if (node.minLength !== undefined) limits.push(`mín. ${node.minLength} caracteres`);
    if (node.pattern) limits.push(`patrón \`${node.pattern}\``);

    return limits.join(', ');
}

/**
 * Rows of the property table of an object node, nested objects with dotted paths
 *
 * @function propertyRows
 */
function propertyRows(node, prefix = '') {
    const rows = [];
    const required = new Set(node.required || []);

    Object.entries(node.properties || {}).forEach(([name, child]) => {
        const fullName = `${prefix}${name}`;

        rows.push(`| \`${fullName}\` | ${required.has(name) ? 'sí' : 'no'} | ${escape(typeOf(child))} | ` +
            `${escape(limitsOf(child))} | ${escape(child.description || '')} |`);

        if (child && !child.$ref && child.properties) {
            rows.push(...propertyRows(child, `${fullName}.`));
        }
    });

    if (node.additionalProperties && typeof node.additionalProperties === 'object') {
        rows.push(`| \`${prefix}<clave>\` | no | ${escape(typeOf(node.additionalProperties))} | | Cualquier otra clave |`);
    }

    return rows;
}

function sectionOf(node) {
    const lines = [];

    if (node.description) {
        lines.push(node.description, '');
    }

    if (node.properties || (node.additionalProperties && typeof node.additionalProperties === 'object')) {
        lines.push('| Propiedad | Obligatoria | Tipo | Límites | Descripción |', '|---|---|---|---|---|');
        lines.push(...propertyRows(node));
    } else {
        const limits = limitsOf(node);

        lines.push(`Tipo: ${typeOf(node)}${limits ? ` (${limits})` : ''}.`);
    }

    return lines;
}

function buildPage(page) {
    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, page.schema), 'utf8'));
    const lines = [
        GENERATED_NOTE,
        '',
        `# ${page.title}`,
        '',
        `${page.intro} Fuente: \`${page.schema}\` (JSON Schema ${schema.$schema.includes('2019-09') ? 'draft 2019-09' : schema.$schema}).`,
        '',
        '## Raíz',
        '',
        ...sectionOf(schema)
    ];
    const definitions = Object.entries(schema.$defs || {});

    if (definitions.length > 0) {
        lines.push('', '## Definiciones');
        definitions.forEach(([name, definition]) => {
            lines.push('', `### ${name}`, '', ...sectionOf(definition));
        });
    }

    return `${lines.join('\n')}\n`;
}

function main() {
    const isCheck = process.argv.includes('--check');
    const outdated = [];

    if (!isCheck) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
    }

    PAGES.forEach((page) => {
        const file = path.join(OUT_DIR, page.file);
        const content = buildPage(page);

        if (isCheck) {
            if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== content) {
                outdated.push(path.relative(ROOT, file));
            }

            return;
        }

        fs.writeFileSync(file, content);
        console.log(`escrito ${path.relative(ROOT, file)}`);
    });

    if (outdated.length > 0) {
        console.error(`Páginas desactualizadas (ejecuta npm run docs:generate): ${outdated.join(', ')}`);
        process.exitCode = 1;
    }
}

main();
