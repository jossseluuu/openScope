// End-to-end test of the built simulator in Chromium (`npm run test:e2e`). Needs `npm run build` first.
// The files are *.e2e.js so AVA (test/**/*.spec.js) does not pick them up.
// eslint-disable-next-line import/no-extraneous-dependencies
const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.E2E_PORT || 3003);

module.exports = defineConfig({
    testDir: 'test/e2e',
    testMatch: '**/*.e2e.js',
    timeout: 120000,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['github'], ['list']] : 'list',
    outputDir: 'test-results',
    use: {
        baseURL: `http://localhost:${PORT}`,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure'
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: 'node public/assets/scripts/server/index.js',
        env: { PORT: String(PORT) },
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 60000
    }
});
