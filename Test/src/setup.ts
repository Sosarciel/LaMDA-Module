import { startServer, stopServer } from "@sosraciel-lamda/lam-manager/mock";

beforeAll(async () => {
    await startServer();
});

afterAll(async () => {
    await stopServer();
});
