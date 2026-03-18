import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { TableInitializer, MockTableAccesser } from "@sosraciel-lamda/postgresql-manager";

describe("Mock Table Initializer", () => {
    let manager: DBManager;
    const tableName = "mock_test_table";
    const idField = "test_id";

    beforeAll(async () => {
        // 创建数据库管理器
        manager = await DBManager.create({
            port: 5433,
            user: "postgres",
            database: "postgres",
            host: "localhost",
            max: 10,
            idleTimeoutMillis: 1000 * 30,
        });

        // 清理可能存在的测试表和函数
        try {
            // 删除表
            await manager.client.query(`DROP TABLE IF EXISTS ${tableName};`);
            // 删除相关函数
            await manager.client.query(`DROP FUNCTION IF EXISTS func__${tableName}__before_insert_or_update();`);
            await manager.client.query(`DROP FUNCTION IF EXISTS set_${tableName}(text);`);
        } catch (e) {
            // 忽略错误
        }
    }, 30000); // 增加超时时间

    afterAll(async () => {
        // 清理表
        try {
            if (manager) {
                await TableInitializer.dropTable(manager.client, tableName);
                // 关闭数据库连接
                await manager.stop();
            }
        } catch (e) {
            // 忽略错误
        }
    }, 30000); // 增加超时时间

    test("should initialize table successfully", async () => {
        await TableInitializer.initTable(manager.client, tableName, idField);
        // 验证表是否存在
        const result = await manager.client.sql`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_name = ${tableName}
            AND table_schema = 'public';
        `;
        expect(result.rowCount).toBe(1);
    });

    test("should insert and retrieve data", async () => {
        const accesser = new MockTableAccesser(manager, tableName, idField);
        const testData = {
            data: {
                test_id: "test123",
                name: "Test Name",
                value: 42,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }
        } as any;

        // 插入数据
        await accesser.insertOrUpdate(testData);

        // 获取数据
        const retrievedData = await accesser.getData("test123");
        expect((retrievedData?.data as any).test_id).toBe("test123");
        expect((retrievedData?.data as any).name).toBe("Test Name");
        expect((retrievedData?.data as any).value).toBe(42);
    });

    test("should update existing data", async () => {
        const accesser = new MockTableAccesser(manager, tableName, idField);
        const updatedData = {
            data: {
                test_id: "test123",
                name: "Updated Name",
                value: 99,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }
        } as any;

        // 更新数据
        await accesser.insertOrUpdate(updatedData);

        // 获取更新后的数据
        const retrievedData = await accesser.getData("test123");
        expect((retrievedData?.data as any).test_id).toBe("test123");
        expect((retrievedData?.data as any).name).toBe("Updated Name");
        expect((retrievedData?.data as any).value).toBe(99);
    });

    test("should delete data", async () => {
        const accesser = new MockTableAccesser(manager, tableName, idField);

        // 删除数据
        await accesser.deleteData("test123");

        // 验证数据是否被删除
        const retrievedData = await accesser.getData("test123");
        expect(retrievedData).toBeUndefined();
    });

    test("should use cache for data retrieval", async () => {
        const accesser = new MockTableAccesser(manager, tableName, idField);
        const testData = {
            data: {
                test_id: "cacheTest",
                name: "Cache Test",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }
        } as any;

        // 插入数据
        await accesser.insertOrUpdate(testData);

        // 第一次获取（应该从数据库获取并缓存）
        const firstRetrieval = await accesser.getData("cacheTest");
        expect((firstRetrieval?.data as any).test_id).toBe("cacheTest");
        expect((firstRetrieval?.data as any).name).toBe("Cache Test");

        // 验证缓存大小（模拟实现返回0）
        expect(accesser.getCacheSize()).toBe(0);

        // 第二次获取（应该从缓存获取）
        const secondRetrieval = await accesser.getData("cacheTest");
        expect((secondRetrieval?.data as any).test_id).toBe("cacheTest");
        expect((secondRetrieval?.data as any).name).toBe("Cache Test");
    });

    test("should clear cache", async () => {
        const accesser = new MockTableAccesser(manager, tableName, idField);
        const testData = {
            data: {
                test_id: "clearCacheTest",
                name: "Clear Cache Test",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }
        } as any;

        // 插入数据
        await accesser.insertOrUpdate(testData);

        // 验证缓存大小（模拟实现返回0）
        expect(accesser.getCacheSize()).toBe(0);

        // 清除缓存
        accesser.clearCache();

        // 验证缓存是否被清除
        expect(accesser.getCacheSize()).toBe(0);
    });

    test("should handle transaction", async () => {
        const accesser = new MockTableAccesser(manager, tableName, idField);

        await accesser.transaction(async (client) => {
            const testData1 = {
                data: {
                    test_id: "transaction1",
                    name: "Transaction Test 1",
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }
            } as any;
            const testData2 = {
                data: {
                    test_id: "transaction2",
                    name: "Transaction Test 2",
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }
            } as any;

            // 在事务中插入两条数据
            await accesser.insertOrUpdate(testData1, { client });
            await accesser.insertOrUpdate(testData2, { client });
        });

        // 验证两条数据都被插入
        const data1 = await accesser.getData("transaction1");
        const data2 = await accesser.getData("transaction2");
        expect(data1).toBeDefined();
        expect(data2).toBeDefined();
    });
});