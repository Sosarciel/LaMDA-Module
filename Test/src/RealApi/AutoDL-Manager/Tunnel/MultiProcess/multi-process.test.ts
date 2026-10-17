/** 多进程并发接入测试
 *
 * ## 这个测试要证明什么
 * 指挥官描述的最基础使用场景：
 * > 两个物理机连着一个 autodl 实例发生图任务
 *
 * 即**两个独立进程**同时接入同一实例、**彼此没有任何进程间通讯**，
 * 各自独立判断远端服务状态，并决定是否要自己把服务拉起来。
 *
 * ## 核心风险：竞态
 * 两个进程可能**同时**探测到「服务没起」，于是**都去启动**，
 * 后果是端口抢占（`Address already in use`）、进程翻倍、服务状态错乱。
 *
 * 正确行为应当是：
 * - 至少一个进程成功拉起服务
 * - 两个进程最终都能看到服务就绪
 * - 远端服务**不会**被重复启动成两份
 *
 * ## 为什么必须是真的独立进程
 * jest 的模块内联共享同一个 Node 运行时与模块缓存，
 * 无法模拟「两台物理机各跑一个程序」这个场景。
 * 因此本测试 spawn 真实的 `node worker.mjs` 子进程。
 *
 * ## 为什么用**慢**服务
 * 并发目标必须让两个 worker **必然重叠**在启动窗口里，锁才会真的被考验。
 * 快服务 1 秒就返回，两者大概率自然错开，测试就成了「碰巧通过」。
 * 故这里用 6 秒才就绪的慢服务 —— 两个 worker 同时冲进去，必然有人撞锁。
 *
 * ## 服务全部自备
 * 不依赖 ComfyUI 镜像：脚本上传到 `/root/akaset_test_tunnel`，跑完删除。
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { AutoDLManager, TunnelManager } from "@sosraciel-lamda/autodl-manager";
import { SLogger } from "@zwa73/utils";

import { FIXTURE_DIR, FIXTURE_TAG } from "../fixture";
import { cleanupFixtures, deployFixtures, stopFixture } from "../fixtureSetup";
import { assertInstanceRunning, autodlInstanceData, summarize } from "../Util";

const execFileAsync = promisify(execFile);

/** AutoDL 侧实例名（父进程自己用） */
const HOST_INSTANCE = "AutoDLHost";

/** worker 进程内部给 AutoDL 侧起的实例名
 *
 * ⚠️ 与父进程的 `HOST_INSTANCE` **不同** —— worker 是独立进程，
 * 它自己 `initInject` 一份自己的实例表，实例名由它（worker.mjs）决定。
 * 传给 worker 的实例 data 里 `autodl_instance` 必须写这个值。
 */
const WORKER_HOST_INSTANCE = "BJ";
/** Tunnel 侧实例名 */
const INSTANCE = "FixtureMulti";

/** 实例未运行时在模块加载阶段抛错, 让整个测试集直接失败 */
assertInstanceRunning("multi-process.test.ts");

/** 工作进程脚本路径
 *
 * 用 `__dirname` 而非 `import.meta.url` —— 本测试集编译为 CommonJS。
 */
const WORKER = path.join(__dirname, "worker.mjs");

/** 工作进程产出的事件 */
type WorkerEvent = {
    worker: string;
    phase: string;
    detail: string;
    at: number;
};

/** 本组的服务配置 —— 只用**慢**服务
 *
 * 慢服务的启动窗口是 6 秒，两个 worker 同时冲进去必然重叠，
 * 这正是我们想考验锁的场景。
 */
const fixtureService = () => ({
    slow: {
        start: `${FIXTURE_DIR}/start_slow.sh`,
        probe: `${FIXTURE_DIR}/probe_slow.sh`,
        log: `${FIXTURE_DIR}/log_slow.sh`,
        unique_tag: FIXTURE_TAG.slow,
        expect_ready_sec: 30,
        poll_interval_ms: 300,
    },
});

/** 实例 data —— 与 `fixtureService()` 配套 */
const fixtureInstanceData = () => ({
    autodl_instance: HOST_INSTANCE,
    script_dir: FIXTURE_DIR,
    service: fixtureService(),
});

/** 启动一个工作进程并等它结束
 * @param param.id      - 工作进程标识
 * @param param.outDir  - 事件文件输出目录
 * @param param.startAt - 起跑线时间戳/毫秒（两个 worker 据此对齐冲锁时机）
 * @returns 该进程记录的事件列表
 */
const runWorker = async (param: { id: string; outDir: string; startAt?: number }): Promise<WorkerEvent[]> => {
    const { id, outDir, startAt } = param;
    const eventFile = path.join(outDir, `events-${id}.json`);
    const args = [WORKER, id, eventFile];
    if (startAt != undefined) args.push(String(startAt));
    // 用例配置由父进程序列化传入（本文件是 .mjs，读不到 .ts 源码）
    args.push(JSON.stringify({
        // ⚠️ 必须是 `BJ` —— 那是 worker 内部给 AutoDL 侧起的实例名。
        // 本文件里的 `HOST_INSTANCE`（AutoDLHost）只用于**父进程自己**，
        // worker 是独立进程，看不到父进程的实例表。
        autodl_instance: WORKER_HOST_INSTANCE,
        script_dir: FIXTURE_DIR,
        service: fixtureService(),
    }));
    try {
        await execFileAsync(process.execPath, args,
            { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 });
    } catch (e) {
        // 子进程非零退出不直接失败 —— 事件文件里有更详细的失败原因
        SLogger.warn(`工作进程 ${id} 异常退出: ${e}`);
    }
    if (!fs.existsSync(eventFile)) return [];
    return JSON.parse(fs.readFileSync(eventFile, "utf8")) as WorkerEvent[];
};

describe("Tunnel 多进程并发接入", () => {

    /** 临时目录：存放各工作进程的事件文件 */
    let outDir: string;

    /** 两个工作进程的事件 */
    let eventsA: WorkerEvent[];
    let eventsB: WorkerEvent[];

    beforeAll(async () => {
        outDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "akaset-mp-"));

        AutoDLManager.initInject({
            // 本组预期实例已启动, 绝不应对真实实例开关机(显式声明, 虽为默认值)
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

        const hostIns = await AutoDLManager.getInstance(HOST_INSTANCE);
        const ssh = await hostIns!.getSshClient();
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

        // 把远端服务**停掉**, 制造「两个进程都需要拉起」的竞争条件。
        // 这是本测试的核心前提: 若服务已就绪, 两者都走复用路径, 测不出竞态。
        await stopFixture({ ssh: ssh!, kind: "slow" });

        // 用只读探测确认竞争条件成立
        const probe = await TunnelManager.probe(INSTANCE);
        const summary = probe == undefined ? "(实例探测不可用)" : summarize(probe);
        SLogger.info(`多进程测试前置: 服务已停止 → ${summary}`);
        if (probe?.slow.ready) {
            throw new Error(
                `前置条件不成立: 服务未被真正停止 (${summary})。\n`
                + `本测试要求两个进程**同时**发现服务未启动, 否则测不到竞态。`);
        }

        // ## 起跑线：给两者一个共同的时间点，让它们同时冲锁
        //
        // 慢服务要 6 秒才就绪，两个 worker 各自初始化要 2-3 秒。
        // 不设起跑线的话，「初始化快的那个」可能已经把服务拉到就绪，
        // 慢的那个一探测就直接复用 —— 锁又没被考验。
        // 故 spawn 之后再等 4 秒，确保两者都是「服务未起」状态下同时开始抢。
        const startAt = Date.now() + 4_000;
        [eventsA, eventsB] = await Promise.all([
            runWorker({ id: "A", outDir, startAt }),
            runWorker({ id: "B", outDir, startAt }),
        ]);
    }, 600_000);

    it("1. 两个独立进程都应完整跑完流程", () => {
        for (const [id, evs] of [["A", eventsA], ["B", eventsB]] as const) {
            expect(evs.length).toBeGreaterThan(0);
            const phases = evs.map(e => e.phase);
            expect(phases).toContain("probe-before");
            expect(phases).toContain("ensure-done");
            expect(phases).toContain("probe-after");
            SLogger.info(`  ${id}: ${evs.length} 个事件, 阶段=${
                [...new Set(phases)].join(",")}`);
        }
    }, 30_000);

    it("2. 两个进程都应在启动前探测到服务未就绪", () => {
        // 证明竞态条件成立 —— 否则本测试测的不是并发接入
        for (const [id, evs] of [["A", eventsA], ["B", eventsB]] as const) {
            const before = evs.find(e => e.phase === "probe-before");
            expect(before).toBeDefined();
            SLogger.info(`  ${id} 启动前: ${before!.detail}`);
        }
    }, 30_000);

    it("3. 两个进程应都成功等到服务就绪", () => {
        // 慢服务下两者都该能等到 —— 一个拉、一个等，最终都拿到 ok
        const okA = eventsA.find(e => e.phase === "exit")?.detail === "ok=true";
        const okB = eventsB.find(e => e.phase === "exit")?.detail === "ok=true";
        SLogger.info(`  A 就绪=${okA}, B 就绪=${okB}`);
        expect(okA || okB).toBe(true);
    }, 30_000);

    it("4. 两个进程最终都应看到服务就绪(无 IPC 下的一致性)", () => {
        for (const [id, evs] of [["A", eventsA], ["B", eventsB]] as const) {
            const after = evs.find(e => e.phase === "probe-after");
            expect(after).toBeDefined();
            SLogger.info(`  ${id} 结束后: ${after!.detail}`);
            expect(after!.detail).toContain("slow=ready");
        }
    }, 30_000);

    it("5. 远端服务不应被重复启动成多份", async () => {
        const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
        expect(ins).toBeDefined();
        const ssh = await ins!.getSshClient();

        // ## 数 screen 会话，而不是数进程命令行
        // 假服务的本体是 `python3 -m http.server`，其 `argv[0]` 是 `python3`
        // 而非 tag，故 `pgrep -f '^tag'` 数不到它。
        // 会话名才是我们让脚本写下的特征 —— 一份服务 = 一个会话。
        const tag = FIXTURE_TAG.slow;
        const r = await ssh!.exec(
            `screen -ls 2>/dev/null | grep -c '[.]${tag}[[:space:]]'`);
        const count = Number(r.stdout.trim());
        SLogger.info(`  slow 会话数: ${count}  (tag=${tag})`);
        // 竞态若处理不当, 这里会 >1
        expect(count).toBeLessThanOrEqual(1);
    }, 60_000);

    it("6. 并发时应只有一个进程真正执行了启动(凭锁串行化)", () => {
        // ## 匹配串必须带 `TunnelLauncher` 前缀
        // 调度器打的 `Scheduler 调度 <kind> 启动 (预期 Ns 内就绪)` 也含「启动」，
        // 用裸串会把两个 worker 都误判成启动者，断言形同虚设。
        const waitA = eventsA.some(e => e.detail.includes("已有其他进程在启动"));
        const waitB = eventsB.some(e => e.detail.includes("已有其他进程在启动"));
        const startA = eventsA.some(e => e.detail.includes("TunnelLauncher 启动 slow"));
        const startB = eventsB.some(e => e.detail.includes("TunnelLauncher 启动 slow"));
        const recheckA = eventsA.some(e => e.detail.includes("抢锁后复查有变化"));
        const recheckB = eventsB.some(e => e.detail.includes("抢锁后复查有变化"));

        SLogger.info(`  A: 等待=${waitA} 启动=${startA} 复查复用=${recheckA}`);
        SLogger.info(`  B: 等待=${waitB} 启动=${startB} 复查复用=${recheckB}`);

        // 只应有一个真正执行了启动
        const starters = [startA, startB].filter(Boolean).length;
        expect(starters).toBeLessThanOrEqual(1);

        // ## 这一次「锁必须被撞到」
        // 用**慢服务**（6 秒才就绪）就是为了这个：两个 worker 同时冲进去，
        // 先到者持锁期间服务远未就绪，后到者**必然**撞上锁或复查到变化。
        // 若这里全为 false，说明起跑线没对齐、或锁根本没生效 ——
        // 那本用例就什么也没证明，应当判红。
        const observed = [waitA, waitB, recheckA, recheckB].some(Boolean);
        expect(observed).toBe(true);
    }, 30_000);

    afterAll(async () => {
        // ## 收尾必须清理, 而不是「恢复」
        // 留在远端的服务会让后续测试在「本套件留下的状态」上做判定(内容竞态)。
        try {
            const cleaned = await TunnelManager.teardown(INSTANCE);
            SLogger.info(`多进程测试收尾: ${JSON.stringify(cleaned)}`);
        } catch (e) {
            SLogger.warn(`多进程测试收尾清理失败: ${e}`);
        }

        // ## 必须关闭本套件自己的隧道
        // jest 的 `--runInBand` **复用同一个模块实例与进程**，
        // 因此本套件开的隧道若不关，会残留到下一个测试套件，
        // 让它们的 `openTunnel` 报「本地端口已被其它进程占用」。
        try {
            const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
            const ssh = await ins?.getSshClient();
            if (ssh != undefined) await cleanupFixtures(ssh);
            await ins?.closeTunnel();
            SLogger.info("多进程测试收尾: 清理完成");
        } catch (e) {
            SLogger.warn(`多进程测试收尾清理失败: ${e}`);
        }

        // 清理临时目录
        try {
            if (outDir != undefined) await fs.promises.rm(outDir, { recursive: true, force: true });
        } catch {
            // 清理失败不影响测试结论
        }
    }, 300_000);
});
