import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "tests/e2e",
    timeout: 120_000,
    retries: 0,
    reporter: [["list"]],
    use: {
        baseURL: "http://localhost:3230",
        trace: "retain-on-failure",
    },
    webServer: {
        command: "npm run dev -- -p 3230",
        url: "http://localhost:3230",
        reuseExistingServer: true,
        timeout: 180_000,
    },
});
