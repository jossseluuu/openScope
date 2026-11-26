// eslint-disable-next-line import/no-extraneous-dependencies
const { test, expect } = require('@playwright/test');

// Loads the page, waits for the airport and traffic, changes airport with a command and checks that the
// browser console shows no errors. Leaves a screenshot in test-results/ for the CI artifact.

// noise that is not a failure of the simulator
const IGNORED_ERRORS = [/gtag/i, /favicon/i, /Event tracking/i];

test('the simulator loads, shows traffic and changes airport by command', async({ page }) => {
    const errors = [];

    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
        if (message.type() === 'error' && !IGNORED_ERRORS.some((pattern) => pattern.test(message.text()))) {
            errors.push(`console: ${message.text()}`);
        }
    });

    await page.goto('/');

    // the app is up when the aircraft controller exists and the first aircraft are created
    await page.waitForFunction(() => window.aircraftController &&
        window.aircraftController.aircraft &&
        window.aircraftController.aircraft.list.length > 0, null, { timeout: 90000 });

    const command = page.locator('#command');

    await command.click();
    await command.fill('airport lemg');
    await command.press('Enter');

    await expect(page.locator('#airport-switch')).toContainText(/LEMG/i, { timeout: 60000 });
    await page.waitForFunction(() => window.aircraftController.aircraft.list.length > 0, null, { timeout: 60000 });

    await page.screenshot({ path: 'test-results/lemg.png' });

    expect(errors).toEqual([]);
});
