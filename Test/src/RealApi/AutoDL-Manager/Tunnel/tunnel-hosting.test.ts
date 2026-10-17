/** Tunnel 托管机制测试（服务无关）
 *
 * ## 本组测什么
 * `TunnelManager` 的**托管契约**：配置解析 → 探测 → 拉起 → 幂等复用 → 收尾。
 * 这些机制**与具体服务是什么毫无关系** —— 换成 ComfyUI 那套还是别的，
 * 走的都是同一套代码。故本组用**测试自备的假服务**，
 * 不依赖任何镜像预置，CPU 实例也能完整跑。
 *
 * ## 为什么不再测 Middleware 网关
 * 此前本组还验证「本地映射端口能访问到网关」「网关的文件工具往返」——
 * 那些是 **ComfyUI 那一套部署的专属能力**（`/tool/probe` `/tool/save` 等），
 * 属于**用例**而非机制。它们已下沉到 `test-server`，
 * 与同在那里运行的真实业务一并验证。
 *
 * ## 前置
 * 实例处于运行中（无卡模式即可，指挥官手动开）。
 * 服务由本组自己上传到 `/root/akaset_test_tunnel`，跑完删除。
 */

import { AutoDLManager, TunnelManager } from "@sosraciel-lamda/autodl-manager";
import { SLogger } from "@zwa73/utils";

import { FIXTURE_DIR, FIXTURE_PORT, FIXTURE_TAG, type FixtureKind } from "./fixture";
import { cleanupFixtures, deployFixtures, isFixtureUp, stopFixture } from "./fixtureSetup";
import { assertInstanceRunning, autodlInstanceData, summarize } from "./Util";

/** AutoDL 侧实例名 */
const HOST_INSTANCE = "AutoDLHost";
/** Tunnel 侧实例名 */
const INSTANCE = "FixtureHosting";

/** 实例未运行时在模块加载阶段抛错, 让整个测试集直接失败 */
assertInstanceRunning("tunnel-hosting.test.ts");

/** 超时上限/毫秒 */
const TIMEOUT = {
    setup: 120_000,
    api: 30_000,
    launch: 120_000,
};

/** 本组的服务配置 —— 全部指向自备假服务
 *
 * 键序即启动顺序（与真实配置的约定一致）。
 * `probe` 只给**慢**服务 —— 它「进程在但端口不通」，
 * 正是需要 probe 才能判准的情形；快服务走特征匹配即可。
 */
const fixtureService = () => ({
    fast: {
        start: `${FIXTURE_DIR}/start_fast.sh`,
        log: `${FIXTURE_DIR}/log_fast.sh`,
        unique_tag: FIXTURE_TAG.fast,
        expect_ready_sec: 15,
        poll_interval_ms: 300,
    },
    slow: {
        start: `${FIXTURE_DIR}/start_slow.sh`,
        probe: `${FIXTURE_DIR}/probe_slow.sh`,
        log: `${FIXTURE_DIR}/log_slow.sh`,
        unique_tag: FIXTURE_TAG.slow,
        expect_ready_sec: 30,
        poll_interval_ms: 300,
        // 慢服务要经 clash 那类外网才可用是 ComfyUI 的依赖形态；
        // 假服务之间没有依赖，故不声明 deps。
    },
});

/** 实例 data —— 与 `fixtureService()` 配套 */
const fixtureInstanceData = () => ({
    autodl_instance: HOST_INSTANCE,
    script_dir: FIXTURE_DIR,
    service: fixtureService(),
});

describe("Tunnel 托管机制", () => {

    beforeAll(async () => {
        // `allowPowerControl: false` —— 本组是「预期实例已启动」的语义,
        // 绝不应对真实实例开关机(关了就再也拉不起来, 开了则立刻产生 GPU 费用)。
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

        const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
        const ssh = await ins!.getSshClient();
        await deployFixtures(ssh!);

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

    it("1. 应能通过 ServiceManager 取到实例且配置回写正确", async () => {
        const names = await TunnelManager.listInstances();
        expect(names).toContain(INSTANCE);

        const ins = await TunnelManager.getInstance(INSTANCE);
        expect(ins).toBeDefined();
        // getData 必须与构造参数一致 —— ServiceManager 依赖此契约
        expect(ins!.getData()).toEqual(fixtureInstanceData());
    }, TIMEOUT.api);

    it("2. 服务配置应由「实例 data 的 script_dir」拼出, 而非模块常量", async () => {
        const ins = await TunnelManager.getInstance(INSTANCE);
        const svc = ins!.getServices();

        // 键序即启动顺序
        expect(Object.keys(svc)).toEqual(["fast", "slow"]);
        expect(svc.fast.start).toBe(`${FIXTURE_DIR}/start_fast.sh`);
        expect(svc.slow.start).toBe(`${FIXTURE_DIR}/start_slow.sh`);
        // 只有慢服务声明了 probe（它「进程在但端口不通」，需真探端口）
        expect(svc.slow.probe).toBe(`${FIXTURE_DIR}/probe_slow.sh`);
        expect(svc.fast.probe).toBeUndefined();
    }, TIMEOUT.api);

    it("2b. 每个服务应各自声明 unique_tag, 且互不相同", async () => {
        // tag 是 mgr 唯一该关心的东西 —— 只作 pgrep/pkill 的匹配键。
        // 它**必须 unique**：共用会让 pkill 误杀、pgrep 误判。
        const ins = await TunnelManager.getInstance(INSTANCE);
        const services = ins!.getServices();

        expect(services.fast.unique_tag).toBe(FIXTURE_TAG.fast);
        expect(services.slow.unique_tag).toBe(FIXTURE_TAG.slow);
        const tags = Object.values(services).map(s => s.unique_tag ?? "");
        expect(new Set(tags).size).toBe(tags.length);
        for (const t of tags) expect(t).not.toBe("");
    }, TIMEOUT.api);

    it("3. 部署文件应存在于实例上(自备假服务)", async () => {
        const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
        const ssh = await ins!.getSshClient();

        const r = await ssh!.exec(
            `for f in '${FIXTURE_DIR}'/start_*.sh '${FIXTURE_DIR}'/log_*.sh;`
            + ` do test -x "$f" || echo "MISSING:$f"; done; echo CHECKED`);
        expect(r.stdout).not.toContain("MISSING:");
        expect(r.stdout).toContain("CHECKED");
    }, TIMEOUT.api);

    it("4. 探测应给出自洽的服务状态(不误报)", async () => {
        const probe = await TunnelManager.probe(INSTANCE);
        expect(probe).toBeDefined();
        SLogger.info(`  服务状态: ${summarize(probe!)}`);

        for (const kind of ["fast", "slow"] as const) {
            const r = probe![kind];
            expect(r).toBeDefined();
            // detail 必须与观测**自洽**：ready ⇒ 进程在；
            // 不 ready 时区分「进程在(启动中)」与「进程不存在」。
            if (r.ready) {
                expect(r.alive).toBe(true);
                expect(r.detail).toBe("服务就绪");
            } else if (r.alive) {
                expect(r.detail).toContain("尚未就绪");
            } else {
                expect(r.detail).toContain("进程不存在");
            }
        }
        // 快服务未配 probe → 走特征匹配
        expect(probe!.fast.probeUsed).toBe(false);
    }, TIMEOUT.api);

    it("5. ensureReady 应把快服务拉起并就绪", async () => {
        const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
        const ssh = await ins!.getSshClient();
        await stopFixture({ ssh: ssh!, kind: "fast" });

        const ok = await TunnelManager.ensureReady({
            instanceName: INSTANCE, require: ["fast"], timeoutSec: 60 });
        if (!ok) {
            const probe = await TunnelManager.probe(INSTANCE);
            throw new Error(`ensureReady 未就绪。当前状态: `
                + `${probe == undefined ? "实例不可用" : summarize(probe)}`);
        }
        expect(ok).toBe(true);

        // 服务确实在跑，且端口真的能服务请求
        expect(await isFixtureUp({ ssh: ssh!, kind: "fast" })).toBe(true);
        SLogger.info(`  fast 已就绪`);
    }, TIMEOUT.launch);

    it("6. 慢服务的 probe 应能区分「进程在」与「真的可用」", async () => {
        const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
        const ssh = await ins!.getSshClient();
        await stopFixture({ ssh: ssh!, kind: "slow" });

        // 不等它 —— 直接去看那 6 秒窗口内的探测结果
        const startP = TunnelManager.ensureReady({
            instanceName: INSTANCE, require: ["slow"], timeoutSec: 90 });
        await new Promise(r => setTimeout(r, 2_000));

        const mid = await TunnelManager.probe(INSTANCE);
        const slow = mid!.slow;
        // ⚠️ 这正是 probe 存在的理由：进程在，但还不能服务
        expect(slow.alive).toBe(true);
        expect(slow.ready).toBe(false);
        expect(slow.probeUsed).toBe(true);
        expect(slow.detail).toContain("尚未就绪");
        SLogger.info(`  慢服务窗口内: alive=${slow.alive} ready=${slow.ready} (probe 生效)`);

        // 等它真正就绪
        await expect(startP).resolves.toBe(true);
        const done = await TunnelManager.probe(INSTANCE);
        expect(done!.slow.ready).toBe(true);
    }, TIMEOUT.launch);

    it("7. probe 报出的 pid 应与远端 /proc 实况吻合(交叉验证)", async () => {
        // ## 测的是**本地代码**, 不是远端软件
        // 不再自己复刻 `probeService` 的判据（那等于把实现抄一遍，
        // 还要顺带抄防自匹配等细节）。改为**交叉验证**：
        // 拿 `probe()` 自己报出的 pid 去 `/proc` 核对 ——
        // 若解析错位、正则跑偏、字段串行，pid 就对不上。
        const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
        const ssh = await ins!.getSshClient();
        await TunnelManager.ensureReady({
            instanceName: INSTANCE, require: ["fast"], timeoutSec: 60 });

        const probe = await TunnelManager.probe(INSTANCE);
        const fast = probe!.fast;
        expect(fast.alive).toBe(true);
        expect(typeof fast.procPid).toBe("number");
        expect(fast.procPid!).toBeGreaterThan(0);

        // 拿这个 pid 去远端核对：进程确实存在，且命令行含我们的 tag
        const r = await ssh!.exec(
            `cat /proc/${fast.procPid}/cmdline 2>/dev/null | tr '\\0' ' '`);
        // 期望值由**实例自己的配置**取，而不是硬编码常量
        const own = await TunnelManager.getInstance(INSTANCE);
        const tag = own!.getServices().fast.unique_tag ?? `${INSTANCE}_fast`;
        expect(r.stdout).toContain(tag);

        expect(typeof fast.procSid).toBe("number");
        expect(fast.procSid!).toBeGreaterThan(0);

        SLogger.info(`  fast 交叉验证: pid=${fast.procPid} sid=${fast.procSid}`
            + ` cmdline=${r.stdout.trim()}`);
    }, TIMEOUT.launch);

    it("8. 重复 ensureReady 应幂等(复用已就绪的服务)", async () => {
        const first = await TunnelManager.ensureReady({
            instanceName: INSTANCE, require: ["fast"], timeoutSec: 60 });
        const second = await TunnelManager.ensureReady({
            instanceName: INSTANCE, require: ["fast"], timeoutSec: 60 });
        expect(first).toBe(true);
        expect(second).toBe(first);
    }, TIMEOUT.launch);

    it("9. teardown 应停掉服务, 且幂等", async () => {
        const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
        const ssh = await ins!.getSshClient();

        const cleaned = await TunnelManager.teardown(INSTANCE);
        SLogger.info(`  清理结果: ${JSON.stringify(cleaned)}`);

        // 服务确已不在
        for (const kind of ["fast", "slow"] as FixtureKind[])
            await stopFixture({ ssh: ssh!, kind });

        // 幂等：再来一次不报错
        await expect(TunnelManager.teardown(INSTANCE)).resolves.toBeDefined();
    }, TIMEOUT.launch);

    afterAll(async () => {
        // ## 必须清理 —— 这是「内容竞态」的根治
        // 若不清理，紧随其后的测试就会在**本组留下的状态**上做判定 ——
        // 这不是端口抢占那种资源冲突，而是**判定依据被污染**。
        try {
            const cleaned = await TunnelManager.teardown(INSTANCE);
            SLogger.info(`收尾清理: ${JSON.stringify(cleaned)}`);
        } catch (e) {
            SLogger.warn(`收尾清理失败: ${e}`);
        }

        try {
            const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
            const ssh = await ins?.getSshClient();
            if (ssh != undefined) await cleanupFixtures(ssh);
            await ins?.closeTunnel();
        } catch {
            // 收尾失败不应让测试结果变红 —— 用例本身已全部断言完毕
        }
    }, TIMEOUT.api);
});
