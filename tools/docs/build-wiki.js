/* eslint-disable no-console, import/no-extraneous-dependencies */
/**
 * Builds the GitHub Wiki from docs/ (the single source, see docs/adr/0001-docs-as-code.md).
 *
 * The Wiki is flat: `docs/bots/razonamiento.md` becomes the page `bots-razonamiento`, `docs/index.md`
 * becomes `Home`. Relative links and images are rewritten, MkDocs-only syntax (admonitions, attribute
 * lists) is turned into plain Markdown, and `_Sidebar.md` is built from the `nav` of mkdocs.yml. Every page
 * gets a note saying it is generated.
 *
 * Usage:
 *   node tools/docs/build-wiki.js <wiki-directory>
 *
 * Existing .md pages in the wiki directory are deleted first (the Wiki is never edited by hand).
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..', '..');
const DOCS = path.join(ROOT, 'docs');
const REPOSITORY_URL = 'https://github.com/jossseluuu/openScope';

/**
 * Wiki page name of a docs file (path relative to docs/, with forward slashes)
 *
 * @function pageName
 */
function pageName(relativePath) {
    if (relativePath === 'index.md') {
        return 'Home';
    }

    return relativePath.replace(/\.md$/, '').replace(/\/index$/, '').split('/').join('-');
}

function markdownFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            return entry.name === 'images' ? [] : markdownFiles(fullPath);
        }

        return entry.name.endsWith('.md') ? [fullPath] : [];
    });
}

function toPosix(file) {
    return file.split(path.sep).join('/');
}

/**
 * MkDocs-only syntax as plain Markdown: `!!! note "Title"` blocks become quotes, `{ .class }` lists go away
 *
 * @function plainMarkdown
 */
function plainMarkdown(text) {
    const lines = text.split('\n');
    const output = [];

    for (let i = 0; i < lines.length; i++) {
        const admonition = lines[i].match(/^!!!\s+(\w+)(?:\s+"([^"]*)")?/);

        if (!admonition) {
            output.push(lines[i].replace(/\{\s*\.[^}]*\}/g, '').trimEnd());
            continue; // eslint-disable-line no-continue
        }

        output.push(`> **${admonition[2] || admonition[1]}**`);

        while (i + 1 < lines.length && (lines[i + 1].startsWith('    ') || lines[i + 1].trim() === '')) {
            i += 1;

            if (lines[i].trim() === '' && !(lines[i + 1] || '').startsWith('    ')) {
                break;
            }

            output.push(`> ${lines[i].replace(/^ {4}/, '')}`.trimEnd());
        }

        output.push('');
    }

    return output.join('\n');
}

/**
 * Relative links between docs pages become Wiki links; links outside docs/ point to the repository
 *
 * @function rewriteLinks
 */
function rewriteLinks(text, relativePath) {
    const directory = path.posix.dirname(relativePath);

    return text.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (match, bang, label, target) => {
        if (/^(https?:|mailto:|#)/.test(target)) {
            return match;
        }

        const [file, anchor] = target.split('#');
        const resolved = path.posix.normalize(path.posix.join(directory, file));
        const hash = anchor ? `#${anchor}` : '';

        if (resolved.startsWith('images/')) {
            return `${bang}[${label}](${resolved}${hash})`;
        }

        if (resolved.endsWith('.md') && !resolved.startsWith('..')) {
            return `${bang}[${label}](${pageName(resolved)}${hash})`;
        }

        // something outside docs/ (source files, other folders): link to the repository
        const repositoryPath = path.posix.normalize(path.posix.join('docs', directory, file));

        return `${bang}[${label}](${REPOSITORY_URL}/blob/main/${repositoryPath}${hash})`;
    });
}

/**
 * The `nav` section of mkdocs.yml (the rest uses Python-specific YAML tags)
 *
 * @function readNav
 */
function readNav() {
    const text = fs.readFileSync(path.join(ROOT, 'mkdocs.yml'), 'utf8');

    return yaml.safeLoad(text.slice(text.indexOf('\nnav:'))).nav;
}

function sidebar(nav, depth = 0) {
    return nav.flatMap((item) => {
        const indent = '  '.repeat(depth);

        if (typeof item === 'string') {
            return [`${indent}- [${pageName(item)}](${pageName(item)})`];
        }

        const [title, value] = Object.entries(item)[0];

        if (typeof value === 'string') {
            return [`${indent}- [${title}](${pageName(value)})`];
        }

        return [`${indent}- **${title}**`, ...sidebar(value, depth + 1)];
    });
}

function main() {
    const wikiDirectory = process.argv[2];

    if (!wikiDirectory) {
        console.error('usage: node tools/docs/build-wiki.js <wiki-directory>');
        process.exitCode = 1;

        return;
    }

    fs.mkdirSync(wikiDirectory, { recursive: true });
    fs.readdirSync(wikiDirectory)
        .filter((file) => file.endsWith('.md'))
        .forEach((file) => fs.unlinkSync(path.join(wikiDirectory, file)));

    const files = markdownFiles(DOCS);

    files.forEach((file) => {
        const relativePath = toPosix(path.relative(DOCS, file));
        const body = rewriteLinks(plainMarkdown(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')), relativePath);
        const note = `> Página generada desde [\`docs/${relativePath}\`](${REPOSITORY_URL}/blob/main/docs/${relativePath}). ` +
            'No la edites aquí: los cambios se pierden en la siguiente sincronización.\n\n';

        fs.writeFileSync(path.join(wikiDirectory, `${pageName(relativePath)}.md`), note + body);
    });

    const imagesSource = path.join(DOCS, 'images');

    if (fs.existsSync(imagesSource)) {
        fs.cpSync(imagesSource, path.join(wikiDirectory, 'images'), { recursive: true });
    }

    fs.writeFileSync(path.join(wikiDirectory, '_Sidebar.md'), `${sidebar(readNav()).join('\n')}\n`);
    fs.writeFileSync(path.join(wikiDirectory, '_Footer.md'),
        `Generada desde [docs/](${REPOSITORY_URL}/tree/main/docs) · ` +
        '[Versión web](https://jossseluuu.github.io/openScope/docs/)\n');
    console.log(`${files.length} páginas escritas en ${wikiDirectory}`);
}

main();
