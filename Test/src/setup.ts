import { LaMManagerMockServer } from "@sosraciel-lamda/lam-manager/mock";

const server:LaMManagerMockServer = new LaMManagerMockServer(3000);
beforeAll(async () => {
    await server.start();
});

afterAll(async () => {
    await server.stop();
});
