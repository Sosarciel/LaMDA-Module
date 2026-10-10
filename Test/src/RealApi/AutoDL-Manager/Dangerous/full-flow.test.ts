/** AutoDL-Manager 全路径测试 ⚠️ 危险：会真实开关机
 *
 * 模拟真实调用方的完整链路, 对齐 TTS-Manager 那类「调用即用」的用法:
 *
 * ```
 * 调用方使用函数
 *   → 实例管理器发现未启动, **自动拉起**
 *   → 完成函数调用(端口转发 / 指令执行)并把结果返回调用方
 *   → 达到 TTL 保活时间后自动释放
 * ```
 *
 * ## ⚠️ 为什么放在 Dangerous/ 且默认关闭
 *
 * 本文件**会真实开关机**（有卡约 1.68 元/小时），
 * 与其他「预期实例已开机」的测试语义完全不同：
 *
 * | 目录/文件 | 语义 | 是否含开关机 |
 * |---|---|---|
 * | `AutoDL-Manager/*.test.ts` | **预期已开机**，只测已启动后的链路 | 否 |
 * | `Dangerous/full-flow.test.ts` | **调用即拉起**，含开关机与 TTL | **是** |
 *
 * 因此：
 * 1. 放在 `Dangerous/` 子目录, 与常规测试物理隔离
 * 2. 由下方 `ENABLED = false` 硬开关控制 —— **测试脚本永远不会自动跑它**,
 *    必须人工把开关改掉, 或显式设置 `AUTODL_FLOW=true` 才执行
 *
 * 常规跑测试（`npm run test -- --selectProjects real-api`）不会碰到本文件的开机逻辑。
 *
 * ## 关于 TTL 的起算点（读 ServiceManager 源码确认）
 *
 * `ServiceManager.invoke()` 的流程是：
 * ```js
 * const pak = await this.ensure(lastname);      // 未启动则自动 start()
 * const result = await pak.instance[fd](...);   // 执行目标函数
 * this.touchIns(pak);                           // ← 调用**之后**才起算 TTL
 * ```
 * 而 `touchIns` 里是 `expireAt = now + idle_timeout * 1000`。
 * 所以 **TTL 从「调用完成瞬间」起算**，不是从真正打开开始。
 * 这也意味着若实例拉起本身很慢（有卡开机约 30s），TTL 不会因此被吃掉。
 *
 * ## 与常规测试的语义区别
 *
 * 常规测试写的是「**预期已打开**」—— 调用前实例必须已在运行，否则在模块顶层抛错。
 * 本测试的语义是「**调用即拉起**」：调用前断言实例是关的，调用后断言它已可用。
 *
 * ## 幂等与费用
 *
 * 测试自己上传被测服务、自己清理，不依赖远端预置环境。
 *
 * 运行方式（二选一）：
 * ```
 * # 1. 环境变量
 * cross-env WITH_API=true AUTODL_FLOW=true npm run test -- --selectProjects real-api src/RealApi/AutoDL-Manager/Dangerous --runInBand --forceExit
 * # 2. 把下面的 ENABLED 改成 true 后直接跑
 * ```
 */

import { AutoDLManager, isPortListening } from "@sosraciel-lamda/autodl-manager";
import type { AutoDLDrive, SshClient } from "@sosraciel-lamda/autodl-manager";
import { SLogger } from "@zwa73/utils";

import { buildServiceScript, credFields } from "@/src/RealApi/AutoDL-Manager/Util";
import { AUTODL_LOCAL_PORT, AUTODL_REMOTE_PORT, getAutoDLCred } from "@/src/Constant";

/** ⚠️ 危险测试总开关：人工确认后才置 true
 *
 * **默认 `false`** —— 本文件会真实开关机并产生 GPU 费用（有卡约 1.68 元/小时），
 * 因此测试脚本、CI、批量跑测试都**不会**触发它。
 * 要执行时必须由人**显式**做下面二者之一：
 *   1. 把本常量改成 `true`
 *   2. 设环境变量 `AUTODL_FLOW=true`
 */
const MANUAL_CONFIRM: boolean = false;

/** 是否启用本危险测试（人工开关 或 环境变量，二者其一） */
const ENABLED: boolean = MANUAL_CONFIRM || process.env.AUTODL_FLOW === "true";

const describeFlow = ENABLED ? describe : describe.skip;

/** 缺少凭据时在模块加载阶段抛错, 让整个测试集直接失败(报告 0 个用例) */
const CRED = getAutoDLCred();

/** 测试用实例名 */
const INSTANCE = "TestFullFlow";

/** 本地端口(登记于 Constant.ts) */
const LOCAL_PORT = AUTODL_LOCAL_PORT.flow;

/** 远端端口 */
const REMOTE_PORT = AUTODL_REMOTE_PORT;

/** 该端口服务返回的固定内容 */
const SERVICE_BODY = "AKASET_FLOW_SVC";

/** 远端工作目录, 测试结束整体删除 */
const REMOTE_DIR = "/root/akaset_test_flow";

/** TTL 保活时长/秒
 *
 * 取 1 分钟: 有卡开机约 30s, 留出余量让「拉起 + 调用 + 观察」都能在 TTL 内完成,
 * 又不至于让测试等太久。TTL 从调用完成瞬间起算(见文件头注释)。
 */
const IDLE_TIMEOUT_SEC = 60;

/** 超时上限/毫秒 */
const TIMEOUT = {
    /** 开机 + 建隧道: 有卡开机实测约 30s, 留 3 倍余量 */
    powerOn: 180_000,
    /** 单次 API 调用 */
    api: 30_000,
    /** 等待 TTL 到期并释放 */
    expire: 180_000,
};

describeFlow("AutoDL-Manager 全路径(调用即拉起 → TTL 自动释放)", () => {

    /** 实例(确切类型) */
    let ins: AutoDLDrive;

    beforeAll(async () => {
        AutoDLManager.initInject({
            serviceTable: {
                instance_table: {
                    [INSTANCE]: {
                        type: "ProInstance",
                        name: INSTANCE,
                        // TTL 挂在实例上; 也可放全局
                        idle_timeout: IDLE_TIMEOUT_SEC,
                        data: {
                            ...credFields(),
                            jupyter_port: 8888,
                            port_forwards: [{ local_port: LOCAL_PORT, remote_port: REMOTE_PORT }],
                        },
                    },
                },
            },
        });
        await AutoDLManager.sm.inited;
        ins = (await AutoDLManager.getInstance(INSTANCE))!;
        expect(ins).toBeDefined();
    }, TIMEOUT.api);

    afterAll(async () => {
        // 兜底: 无论成败都要把远端关掉, 否则会持续计费
        try {
            const status = await ins?.getStatus();
            if (status !== "shutdown") {
                SLogger.warn(`afterAll: 实例仍处于 ${status}, 执行关机`);
                await AutoDLManager.powerOffAndConfirm(INSTANCE, { interval: 5_000, timeout: 120_000 });
            }
        } catch (e) {
            SLogger.error(`afterAll 关机失败, 请手动检查! ${e}`);
        }
        await ins?.closeTunnel();
    }, TIMEOUT.powerOn);

    it("1. 前置: 实例应处于关机状态(全路径的起点)", async () => {
        const status = await ins.getStatus();
        SLogger.info(`当前实例状态: ${status}`);

        // 若实例本就开着, 先关掉 —— 否则测不出「自动拉起」
        if (status !== "shutdown") {
            SLogger.warn(`实例当前为 ${status}, 先关机以保证测试从"未启动"开始`);
            const ok = await AutoDLManager.powerOffAndConfirm(INSTANCE, {
                interval: 5_000,
                timeout: 120_000,
            });
            expect(ok).toBe(true);
        }

        expect(await ins.getStatus()).toBe("shutdown");
        // 关机状态下隧道必然不可用
        expect(await ins.isTunnelAlive()).toBe(false);
        expect(await isPortListening(LOCAL_PORT)).toBe(false);
    }, TIMEOUT.powerOn);

    it("2. 开机(有卡模式, 官方不支持无卡开机)", async () => {
        const ok = await AutoDLManager.powerOn(INSTANCE);

        // 无库存时 API 返回 HTTP 200 但 code=InternalError、msg="当前算力规格暂无库存"。
        // 这种失败很常见(该区该规格的卡被抢光), 给出可操作的提示而不是干瘪的断言失败。
        if (!ok) {
            const status = await ins.getStatus();
            throw new Error(
                `开机失败。API 返回 code=InternalError，最常见原因是**当前算力规格暂无库存**\n` +
                `（原始 msg: "当前算力规格暂无库存, 请修改配置或稍等再试"）。\n` +
                `实例当前状态: ${status}\n` +
                `处理建议: 稍后重试, 或在 AutoDL 控制台换用其他可用规格/区域。\n` +
                `这不是代码缺陷 —— AutoDLProClient.powerOn 已正确把非 Success 的 code 反映为 false。`);
        }
        expect(ok).toBe(true);

        // 等到确实 running, 而不是盲等固定时长
        const running = await AutoDLProClientWaitRunning();
        expect(running).toBe(true);
        SLogger.info("实例已开机就绪");
    }, TIMEOUT.powerOn);

    it("3. 调用即拉起: 直接调用函数, 隧道应被自动建立", async () => {
        // 调用前: 没有隧道
        expect(await ins.isTunnelAlive()).toBe(false);

        // 先准备好远端服务(此时实例已开机, ssh 可用)
        const ssh = (await ins.getSshClient())!;
        await startServiceThroughSsh(ssh);

        // ★ 核心: 调用方不需要自己 openTunnel, 直接调 sm.invoke
        //   ServiceManager 会 ensure() → 发现 isRuning() 为 false → 自动 start() → 建隧道
        const status = await AutoDLManager.sm.invoke(INSTANCE, "getStatus");
        expect(status).toBe("running");

        // 自动拉起后隧道应已就绪
        expect(await ins.isTunnelAlive()).toBe(true);
        expect(await isPortListening(LOCAL_PORT)).toBe(true);
        SLogger.info("自动拉起生效: 隧道已由 ServiceManager 建立");
    }, TIMEOUT.powerOn);

    it("4. 端口转发可用: 经本地端口访问到远端服务", async () => {
        const res = await fetch(`http://127.0.0.1:${LOCAL_PORT}/`, {
            signal: AbortSignal.timeout(TIMEOUT.api),
        });
        expect((await res.text()).trim()).toBe(SERVICE_BODY);
    }, TIMEOUT.api);

    it("5. 指令执行可用: 调用方拿到返回值", async () => {
        const ssh = (await ins.getSshClient())!;
        const r = await ssh.exec("hostname && whoami");
        expect(r.stdout).toContain("autodl-");
        expect(r.stdout).toContain("root");
    }, TIMEOUT.api);

    it("6. TTL 到期后应自动释放隧道", async () => {
        // 先确认调用后隧道是活的
        expect(await ins.isTunnelAlive()).toBe(true);

        // TTL 从**最后一次调用完成瞬间**起算, 故这里直接等 idle_timeout 秒 + 余量
        const waitMs = (IDLE_TIMEOUT_SEC + 20) * 1000;
        SLogger.info(`等待 ${IDLE_TIMEOUT_SEC}s TTL 到期(另加 20s 余量)...`);
        const deadline = Date.now() + waitMs;

        let released = false;
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 3_000));
            if (!await ins.isTunnelAlive() && !await isPortListening(LOCAL_PORT)) {
                released = true;
                break;
            }
        }
        expect(released).toBe(true);
        SLogger.info("TTL 到期, 隧道已自动释放");
    }, TIMEOUT.expire);

    it("7. 释放后不应能再访问(隧道确实断了)", async () => {
        expect(await ins.isTunnelAlive()).toBe(false);
        expect(await isPortListening(LOCAL_PORT)).toBe(false);

        // 端口没在监听, 连接应当失败
        await expect(
            fetch(`http://127.0.0.1:${LOCAL_PORT}/`, { signal: AbortSignal.timeout(5_000) }),
        ).rejects.toThrow();
    }, TIMEOUT.api);

    it("8. 清理: 停服务、删目录、关机并确认真的关了", async () => {
        const ssh = (await ins.getSshClient())!;
        await ssh.exec(`pkill -f '${REMOTE_DIR}' > /dev/null 2>&1; echo ok`);
        await ssh.removeRemoteDir(REMOTE_DIR);
        expect(await ssh.remoteExists(REMOTE_DIR)).toBe(false);

        const ok = await AutoDLManager.powerOffAndConfirm(INSTANCE, {
            interval: 5_000,
            timeout: 120_000,
        });
        expect(ok).toBe(true);

        // 关机是异步的, powerOffAndConfirm 已经轮询到 shutdown, 这里再确认一次
        expect(await ins.getStatus()).toBe("shutdown");
    }, TIMEOUT.powerOn);

    // #region 局部工具

    /** 组装远端服务脚本所需的最小 ssh 操作 */
    async function startServiceThroughSsh(ssh: SshClient) {
        await ssh.ensureRemoteDir(REMOTE_DIR);
        await ssh.uploadText(
            buildServiceScript(REMOTE_PORT, SERVICE_BODY, REMOTE_DIR),
            `${REMOTE_DIR}/svc.sh`,
        );
        await ssh.exec(`pkill -f '${REMOTE_DIR}' > /dev/null 2>&1; echo ok`);
        await new Promise(r => setTimeout(r, 1000));
        await ssh.exec(`bash ${REMOTE_DIR}/svc.sh`);

        for (let i = 0; i < 30; i++) {
            const r = await ssh.exec(`curl -s -m 2 http://127.0.0.1:${REMOTE_PORT}/ || true`);
            if (r.stdout.trim() === SERVICE_BODY) return;
            await new Promise(r => setTimeout(r, 500));
        }
        const log = await ssh.readRemoteFile(`${REMOTE_DIR}/svc.log`).catch(() => "");
        throw new Error(`测试服务未能就绪, 日志: ${log || "(空)"}`);
    }

    /** 轮询等待实例进入 running */
    async function AutoDLProClientWaitRunning(): Promise<boolean> {
        const deadline = Date.now() + TIMEOUT.powerOn;
        while (Date.now() < deadline) {
            if (await ins.getStatus() === "running") return true;
            await new Promise(r => setTimeout(r, 5_000));
        }
        return false;
    }

    // #endregion
});
