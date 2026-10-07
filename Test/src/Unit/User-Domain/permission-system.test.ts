import { PermissionManager } from "@sosraciel-lamda/user-domain";
import type { PermissionManagerJsonTable } from "@sosraciel-lamda/user-domain";


/**测试用权限配置 */
const TEST_TABLE: PermissionManagerJsonTable = {
    define: {
        /**基础权限组 */
        basic: { segment: ["cmd.basic"] },
    },
    role: {
        /**普通用户: 拥有全部 cmd.* 与继承的 basic */
        user: { segment: [{ node: "cmd.*", weight: 1 }], inherit: "basic" },
        /**受限用户: 同节点上正负权重相互抵消 */
        conflict: { segment: [{ node: "cmd.keep", weight: 1 }, { node: "cmd.keep", weight: -1 }] },
    },
    rule: [
        /**vip 前缀的角色动态获得 cmd.vip */
        { role_regex: "^vip\\.", data: { segment: [{ node: "cmd.vip", weight: 5 }] } },
    ],
};

describe("User-Domain 权限系统 测试", () => {
    beforeAll(() => {
        PermissionManager.initInject({ table: TEST_TABLE });
    });

    test("1. 应放行角色直接声明的权限节点", async () => {
        await expect(PermissionManager.check({ roleset: "user", node: "cmd.setname" })).resolves.toBe(true);
    });

    test("2. 应拒绝未声明的权限节点", async () => {
        await expect(PermissionManager.check({ roleset: "user", node: "other.node" })).resolves.toBe(false);
    });

    test("3. 应放行通过 inherit 继承的权限组", async () => {
        await expect(PermissionManager.check({ roleset: "user", node: "cmd.basic" })).resolves.toBe(true);
    });

    test("4. 不存在的角色应无任何权限", async () => {
        await expect(PermissionManager.check({ roleset: "ghost", node: "cmd.setname" })).resolves.toBe(false);
    });

    test("5. 同节点正负权重应相互抵消", async () => {
        await expect(PermissionManager.check({ roleset: "conflict", node: "cmd.keep" })).resolves.toBe(false);
    });

    test("6. 应支持多个角色并存", async () => {
        await expect(PermissionManager.check({ roleset: ["ghost", "user"], node: "cmd.basic" })).resolves.toBe(true);
    });

    test("7. 应支持 role_regex 动态匹配角色", async () => {
        await expect(PermissionManager.check({ roleset: "vip.zhang", node: "cmd.vip" })).resolves.toBe(true);
        await expect(PermissionManager.check({ roleset: "normal.zhang", node: "cmd.vip" })).resolves.toBe(false);
    });

    test("8. threshold 应能抬高放行门槛", async () => {
        // user 通过通配符 cmd.* 在 cmd.vip 上取得权重 1
        await expect(PermissionManager.check({ roleset: "user", node: "cmd.vip", threshold: 0 })).resolves.toBe(true);
        // 门槛抬到 2 即不再放行
        await expect(PermissionManager.check({ roleset: "user", node: "cmd.vip", threshold: 2 })).resolves.toBe(false);
        // vip 角色权重为 5, 抬高到 6 即不再放行
        await expect(PermissionManager.check({ roleset: "vip.a", node: "cmd.vip", threshold: 6 })).resolves.toBe(false);
    });

    test("9. 权限节点匹配应忽略大小写", async () => {
        await expect(PermissionManager.check({ roleset: "user", node: "CMD.SETNAME" })).resolves.toBe(true);
    });
});
