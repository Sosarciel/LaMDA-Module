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
 * ## 服务用自备假服务，而不是 ComfyUI
 * 本测试要证的只有一件事：**`ensureReady` 能否在实例关机时自动开机并拉起服务**。
 * 那与服务是什么毫无关系 —— 用假服务反而更纯粹：
 * ComfyUI 起不来时（比如无卡模式），我们分不清是「生命周期没工作」
 * 还是「服务自己起不来」，而假服务只会在真出问题时失败。
 * ComfyUI 那一条属于**用例验证**，已下沉到 `test-server`。
 *
 * ## ⚠️ 无卡模式实例的硬性阻断
 * AutoDL 的 `power_on` API 的 `payload` **只接受 `"gpu"`** ——
 * 无卡模式实例一旦被关，就无法经 API 重新打开，只能人工在控制台开。
 * 故 `BLOCKED_BY_GPU_MODE` 拦的正是这一情形。
 *
 * ## 运行方式
 * ```
 * cross-env WITH_API=true AUTODL_COMFY_FLOW=true npm run test -- --selectProjects real-api src/RealApi/AutoDL-Manager/Tunnel/Dangerous --runInBand --forceExit
 * ```
 * 或把下面的 `MANUAL_CONFIRM` 改成 `true` 后直接跑。
 */

import { AutoDLManager, TunnelManager } from "@sosraciel-lamda/autodl-manager";
import { SLogger } from "@zwa73/utils";

import { FIXTURE_DIR, FIXTURE_TAG } from "../fixture";
import { cleanupFixtures, deployFixtures, isFixtureUp, stopFixture } from "../fixtureSetup";
import { autodlInstanceData, summarize } from "../Util";

/** ⚠️ 危险测试总开关：人工确认后才置 true
 *
 * **默认 `false`** —— 本文件会真实开关机并产生 GPU 费用，
 * 因此测试脚本、CI、批量跑测试都**不会**触发它。
 */
const MANUAL_CONFIRM: boolean = false;

/** ⚠️ 硬性阻断：**无卡模式**实例无法经 API 重新开启
 *
 * AutoDL 的 `power_on` 的 payload **只接受 `"gpu"`** ——
 * 即 API 只能用**有卡模式**开机，无卡模式必须人工在控制台开。
 *
 * 故本开关拦的是「目标实例是无卡模式」这一情形：
 * 那种实例被关掉后**开不回来**，跑本测试是纯粹的破坏。
 *
 * 换成无卡实例时，把它改回 `true`。
 */
const BLOCKED_BY_GPU_MODE: boolean = false;

/** 是否启用本危险测试（人工开关 或 环境变量，且未被阻断） */
const ENABLED: boolean =
    !BLOCKED_BY_GPU_MODE
    && (MANUAL_CONFIRM || process.env.AUTODL_COMFY_FLOW === "true");

const describeFlow = ENABLED ? describe : describe.skip;

/** AutoDL 侧实例名 */
const HOST_INSTANCE = "AutoDLHost";
/** Tunnel 侧实例名 */
const INSTANCE = "FixtureLifecycle";

/** 超时上限/毫秒 */
const TIMEOUT = {
    setup: 120_000,
    api: 60_000,
    boot: 300_000,
    launch: 300_000,
};

/** 本组的服务配置 —— 只用**快**服务
 *
 * 生命周期测试关心的是「能否开机 + 拉起」，不需要慢服务的启动窗口。
 */
const fixtureService = () => ({
    fast: {
        start: `${FIXTURE_DIR}/start_fast.sh`,
        log: `${FIXTURE_DIR}/log_fast.sh`,
        unique_tag: FIXTURE_TAG.fast,
        expect_ready_sec: 15,
        poll_interval_ms: 300,
    },
});

/** 测试用的 Tunnel 实例 data */
const fixtureInstanceData = () => ({
    autodl_instance: HOST_INSTANCE,
    script_dir: FIXTURE_DIR,
    service: fixtureService(),
});

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
                        data: fixtureInstanceData(),
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
        const ok = await TunnelManager.ensureReady({
            instanceName: INSTANCE,
            require: ["fast"],
            timeoutSec: 240,
        });

        // ⚠️ 断言 `=== false` 而非 `== undefined` ——
        // `ensureReady` 返回的是布尔, `undefined` 检查对本类型恒不成立,
        // 失败时会静默放过（假绿）。
        if (ok === false) {
            const probe = await TunnelManager.probe(INSTANCE);
            throw new Error(
                `ensureReady 失败。当前状态: `
                + `${probe == undefined ? "实例不可用" : summarize(probe)}`);
        }
        expect(ok).toBe(true);
        SLogger.info(`  服务已就绪`);
    }, TIMEOUT.boot + TIMEOUT.launch);

    it("3. 拉起后 AutoDL 实例应处于运行中", async () => {
        const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
        expect(await ins!.getStatus()).toBe("running");
    }, TIMEOUT.api);

    it("4. 服务应真的能响应(证明假服务确实被拉起来了)", async () => {
        const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
        const ssh = await ins!.getSshClient();
        const r = await ssh!.exec(
            `curl -fs --max-time 10 http://127.0.0.1:18101/ >/dev/null 2>&1 && echo UP || echo DOWN`);
        expect(r.stdout).toContain("UP");
    }, TIMEOUT.api);

    it("5. teardown 应停掉服务", async () => {
        const cleaned = await TunnelManager.teardown(INSTANCE);
        SLogger.info(`  清理结果: ${JSON.stringify(cleaned)}`);

        const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
        const ssh = await ins!.getSshClient();
        await stopFixture({ ssh: ssh!, kind: "fast" });
        expect(await isFixtureUp({ ssh: ssh!, kind: "fast" })).toBe(false);
    }, TIMEOUT.launch);

    afterAll(async () => {
        // ⚠️ 本测试的收尾**不停机** —— 由生命周期协商决定何时关机。
        // 这里只清掉假服务与本地隧道。若需要主动关机, 那是另一个显式的危险操作。
        try {
            const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
            const ssh = await ins?.getSshClient();
            if (ssh != undefined) await cleanupFixtures(ssh);
            await ins?.closeTunnel();
        } catch {
            // 收尾失败不应让测试结果变红
        }
    }, TIMEOUT.api);
});
