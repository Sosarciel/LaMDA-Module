/** AutoDL-Manager 多实例 / 脱离执行 / Jupyter 终端测试
 *
 * 覆盖三类能力:
 * 1. **多实例多端口**: instance_table 中配置多个实例, 每个实例各自多个端口映射,
 *    隧道相互独立, 本地端口可任意编号
 * 2. **脱离式执行**: 下发脚本后 SSH 断开也不中断(用日志持续增长证明存活)
 * 3. **Jupyter 终端**: 经隧道连 JupyterLab 的终端 WebSocket, 指令与其输出在
 *    JupyterLab 界面中可见, 且能取回纯结果
 *
 * 不在覆盖范围:
 * - **开关机**: 官方「暂不支持API以无卡模式开机」, 调用 power_on 即是有卡开机并产生费用
 *
 * ⚠️ 前置条件: 实例须**运行中**, 且实例内:
 * - 6006 / 6008 端口上有 HTTP 服务
 * - JupyterLab(8888) 可用
 *
 * 运行方式:
 * ```
 * cross-env WITH_API=true npm run test -- --selectProjects real-api src/RealApi/AutoDL-Manager/multi-instance.test.ts --runInBand --forceExit
 * ```
 */

import { AutoDLManager, isPortListening, stripAnsi } from "@sosraciel-lamda/autodl-manager";
import { SLogger } from "@zwa73/utils";

import { getAutoDLCred } from "@/src/Constant";

/** 各实例名 */
const INST_A = "TestMultiA";
const INST_B = "TestMultiB";
const INST_C = "TestMultiC";

/** 本地端口分配(刻意与远端不同, 验证映射可重新编号) */
const PORT_A1 = 16006;
const PORT_A2 = 16008;
const PORT_JUPYTER = 18888;

/** 远端 Jupyter 端口 */
const REMOTE_JUPYTER = 8888;

/** 超时上限/毫秒 (依据实测: 建隧道约 1s, 指令约 1.5s, Jupyter 终端约 2s) */
const TIMEOUT = {
    api: 20_000,
    tunnel: 30_000,
    request: 10_000,
    jupyter: 40_000,
    detached: 60_000,
};

/** 脱离式执行的日志路径 */
const DETACH_LOG = "/root/dtest/jest_detached.log";

/** 构建多实例服务配置表 */
const buildServiceTable = () => {
    const cred = getAutoDLCred();
    const base = {
        token: cred.token,
        instance_uuid: cred.instance_uuid,
        region_name: cred.region_name,
    };
    return {
        instance_table: {
            // A: 两个端口映射
            [INST_A]: {
                type: "ProInstance" as const,
                name: INST_A,
                data: {
                    ...base,
                    jupyter_port: REMOTE_JUPYTER,
                    port_forwards: [
                        { local_port: PORT_A1, remote_port: 6006 },
                        { local_port: PORT_A2, remote_port: 6008 },
                    ],
                },
            },
            // B: 映射 Jupyter 端口
            [INST_B]: {
                type: "ProInstance" as const,
                name: INST_B,
                data: {
                    ...base,
                    jupyter_port: REMOTE_JUPYTER,
                    port_forwards: [
                        { local_port: PORT_JUPYTER, remote_port: REMOTE_JUPYTER },
                    ],
                },
            },
            // C: 不配任何端口映射, 用于验证不会平白建空隧道
            [INST_C]: {
                type: "ProInstance" as const,
                name: INST_C,
                data: { ...base, port_forwards: [] },
            },
        },
    };
};

/** 通过本地端口取 HTTP 内容
 * @param port - 本地端口
 * @returns 响应文本
 */
const fetchLocal = async (port: number): Promise<string> => {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(TIMEOUT.request),
    });
    return (await res.text()).trim();
};

describe("AutoDL-Manager 多实例 / 脱离执行 / Jupyter 终端测试", () => {

    beforeAll(async () => {
        AutoDLManager.initInject({ serviceTable: buildServiceTable() });
        await AutoDLManager.sm.inited;
    }, TIMEOUT.api);

    afterAll(async () => {
        // 兜底清理: 无论成败都收掉隧道, 避免残留进程与端口占用
        for (const n of [INST_A, INST_B, INST_C])
            await AutoDLManager.closeTunnel(n);
    }, TIMEOUT.tunnel);

    describe("1. 多实例多端口", () => {

        it("1.1 应能同时接管多个实例", async () => {
            expect(await AutoDLManager.sm.hasService(INST_A)).toBe(true);
            expect(await AutoDLManager.sm.hasService(INST_B)).toBe(true);
            expect(await AutoDLManager.sm.hasService(INST_C)).toBe(true);
        }, TIMEOUT.api);

        it("1.2 各实例应各自持有独立的端口映射配置", async () => {
            expect(await AutoDLManager.getPortForwards(INST_A)).toEqual([
                { local_port: PORT_A1, remote_port: 6006 },
                { local_port: PORT_A2, remote_port: 6008 },
            ]);
            expect(await AutoDLManager.getPortForwards(INST_B)).toEqual([
                { local_port: PORT_JUPYTER, remote_port: REMOTE_JUPYTER },
            ]);
            expect(await AutoDLManager.getPortForwards(INST_C)).toEqual([]);
        }, TIMEOUT.api);

        it("1.3 应能为各实例分别建立隧道", async () => {
            expect(await AutoDLManager.openTunnel(INST_A)).toBe(true);
            expect(await AutoDLManager.openTunnel(INST_B)).toBe(true);
            // 无端口映射的实例无需建隧道, 直接视为成功
            expect(await AutoDLManager.openTunnel(INST_C)).toBe(true);
        }, TIMEOUT.tunnel);

        it("1.4 各实例的本地端口应各自监听", async () => {
            expect(await isPortListening(PORT_A1)).toBe(true);
            expect(await isPortListening(PORT_A2)).toBe(true);
            expect(await isPortListening(PORT_JUPYTER)).toBe(true);
        }, TIMEOUT.tunnel);

        it("1.5 不同本地端口应映射到不同的远端服务", async () => {
            const body1 = await fetchLocal(PORT_A1);
            const body2 = await fetchLocal(PORT_A2);

            expect(body2).toBe("SECOND_SERVICE_6008");
            expect(body1.length).toBeGreaterThan(0);
            expect(body1).not.toBe(body2);
        }, TIMEOUT.request);

        it("1.6 关闭某实例隧道不应影响其它实例", async () => {
            await AutoDLManager.closeTunnel(INST_A);

            expect(await AutoDLManager.isTunnelAlive(INST_A)).toBe(false);
            expect(await isPortListening(PORT_A1)).toBe(false);
            // INST_B 的隧道应不受影响
            expect(await AutoDLManager.isTunnelAlive(INST_B)).toBe(true);
            expect(await isPortListening(PORT_JUPYTER)).toBe(true);
        }, TIMEOUT.tunnel);

        it("1.7 收尾: 关闭全部隧道并确认端口释放", async () => {
            for (const n of [INST_A, INST_B, INST_C])
                await AutoDLManager.closeTunnel(n);

            expect(await isPortListening(PORT_A1)).toBe(false);
            expect(await isPortListening(PORT_A2)).toBe(false);
            expect(await isPortListening(PORT_JUPYTER)).toBe(false);
        }, TIMEOUT.tunnel);
    });

    describe("2. 脱离式执行", () => {

        it("2.1 应能在远端投递脱离式任务并立即返回", async () => {
            // 先清掉上次的日志
            await AutoDLManager.execRemote(INST_C, `rm -f ${DETACH_LOG}`);

            const started = Date.now();
            const res = await AutoDLManager.execDetached(
                INST_C,
                `bash -c 'for i in $(seq 1 60); do echo tick $i >> ${DETACH_LOG}; sleep 1; done'`,
                { log: `${DETACH_LOG}.outer`, name: "jest-detached" },
            );
            const elapsed = Date.now() - started;

            expect(res).toBeDefined();
            expect(res!.ok).toBe(true);
            expect(res!.pid).not.toBe("");
            // 关键: 必须立即返回, 不能等脚本跑完(挂起即说明没脱离成功)
            expect(elapsed).toBeLessThan(15_000);
        }, TIMEOUT.detached);

        it("2.2 SSH 断开后脚本应持续运行(日志行数持续增长)", async () => {
            const counts: number[] = [];
            for (let i = 0; i < 3; i++) {
                await new Promise(r => setTimeout(r, 4_000));
                const out = await AutoDLManager.readRemoteLog(INST_C, DETACH_LOG, 1000);
                const n = out == undefined || out.trim() === "" ? 0 : out.trim().split("\n").length;
                counts.push(n);
            }
            SLogger.info(`脱离式任务日志增长: ${counts.join(" -> ")}`);

            // 三次采样之间 plink 完全断开, 行数仍增长即证明脚本未被会话断开打断
            expect(counts[0]).toBeGreaterThan(0);
            expect(counts[1]).toBeGreaterThan(counts[0]!);
            expect(counts[2]).toBeGreaterThan(counts[1]!);
        }, TIMEOUT.detached);

        it("2.3 应能查到脱离式任务仍在运行", async () => {
            expect(await AutoDLManager.isRemoteRunning(INST_C, "jest_detached.log")).toBe(true);
        }, TIMEOUT.api);
    });

    describe("3. Jupyter 终端", () => {

        it("3.1 应能定位映射到 Jupyter 的本地端口", async () => {
            await AutoDLManager.openTunnel(INST_B);

            expect(await AutoDLManager.getJupyterLocalPort(INST_B)).toBe(PORT_JUPYTER);
        }, TIMEOUT.tunnel);

        it("3.2 应能在 Jupyter 终端执行指令并取回纯结果", async () => {
            const out = await AutoDLManager.runInJupyterTerminal(
                INST_B,
                "echo JEST_JUPYTER_OK && whoami",
                { timeout: TIMEOUT.jupyter },
            );

            expect(typeof out).toBe("string");
            expect(out).toContain("JEST_JUPYTER_OK");
            expect(out).toContain("root");
            // 输出应已剥离 ANSI 与 AutoDL 欢迎横幅
            expect(out).not.toContain("AutoDL---");
            expect(stripAnsi(out!)).toBe(out);
        }, TIMEOUT.jupyter);

        it("3.3 Jupyter 终端应保留, 可在 JupyterLab 界面中看到", async () => {
            const jc = await AutoDLManager.getJupyterClient(INST_B);
            expect(jc).toBeDefined();
            // 触发一次连接以确立终端
            await jc!.run("echo KEEP_TERMINAL", { timeout: TIMEOUT.jupyter });

            const name = jc!.terminalName;
            expect(name).toBeDefined();
            // 终端名应为数字形式(terminado 的命名规则)
            expect(name).toMatch(/^\d+$/);
            expect(jc!.connected).toBe(true);

            // 关闭通道但终端保留在服务端, 仍能在 JupyterLab 界面看到
            await jc!.close();
            expect(jc!.connected).toBe(false);
        }, TIMEOUT.jupyter);
    });

    describe("4. 连接复用与自动重连", () => {

        // 前面的用例会关掉隧道与 Jupyter 通道, 这里重新建立, 保证本组自足
        beforeAll(async () => {
            await AutoDLManager.openTunnel(INST_A);
            await AutoDLManager.openTunnel(INST_B);
            expect(await isPortListening(PORT_A1)).toBe(true);
            expect(await isPortListening(PORT_JUPYTER)).toBe(true);
        }, TIMEOUT.tunnel);

        it("4.1 SSH 应复用长连接(后续调用快于首次握手)", async () => {
            // 首次会建立 SSH 连接(含握手), 后续调用复用该连接
            const t1 = Date.now();
            await AutoDLManager.execRemote(INST_C, "echo warmup");
            const first = Date.now() - t1;

            const t2 = Date.now();
            await AutoDLManager.execRemote(INST_C, "echo reuse");
            const second = Date.now() - t2;

            // 实测: 首次约 2800ms(含 SSH 握手), 复用约 700ms
            // 注意复用时仍有一次 AutoDL snapshot 的 HTTP 往返, 故不会降到纯 SSH 的 ~170ms
            SLogger.info(`execRemote 首次=${first}ms 复用=${second}ms`);
            expect(second).toBeLessThan(first);
        }, TIMEOUT.detached);

        it("4.2 SSH 连接断开后应自动重连并重建隧道", async () => {
            await AutoDLManager.openTunnel(INST_A);
            expect(await fetchLocal(PORT_A1)).toBeTruthy();

            // 从内部强制断开连接, 模拟网络中断
            const drv = await AutoDLManager.sm.getService(INST_A);
            const drive = drv!.instance as unknown as { _ssh: { _conn: { end: () => void } } };
            drive._ssh._conn.end();

            // 等待自动重连 + 隧道重建(默认 3s 间隔)
            let healed = false;
            for (let i = 0; i < 8; i++) {
                await new Promise(r => setTimeout(r, 2_000));
                if (await AutoDLManager.isTunnelAlive(INST_A)) { healed = true; break; }
            }
            expect(healed).toBe(true);

            // 隧道应恢复可用, 且调用方无需做任何额外操作
            expect(await isPortListening(PORT_A1)).toBe(true);
            expect(await fetchLocal(PORT_A1)).toBeTruthy();
        }, TIMEOUT.detached);

        it("4.3 重连后 execRemote 应无需调用方干预即可用", async () => {
            const res = await AutoDLManager.execRemote(INST_A, "hostname");
            expect(res).toBeDefined();
            expect(res!.stdout.trim().length).toBeGreaterThan(0);
        }, TIMEOUT.detached);

        it("4.4 Jupyter 通道断开后应自动重连", async () => {
            const jc = await AutoDLManager.getJupyterClient(INST_B);
            expect(jc).toBeDefined();
            await jc!.run("echo BEFORE_DROP", { timeout: TIMEOUT.jupyter });
            expect(jc!.connected).toBe(true);

            const nameBefore = jc!.terminalName;
            // 强制断开 WS 通道(模拟网络中断)
            (jc as unknown as { _ws: { close: () => void } })._ws.close();

            // 等待自动重连(默认 2s 间隔)
            let reconnected = false;
            for (let i = 0; i < 8; i++) {
                await new Promise(r => setTimeout(r, 1_500));
                if (jc!.connected) { reconnected = true; break; }
            }
            expect(reconnected).toBe(true);

            // 重连的是**同一个终端**(终端进程在服务端独立存活), 因此名称不变
            expect(jc!.terminalName).toBe(nameBefore);
            const out = await jc!.run("echo AFTER_RECONNECT", { timeout: TIMEOUT.jupyter });
            expect(out).toContain("AFTER_RECONNECT");
        }, TIMEOUT.detached);

        it("4.5 关闭隧道后不应误报为存活", async () => {
            await AutoDLManager.closeTunnel(INST_A);

            expect(await AutoDLManager.isTunnelAlive(INST_A)).toBe(false);
            expect(await isPortListening(PORT_A1)).toBe(false);
            expect(await isPortListening(PORT_A2)).toBe(false);
        }, TIMEOUT.tunnel);
    });
});
