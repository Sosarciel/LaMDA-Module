/** ComfyUI-Manager 可用性测试
 *
 * ## 本组的语义
 * 与 AutoDL-Manager 的常规测试一致：**预期实例已在无卡模式启动**，
 * 测试只验证「服务是否可用」，**不管理实例生命周期**（不强求开机/关机）。
 *
 * 实例未启动时在**模块顶层**抛错，让整个测试集直接失败 ——
 * 而不是每个用例各报一次同样的错误。
 *
 * ## 被测对象
 * `ComfyUIManager`（ServiceManager 封装），而非裸函数 ——
 * 调用方式与生产使用完全一致。
 *
 * ## 为什么大部分用例不需要 GPU
 * Middleware 网关自带**文件工具**（`/tool/probe` `/tool/save` `/tool/download`），
 * 这些能力完全在网关内实现，**与 ComfyUI 的推理无关**。
 * 因此「服务的探测/启动」「端口映射链路」「文件往返」都能在无卡模式下验证。
 *
 * ⚠️ **ComfyUI 本体在无卡模式下无法启动** ——
 * 它启动时第一件事就是查显存，无卡必然抛
 * `RuntimeError: Found no NVIDIA driver on your system`。
 * 故本组只断言 clash 与 middleware。
 *
 * ## 前置条件
 * 1. 实例处于运行中（无卡模式即可，指挥官手动开）
 * 2. clash 与 Middleware 的文件已部署到实例上（见 `Util.checkDeployed`）
 */

import { AutoDLManager, ComfyUIManager, SERVICE_ORDER } from "@sosraciel-lamda/autodl-manager";
import { SLogger } from "@zwa73/utils";

import { COMFY_LOCAL_PORT } from "@/src/Constant";

import {
    INSTANCE, assertInstanceRunning, autodlInstanceData, checkDeployed, instanceData,
    services, summarize,
} from "./Util";

/** AutoDL 侧实例名 */
const HOST_INSTANCE = "AutoDLHost";

/** 实例未运行时在模块加载阶段抛错, 让整个测试集直接失败 */
assertInstanceRunning("comfyui-hosting.test.ts");

/** 超时上限/毫秒（实测: 建隧道约 1s, clash 启动约 17s, 网关启动约 2s） */
const TIMEOUT = {
    setup: 120_000,
    api: 30_000,
    launch: 120_000,
};

describe("ComfyUI-Manager 可用性", () => {

    beforeAll(async () => {
        // ① AutoDL 侧：提供实例操作能力
        AutoDLManager.initInject({
            serviceTable: {
                instance_table: {
                    [HOST_INSTANCE]: {
                        type: "ProInstance",
                        name: HOST_INSTANCE,
                        data: autodlInstanceData(),
                    },
                },
            },
        });
        await AutoDLManager.sm.inited;

        // ② ComfyUI 侧：把 AutoDL 能力注入，并配置自己的实例
        ComfyUIManager.initInject({
            host: AutoDLManager,
            serviceTable: {
                instance_table: {
                    [INSTANCE]: {
                        type: "CloudComfyUI",
                        name: INSTANCE,
                        data: instanceData(),
                    },
                },
            },
        });
        await ComfyUIManager.sm.inited;
    }, TIMEOUT.setup);

    it("1. 应能通过 ServiceManager 取到实例且配置回写正确", async () => {
        const names = await ComfyUIManager.listInstances();
        expect(names).toContain(INSTANCE);

        const ins = await ComfyUIManager.getInstance(INSTANCE);
        expect(ins).toBeDefined();
        // getData 必须与构造参数一致 —— ServiceManager 依赖此契约
        expect(ins!.getData()).toEqual(instanceData());
    }, TIMEOUT.api);

    it("2. 实例的服务配置应由「实例 data + 默认值」正确解析", async () => {
        const ins = await ComfyUIManager.getInstance(INSTANCE);
        const svc = ins!.getServices();

        // 三个服务都应有配置
        for (const kind of SERVICE_ORDER) expect(svc[kind]).toBeDefined();
        // 默认值来自远端脚本目录（本地不硬编码任何启动细节）
        expect(svc.clash.start).toBe("/root/ComfyUI-Manager/start_clash.sh");
        expect(svc.middleware.start).toBe("/root/ComfyUI-Manager/start_middleware.sh");
        expect(svc.comfyui.start).toBe("/root/ComfyUI-Manager/start_comfyui.sh");
        // ComfyUI 有可选 probe（用于原生 API 探测，进程在≠能用）
        expect(svc.comfyui.probe).toBe("/root/ComfyUI-Manager/probe_comfyui.sh");
        // 前台模型下每个服务有独立终端
        expect(svc.clash.terminal).toBe("comfyui_manager_clash");
        expect(svc.middleware.terminal).toBe("comfyui_manager_middleware");
        expect(svc.comfyui.terminal).toBe("comfyui_manager_comfyui");
    }, TIMEOUT.api);

    it("3. 应能在实例上找到服务的部署文件", async () => {
        const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
        const ssh = await ins!.getSshClient();
        expect(ssh).toBeDefined();

        const missing = await checkDeployed(ssh!, ["clash", "middleware"]);
        if (missing.length > 0) {
            throw new Error(
                `以下服务未部署到实例上:\n  ${missing.join("\n  ")}\n`
                + `ComfyUI 这一套不是 AutoDL 镜像自带的, 需事先放置。`);
        }
    }, TIMEOUT.api);

    it("4. 探测应能给出自洽的服务状态(不误报)", async () => {
        const probe = await ComfyUIManager.probe(INSTANCE);
        expect(probe).toBeDefined();
        SLogger.info(`  服务状态: ${summarize(probe!)}`);

        for (const kind of ["clash", "middleware"] as const) {
            const r = probe![kind];
            expect(r).toBeDefined();
            // detail 必须与观测**自洽**：ready ⇒ 进程在；不 ready ⇒ 进程在时称"启动中"，
            // 进程不在则称"不存在"。三者互斥且覆盖全部情形。
            if (r.ready) {
                expect(r.alive).toBe(true);
                expect(r.detail).toBe("服务就绪");
            } else if (r.alive) {
                // 进程在但没就绪 —— ComfyUI 启动要数十秒时会落在这里
                expect(r.detail).toContain("尚未就绪");
            } else {
                expect(r.detail).toContain("进程不存在");
            }
            // clash / middleware 未配 probe 脚本 → 走特征匹配
            expect(r.probeUsed).toBe(false);
        }
    }, TIMEOUT.api);

    it("5. ensureReady 应让 clash 与 middleware 就绪并返回网关地址", async () => {
        // 本组是**无卡模式**的可用性测试, 故只要求 clash 与 middleware ——
        // ComfyUI 本体启动时第一件事就是查显存, 无卡必然抛
        // "Found no NVIDIA driver on your system", 不属于本组的覆盖范围。
        const endpoint = await ComfyUIManager.ensureReady(
            INSTANCE, { require: ["clash", "middleware"], timeoutSec: 120 });

        if (endpoint == undefined) {
            // 失败时给出各服务的实际状态, 便于定位
            const probe = await ComfyUIManager.probe(INSTANCE);
            throw new Error(
                `ensureReady 未返回端点。当前状态: `
                + `${probe == undefined ? "实例不可用" : summarize(probe)}`);
        }

        expect(endpoint).toBe(`http://127.0.0.1:${COMFY_LOCAL_PORT.middleware}`);
        SLogger.info(`  生图入口: ${endpoint}`);
    }, TIMEOUT.launch);

    it("6. 本地映射端口应能访问到网关(证明隧道链路通)", async () => {
        const res = await fetch(`http://127.0.0.1:${COMFY_LOCAL_PORT.middleware}/`,
            { signal: AbortSignal.timeout(10_000) });
        const body = await res.text();

        // Middleware 把请求转发给 ComfyUI(6005)。ComfyUI 未启动时返回 500,
        // 且错误里含 ECONNREFUSED 6005 —— 这恰恰证明网关是活的、转发生效了。
        if (res.status === 500) {
            expect(body).toContain("6005");
        } else {
            expect(res.status).toBeLessThan(500);
        }
    }, TIMEOUT.api);

    it("7. clash 就绪后代理应真的能出网", async () => {
        const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
        const ssh = await ins!.getSshClient();
        const r = await ssh!.exec(
            "curl -s -o /dev/null -w '%{http_code}' --max-time 15"
            + " -x http://127.0.0.1:7890 https://www.google.com");
        expect(r.stdout.trim()).toBe("200");
    }, TIMEOUT.api);

    it("8. 重复 ensureReady 应幂等(复用已就绪的服务)", async () => {
        // 只要求 clash + middleware —— 加入 comfyui 会让每次调用都等满超时
        // (无卡模式下它必然启动失败), 那是另一维度的问题, 不应混入幂等性验证。
        const opt = { require: ["clash", "middleware"] as const, timeoutSec: 120 };
        const first = await ComfyUIManager.ensureReady(INSTANCE, { ...opt, require: [...opt.require] });
        const second = await ComfyUIManager.ensureReady(INSTANCE, { ...opt, require: [...opt.require] });
        expect(second).toBe(first);
    }, 300_000);

    afterAll(async () => {
        // ## 必须清理 —— 这是「内容竞态」的根治
        // 本组测试是「预期实例已启动」的语义：自己不管理实例生命周期，
        // 但 **`ensureReady` 会留下正在运行的服务**（刻意的，服务在托管终端里
        // 长期存活以支持多客户端复用）。
        //
        // 若不清理，紧随其后的测试（尤其是 AutoDL-Manager 那组，它预期
        // 「远端是干净的」）就会在**本组留下的状态**上做判定 ——
        // 这不是端口抢占那种资源冲突，而是**判定依据被污染**。
        //
        // `teardown()` 是 `ensureReady()` 的对称收尾，且保证幂等：
        // 服务本就没起时不报错。
        try {
            const cleaned = await ComfyUIManager.teardown(INSTANCE);
            SLogger.info(`收尾清理: ${JSON.stringify(cleaned)}`);
        } catch (e) {
            SLogger.warn(`收尾清理失败: ${e}`);
        }

        // 收掉本地隧道
        try {
            const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
            await ins?.closeTunnel();
        } catch {
            // 收尾失败不应让测试结果变红 —— 用例本身已全部断言完毕
        }
    }, TIMEOUT.api);
});
