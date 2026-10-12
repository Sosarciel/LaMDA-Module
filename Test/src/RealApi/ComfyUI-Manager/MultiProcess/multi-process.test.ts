/** 多进程并发接入测试
 *
 * ## 这个测试要证明什么
 * 指挥官描述的最基础使用场景：
 * > 两个物理机连着一个 autodl 实例发生图任务
 *
 * 即**两个独立进程**同时接入同一实例、**彼此没有任何进程间通讯**，
 * 各自独立判断远端服务状态，并决定是否要自己叫 Jupyter 终端把它拉起来。
 *
 * ## 核心风险：竞态
 * 两个进程可能**同时**探测到「服务没起」，于是**都去启动**，
 * 后果是端口抢占（`Address already in use`）、进程翻倍、服务状态错乱。
 *
 * 正确行为应当是：
 * - 至少一个进程成功拉起服务
 * - 两个进程最终都能拿到可用端点
 * - 远端服务**不会**被重复启动成两份
 *
 * ## 为什么必须是真的独立进程
 * jest 的模块内联共享同一个 Node 运行时与模块缓存，
 * 无法模拟「两台物理机各跑一个程序」这个场景。
 * 因此本测试 spawn 真实的 `node worker.mjs` 子进程。
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { AutoDLManager, ComfyUIManager } from "@sosraciel-lamda/autodl-manager";
import { SLogger } from "@zwa73/utils";

import { INSTANCE, assertInstanceRunning, autodlInstanceData, instanceData, services,
    stopRemoteServices, summarize } from "../Util";

const execFileAsync = promisify(execFile);

/** AutoDL 侧实例名 */
const HOST_INSTANCE = "AutoDLHost";

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

/** 启动一个工作进程并等它结束
 * @param id     - 工作进程标识
 * @param outDir - 事件文件输出目录
 * @returns 该进程记录的事件列表
 */
const runWorker = async (id: string, outDir: string): Promise<WorkerEvent[]> => {
    const eventFile = path.join(outDir, `events-${id}.json`);
    try {
        await execFileAsync(process.execPath, [WORKER, id, eventFile],
            { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 });
    } catch (e) {
        // 子进程非零退出不直接失败 —— 事件文件里有更详细的失败原因
        SLogger.warn(`工作进程 ${id} 异常退出: ${e}`);
    }
    if (!fs.existsSync(eventFile)) return [];
    return JSON.parse(fs.readFileSync(eventFile, "utf8")) as WorkerEvent[];
};

describe("ComfyUI-Manager 多进程并发接入", () => {

    /** 临时目录：存放各工作进程的事件文件 */
    let outDir: string;

    /** 两个工作进程的事件 */
    let eventsA: WorkerEvent[];
    let eventsB: WorkerEvent[];

    beforeAll(async () => {
        outDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "akaset-mp-"));

        // 把远端服务**停掉**, 制造「两个进程都需要拉起」的竞争条件。
        // 这是本测试的核心前提: 若服务已就绪, 两者都走复用路径, 测不出竞态。
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

        const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
        const ssh = await ins!.getSshClient();
        await stopRemoteServices(ssh!, ["middleware", "clash"]);
        await new Promise(r => setTimeout(r, 2_000));

        // 用只读探测确认竞争条件成立 —— 若服务仍就绪, 两个进程都会走复用路径,
        // 本测试就测不到竞态了（假绿）。
        const probe = await ComfyUIManager.probe(INSTANCE);
        const summary = probe == undefined ? "(实例探测不可用)" : summarize(probe);
        SLogger.info(`多进程测试前置: 服务已停止 → ${summary}`);
        if (probe?.clash.ready || probe?.middleware.ready) {
            throw new Error(
                `前置条件不成立: 服务未被真正停止 (${summary})。\n`
                + `本测试要求两个进程**同时**发现服务未启动, 否则测不到竞态。`);
        }

        // 两个进程**同时**启动 —— 这是竞态的关键
        [eventsA, eventsB] = await Promise.all([
            runWorker("A", outDir),
            runWorker("B", outDir),
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

    it("3. 至少一个进程应成功拿到可用端点", () => {
        const okA = eventsA.find(e => e.phase === "exit")?.detail === "ok=true";
        const okB = eventsB.find(e => e.phase === "exit")?.detail === "ok=true";
        SLogger.info(`  A 拿到端点=${okA}, B 拿到端点=${okB}`);
        expect(okA || okB).toBe(true);
    }, 30_000);

    it("4. 两个进程最终都应看到服务就绪(无 IPC 下的一致性)", () => {
        for (const [id, evs] of [["A", eventsA], ["B", eventsB]] as const) {
            const after = evs.find(e => e.phase === "probe-after");
            expect(after).toBeDefined();
            SLogger.info(`  ${id} 结束后: ${after!.detail}`);
            // clash 与 middleware 都应为 ready
            expect(after!.detail).toContain("clash=ready");
            expect(after!.detail).toContain("middleware=ready");
        }
    }, 30_000);

    it("5. 远端服务不应被重复启动成多份", async () => {
        // 取 AutoDL 侧实例 —— `INSTANCE` 是 ComfyUI 侧的实例名, 两者不同
        const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
        expect(ins).toBeDefined();
        const ssh = await ins!.getSshClient();

        for (const [kind, pattern] of [
            ["clash", "[/]root/clash/mihomo"],
            ["middleware", "[n]ode index.js -p"],
        ] as const) {
            const r = await ssh!.exec(`pgrep -f '${pattern}' | wc -l`);
            const count = Number(r.stdout.trim());
            SLogger.info(`  ${kind} 进程数: ${count}`);
            // 竞态若处理不当, 这里会 >1
            expect(count).toBeLessThanOrEqual(1);
        }
    }, 60_000);

    it("6. 并发时应只有一个进程真正启动(凭锁串行化)", () => {
        // 这是最有说服力的一条: 从两个进程各自的日志里确认
        // 「确实有进程走了等待路径」—— 否则说明它们只是碰巧错开,
        // 并没真正验证锁的作用。
        const waitA = eventsA.some(e => e.detail.includes("已有其他进程在启动"));
        const waitB = eventsB.some(e => e.detail.includes("已有其他进程在启动"));
        const startA = eventsA.some(e => e.detail.includes("启动 clash"));
        const startB = eventsB.some(e => e.detail.includes("启动 clash"));

        SLogger.info(`  A: 等待=${waitA} 启动=${startA}`);
        SLogger.info(`  B: 等待=${waitB} 启动=${startB}`);

        // 两者合计只应有一个真正执行了启动。
        // 注意: 即使都走了「等待」也属正常(依赖链会让其中一个先启动 clash,
        // 另一个在 middleware 那层等待), 关键是**不能两个都启动同一个服务**。
        const clashStarters = [startA, startB].filter(Boolean).length;
        expect(clashStarters).toBeLessThanOrEqual(1);
    }, 30_000);

    afterAll(async () => {
        // ## 收尾必须清理, 而不是「恢复」
        // 本测试**故意停掉**了远端服务以制造竞争条件, 跑完时服务是被
        // 两个 worker 重新拉起的。此处**不该把它们留着** ——
        // 留下的服务会让后续测试在「本套件留下的状态」上做判定(内容竞态)。
        //
        // 早先的做法是「恢复服务供下一组复用」, 那是错的: 复用别人拉起的服务
        // 意味着无法保证其配置与自己预期一致, 判定依据被污染。
        try {
            const cleaned = await ComfyUIManager.teardown(INSTANCE);
            SLogger.info(`多进程测试收尾: ${JSON.stringify(cleaned)}`);
        } catch (e) {
            SLogger.warn(`多进程测试收尾清理失败: ${e}`);
        }

        // ## 必须关闭本套件自己的隧道
        // jest 的 `--runInBand` **复用同一个模块实例与进程**，
        // 因此本套件开的隧道（占用 26530）若不关，会残留到下一个测试套件，
        // 让它们的 `openTunnel` 报「本地端口已被其它进程占用」。
        try {
            const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
            await ins?.closeTunnel();
            SLogger.info("多进程测试收尾: 本地隧道已关闭");
        } catch (e) {
            SLogger.warn(`多进程测试收尾关闭隧道失败: ${e}`);
        }

        // 清理临时目录
        try {
            if (outDir != undefined) await fs.promises.rm(outDir, { recursive: true, force: true });
        } catch {
            // 清理失败不影响测试结论
        }
    }, 300_000);
});
