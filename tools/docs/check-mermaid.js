/* eslint-disable no-console */
/**
 * Renders every Mermaid block of the documentation (docs/**.md and README.md) with
 * @mermaid-js/mermaid-cli and fails if any of them has broken syntax.
 *
 * mermaid-cli is not a dependency of the project (it downloads a headless Chromium): it runs through
 * `npx` with a pinned version.
 *
 * Usage:
 *   node tools/docs/check-mermaid.js
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MERMAID_CLI = '@mermaid-js/mermaid-cli@11.4.2';
const PUPPETEER = 'puppeteer@23.11.1';

function markdownFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            return markdownFiles(fullPath);
        }

        return entry.name.endsWith('.md') ? [fullPath] : [];
    });
}

function main() {
    const files = [...markdownFiles(path.join(ROOT, 'docs')), path.join(ROOT, 'README.md')]
        .filter((file) => /```mermaid/.test(fs.readFileSync(file, 'utf8')));
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'mermaid-'));
    const failures = [];
    const extraArguments = [];

    // GitHub's Linux runners need Chromium without its sandbox
    if (process.env.CI) {
        const puppeteerConfig = path.join(output, 'puppeteer.json');

        fs.writeFileSync(puppeteerConfig, JSON.stringify({ args: ['--no-sandbox'] }));
        extraArguments.push('--puppeteerConfigFile', puppeteerConfig);
    }

    files.forEach((file, index) => {
        const relative = path.relative(ROOT, file);
        const mmdcArguments = ['-q', '-i', file, '-o', path.join(output, `${index}.md`), ...extraArguments];
        const result = spawnSync('npx', ['-y', '-p', MERMAID_CLI, '-p', PUPPETEER, 'mmdc', ...mmdcArguments], {
            encoding: 'utf8',
            shell: process.platform === 'win32',
            // the project's .npmrc sets legacy-peer-deps, which would skip mermaid-cli's peer dependency (puppeteer)
            env: { ...process.env, npm_config_legacy_peer_deps: 'false' }
        });

        if (result.status === 0) {
            console.log(`ok    ${relative}`);
        } else {
            console.log(`ERROR ${relative}`);
            console.log((result.stderr || result.stdout || '').split('\n').filter(Boolean).slice(0, 8).map((line) => `      ${line}`)
                .join('\n'));
            failures.push(relative);
        }
    });

    fs.rmSync(output, { recursive: true, force: true });
    console.log(`\n${files.length} páginas con diagramas, ${failures.length} con errores`);

    if (failures.length > 0) {
        process.exitCode = 1;
    }
}

main();
