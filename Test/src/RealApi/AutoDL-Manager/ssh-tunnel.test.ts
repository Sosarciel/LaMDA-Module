/** AutoDL-Manager SSH 端口映射链路测试
 * 验证「实例内远端端口 → 本地端口」的映射链路, 这是模块的核心职责。
 *
 * 覆盖:
 * - 实例接管与状态查询
 * - SSH 远端指令执行
 * - **单端口映射**(远端 6006 → 本地 6006)
 * - **多端口映射**(远端 6006/6008 → 本地 16006/16008), 验证本地端口可与远端不同
 * - 隧道重建
 * - 隧道回收后本地端口释放
 *
 * 不在本测试覆盖范围:
 * - **开关机**: 官方「暂不支持API以无卡模式开机」, 调用 power_on 即是有卡开机并产生 GPU 费用,
 *   故开关机代码只写不测
 *
 * ## 幂等性
 *
 * 测试**不依赖远端预置环境**: 自己上传被测服务脚本 → 测试 → 删除, 全程自足。
 * 唯一的假设是「实例处于运行中且 SSH 可达」。
 *
 * 凭据从 `data/Cred.json` 读取, 缺失时在模块加载阶段抛错使整个测试集失败。
 *
 * 运行方式:
 * ```
 * cross-env WITH_API=true npm run test -- --selectProjects real-api src/RealApi/AutoDL-Manager/ssh-tunnel.test.ts --runInBand --forceExit
 * ```
 */

import { AutoDLManager, isPortListening } from "@sosraciel-lamda/autodl-manager";
import type { AutoDLDrive, SshClient } from "@sosraciel-lamda/autodl-manager";
import { SLogger } from "@zwa73/utils";

import { getAutoDLCred } from "@/src/Constant";

/** 测试用实例名 */
const INSTANCE = "TestAutoDLPro";

/** 超时上限/毫秒 (依据实测耗时设定)
 * 实测: 状态查询 <1s / 远端指令 ~1.5s / 隧道建立 ~1s / 本地访问 ~0.15s
 */
const TIMEOUT = {
    api: 20_000,
    exec: 30_000,
    tunnel: 30_000,
    request: 10_000,
};

/** 待映射的远端服务端口
 * 由测试**自己上传**服务脚本监听这些端口, 不依赖远端预置
 */
const REMOTE_PORTS = [6006, 6008];

/** 本地映射端口, 刻意与远端不同以验证映射是可重新编号的 */
const LOCAL_PORTS = [16006, 16008];

/** 测试用远端工作目录, 测试结束会整体删除 */
const REMOTE_DIR = "/root/akaset_test_tunnel";

/** 各端口对应的服务返回内容, 用于确认映射到的确实是目标服务 */
const SERVICE_BODIES: Record<number, string> = {
    6006: "AKASET_TEST_SVC_6006",
    6008: "AKASET_TEST_SVC_6008",
};

/** 生成一个极简 HTTP 服务的启动脚本
 *
 * 用 python 起服务(实例内 miniconda 自带)。
 * ⚠️ 必须用**绝对路径** `/root/miniconda3/bin/python3`: 实例的 PATH 里没有 python3,
 * 直接写 python3 会 `No such file or directory` 且被 nohup 吞掉、静默失败。
 *
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

/** 构建服务配置表 */
const buildServiceTable = () => {
    const cred = getAutoDLCred();
    return {
        idle_timeout: 300,
        instance_table: {
            [INSTANCE]: {
                type: "ProInstance" as const,
                name: INSTANCE,
                idle_timeout: 300,
                data: {
                    token: cred.token,
                    instance_uuid: cred.instance_uuid,
                    region_name: cred.region_name,
                    port_forwards: REMOTE_PORTS.map((remotePort, i) => ({
                        local_port: LOCAL_PORTS[i]!,
                        remote_port: remotePort,
                    })),
                },
            },
        },
    };
};

/** 通过本地端口访问映射过来的服务
 * @param port - 本地端口
 * @returns 响应文本
 */
const fetchLocal = async (port: number): Promise<string> => {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(TIMEOUT.request),
    });
    return (await res.text()).trim();
};

describe("AutoDL-Manager SSH 端口映射链路测试", () => {

    let status: string | undefined;
    /** 实例(拿到后可访问自身能力与两个客户端) */
    let ins: AutoDLDrive;
    /** SSH 客户端(指令 / 文件传输 / 隧道) */
    let ssh: SshClient;

    beforeAll(async () => {
        AutoDLManager.initInject({ serviceTable: buildServiceTable() });
        await AutoDLManager.sm.inited;

        // 按类型取实例, 类型由 ctorTable 推导 —— 拿到的是**确切的 AutoDLDrive**,
        // 而非泛化的 AutoDLInstance 接口
        const list = await AutoDLManager.getInstancesByType("ProInstance");
        ins = list.find(pak => pak.name === INSTANCE)!.instance;
        expect(ins).toBeDefined();
        ssh = (await ins.getSshClient())!;
        expect(ssh).toBeDefined();

        status = await ins.getStatus();
        SLogger.info(`AutoDL 测试实例状态: ${status}`);

        // 幂等准备: 自己上传被测服务脚本并启动, 不依赖远端预置环境
        await ssh.ensureRemoteDir(REMOTE_DIR);
        for (const port of REMOTE_PORTS)
            await ssh.uploadText(buildServiceScript(port), `${REMOTE_DIR}/svc_${port}.sh`);

        // 起服务。逐个脚本单独执行 ——
        // 把多条 `bash x.sh` 用 `;` 串成一行时, 脚本内的 `nohup ... &`
        // 会影响整行的返回时机, 实测会导致后一条根本没执行。
        await ssh.exec(`pkill -f 'akaset_test_tunnel' > /dev/null 2>&1; echo ok`);
        await new Promise(res => setTimeout(res, 1000));
        for (const port of REMOTE_PORTS)
            await ssh.exec(`bash ${REMOTE_DIR}/svc_${port}.sh`);

        // 等服务真正起来(而不是盲等固定时长); 失败时把服务日志带出来便于排查
        for (const port of REMOTE_PORTS) {
            let up = false;
            for (let i = 0; i < 20; i++) {
                const r = await ssh.exec(`curl -s -m 2 http://127.0.0.1:${port}/ || true`);
                if (r.stdout.trim() === SERVICE_BODIES[port]) { up = true; break; }
                await new Promise(res => setTimeout(res, 500));
            }
            if (!up) {
                const log = await ssh.readRemoteFile(`${REMOTE_DIR}/svc_${port}.log`).catch(() => "");
                SLogger.error(`端口 ${port} 的服务未能就绪, 其日志: ${log || "(空)"}`);
            }
            expect(up).toBe(true);
        }
        SLogger.info(`测试服务已就绪: ${REMOTE_PORTS.join(", ")}`);
    }, TIMEOUT.exec);

    afterAll(async () => {
        // 兜底清理: 无论测试是否失败都收掉隧道, 避免残留进程与端口占用
        await ins?.closeTunnel();

        // 停掉自建服务并删除整个工作目录, 做到「上传 → 测试 → 删除」闭环
        try {
            // pkill 在没匹配到进程时返回非零, 会截断后续命令, 故单独执行并忽略其结果
            await ssh.exec(`pkill -f 'akaset_test_tunnel' > /dev/null 2>&1; echo ok`);
            await new Promise(res => setTimeout(res, 1000));
            // 用 SFTP 递归删除, 比 shell rm 更可靠(不受前序命令返回值影响)
            await ssh.removeRemoteDir(REMOTE_DIR);
            SLogger.info(`测试工作目录已清理: ${!(await ssh.remoteExists(REMOTE_DIR))}`);
        } catch (e) {
            SLogger.warn(`清理测试工作目录失败(不影响测试结论): ${e}`);
        }
    }, TIMEOUT.tunnel);

    it("1. 应能接管 instance_table 中配置的现有实例并读到状态", async () => {
        expect(typeof status).toBe("string");
        expect(status).toBe("running");
    }, TIMEOUT.api);

    it("2. 应能读回实例的端口映射配置", async () => {
        const forwards = ins.getData().port_forwards;

        expect(forwards).toEqual([
            { local_port: 16006, remote_port: 6006 },
            { local_port: 16008, remote_port: 6008 },
        ]);
    }, TIMEOUT.api);

    it("3. 应能通过 SSH 在实例内执行指令", async () => {
        const res = await ssh.exec("hostname");

        expect(res.stdout.trim()).toContain("autodl-");
        expect(res.stderr).toBe("");
    }, TIMEOUT.exec);

    it("4. 建立隧道后本地端口应进入监听", async () => {
        const opened = await ins.openTunnel();
        expect(opened).toBe(true);

        expect(await ins.isTunnelAlive()).toBe(true);
        expect(await isPortListening(LOCAL_PORTS[0]!)).toBe(true);
        expect(await isPortListening(LOCAL_PORTS[1]!)).toBe(true);
    }, TIMEOUT.tunnel);

    it("5. 应能通过本地端口访问远端 6006 的服务", async () => {
        const body = await fetchLocal(LOCAL_PORTS[0]!);

        // 服务返回固定内容, 精确比对才能确认映射到的确实是目标服务
        expect(body).toBe(SERVICE_BODIES[6006]);
    }, TIMEOUT.request);

    it("6. 应能通过本地端口访问远端 6008 的服务(多端口映射)", async () => {
        const body = await fetchLocal(LOCAL_PORTS[1]!);

        expect(body).toBe(SERVICE_BODIES[6008]);
        // 两个端口内容不同, 证明映射没有串到同一个服务上
        expect(await fetchLocal(LOCAL_PORTS[0]!)).not.toBe(body);
    }, TIMEOUT.request);

    it("7. 关闭隧道后本地端口应被释放", async () => {
        await ins.closeTunnel();

        expect(await ins.isTunnelAlive()).toBe(false);
        expect(await isPortListening(LOCAL_PORTS[0]!)).toBe(false);
        expect(await isPortListening(LOCAL_PORTS[1]!)).toBe(false);
    }, TIMEOUT.tunnel);

    it("8. 应能重建隧道并再次访问", async () => {
        const opened = await ins.openTunnel();

        expect(opened).toBe(true);
        expect(await fetchLocal(LOCAL_PORTS[0]!)).toBe(SERVICE_BODIES[6006]);
    }, TIMEOUT.tunnel);
});
