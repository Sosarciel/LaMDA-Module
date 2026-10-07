/** AutoDL-Manager Jupyter 终端测试
 *
 * 覆盖 Jupyter 客户端的能力：
 * - 定位映射到 Jupyter 的本地端口
 * - 在终端执行指令并取回**纯结果**（已剥离 ANSI、欢迎横幅、命令回显）
 * - 终端保留在服务端（可在 JupyterLab 界面看到）
 * - 列出 / 删除终端（**防止终端泄漏**）
 * - 通道断开后**自动重连**（重连到同一终端，shell 状态不丢）
 *
 * ## 为什么单独一个文件
 *
 * 终端相关逻辑与 SSH 侧完全独立，放在 `jupyter.test.ts` 里边界更清楚，
 * 也避免 `multi-instance.test.ts` 膨胀。
 *
 * ## 幂等
 *
 * 自己上传被测服务、自己清理；终端采用**基线对比**清理 ——
 * `beforeAll` 记录已有终端，`afterAll` 只删本次新增的，不动人工留下的。
 *
 * 运行方式：
 * ```
 * cross-env WITH_API=true npm run test -- --selectProjects real-api src/RealApi/AutoDL-Manager/jupyter.test.ts --runInBand --forceExit
 * ```
 */

import { AutoDLManager, isPortListening, stripAnsi } from "@sosraciel-lamda/autodl-manager";
import type { AutoDLDrive } from "@sosraciel-lamda/autodl-manager";
import { SLogger } from "@zwa73/utils";

import { cleanupTestServices, credFields, assertInstanceRunning } from "@/src/RealApi/AutoDL-Manager/Util";
import { AUTODL_LOCAL_PORT, getAutoDLCred } from "@/src/Constant";

/** 缺少凭据时在模块加载阶段抛错, 让整个测试集直接失败 */
const CRED = getAutoDLCred();

/** Jupyter 终端需要实例处于运行中; 校验放模块顶层, 让整个测试集失败而非逐用例报错 */
assertInstanceRunning("jupyter.test.ts");

/** 测试用实例名 */
const INSTANCE = "TestJupyter";

/** 远端 Jupyter 端口 */
const REMOTE_JUPYTER = 8888;

/** 本地映射端口(登记于 Constant.ts) */
const LOCAL_JUPYTER = AUTODL_LOCAL_PORT.jupyter;

/** 远端工作目录 */
const REMOTE_DIR = "/root/akaset_test_jupyter";

/** 超时上限/毫秒 (实测: 建隧道约 1s, 终端指令约 1.5s) */
const TIMEOUT = {
    /** beforeAll: 建隧道 + 拉取终端基线 */
    setup: 120_000,
    api: 30_000,
    tunnel: 30_000,
    jupyter: 40_000,
    reconnect: 60_000,
};

describe("AutoDL-Manager Jupyter 终端", () => {

    let ins: AutoDLDrive;
    /** 测试开始前实例上已有的终端, 结束时只清理新增的 */
    let terminalsBefore: string[] = [];

    beforeAll(async () => {
        AutoDLManager.initInject({
            serviceTable: {
                instance_table: {
                    [INSTANCE]: {
                        type: "ProInstance",
                        name: INSTANCE,
                        data: {
                            ...credFields(),
                            jupyter_port: REMOTE_JUPYTER,
                            port_forwards: [{ local_port: LOCAL_JUPYTER, remote_port: REMOTE_JUPYTER }],
                        },
                    },
                },
            },
        });
        await AutoDLManager.sm.inited;

        // 按类型取实例, 类型由 ctorTable 推导 —— 拿到的是确切的 AutoDLDrive
        const list = await AutoDLManager.getInstancesByType("ProInstance");
        ins = list.find(pak => pak.name === INSTANCE)!.instance;
        expect(ins).toBeDefined();

        // 需要 Jupyter 端口映射, 但 Jupyter 本身由实例自带, 无需自建 HTTP 服务。
        // 这里仍建隧道 —— 终端 WS 与 REST 都要经它。
        await ins.openTunnel();

        // 记录终端基线
        const jc = (await ins.getJupyterClient())!;
        terminalsBefore = await jc.list();
        SLogger.info(`测试前已有 Jupyter 终端: ${JSON.stringify(terminalsBefore)}`);
    }, TIMEOUT.setup);

    afterAll(async () => {
        // 先清理本次新增的终端, 再收隧道 ——
        // 删终端要经隧道打到 Jupyter 的 REST 接口, 顺序反了就 fetch failed
        try {
            await ins.openTunnel();
            const jc = (await ins.getJupyterClient())!;
            const after = await jc.list();
            const created = after.filter(n => !terminalsBefore.includes(n));
            for (const name of created)
                await jc.remove(name);
            SLogger.info(`已清理本次新建的 Jupyter 终端: ${JSON.stringify(created)}`);
        } catch (e) {
            SLogger.warn(`清理 Jupyter 终端失败(不影响测试结论): ${e}`);
        }
        await ins?.closeTunnel();
        await cleanupTestServices(ins, REMOTE_DIR);
    }, TIMEOUT.tunnel);

    it("1. 应能定位映射到 Jupyter 的本地端口", async () => {
        await ins.openTunnel();
        expect(ins.getJupyterLocalPort()).toBe(LOCAL_JUPYTER);
        expect(await isPortListening(LOCAL_JUPYTER)).toBe(true);
    }, TIMEOUT.tunnel);

    it("2. 应能在终端执行指令并取回纯结果", async () => {
        const jc = (await ins.getJupyterClient())!;
        const out = await jc.run("echo JEST_JUPYTER_OK && whoami", { timeout: TIMEOUT.jupyter });

        expect(out).toContain("JEST_JUPYTER_OK");
        expect(out).toContain("root");
        // 输出应已剥离 ANSI 与 AutoDL 欢迎横幅
        expect(out).not.toContain("AutoDL---");
        expect(stripAnsi(out)).toBe(out);
    }, TIMEOUT.jupyter);

    it("3. 终端应保留在服务端, 可在 JupyterLab 界面看到", async () => {
        const jc = (await ins.getJupyterClient())!;
        await jc.run("echo KEEP_TERMINAL", { timeout: TIMEOUT.jupyter });

        const name = jc.terminalName;
        expect(name).toBeDefined();
        // 终端名应为数字形式(terminado 的命名规则)
        expect(name).toMatch(/^\d+$/);
        expect(jc.connected).toBe(true);

        // 关闭通道但终端保留在服务端
        await jc.close();
        expect(jc.connected).toBe(false);
    }, TIMEOUT.jupyter);

    it("4. 应能列出并删除服务端终端(防止终端泄漏)", async () => {
        // 终端由 create 产生且默认不自动删除, 若不提供删除手段会在实例上越积越多
        const jc = (await ins.getJupyterClient())!;
        const before = await jc.list();

        await jc.connect();
        const created = jc.terminalName!;
        expect(created).toBeDefined();

        const during = await jc.list();
        expect(during).toContain(created);
        expect(during.length).toBe(before.length + 1);

        // 删除后应真的从列表里消失
        await jc.close();
        expect(await jc.remove(created)).toBe(true);

        const after = await jc.list();
        expect(after).not.toContain(created);
        expect(after.length).toBe(before.length);
    }, TIMEOUT.jupyter);

    it("5. 通道断开后应自动重连到同一终端", async () => {
        const jc = (await ins.getJupyterClient())!;
        await jc.run("echo BEFORE_DROP", { timeout: TIMEOUT.jupyter });
        expect(jc.connected).toBe(true);

        const nameBefore = jc.terminalName;
        // 强制断开 WS 通道(模拟网络中断)
        (jc as unknown as { _ws: { close: () => void } })._ws.close();

        // 等待自动重连(默认 2s 间隔)
        let reconnected = false;
        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 1_500));
            if (jc.connected) { reconnected = true; break; }
        }
        expect(reconnected).toBe(true);

        // 重连的是**同一个终端**(终端进程在服务端独立存活), 因此名称不变
        expect(jc.terminalName).toBe(nameBefore);
        const out = await jc.run("echo AFTER_RECONNECT", { timeout: TIMEOUT.jupyter });
        expect(out).toContain("AFTER_RECONNECT");
    }, TIMEOUT.reconnect);

    it("6. release 应释放隧道并删除服务端终端", async () => {
        await ins.openTunnel();
        const jc = (await ins.getJupyterClient())!;
        await jc.connect();
        const created = jc.terminalName!;
        expect(await jc.list()).toContain(created);

        await AutoDLManager.release(INSTANCE);

        // 隧道应已释放
        expect(await isPortListening(LOCAL_JUPYTER)).toBe(false);

        // 终端应已从服务端删除(需重开隧道才能查)
        await ins.openTunnel();
        expect(await (await ins.getJupyterClient())!.list()).not.toContain(created);
    }, TIMEOUT.jupyter);
});
