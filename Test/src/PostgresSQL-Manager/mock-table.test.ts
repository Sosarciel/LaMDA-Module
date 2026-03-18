import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { TableInitializer, MockTableAccesser, MockCacheCoordinator, MockJsonDataCacheCoordinator, PostgreSQLMockTool, cache, jsonCache } from "@sosraciel-lamda/postgresql-manager/mock";

const { MOCK_TABLE_NAME, MOCK_ID_FIELD } = PostgreSQLMockTool;

describe("模拟表初始化器", () => {
    let manager: DBManager;

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

        // 测试数据库连接
        const result = await manager.client.query("SELECT 1");
        expect(result.rowCount).toBe(1);

        // 清理可能存在的测试表和函数
        try {
            // 删除表
            await manager.client.query(`DROP TABLE IF EXISTS ${MOCK_TABLE_NAME};`);
            // 删除相关函数
            await manager.client.query(`DROP FUNCTION IF EXISTS func__${MOCK_TABLE_NAME}__before_insert_or_update();`);
            await manager.client.query(`DROP FUNCTION IF EXISTS set_${MOCK_TABLE_NAME}(text);`);
        } catch (e) {
            // 忽略错误
        }
    }, 30000); // 增加超时时间

    afterAll(async () => {
        // 清理表
        try {
            if (manager) {
                await TableInitializer.dropTable(manager.client);
                // 关闭数据库连接
                await manager.stop();
            }

            // 关闭缓存实例，清理TTL定时器
            cache.dispose();
            jsonCache.dispose();
        } catch (e) {
            // 忽略错误
        }
    }, 30000); // 增加超时时间

    test("应成功初始化表", async () => {
        await TableInitializer.initTable(manager.client);
        // 验证表是否存在
        const result = await manager.client.sql`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_name = ${MOCK_TABLE_NAME}
            AND table_schema = 'public';
        `;
        expect(result.rowCount).toBe(1);
    });

    test("应使用注入的普通缓存协调器", async () => {
        // 创建访问器并注入缓存协调器
        const accesser = new MockTableAccesser(manager);
        accesser.injectCacheCoordinator(MockCacheCoordinator);

        const testData = {
            data: {
                test_id: "injectedCacheTest",
                name: "注入缓存测试",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }
        } as any;

        // 插入数据
        await accesser.insertOrUpdate(testData);

        // 验证缓存是否存在
        expect(accesser.hasCache("injectedCacheTest")).toBe(true);
        expect(accesser.peekCache("injectedCacheTest")).toBeDefined();

        // 获取数据
        const retrievedData = await accesser.getData("injectedCacheTest");
        expect((retrievedData?.data as any).test_id).toBe("injectedCacheTest");
        expect((retrievedData?.data as any).name).toBe("注入缓存测试");
    });

    test("应使用注入的JSON数据缓存协调器", async () => {
        // 等待初始化完成
        await MockJsonDataCacheCoordinator.inited;

        // 创建访问器并注入缓存协调器
        const accesser = new MockTableAccesser(manager);
        accesser.injectCacheCoordinator(MockJsonDataCacheCoordinator);

        const testData = {
            data: {
                test_id: "jsonCacheTest",
                name: "JSON缓存测试",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }
        } as any;

        // 插入数据
        await accesser.insertOrUpdate(testData);

        // 验证缓存是否存在
        expect(accesser.hasCache("jsonCacheTest")).toBe(true);
        expect(accesser.peekCache("jsonCacheTest")).toBeDefined();

        // 获取数据
        const retrievedData = await accesser.getData("jsonCacheTest");
        expect((retrievedData?.data as any).test_id).toBe("jsonCacheTest");
        expect((retrievedData?.data as any).name).toBe("JSON缓存测试");
    });

    test("应通过数据库通知更新缓存", async () => {
        // 创建访问器并注入缓存协调器
        const accesser = new MockTableAccesser(manager);
        accesser.injectCacheCoordinator(MockCacheCoordinator);

        // 插入初始数据
        const initialData = {
            data: {
                test_id: "notifyTest",
                name: "初始名称",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }
        } as any;
        await accesser.insertOrUpdate(initialData);

        // 验证缓存
        expect(accesser.hasCache("notifyTest")).toBe(true);
        expect((accesser.peekCache("notifyTest")?.data as any).name).toBe("初始名称");

        // 不通过访问器，直接用mgr发指令更新数据
        await manager.client.query(`
            UPDATE ${MOCK_TABLE_NAME}
            SET data = jsonb_set(data, '{name}', to_jsonb('更新后的名称'::text), true)
            WHERE data->>'${MOCK_ID_FIELD}' = 'notifyTest';
        `);

        // 等待通知处理
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 验证缓存是否已更新
        const cachedData = accesser.peekCache("notifyTest");
        expect(cachedData).toBeDefined();
        expect((cachedData?.data as any).name).toBe("更新后的名称");

        // 不通过访问器，直接用mgr发指令删除数据
        await manager.client.query(`
            DELETE FROM ${MOCK_TABLE_NAME}
            WHERE data->>'${MOCK_ID_FIELD}' = 'notifyTest';
        `);

        // 等待通知处理
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 验证缓存是否已删除
        expect(accesser.hasCache("notifyTest")).toBe(false);
    });
});