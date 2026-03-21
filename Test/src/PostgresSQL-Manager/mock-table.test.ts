import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { TableInitializer, MockTableAccesser, PostgreSQLMockTool, TestDBRow, createMockJsonDataCacheCoordinator, createMockCacheCoordinator } from "@sosraciel-lamda/postgresql-manager/mock";

const { MOCK_TABLE_NAME, MOCK_ID_FIELD } = PostgreSQLMockTool;

describe("PostgresSQL-Manager 模拟表测试", () => {
    let manager: DBManager;
    let mockCacheCoordinator: any;
    let mockJsonDataCacheCoordinator: any;

    beforeAll(async () => {
        manager = await DBManager.create({
            port: 5433,
            user: "postgres",
            database: "postgres",
            host: "localhost",
            max: 10,
            idleTimeoutMillis: 1000 * 30,
        });

        const result = await manager.client.query("SELECT 1");
        expect(result.rowCount).toBe(1);

        try {
            await manager.client.query(`DROP TABLE IF EXISTS ${MOCK_TABLE_NAME};`);
            await manager.client.query(`DROP FUNCTION IF EXISTS func__${MOCK_TABLE_NAME}__before_insert_or_update();`);
            await manager.client.query(`DROP FUNCTION IF EXISTS set_${MOCK_TABLE_NAME}(text);`);
        } catch (e) {
        }

        const { cache, coordinator } = createMockCacheCoordinator();
        mockCacheCoordinator = coordinator;

        const { jsonCache, coordinator: jsonCoordinator } = createMockJsonDataCacheCoordinator();
        mockJsonDataCacheCoordinator = jsonCoordinator;
    }, 30000);

    afterAll(async () => {
        try {
            if (manager) {
                await TableInitializer.dropTable(manager.client);
                await manager.stop();
            }

            mockCacheCoordinator.dispose();
            mockJsonDataCacheCoordinator.dispose();
        } catch (e) {
        }
    }, 30000);

    describe("1. 表初始化", () => {
        it("1.1 应成功初始化表", async () => {
            await TableInitializer.initTable(manager.client);
            const result = await manager.client.sql`
                SELECT table_name
                FROM information_schema.tables
                WHERE table_name = ${MOCK_TABLE_NAME}
                AND table_schema = 'public';
            `;
            expect(result.rowCount).toBe(1);
        });
    });

    describe("2. 缓存协调器", () => {
        it("2.1 应使用注入的普通缓存协调器", async () => {
            const accesser = new MockTableAccesser<TestDBRow>(manager);
            accesser.injectCacheCoordinator(mockCacheCoordinator);

            const testData: TestDBRow = {
                data: {
                    test_id: "injectedCacheTest",
                    name: "注入缓存测试"
                }
            };

            await accesser.insertOrUpdate(testData);

            expect(accesser.hasCache("injectedCacheTest")).toBe(true);
            expect(accesser.peekCache("injectedCacheTest")).toBeDefined();

            const retrievedData = await accesser.getData("injectedCacheTest");
            expect(retrievedData?.data.test_id).toBe("injectedCacheTest");
            expect(retrievedData?.data.name).toBe("注入缓存测试");
        });

        it("2.2 应使用注入的JSON数据缓存协调器", async () => {
            await mockJsonDataCacheCoordinator.inited;

            const accesser = new MockTableAccesser<TestDBRow>(manager);
            accesser.injectCacheCoordinator(mockJsonDataCacheCoordinator);

            const testData: TestDBRow = {
                data: {
                    test_id: "jsonCacheTest",
                    name: "JSON缓存测试"
                }
            };

            await accesser.insertOrUpdate(testData);

            expect(accesser.hasCache("jsonCacheTest")).toBe(true);
            expect(accesser.peekCache("jsonCacheTest")).toBeDefined();

            const retrievedData = await accesser.getData("jsonCacheTest");
            expect(retrievedData?.data.test_id).toBe("jsonCacheTest");
            expect(retrievedData?.data.name).toBe("JSON缓存测试");
        });
    });

    describe("3. 数据库通知", () => {
        it("3.1 应通过数据库通知更新缓存", async () => {
            const accesser = new MockTableAccesser<TestDBRow>(manager);
            accesser.injectCacheCoordinator(mockCacheCoordinator);

            const initialData: TestDBRow = {
                data: {
                    test_id: "notifyTest",
                    name: "初始名称"
                }
            };
            await accesser.insertOrUpdate(initialData);

            expect(accesser.hasCache("notifyTest")).toBe(true);
            expect(accesser.peekCache("notifyTest")?.data.name).toBe("初始名称");

            await manager.client.query(`
                UPDATE ${MOCK_TABLE_NAME}
                SET data = jsonb_set(data, '{name}', to_jsonb('更新后的名称'::text), true)
                WHERE data->>'${MOCK_ID_FIELD}' = 'notifyTest';
            `);

            await new Promise(resolve => setTimeout(resolve, 1000));

            const cachedData = accesser.peekCache("notifyTest");
            expect(cachedData).toBeDefined();
            expect(cachedData?.data.name).toBe("更新后的名称");

            await manager.client.query(`
                DELETE FROM ${MOCK_TABLE_NAME}
                WHERE data->>'${MOCK_ID_FIELD}' = 'notifyTest';
            `);

            await new Promise(resolve => setTimeout(resolve, 1000));

            expect(accesser.hasCache("notifyTest")).toBe(false);
        });
    });
});
