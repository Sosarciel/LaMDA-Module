import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { UserData, UserDomain } from "@sosraciel-lamda/user-domain";
import { DBCache, DBCacheKH } from "@sosraciel-lamda/user-domain/dist/DBCache";
import { sleep } from "@zwa73/utils";
import { setupTestDb, teardownTestDb } from "./Util";
import type { TestParams } from "./Util";

describe("User-Domain 用户数据 测试", () => {
    let manager: DBManager;

    beforeAll(async () => {
        manager = await setupTestDb();
    }, 30000);

    afterAll(async () => {
        await teardownTestDb(manager);
    }, 30000);

    test("1. 应成功初始化 user_data 表", async () => {
        const result = await manager.client.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_name = 'user_data'
            AND table_schema = 'public';
        `);
        expect(result.rowCount).toBe(1);
    });

    test("2. 应成功写入并读取用户数据", async () => {
        const userId = "udtest-basic";
        await UserDomain.insertUserData({ data: { user_id: userId, user_name: "张三" } });

        const row = await UserDomain.getUserData(userId);
        expect(row).toBeDefined();
        expect(row?.data.user_id).toBe(userId);
        expect(row?.data.user_name).toBe("张三");
    });

    test("3. 写入后应建立缓存, 且缓存与数据库一致", async () => {
        const userId = "udtest-cache";
        await UserDomain.insertUserData({ data: { user_id: userId, user_name: "缓存用户" } });

        const cacheKey = DBCacheKH.getUserDataKey(userId);
        expect(DBCache.hasCache(cacheKey)).toBe(true);

        // data_hash 由代码层与数据库两侧独立算出, 必须一致
        const dbRes = await manager.client.query(
            `SELECT data->>'data_hash' AS h FROM user_data WHERE data->>'user_id' = $1;`, [userId]);
        expect(DBCache.peekCache(cacheKey)?.data.data_hash).toBe(dbRes.rows[0].h);
    });

    test("4. 显式 undefined 应真正删除该字段", async () => {
        const userId = "udtest-undef";
        await UserDomain.insertUserData({ data: { user_id: userId, user_name: "待删除", in_private_chat: true } });

        const row = await UserDomain.getUserData(userId);
        expect(row?.data.in_private_chat).toBe(true);

        // 先合入旧数据再提交 undefined 字段: JSON 序列化会丢弃 undefined, 从而让数据库真正删除该键
        const newData = JSON.parse(JSON.stringify(row!.data)) as Record<string, unknown>;
        newData.in_private_chat = undefined;
        await UserDomain.insertUserData({
            order_id: row!.order_id,
            data: JSON.parse(JSON.stringify(newData))
        });
        await sleep(100);

        const after = await manager.client.query(
            `SELECT data FROM user_data WHERE data->>'user_id' = $1;`, [userId]);
        expect("in_private_chat" in after.rows[0].data).toBe(false);
        expect(after.rows[0].data.user_name).toBe("待删除");
    });

    test("5. UserData.loadOrCreate 应能创建并读取实体", async () => {
        const userId = "udtest-entity";
        const ud = await UserData.loadOrCreate<TestParams>(userId);

        expect(ud.getUserId()).toBe(userId);
        expect(ud.getUserName()).toBeUndefined();

        await ud.updateData({ user_name: "实体用户" });
        const again = await UserData.loadOrCreate<TestParams>(userId);
        expect(again.getUserName()).toBe("实体用户");
    });

    test("6. setUserDefChatParam 应写入并可读回", async () => {
        const userId = "udtest-params";
        const ud = await UserData.loadOrCreate<TestParams>(userId);

        await ud.setUserDefChatParam({ model_name: "GPT4Chat", max_hist_length: 20, preferred_account: ["Eylink4"] });

        const again = await UserData.loadOrCreate<TestParams>(userId);
        expect(again.getUserDefChatParam()).toEqual({
            model_name: "GPT4Chat",
            max_hist_length: 20,
            preferred_account: ["Eylink4"],
        });
    });

    test("7. 外部SQL 改动后缓存应同步", async () => {
        const userId = "udtest-sync";
        await UserDomain.insertUserData({ data: { user_id: userId, user_name: "同步前" } });
        const cacheKey = DBCacheKH.getUserDataKey(userId);
        expect(DBCache.peekCache(cacheKey)?.data.user_name).toBe("同步前");

        await manager.client.query(
            `UPDATE user_data SET data = jsonb_set(data,'{user_name}',to_jsonb('同步后'::text),true)
             WHERE data->>'user_id' = $1;`, [userId]);
        await sleep(1200);

        expect(DBCache.peekCache(cacheKey)?.data.user_name).toBe("同步后");
    });

    test("8. 删除后缓存应被移除", async () => {
        const userId = "udtest-del";
        await UserDomain.insertUserData({ data: { user_id: userId, user_name: "待删除行" } });
        const cacheKey = DBCacheKH.getUserDataKey(userId);
        expect(DBCache.hasCache(cacheKey)).toBe(true);

        await manager.client.query(`DELETE FROM user_data WHERE data->>'user_id' = $1;`, [userId]);
        await sleep(1200);

        expect(DBCache.hasCache(cacheKey)).toBe(false);
    });
});
