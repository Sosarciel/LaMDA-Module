/** AutoDL-Manager SSH 链路测试
 *
 * 覆盖 SSH 侧的全部能力：
 * - 实例接管与状态查询
 * - **单端口映射**（远端 6006 → 本地 5520）
 * - **多端口映射**（远端 6006/6007 → 本地 5520/5521），验证本地端口可重新编号
 * - 隧道建立 / 释放 / 重建
 * - 远端指令执行与文件传输
 * - **连接复用**（长连接，不每次握手）
 * - **断线自动重连并重建隧道**
 *
 * 不在覆盖范围：
 * - **开关机**：会产生真实 GPU 费用，改由 `full-flow.test.ts` 专门覆盖
 * - Jupyter 终端 → `jupyter.test.ts`
 *
 * ## 关于「实例须已启动」
 *
 * 本文件测的是**已启动之后**的 SSH 链路细节，因此需要一个运行中的实例。
 * 但这**不是**在本文件里做「自动拉起」的验证 —— 那属于 `full-flow.test.ts`。
 * 若实例未启动，本文件在 `beforeAll` **抛错**让整集失败，
 * 而不是逐用例超时报错（那样噪声大且难以定位）。
 *
 * 幂等：自己上传被测服务、自己清理。
 *
 * 运行方式：
 * ```
 * cross-env WITH_API=true npm run test -- --selectProjects real-api src/RealApi/AutoDL-Manager/ssh-tunnel.test.ts --runInBand --forceExit
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

/** 缺少凭据时在模块加载阶段抛错, 让整个测试集直接失败(报告 0 个用例) */
const CRED = getAutoDLCred();

/** 本文件测的是「已启动之后」的链路细节, 故要求实例已运行。
 * 校验放在**模块顶层**而非 beforeAll —— 后者会让每个用例各报一次同样的错误。
 * 「自动拉起」本身由 full-flow.test.ts 专门验证。
 */
assertInstanceRunning("ssh-tunnel.test.ts");

/** 测试用实例名 */
const INSTANCE = "TestAutoDLPro";

/** 本地映射端口(登记于 Constant.ts), 刻意与远端不同以验证映射可重新编号 */
const LOCAL_PORT_A = AUTODL_LOCAL_PORT.sshA;
const LOCAL_PORT_B = AUTODL_LOCAL_PORT.sshB;

/** 远端服务端口与返回内容
 * 两个端口用两个**不同内容**的服务, 才能证明映射没有串到同一个上
 * (第二个端口避开 6007 —— 那是镜像自带 TensorBoard)
 */
const REMOTE_PORT_A = AUTODL_REMOTE_PORT;
const REMOTE_PORT_B = AUTODL_REMOTE_PORT_B;
const SERVICE_BODY_A = "AKASET_TEST_SVC_A";
const SERVICE_BODY_B = "AKASET_TEST_SVC_B";
const REMOTE_SVC = { [REMOTE_PORT_A]: SERVICE_BODY_A, [REMOTE_PORT_B]: SERVICE_BODY_B };

/** 测试用远端工作目录 */
const REMOTE_DIR = "/root/akaset_test_ssh";

/** 超时上限/毫秒 (依据实测: 状态查询 <1s / 远端指令 ~1.5s / 隧道建立 ~1s / 本地访问 ~0.15s) */
const TIMEOUT = {
    /** beforeAll 里的服务部署：上传 + 起服务 + 逐端口轮询就绪，
     *  每个端口最多等 20×500ms，故必须比单次 api 调用宽裕得多 */
    setup: 120_000,
    api: 30_000,
    exec: 30_000,
    tunnel: 30_000,
    request: 10_000,
    reconnect: 60_000,
};

describe("AutoDL-Manager SSH 链路", () => {

    let ins: AutoDLDrive;
    let ssh: SshClient;

    beforeAll(async () => {
        AutoDLManager.initInject({
            serviceTable: {
                instance_table: {
                    [INSTANCE]: {
                        type: "ProInstance",
                        name: INSTANCE,
                        data: {
                            ...credFields(),
                            port_forwards: [
                                { local_port: LOCAL_PORT_A, remote_port: REMOTE_PORT_A },
                                { local_port: LOCAL_PORT_B, remote_port: REMOTE_PORT_B },
                            ],
                        },
                    },
                },
            },
        });
        await AutoDLManager.sm.inited;

        // 按类型取实例, 类型由 ctorTable 推导 —— 拿到的是**确切的 AutoDLDrive**
        const list = await AutoDLManager.getInstancesByType("ProInstance");
        ins = list.find(pak => pak.name === INSTANCE)!.instance;

        SLogger.info(`AutoDL 测试实例已就绪: ${await ins.getStatus()}`);
        ssh = (await ins.getSshClient())!;
        await startTestServices(ins, REMOTE_DIR, REMOTE_SVC);
    }, TIMEOUT.setup);

    afterAll(async () => {
        await ins?.closeTunnel();
        await cleanupTestServices(ins, REMOTE_DIR);
    }, TIMEOUT.tunnel);

    it("1. 应能接管 instance_table 中配置的现有实例并读到状态", async () => {
        expect(await ins.getStatus()).toBe("running");
    }, TIMEOUT.api);

    it("2. 应能读回实例的端口映射配置", async () => {
        expect(ins.getData().port_forwards).toEqual([
            { local_port: LOCAL_PORT_A, remote_port: REMOTE_PORT_A },
            { local_port: LOCAL_PORT_B, remote_port: REMOTE_PORT_B },
        ]);
    }, TIMEOUT.api);

    it("3. 应能通过 SSH 在实例内执行指令", async () => {
        const res = await ssh.exec("hostname");
        expect(res.stdout.trim()).toContain("autodl-");
        expect(res.stderr).toBe("");
    }, TIMEOUT.exec);

    it("4. 建立隧道后本地端口应进入监听", async () => {
        expect(await ins.openTunnel()).toBe(true);
        expect(await ins.isTunnelAlive()).toBe(true);
        expect(await isPortListening(LOCAL_PORT_A)).toBe(true);
        expect(await isPortListening(LOCAL_PORT_B)).toBe(true);
    }, TIMEOUT.tunnel);

    it(`5. 应能通过本地端口访问远端 ${REMOTE_PORT_A} 的服务`, async () => {
        // 服务返回固定内容, 精确比对才能确认映射到的确实是目标服务
        expect(await fetchLocal(LOCAL_PORT_A)).toBe(REMOTE_SVC[REMOTE_PORT_A]);
    }, TIMEOUT.request);

    it(`6. 应能通过本地端口访问远端 ${REMOTE_PORT_B} 的服务(多端口映射)`, async () => {
        expect(await fetchLocal(LOCAL_PORT_B)).toBe(REMOTE_SVC[REMOTE_PORT_B]);
        // 两个端口内容不同, 证明映射没有串到同一个服务上
        expect(await fetchLocal(LOCAL_PORT_A)).not.toBe(REMOTE_SVC[REMOTE_PORT_B]);
    }, TIMEOUT.request);

    it("7. 关闭隧道后本地端口应被释放", async () => {
        await ins.closeTunnel();

        expect(await ins.isTunnelAlive()).toBe(false);
        expect(await isPortListening(LOCAL_PORT_A)).toBe(false);
        expect(await isPortListening(LOCAL_PORT_B)).toBe(false);
    }, TIMEOUT.tunnel);

    it("8. 应能重建隧道并再次访问", async () => {
        expect(await ins.openTunnel()).toBe(true);
        expect(await fetchLocal(LOCAL_PORT_A)).toBe(REMOTE_SVC[REMOTE_PORT_A]);
    }, TIMEOUT.tunnel);

    // #region 文件传输

    it("9. 应能上传文本并读回", async () => {
        const content = "#!/bin/bash\necho UPLOADED_OK\n";
        await ssh.uploadText(content, `${REMOTE_DIR}/up.sh`);

        expect(await ssh.remoteExists(`${REMOTE_DIR}/up.sh`)).toBe(true);
        expect(await ssh.readRemoteFile(`${REMOTE_DIR}/up.sh`)).toBe(content);
    }, TIMEOUT.exec);

    it("10. 上传的脚本应可执行并返回预期输出", async () => {
        const r = await ssh.exec(`bash ${REMOTE_DIR}/up.sh`);
        expect(r.stdout.trim()).toBe("UPLOADED_OK");
    }, TIMEOUT.exec);

    it("11. 删除远端文件与目录应幂等(重复调用不报错)", async () => {
        await ssh.removeRemoteFile(`${REMOTE_DIR}/up.sh`);
        expect(await ssh.remoteExists(`${REMOTE_DIR}/up.sh`)).toBe(false);
        // 重复删除不应抛错
        await expect(ssh.removeRemoteFile(`${REMOTE_DIR}/up.sh`)).resolves.toBeUndefined();
        await expect(ssh.removeRemoteDir(`${REMOTE_DIR}/no_such_dir`)).resolves.toBeUndefined();
    }, TIMEOUT.exec);

    // #endregion

    // #region 连接复用与自动重连

    it("12. 应复用长连接(后续调用无需重新握手)", async () => {
        // 先做一次以建立连接
        await ssh.exec("echo warmup");

        // 再连做三次, 取最小值作为"复用时的稳定耗时"
        const samples: number[] = [];
        for (let i = 0; i < 3; i++) {
            const t = Date.now();
            await ssh.exec("echo reuse");
            samples.push(Date.now() - t);
        }
        const best = Math.min(...samples);

        // 实测: SSH 握手约 770ms, 复用连接约 170ms
        // 取最小值以避开瞬时负载波动; 阈值取 700ms —— 高于复用耗时, 低于握手成本
        SLogger.info(`exec 复用耗时样本=${JSON.stringify(samples)} 最小=${best}ms`);
        expect(best).toBeLessThan(700);
    }, TIMEOUT.exec);

    it("13. 连接断开后应自动重连并重建隧道", async () => {
        await ins.openTunnel();
        expect(await fetchLocal(LOCAL_PORT_A)).toBe(REMOTE_SVC[REMOTE_PORT_A]);

        // 从内部强制断开连接, 模拟网络中断
        const inner = ssh as unknown as { _conn: { end: () => void } };
        inner._conn.end();

        // 等待自动重连 + 隧道重建(默认 3s 间隔)
        let healed = false;
        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 2_000));
            if (await ins.isTunnelAlive()) { healed = true; break; }
        }
        expect(healed).toBe(true);

        // 隧道应恢复可用, 且调用方无需做任何额外操作
        expect(await isPortListening(LOCAL_PORT_A)).toBe(true);
        expect(await fetchLocal(LOCAL_PORT_A)).toBe(REMOTE_SVC[REMOTE_PORT_A]);
    }, TIMEOUT.reconnect);

    it("14. 重连后执行指令应无需调用方干预即可用", async () => {
        const res = await ssh.exec("hostname");
        expect(res.stdout.trim()).toContain("autodl-");
    }, TIMEOUT.exec);

    it("15. 关闭隧道后不应误报为存活", async () => {
        await ins.closeTunnel();

        expect(await ins.isTunnelAlive()).toBe(false);
        expect(await isPortListening(LOCAL_PORT_A)).toBe(false);
        expect(await isPortListening(LOCAL_PORT_B)).toBe(false);
    }, TIMEOUT.tunnel);

    // #endregion
});
