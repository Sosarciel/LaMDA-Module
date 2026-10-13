/** Tunnel 可用性测试
 *
 * ## 本组的语义
 * 与 AutoDL-Manager 的常规测试一致：**预期实例已在无卡模式启动**，
 * 测试只验证「服务是否可用」，**不管理实例生命周期**（不强求开机/关机）。
 *
 * 实例未启动时在**模块顶层**抛错，让整个测试集直接失败 ——
 * 而不是每个用例各报一次同样的错误。
 *
 * ## 被测对象
 * `TunnelManager`（ServiceManager 封装），而非裸函数 ——
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

import { AutoDLManager, TunnelManager } from "@sosraciel-lamda/autodl-manager";
import { SLogger } from "@zwa73/utils";

import { COMFY_LOCAL_PORT } from "@/src/Constant";

import {
    INSTANCE, assertInstanceRunning, autodlInstanceData, checkDeployed,
    instanceData, summarize,
} from "./Util";

/** AutoDL 侧实例名 */
const HOST_INSTANCE = "AutoDLHost";

/** 实例未运行时在模块加载阶段抛错, 让整个测试集直接失败 */
assertInstanceRunning("tunnel-hosting.test.ts");

/** 超时上限/毫秒（实测: 建隧道约 1s, clash 启动约 17s, 网关启动约 2s） */
const TIMEOUT = {
    setup: 120_000,
    api: 30_000,
    launch: 120_000,
};

describe("Tunnel 可用性", () => {

    beforeAll(async () => {
        // ① AutoDL 侧：提供实例操作能力
        // `allowPowerControl: false` —— 本组是「预期实例已启动」的语义,
        // 绝不应对真实实例开关机(关了就再也拉不起来, 开了则立刻产生 GPU 费用)。
        // 虽已是默认值, 仍**显式写出**以表明这是刻意的约束而非遗漏。
        AutoDLManager.initInject({
            allowPowerControl: false,
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

        // ② ComfyUI 侧：**初始化顺序由调用方(应用层)决定**
        // `TunnelManager` 直接依赖 AutoDLManager 全局单例, 无需传入 host ——
        // 它只是该单例的使用者, 不负责也不管理其注入。
        TunnelManager.initInject({
            serviceTable: {
                instance_table: {
                    [INSTANCE]: {
                        type: "TunnelInstance",
                        name: INSTANCE,
                        data: instanceData(),
                    },
                },
            },
        });
        await TunnelManager.sm.inited;
    }, TIMEOUT.setup);

    it("1. 应能通过 ServiceManager 取到实例且配置回写正确", async () => {
        const names = await TunnelManager.listInstances();
        expect(names).toContain(INSTANCE);

        const ins = await TunnelManager.getInstance(INSTANCE);
        expect(ins).toBeDefined();
        // getData 必须与构造参数一致 —— ServiceManager 依赖此契约
        expect(ins!.getData()).toEqual(instanceData());
    }, TIMEOUT.api);

    it("2. 实例的服务配置应由「实例 data + 用例预设」正确解析", async () => {
        const ins = await TunnelManager.getInstance(INSTANCE);
        const svc = ins!.getServices();

        // 三个服务都应有配置 —— 顺序取自**服务表的键序**，
        // 它同时就是启动顺序（指挥官：以 kind 顺序为准, 不做 dep 解析）
        expect(Object.keys(svc)).toEqual(["clash", "middleware", "comfyui"]);
        // 脚本路径由**实例 data 的 script_dir** 拼出（不是模块常量）
        expect(svc.clash.start).toBe("/root/ComfyUI-Manager/start_clash.sh");
        expect(svc.middleware.start).toBe("/root/ComfyUI-Manager/start_middleware.sh");
        expect(svc.comfyui.start).toBe("/root/ComfyUI-Manager/start_comfyui.sh");
        // ComfyUI 有可选 probe（用于原生 API 探测，进程在≠能用）
        expect(svc.comfyui.probe).toBe("/root/ComfyUI-Manager/probe_comfyui.sh");
        // clash / middleware 没有 probe（走特征匹配）
        expect(svc.clash.probe).toBeUndefined();
        expect(svc.middleware.probe).toBeUndefined();
    }, TIMEOUT.api);

    it("2b. 服务的 Unique 特征应由「prefix + 服务名」拼出", async () => {
        // 终端名与进程特征**共用同一个特征串** —— 指挥官指出它们在语义上
        // 就是同一件事（服务的 Unique 特征），不必区分。
        const ins = await TunnelManager.getInstance(INSTANCE);
        const prefix = ins!.getPrefix();

        expect(prefix).toBe("comfyui_manager_");
        for (const kind of Object.keys(ins!.getServices()))
            expect(`${prefix}${kind}`).toBe(`comfyui_manager_${kind}`);
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
        const probe = await TunnelManager.probe(INSTANCE);
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

    it("5. ensureReady 应让 clash 与 middleware 就绪", async () => {
        // 本组是**无卡模式**的可用性测试, 故只要求 clash 与 middleware ——
        // ComfyUI 本体启动时第一件事就是查显存, 无卡必然抛
        // "Found no NVIDIA driver on your system", 不属于本组的覆盖范围。
        //
        // ## 为什么断言布尔而不是端点
        // 指挥官指出本模块不该有「入口」概念：
        // > 彻底去掉入口概念，instance 的 ensure 应该是调用所有 prob 确保
        // > 我们全部的服务都 ensure。至于具体哪个是实际的服务，这个属于端口协定
        //
        // 故 `ensureReady` 只报告「是否全部就绪」；要连哪个端口由调用方自己的协定决定。
        const ok = await TunnelManager.ensureReady(
            INSTANCE, { require: ["clash", "middleware"], timeoutSec: 120 });

        if (!ok) {
            // 失败时给出各服务的实际状态, 便于定位
            const probe = await TunnelManager.probe(INSTANCE);
            throw new Error(
                `ensureReady 未就绪。当前状态: `
                + `${probe == undefined ? "实例不可用" : summarize(probe)}`);
        }

        expect(ok).toBe(true);
        SLogger.info(`  clash 与 middleware 均已就绪`);
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

    it("7. probe 报出的 pid 应与远端 /proc 实况吻合(交叉验证)", async () => {
        // ## 测试对象是**本地代码**, 不是远端软件
        // 指挥官指出过本用例早先的错法：
        // > 你可以看到我们居然在用自己造的 ssh 指令做 clash 的 probe…
        // > 你测一个远端软件行为实际上是完全无意义的, 我们肯定是预期远端无误,
        // > 测试的主题应该是我们本地服务能否正确接上
        //
        // 因此这里**不再**自己写 `pgrep -f '[C]OMFYUI_MANAGER_SVC_clash'`
        // 去复刻 `probeService` 的判据（那等于把实现抄一遍，还要顺带抄
        // 特征串前缀、`[x]` 防自匹配这些细节）。
        //
        // 改为**交叉验证**：拿 `probe()` 自己报出的 `procPid` 去 `/proc` 核对。
        // 这样测的是「本地探测链条（SSH → 远端脚本 → 解析）是否自洽」——
        // 若解析错位、正则跑偏、字段串行，pid 就对不上 /proc 里的实际进程。
        const probe = await TunnelManager.probe(INSTANCE);
        expect(probe).toBeDefined();
        const clash = probe!.clash;

        // clash 未配 probe 脚本 ⇒ 判据退化为「进程存在」
        expect(clash.probeUsed).toBe(false);
        expect(clash.ready).toBe(clash.alive);

        if (!clash.alive) {
            // 进程不在时无从交叉验证 —— 本用例只断言「无 pid 残留」这一自洽性
            expect(clash.procPid).toBeUndefined();
            SLogger.info(`  clash 未运行, 跳过 pid 交叉验证`);
            return;
        }

        // 本地解析出的 pid 必须是个正整数
        expect(typeof clash.procPid).toBe("number");
        expect(clash.procPid!).toBeGreaterThan(0);

        // 拿这个 pid 去远端核对：进程确实存在，且命令行含我们的 tag
        const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
        const ssh = await ins!.getSshClient();
        const r = await ssh!.exec(
            `cat /proc/${clash.procPid}/cmdline 2>/dev/null | tr '\\0' ' '`);
        // 期望值由**实例自己的 prefix** 拼出，而不是硬编码一个常量 ——
        // 这样测试跟随配置，配置一改（如换成 indextts）断言自动跟着走。
        const own = await TunnelManager.getInstance(INSTANCE);
        expect(r.stdout).toContain(`${own!.getPrefix()}clash`);

        // ## pid 与 sid 的关系（实测修正了此前的错误认知）
        // 曾以为「前台 exec 让服务顶替终端 shell，故 pid == sid」——
        // 实测**并非如此**。`ps -eo pid,ppid,sid,args` 的真实输出：
        // ```
        //   5184   1819   1819  comfyui_manager_clash
        //   5221   1887   1887  comfyui_manager_middleware index.js ...
        //         ↑ppid  ↑sid   （两者相等，而 pid 不同）
        // ```
        // 即**父进程才是会话首进程**：Jupyter 的终端本身还套了一层 shell，
        // `exec` 顶替的是那条命令行，服务仍是它 fork 出来的子进程。
        //
        // 这不是缺陷 —— 「服务由托管终端承载」这一语义依然成立（sid 与 ppid
        // 一致正说明它挂在同一个会话里）。此处**只断言 sid 存在**，
        // 不断言 pid/sid 的具体相等关系，以免把实现细节写死进测试。
        expect(typeof clash.procSid).toBe("number");
        expect(clash.procSid!).toBeGreaterThan(0);

        SLogger.info(`  clash 交叉验证: pid=${clash.procPid} sid=${clash.procSid}`
            + ` cmdline=${r.stdout.trim()}`);
    }, TIMEOUT.api);

    it("8. 重复 ensureReady 应幂等(复用已就绪的服务)", async () => {
        // 只要求 clash + middleware —— 加入 comfyui 会让每次调用都等满超时
        // (无卡模式下它必然启动失败), 那是另一维度的问题, 不应混入幂等性验证。
        const opt = { require: ["clash", "middleware"] as const, timeoutSec: 120 };
        const first = await TunnelManager.ensureReady(INSTANCE, { ...opt, require: [...opt.require] });
        const second = await TunnelManager.ensureReady(INSTANCE, { ...opt, require: [...opt.require] });
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
            const cleaned = await TunnelManager.teardown(INSTANCE);
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
