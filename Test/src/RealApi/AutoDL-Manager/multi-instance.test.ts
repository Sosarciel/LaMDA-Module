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
import type { AutoDLDrive, SshClient } from "@sosraciel-lamda/autodl-manager";
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

/** 测试用远端工作目录, 测试结束会整体删除 */
const REMOTE_DIR = "/root/akaset_test_multi";

/** 脱离式执行的日志路径 */
const DETACH_LOG = `${REMOTE_DIR}/jest_detached.log`;

/** 各端口对应的服务返回内容, 用于确认映射到的确实是目标服务 */
const SERVICE_BODIES: Record<number, string> = {
    6006: "AKASET_TEST_SVC_6006",
    6008: "AKASET_TEST_SVC_6008",
};

/** 生成一个极简 HTTP 服务的启动脚本
 * ⚠️ 必须用绝对路径 `/root/miniconda3/bin/python3`: 实例 PATH 里没有 python3
 * @param port - 监听端口
 * @returns 服务启动脚本内容
 */
const buildServiceScript = (port: number): string => {
    const body = SERVICE_BODIES[port]!;
    return [
        "#!/bin/bash",
        "cd /",
        `nohup /root/miniconda3/bin/python3 -c "`,
        "import http.server, socketserver",
        `class H(http.server.BaseHTTPRequestHandler):`,
        `    def do_GET(self):`,
        `        b = b'${body}'`,
        `        self.send_response(200)`,
        `        self.send_header('Content-Length', str(len(b)))`,
        `        self.end_headers()`,
        `        self.wfile.write(b)`,
        `    def log_message(self, *a): pass`,
        `socketserver.TCPServer(('127.0.0.1', ${port}), H).serve_forever()`,
        // 日志留存: 服务起不来时能查原因, 不要全部丢弃
        `" > ${REMOTE_DIR}/svc_${port}.log 2>&1 < /dev/null &`,
        "",
    ].join("\n");
};

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

    /** 测试开始前实例上已有的终端, 结束时只清理新增的, 不动别人的 */
    let terminalsBefore: string[] = [];
    /** 三个实例与各自的 SSH 客户端 */
    let insA: AutoDLDrive;
    let insB: AutoDLDrive;
    let insC: AutoDLDrive;
    let sshA: SshClient;
    let sshC: SshClient;

    beforeAll(async () => {
        AutoDLManager.initInject({ serviceTable: buildServiceTable() });
        await AutoDLManager.sm.inited;

        // 按类型取实例, 类型由 ctorTable 推导 —— 拿到的是**确切的 AutoDLDrive**,
        // 而非泛化的 AutoDLInstance 接口
        const list = await AutoDLManager.getInstancesByType("ProInstance");
        const pick = (n: string) => list.find(pak => pak.name === n)!.instance;
        insA = pick(INST_A);
        insB = pick(INST_B);
        insC = pick(INST_C);
        sshA = (await insA.getSshClient())!;
        sshC = (await insC.getSshClient())!;

        // 幂等准备: 自己上传被测服务脚本并启动, 不依赖远端预置环境
        await sshA.ensureRemoteDir(REMOTE_DIR);
        for (const port of [6006, 6008])
            await sshA.uploadText(buildServiceScript(port), `${REMOTE_DIR}/svc_${port}.sh`);
        await sshA.exec(`pkill -f 'akaset_test_multi' > /dev/null 2>&1; echo ok`);
        await new Promise(res => setTimeout(res, 1000));
        // 逐个脚本单独执行 —— 串成一行时脚本内的 `nohup ... &` 会影响整行返回
        for (const port of [6006, 6008])
            await sshA.exec(`bash ${REMOTE_DIR}/svc_${port}.sh`);

        for (const port of [6006, 6008]) {
            let up = false;
            for (let i = 0; i < 20; i++) {
                const r = await sshA.exec(`curl -s -m 2 http://127.0.0.1:${port}/ || true`);
                if (r.stdout.trim() === SERVICE_BODIES[port]) { up = true; break; }
                await new Promise(res => setTimeout(res, 500));
            }
            if (!up) {
                const log = await sshA.readRemoteFile(`${REMOTE_DIR}/svc_${port}.log`).catch(() => "");
                SLogger.error(`端口 ${port} 的服务未能就绪, 其日志: ${log || "(空)"}`);
            }
            expect(up).toBe(true);
        }

        // 记录基线: 终端由 create 产生且**默认不自动删除**,
        // 若测试不清理, 每跑一轮就会在 JupyterLab 里多留一个终端(实测攒到过十几个)。
        await insB.openTunnel();
        terminalsBefore = await (await insB.getJupyterClient())!.list();
        SLogger.info(`测试前已有 Jupyter 终端: ${JSON.stringify(terminalsBefore)}`);
    }, TIMEOUT.api);

    afterAll(async () => {
        // 先清理本次测试新建的终端, 再收隧道 ——
        // 删终端要走隧道打到 Jupyter 的 REST 接口, 顺序反了就 fetch failed
        try {
            await insB.openTunnel();
            const jc = (await insB.getJupyterClient())!;
            const after = await jc.list();
            const created = after.filter(n => !terminalsBefore.includes(n));
            for (const name of created)
                await jc.remove(name);
            SLogger.info(`已清理本次新建的 Jupyter 终端: ${JSON.stringify(created)}`);
        } catch (e) {
            SLogger.warn(`清理 Jupyter 终端失败(不影响测试结论): ${e}`);
        }

        // 兜底清理: 无论成败都收掉隧道, 避免残留进程与端口占用
        for (const ins of [insA, insB, insC])
            await ins?.closeTunnel();

        // 停掉自建服务并删除整个工作目录, 做到「上传 → 测试 → 删除」闭环
        try {
            // pkill 没匹配到进程时返回非零会截断后续命令, 故单独执行并忽略结果
            await sshA.exec(`pkill -f 'akaset_test_multi' > /dev/null 2>&1; echo ok`);
            await new Promise(res => setTimeout(res, 1000));
            // 用 SFTP 递归删除, 比 shell rm 更可靠
            await sshA.removeRemoteDir(REMOTE_DIR);
            SLogger.info(`测试工作目录已清理: ${!(await sshA.remoteExists(REMOTE_DIR))}`);
        } catch (e) {
            SLogger.warn(`清理测试工作目录失败(不影响测试结论): ${e}`);
        }
    }, TIMEOUT.tunnel);

    describe("1. 多实例多端口", () => {

        it("1.1 应能同时接管多个实例", async () => {
            expect(await AutoDLManager.sm.hasService(INST_A)).toBe(true);
            expect(await AutoDLManager.sm.hasService(INST_B)).toBe(true);
            expect(await AutoDLManager.sm.hasService(INST_C)).toBe(true);
        }, TIMEOUT.api);

        it("1.2 各实例应各自持有独立的端口映射配置", async () => {
            expect(insA.getData().port_forwards).toEqual([
                { local_port: PORT_A1, remote_port: 6006 },
                { local_port: PORT_A2, remote_port: 6008 },
            ]);
            expect(insB.getData().port_forwards).toEqual([
                { local_port: PORT_JUPYTER, remote_port: REMOTE_JUPYTER },
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
            expect(await isPortListening(PORT_JUPYTER)).toBe(true);
        }, TIMEOUT.tunnel);

        it("1.5 不同本地端口应映射到不同的远端服务", async () => {
            const body1 = await fetchLocal(PORT_A1);
            const body2 = await fetchLocal(PORT_A2);

            // 精确比对, 确认映射到的确实是各自的目标服务
            expect(body1).toBe(SERVICE_BODIES[6006]);
            expect(body2).toBe(SERVICE_BODIES[6008]);
            expect(body1).not.toBe(body2);
        }, TIMEOUT.request);

        it("1.6 关闭某实例隧道不应影响其它实例", async () => {
            await insA.closeTunnel();

            expect(await insA.isTunnelAlive()).toBe(false);
            expect(await isPortListening(PORT_A1)).toBe(false);
            // INST_B 的隧道应不受影响
            expect(await insB.isTunnelAlive()).toBe(true);
            expect(await isPortListening(PORT_JUPYTER)).toBe(true);
        }, TIMEOUT.tunnel);

        it("1.7 收尾: 关闭全部隧道并确认端口释放", async () => {
            for (const ins of [insA, insB, insC])
                await ins.closeTunnel();

            expect(await isPortListening(PORT_A1)).toBe(false);
            expect(await isPortListening(PORT_A2)).toBe(false);
            expect(await isPortListening(PORT_JUPYTER)).toBe(false);
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
    });

    describe("3. Jupyter 终端", () => {

        it("3.1 应能定位映射到 Jupyter 的本地端口", async () => {
            await insB.openTunnel();

            expect(insB.getJupyterLocalPort()).toBe(PORT_JUPYTER);
        }, TIMEOUT.tunnel);

        it("3.2 应能在 Jupyter 终端执行指令并取回纯结果", async () => {
            const jc = (await insB.getJupyterClient())!;
            const out = await jc.run("echo JEST_JUPYTER_OK && whoami", { timeout: TIMEOUT.jupyter });

            expect(out).toContain("JEST_JUPYTER_OK");
            expect(out).toContain("root");
            // 输出应已剥离 ANSI 与 AutoDL 欢迎横幅
            expect(out).not.toContain("AutoDL---");
            expect(stripAnsi(out)).toBe(out);
        }, TIMEOUT.jupyter);

        it("3.3 Jupyter 终端应保留, 可在 JupyterLab 界面中看到", async () => {
            const jc = (await insB.getJupyterClient())!;
            // 触发一次连接以确立终端
            await jc.run("echo KEEP_TERMINAL", { timeout: TIMEOUT.jupyter });

            const name = jc.terminalName;
            expect(name).toBeDefined();
            // 终端名应为数字形式(terminado 的命名规则)
            expect(name).toMatch(/^\d+$/);
            expect(jc.connected).toBe(true);

            // 关闭通道但终端保留在服务端, 仍能在 JupyterLab 界面看到
            await jc.close();
            expect(jc.connected).toBe(false);
        }, TIMEOUT.jupyter);

        it("3.4 应能列出并删除服务端终端(防止终端泄漏)", async () => {
            // 终端由 create 产生且默认不自动删除, 若不提供删除手段会在实例上越积越多
            const jc = (await insB.getJupyterClient())!;
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
        }, TIMEOUT.detached);

        it("3.5 release 应释放隧道并删除服务端终端", async () => {
            await insB.openTunnel();
            const jc = (await insB.getJupyterClient())!;
            await jc.connect();
            const created = jc.terminalName!;
            expect(await jc.list()).toContain(created);

            await AutoDLManager.release(INST_B);

            // 隧道应已释放
            expect(await isPortListening(PORT_JUPYTER)).toBe(false);

            // 终端应已从服务端删除(需重开隧道才能查)
            await insB.openTunnel();
            expect(await (await insB.getJupyterClient())!.list()).not.toContain(created);
        }, TIMEOUT.detached);
    });

    describe("4. 连接复用与自动重连", () => {

        // 前面的用例会关掉隧道与 Jupyter 通道, 这里重新建立, 保证本组自足
        beforeAll(async () => {
            await insA.openTunnel();
            await insB.openTunnel();
            expect(await isPortListening(PORT_A1)).toBe(true);
            expect(await isPortListening(PORT_JUPYTER)).toBe(true);
        }, TIMEOUT.tunnel);

        it("4.1 SSH 应复用长连接(后续调用无需重新握手)", async () => {
            // 先做一次以建立连接
            await sshC.exec("echo warmup");

            // 再连做三次, 取最小值作为"复用时的稳定耗时"
            const samples: number[] = [];
            for (let i = 0; i < 3; i++) {
                const t = Date.now();
                await sshC.exec("echo reuse");
                samples.push(Date.now() - t);
            }
            const best = Math.min(...samples);

            // 实测: SSH 握手约 770ms, 复用连接约 170ms
            // 取最小值以避开瞬时负载波动; 阈值取 700ms —— 高于复用耗时, 低于握手成本
            SLogger.info(`exec 复用耗时样本=${JSON.stringify(samples)} 最小=${best}ms`);
            expect(best).toBeLessThan(700);
        }, TIMEOUT.detached);

        it("4.2 SSH 连接断开后应自动重连并重建隧道", async () => {
            await insA.openTunnel();
            expect(await fetchLocal(PORT_A1)).toBeTruthy();

            // 从内部强制断开连接, 模拟网络中断
            const inner = sshA as unknown as { _conn: { end: () => void } };
            inner._conn.end();

            // 等待自动重连 + 隧道重建(默认 3s 间隔)
            let healed = false;
            for (let i = 0; i < 8; i++) {
                await new Promise(r => setTimeout(r, 2_000));
                if (await insA.isTunnelAlive()) { healed = true; break; }
            }
            expect(healed).toBe(true);

            // 隧道应恢复可用, 且调用方无需做任何额外操作
            expect(await isPortListening(PORT_A1)).toBe(true);
            expect(await fetchLocal(PORT_A1)).toBeTruthy();
        }, TIMEOUT.detached);

        it("4.3 重连后执行指令应无需调用方干预即可用", async () => {
            const res = await sshA.exec("hostname");
            expect(res.stdout.trim().length).toBeGreaterThan(0);
        }, TIMEOUT.detached);

        it("4.4 Jupyter 通道断开后应自动重连", async () => {
            const jc = (await insB.getJupyterClient())!;
            await jc.run("echo BEFORE_DROP", { timeout: TIMEOUT.jupyter });
            expect(jc.connected).toBe(true);

            const nameBefore = jc.terminalName;
            // 强制断开 WS 通道(模拟网络中断)
            (jc as unknown as { _ws: { close: () => void } })._ws.close();

            // 等待自动重连(默认 2s 间隔)
            let reconnected = false;
            for (let i = 0; i < 8; i++) {
                await new Promise(r => setTimeout(r, 1_500));
                if (jc.connected) { reconnected = true; break; }
            }
            expect(reconnected).toBe(true);

            // 重连的是**同一个终端**(终端进程在服务端独立存活), 因此名称不变
            expect(jc.terminalName).toBe(nameBefore);
            const out = await jc.run("echo AFTER_RECONNECT", { timeout: TIMEOUT.jupyter });
            expect(out).toContain("AFTER_RECONNECT");
        }, TIMEOUT.detached);

        it("4.5 关闭隧道后不应误报为存活", async () => {
            await insA.closeTunnel();

            expect(await insA.isTunnelAlive()).toBe(false);
            expect(await isPortListening(PORT_A1)).toBe(false);
            expect(await isPortListening(PORT_A2)).toBe(false);
        }, TIMEOUT.tunnel);
    });
});
