import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { UserDomain } from "@sosraciel-lamda/user-domain";
import { DBCache } from "@sosraciel-lamda/user-domain/dist/DBCache";
import type { JObject } from "@zwa73/utils";
import { PG_PORT } from "@/src/Constant";


/**测试用默认参数表结构 */
export type TestParams = {
    model_name: string;
    max_hist_length: number;
    preferred_account: string[];
} & JObject;

/**设置测试数据库 */
export const setupTestDb = async (): Promise<DBManager> => {
    // 创建数据库管理器
    const manager = await DBManager.create({
        port: PG_PORT,
        user: "postgres",
        database: "postgres",
        host: "localhost",
        max: 10,
        idleTimeoutMillis: 1000 * 30,
    });

    // 测试数据库连接
    const result = await manager.client.query("SELECT 1");
    expect(result.rowCount).toBe(1);

    // 初始化 UserDomain (会载入自带的 sql 并订阅通知频道)
    UserDomain.initInject(Promise.resolve(manager));
    await UserDomain.inited;

    // 清理测试数据
    await manager.client.query(`DELETE FROM user_data`);

    return manager;
};

/**清理测试数据库 */
export const teardownTestDb = async (manager: DBManager | undefined) => {
    try {
        if (manager) {
            await manager.client.query(`DELETE FROM user_data`);
            // 关闭数据库连接
            await manager.stop();
        }
        // 清理缓存
        DBCache.dispose();
    } catch {
        // 忽略错误
    }
};
