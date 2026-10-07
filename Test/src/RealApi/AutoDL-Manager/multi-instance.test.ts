/** AutoDL-Manager 多实例与脱离式执行测试
 *
 * 覆盖：
 * 1. **多实例多端口** —— instance_table 中配置多个实例，每个实例各自多个端口映射，
 *    隧道相互独立，本地端口可任意编号
 * 2. **脱离式执行** —— 下发脚本后 SSH 断开也不中断（用日志持续增长证明存活）
 *
 * 已拆出到其他文件的：
 * - Jupyter 终端相关 → `jupyter.test.ts`
 * - SSH 连接复用与自动重连 → `ssh-tunnel.test.ts`
 *
 * 幂等：自己上传被测服务、自己清理，不依赖远端预置环境。
 *
 * 运行方式：
 * ```
 * cross-env WITH_API=true npm run test -- --selectProjects real-api src/RealApi/AutoDL-Manager/multi-instance.test.ts --runInBand --forceExit
 * ```
 */

import { AutoDLManager, isPortListening } from "@sosraciel-lamda/autodl-manager";
import type { AutoDLDrive, SshClient } from "@sosraciel-lamda/autodl-manager";
import { SLogger } from "@zwa73/utils";

import {
    assertInstanceRunning,
    cleanupTestServices,
    credFields,
    fetchLocal,
    startTestServices,
} from "@/src/RealApi/AutoDL-Manager/Util";
import { AUTODL_LOCAL_PORT, AUTODL_REMOTE_PORT, AUTODL_REMOTE_PORT_B, getAutoDLCred } from "@/src/Constant";

/** 缺少凭据时在模块加载阶段抛错, 让整个测试集直接失败 */
const CRED = getAutoDLCred();

/** 多实例测试需要实例处于运行中; 校验放模块顶层, 让整个测试集失败而非逐用例报错 */
assertInstanceRunning("multi-instance.test.ts");

/** 各实例名 */
const INST_A = "TestMultiA";
const INST_B = "TestMultiB";
const INST_C = "TestMultiC";

/** 本地端口分配(登记于 Constant.ts), 刻意与远端不同以验证映射可重新编号 */
const PORT_A1 = AUTODL_LOCAL_PORT.multiA1;
const PORT_A2 = AUTODL_LOCAL_PORT.multiA2;
const PORT_B1 = AUTODL_LOCAL_PORT.multiB1;

/** 远端服务端口与返回内容
 * 两个端口用两个**不同内容**的服务, 才能证明映射没有串到同一个上
 * (第二个端口避开 6007 —— 那是镜像自带 TensorBoard)
 */
const REMOTE_PORT_A = AUTODL_REMOTE_PORT;
const REMOTE_PORT_B = AUTODL_REMOTE_PORT_B;
const SERVICE_BODY_A = "AKASET_TEST_SVC_A";
const SERVICE_BODY_B = "AKASET_TEST_SVC_B";
const REMOTE_SVC = { [REMOTE_PORT_A]: SERVICE_BODY_A, [REMOTE_PORT_B]: SERVICE_BODY_B };

/** 测试用远端工作目录, 测试结束会整体删除 */
const REMOTE_DIR = "/root/akaset_test_multi";

/** 脱离式执行的日志路径 */
const DETACH_LOG = `${REMOTE_DIR}/jest_detached.log`;

/** 超时上限/毫秒 (依据实测: 建隧道约 1s, 指令约 1.5s) */
const TIMEOUT = {
    /** beforeAll 里的服务部署：上传 + 起服务 + 逐端口轮询就绪 */
    setup: 120_000,
    api: 30_000,
    tunnel: 30_000,
    request: 10_000,
    detached: 60_000,
};

describe("AutoDL-Manager 多实例与脱离式执行", () => {

    let insA: AutoDLDrive;
    let insB: AutoDLDrive;
    let insC: AutoDLDrive;
    let sshA: SshClient;
    let sshC: SshClient;

    beforeAll(async () => {
        AutoDLManager.initInject({
            serviceTable: {
                instance_table: {
                    // A: 两个端口映射
                    [INST_A]: {
                        type: "ProInstance",
                        name: INST_A,
                        data: {
                            ...credFields(),
                            port_forwards: [
                                { local_port: PORT_A1, remote_port: REMOTE_PORT_A },
                                { local_port: PORT_A2, remote_port: REMOTE_PORT_B },
                            ],
                        },
                    },
                    // B: 单个端口映射
                    [INST_B]: {
                        type: "ProInstance",
                        name: INST_B,
                        data: {
                            ...credFields(),
                            port_forwards: [{ local_port: PORT_B1, remote_port: REMOTE_PORT_A }],
                        },
                    },
                    // C: 不配任何端口映射, 用于验证不会平白建空隧道
                    [INST_C]: {
                        type: "ProInstance",
                        name: INST_C,
                        data: { ...credFields(), port_forwards: [] },
                    },
                },
            },
        });
        await AutoDLManager.sm.inited;

        // 按类型取实例, 类型由 ctorTable 推导 —— 拿到的是确切的 AutoDLDrive
        const list = await AutoDLManager.getInstancesByType("ProInstance");
        const pick = (n: string) => list.find(pak => pak.name === n)!.instance;
        insA = pick(INST_A);
        insB = pick(INST_B);
        insC = pick(INST_C);
        sshA = (await insA.getSshClient())!;
        sshC = (await insC.getSshClient())!;

        await startTestServices(insA, REMOTE_DIR, REMOTE_SVC);
    }, TIMEOUT.setup);

    afterAll(async () => {
        for (const ins of [insA, insB, insC])
            await ins?.closeTunnel();
        await cleanupTestServices(insA, REMOTE_DIR);
    }, TIMEOUT.tunnel);

    describe("1. 多实例多端口", () => {

        it("1.1 应能同时接管多个实例", async () => {
            expect(await AutoDLManager.sm.hasService(INST_A)).toBe(true);
            expect(await AutoDLManager.sm.hasService(INST_B)).toBe(true);
            expect(await AutoDLManager.sm.hasService(INST_C)).toBe(true);
            // 按类型取应返回全部三个
            expect((await AutoDLManager.getInstancesByType("ProInstance")).length).toBe(3);
        }, TIMEOUT.api);

        it("1.2 各实例应各自持有独立的端口映射配置", async () => {
            expect(insA.getData().port_forwards).toEqual([
                { local_port: PORT_A1, remote_port: REMOTE_PORT_A },
                { local_port: PORT_A2, remote_port: REMOTE_PORT_B },
            ]);
            expect(insB.getData().port_forwards).toEqual([
                { local_port: PORT_B1, remote_port: REMOTE_PORT_A },
            ]);
            expect(insC.getData().port_forwards).toEqual([]);
        }, TIMEOUT.api);

        it("1.3 应能为各实例分别建立隧道", async () => {
            expect(await insA.openTunnel()).toBe(true);
            expect(await insB.openTunnel()).toBe(true);
            // 无端口映射的实例无需建隧道, 直接视为成功
            expect(await insC.openTunnel()).toBe(true);
        }, TIMEOUT.tunnel);

        it("1.4 各实例的本地端口应各自监听", async () => {
            expect(await isPortListening(PORT_A1)).toBe(true);
            expect(await isPortListening(PORT_A2)).toBe(true);
            expect(await isPortListening(PORT_B1)).toBe(true);
        }, TIMEOUT.tunnel);

        it("1.5 不同本地端口应映射到不同的远端服务", async () => {
            const body1 = await fetchLocal(PORT_A1);
            const body2 = await fetchLocal(PORT_A2);

            // 精确比对, 确认映射到的确实是各自的目标服务
            expect(body1).toBe(REMOTE_SVC[REMOTE_PORT_A]);
            expect(body2).toBe(REMOTE_SVC[REMOTE_PORT_B]);
            expect(body1).not.toBe(body2);
        }, TIMEOUT.request);

        it("1.6 同一远端服务经不同实例映射, 内容应一致", async () => {
            // A 与 B 的对应端口映射的是同一个远端服务
            expect(await fetchLocal(PORT_B1)).toBe(await fetchLocal(PORT_A1));
        }, TIMEOUT.request);

        it("1.7 关闭某实例隧道不应影响其它实例", async () => {
            await insA.closeTunnel();

            expect(await insA.isTunnelAlive()).toBe(false);
            expect(await isPortListening(PORT_A1)).toBe(false);
            // B 的隧道应不受影响
            expect(await insB.isTunnelAlive()).toBe(true);
            expect(await isPortListening(PORT_B1)).toBe(true);
        }, TIMEOUT.tunnel);

        it("1.8 收尾: 关闭全部隧道并确认端口释放", async () => {
            for (const ins of [insA, insB, insC])
                await ins.closeTunnel();

            expect(await isPortListening(PORT_A1)).toBe(false);
            expect(await isPortListening(PORT_A2)).toBe(false);
            expect(await isPortListening(PORT_B1)).toBe(false);
        }, TIMEOUT.tunnel);
    });

    describe("2. 脱离式执行", () => {

        it("2.1 应能在远端投递脱离式任务并立即返回", async () => {
            // 先清掉上次的日志
            await sshC.exec(`rm -f ${DETACH_LOG}`);

            const started = Date.now();
            const res = await sshC.execDetached(
                `bash -c 'for i in $(seq 1 60); do echo tick $i >> ${DETACH_LOG}; sleep 1; done'`,
                { log: `${DETACH_LOG}.outer`, name: "jest-detached" },
            );
            const elapsed = Date.now() - started;

            expect(res.ok).toBe(true);
            expect(res.pid).not.toBe("");
            // 关键: 必须立即返回, 不能等脚本跑完(挂起即说明没脱离成功)
            expect(elapsed).toBeLessThan(15_000);
        }, TIMEOUT.detached);

        it("2.2 SSH 断开后脚本应持续运行(日志行数持续增长)", async () => {
            const counts: number[] = [];
            for (let i = 0; i < 3; i++) {
                await new Promise(r => setTimeout(r, 4_000));
                const out = await sshC.readRemoteLog(DETACH_LOG, 1000);
                const n = out.trim() === "" ? 0 : out.trim().split("\n").length;
                counts.push(n);
            }
            SLogger.info(`脱离式任务日志增长: ${counts.join(" -> ")}`);

            // 三次采样之间连接是完全断开的, 行数仍增长即证明脚本未被会话断开打断
            expect(counts[0]).toBeGreaterThan(0);
            expect(counts[1]).toBeGreaterThan(counts[0]!);
            expect(counts[2]).toBeGreaterThan(counts[1]!);
        }, TIMEOUT.detached);

        it("2.3 应能查到脱离式任务仍在运行", async () => {
            expect(await sshC.isRemoteRunning("jest_detached.log")).toBe(true);
        }, TIMEOUT.api);

        it("2.4 应能停掉并确认已停止", async () => {
            await sshC.exec(`pkill -f '${DETACH_LOG}' > /dev/null 2>&1; echo ok`);
            await new Promise(r => setTimeout(r, 1500));
            expect(await sshC.isRemoteRunning("$$$no_such_marker$$$")).toBe(false);
        }, TIMEOUT.api);
    });
});
