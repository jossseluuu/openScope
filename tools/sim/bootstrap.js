/* eslint-disable global-require, import/no-extraneous-dependencies */ // development tool, not shipped with the game
/**
 * Prepares Node to run the openScope engine headless and returns the
 * `HeadlessSimulator` class.
 *
 * Order matters:
 * 1. the seeded `Math.random` is installed before lodash is loaded (lodash keeps
 *    its own reference to `Math.random`)
 * 2. Babel compiles the ES module sources on the fly
 * 3. a minimal DOM and the globals the engine expects are provided
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

require('@babel/register')({
    cwd: ROOT,
    only: [path.join(ROOT, 'src')]
});

const { installSeededRandom } = require('../../src/assets/scripts/headless/seededRandom');

installSeededRandom(0);

require('browser-env')(['window', 'document', 'navigator']);

global.prop = {
    canvas: { draw_labels: true, dirty: true },
    speech: { synthesis: null, enabled: false }
};
// the browser fetches assets (e.g. terrain) through `zlsa.atc.loadAsset()` and a jQuery-style promise;
// here they are read synchronously from disk
global.zlsa = {
    atc: {
        loadAsset: ({ url }) => {
            let data = null;
            let error = null;

            try {
                data = JSON.parse(fs.readFileSync(path.join(ROOT, url), 'utf8'));
            } catch (readError) {
                error = readError;
            }

            const request = {
                done: (callback) => {
                    if (!error) {
                        callback(data);
                    }

                    return request;
                },
                fail: (callback) => {
                    if (error) {
                        callback(null, error.message, error);
                    }

                    return request;
                }
            };

            return request;
        }
    }
};

if (!global.localStorage) {
    const store = {};

    global.localStorage = store;
    store.getItem = (name) => store[name];
    store.setItem = (name, value) => { store[name] = value; };
}

const HeadlessSimulator = require('../../src/assets/scripts/headless/HeadlessSimulator').default;

module.exports = {
    HeadlessSimulator,
    ASSETS_PATH: path.join(ROOT, 'assets')
};
