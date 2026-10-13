/** ⚠️ 危险测试：完全生命周期的启停
 *
 * ## 为什么是危险的
 * 与 AutoDL-Manager 的 `Dangerous/full-flow.test.ts` 同源：
 * 本测试会**真实开关机**，有卡模式下约 **1.68 元/小时**，故默认禁用。
 *
 * ## 与常规测试的语义区别
 * 常规测试（`../tunnel-hosting.test.ts`）写的是「**预期已打开**」：
 * 调用前实例必须已在运行，否则在模块顶层抛错。
 *
 * 本测试的语义是「**调用即拉起**」：调用前断言实例是关的，调用后断言它已可用。
 *
 * ## ⚠️⚠️ 当前有硬性阻断
 * 目标实例 `pro-7916491fc9d3` 运行在**无卡模式**，而 AutoDL 的
 * `power_on` API 的 `payload` **只接受 `"gpu"`** ——
 * 即**无卡模式实例一旦被关，就无法经 API 重新打开**，只能人工在控制台开。
 *
 * 因此在本测试真正可用之前，必须**先解决「无卡模式实例如何开机」**这个问题，
 * 否则一旦跑起来就会把实例关掉且开不回来。
 *
 * ## 运行方式（解决上述阻断后）
 * ```
 * # 1. 环境变量
 * cross-env WITH_API=true AUTODL_COMFY_FLOW=true npm run test -- --selectProjects real-api src/RealApi/AutoDL-Manager/Tunnel/Dangerous --runInBand --forceExit
 * # 2. 把下面的 MANUAL_CONFIRM 改成 true 后直接跑
 * ```
 */

import { AutoDLManager, TunnelManager } from "@sosraciel-lamda/autodl-manager";
import { SLogger } from "@zwa73/utils";

import { INSTANCE, autodlInstanceData, instanceData, summarize } from "../Util";

/** ⚠️ 危险测试总开关：人工确认后才置 true
 *
 * **默认 `false`** —— 本文件会真实开关机并产生 GPU 费用，
 * 因此测试脚本、CI、批量跑测试都**不会**触发它。
 */
const MANUAL_CONFIRM: boolean = false;

/** ⚠️⚠️ 硬性阻断：无卡模式实例无法经 API 重新开启
 *
 * AutoDL 的 `power_on` 的 payload **只接受 `"gpu"`**，
 * 无卡模式必须人工在控制台开。
 *
 * 因此**只要目标实例是无卡模式，本测试就绝不能跑** ——
 * 它会把实例关掉且开不回来。
 *
 * 需要跑本测试时，必须满足其一：
 * 1. 目标实例本身就是**有卡**常驻的（改测试指向那个实例）
 * 2. 已确认可以人工在控制台重新开启（人在场盯着）
 *
 * 把它设成 `true` 之前请先确认上面两点。
 */
const BLOCKED_BY_GPU_MODE: boolean = true;

/** 是否启用本危险测试（人工开关 或 环境变量，且未被阻断） */
const ENABLED: boolean =
    !BLOCKED_BY_GPU_MODE
    && (MANUAL_CONFIRM || process.env.AUTODL_COMFY_FLOW === "true");

const describeFlow = ENABLED ? describe : describe.skip;

/** AutoDL 侧实例名 */
const HOST_INSTANCE = "AutoDLHost";

/** 超时上限/毫秒 */
const TIMEOUT = {
    setup: 120_000,
    api: 60_000,
    boot: 300_000,
    launch: 300_000,
};

if (!ENABLED) {
    SLogger.warn(
        `Tunnel 危险测试已跳过。`
        + `原因: ${BLOCKED_BY_GPU_MODE
            ? "实例为无卡模式, 关机后无法经 API 开启(硬性阻断)"
            : "未人工确认(MANUAL_CONFIRM=false 且未设 AUTODL_COMFY_FLOW=true)"}`);
}

describeFlow("Tunnel 完全生命周期(危险)", () => {

    beforeAll(async () => {
        AutoDLManager.initInject({
            // ⚠️ **本组必须允许真实开关机** —— 它管理实例生命周期。
            // 若沿用默认的 false, 开关机会被安全闸门静默拦下, 变成假绿。
            allowPowerControl: true,
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

    it("1. 前置: 实例应处于关机状态", async () => {
        const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
        const status = await ins!.getStatus();
        SLogger.info(`  当前状态: ${status}`);
        // 本测试的语义是「调用即拉起」, 故前置必须是关的
        expect(["shutdown", "shutdowning"]).toContain(status);
    }, TIMEOUT.api);

    it("2. ensureReady 应自动开机并把服务拉起", async () => {
        const endpoint = await TunnelManager.ensureReady({
            instanceName: INSTANCE,
            // 有卡模式下三个服务都应可用
            require: ["clash", "middleware", "comfyui"],
            timeoutSec: 240,
        });

        if (endpoint == undefined) {
            const probe = await TunnelManager.probe(INSTANCE);
            throw new Error(
                `ensureReady 失败。当前状态: `
                + `${probe == undefined ? "实例不可用" : summarize(probe)}`);
        }
        expect(endpoint).toContain("http://127.0.0.1:");
        SLogger.info(`  生图入口: ${endpoint}`);
    }, TIMEOUT.boot + TIMEOUT.launch);

    it("3. 拉起后 AutoDL 实例应处于运行中", async () => {
        const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
        expect(await ins!.getStatus()).toBe("running");
    }, TIMEOUT.api);

    it("4. ComfyUI 本体应真的能响应(证明 GPU 可用)", async () => {
        const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
        const ssh = await ins!.getSshClient();
        // /system_stats 是 ComfyUI 的就绪端点, 能返回即证明它真的跑起来了
        const r = await ssh!.exec(
            "curl -s --max-time 10 http://127.0.0.1:6005/system_stats");
        expect(r.stdout).toContain("system");
    }, TIMEOUT.api);

    afterAll(async () => {
        // ⚠️ 本测试的收尾**不停机** —— 由生命周期协商决定何时关机。
        // 这里只收掉本地隧道。若需要主动关机, 那是另一个显式的危险操作。
        try {
            const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
            await ins?.closeTunnel();
        } catch {
            // 收尾失败不应让测试结果变红
        }
    }, TIMEOUT.api);
});
