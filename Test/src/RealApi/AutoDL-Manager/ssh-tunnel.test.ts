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
 * ⚠️ 前置条件: AutoDL 实例须处于**运行中**且实例内已起好待映射的服务。
 * 凭据从 `data/Cred.json` 读取, 缺失时在模块加载阶段抛错使整个测试集失败。
 *
 * 运行方式:
 * ```
 * cross-env WITH_API=true npm run test -- --selectProjects real-api src/RealApi/AutoDL-Manager/ssh-tunnel.test.ts --runInBand --forceExit
 * ```
 */

import { AutoDLManager, isPortListening } from "@sosraciel-lamda/autodl-manager";
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
 * 约定: 测试环境需在实例内这两个端口上提供 HTTP 服务
 */
const REMOTE_PORTS = [6006, 6008];

/** 本地映射端口, 刻意与远端不同以验证映射是可重新编号的 */
const LOCAL_PORTS = [16006, 16008];

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

    beforeAll(async () => {
        AutoDLManager.initInject({ serviceTable: buildServiceTable() });
        await AutoDLManager.sm.inited;
        status = await AutoDLManager.getStatus(INSTANCE);
        SLogger.info(`AutoDL 测试实例状态: ${status}`);
    }, TIMEOUT.api);

    afterAll(async () => {
        // 兜底清理: 无论测试是否失败都收掉隧道, 避免残留进程与端口占用
        await AutoDLManager.closeTunnel(INSTANCE);
    }, TIMEOUT.tunnel);

    it("1. 应能接管 instance_table 中配置的现有实例并读到状态", async () => {
        expect(typeof status).toBe("string");
        expect(status).toBe("running");
    }, TIMEOUT.api);

    it("2. 应能读回实例的端口映射配置", async () => {
        const forwards = await AutoDLManager.getPortForwards(INSTANCE);

        expect(forwards).toEqual([
            { local_port: 16006, remote_port: 6006 },
            { local_port: 16008, remote_port: 6008 },
        ]);
    }, TIMEOUT.api);

    it("3. 应能通过 SSH 在实例内执行指令", async () => {
        const res = await AutoDLManager.execRemote(INSTANCE, "hostname");

        expect(res).toBeDefined();
        expect(res!.stdout.trim()).toContain("autodl-");
        expect(res!.stderr).toBe("");
    }, TIMEOUT.exec);

    it("4. 建立隧道后本地端口应进入监听", async () => {
        const opened = await AutoDLManager.openTunnel(INSTANCE);
        expect(opened).toBe(true);

        expect(await AutoDLManager.isTunnelAlive(INSTANCE)).toBe(true);
        expect(await isPortListening(LOCAL_PORTS[0]!)).toBe(true);
        expect(await isPortListening(LOCAL_PORTS[1]!)).toBe(true);
    }, TIMEOUT.tunnel);

    it("5. 应能通过本地端口访问远端 6006 的服务", async () => {
        const body = await fetchLocal(LOCAL_PORTS[0]!);

        // 远端服务返回其目录下的 index.html 内容
        expect(body.length).toBeGreaterThan(0);
        expect(body).not.toContain("404");
    }, TIMEOUT.request);

    it("6. 应能通过本地端口访问远端 6008 的服务(多端口映射)", async () => {
        const body = await fetchLocal(LOCAL_PORTS[1]!);

        expect(body).toBe("SECOND_SERVICE_6008");
    }, TIMEOUT.request);

    it("7. 关闭隧道后本地端口应被释放", async () => {
        await AutoDLManager.closeTunnel(INSTANCE);

        expect(await AutoDLManager.isTunnelAlive(INSTANCE)).toBe(false);
        expect(await isPortListening(LOCAL_PORTS[0]!)).toBe(false);
        expect(await isPortListening(LOCAL_PORTS[1]!)).toBe(false);
    }, TIMEOUT.tunnel);

    it("8. 应能重建隧道并再次访问", async () => {
        const opened = await AutoDLManager.openTunnel(INSTANCE);

        expect(opened).toBe(true);
        const body = await fetchLocal(LOCAL_PORTS[0]!);
        expect(body.length).toBeGreaterThan(0);
    }, TIMEOUT.tunnel);
});
