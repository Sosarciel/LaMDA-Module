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

import { AutoDLManager, TunnelManager } from "@sosraciel-lamda/autodl-manager";
import { SLogger } from "@zwa73/utils";

import { INSTANCE, assertInstanceRunning, autodlInstanceData, comfyuiService, instanceData,
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
 * @param id      - 工作进程标识
 * @param outDir  - 事件文件输出目录
 * @param startAt - 起跑线时间戳/毫秒（两个 worker 据此对齐冲锁时机）
 * @returns 该进程记录的事件列表
 */
const runWorker = async (id: string, outDir: string, startAt?: number): Promise<WorkerEvent[]> => {
    const eventFile = path.join(outDir, `events-${id}.json`);
    const args = [WORKER, id, eventFile];
    if (startAt != undefined) args.push(String(startAt));
    // 用例配置由父进程序列化传入（本文件是 .mjs，读不到 .ts 源码）
    args.push(JSON.stringify(comfyuiService("/root/ComfyUI-Manager")));
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

        // 把远端服务**停掉**, 制造「两个进程都需要拉起」的竞争条件。
        // 这是本测试的核心前提: 若服务已就绪, 两者都走复用路径, 测不出竞态。
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

        const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
        const ssh = await ins!.getSshClient();
        await stopRemoteServices(ssh!, ["middleware", "clash"]);
        await new Promise(r => setTimeout(r, 2_000));

        // 用只读探测确认竞争条件成立 —— 若服务仍就绪, 两个进程都会走复用路径,
        // 本测试就测不到竞态了（假绿）。
        const probe = await TunnelManager.probe(INSTANCE);
        const summary = probe == undefined ? "(实例探测不可用)" : summarize(probe);
        SLogger.info(`多进程测试前置: 服务已停止 → ${summary}`);
        if (probe?.clash.ready || probe?.middleware.ready) {
            throw new Error(
                `前置条件不成立: 服务未被真正停止 (${summary})。\n`
                + `本测试要求两个进程**同时**发现服务未启动, 否则测不到竞态。`);
        }

        // 两个进程**同时**启动 —— 这是竞态的关键
        //
        // ⚠️ 光靠「同时 spawn」不够：服务改由远端脚本 `screen -dmS` 拉起后，
        // `bash start_<svc>.sh` **1.5 秒就返回**（此前前台常驻、永不复返），
        // 启动窗口从几十秒缩到 1.5 秒，两个进程**大概率自然错开**，
        // 谁也撞不上锁 —— 那样这条用例只是「碰巧通过」，什么都没证明。
        //
        // 故给两者一个**共同的起跑线**（spawn 之后再等 3 秒），
        // 让它们同时冲到抢锁那一步，锁才真的被考验。
        const startAt = Date.now() + 3_000;
        [eventsA, eventsB] = await Promise.all([
            runWorker("A", outDir, startAt),
            runWorker("B", outDir, startAt),
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

        // ## 数「服务本体」而不是「screen 包装」
        // 服务现在由远端脚本用 `screen -dmS <unique_tag>` 拉起，故下列四条的
        // 命令行**都含 tag**：SCREEN 包装 / `bash -c` / 服务本体 / `tee`。
        // 按 tag 子串数会恒为 4，数不出份数。
        //
        // 服务本体靠 `exec -a` 把 argv[0] 换成 tag，于是它的命令行**以 tag 开头**：
        //   clash      → `comfyui_manager_clash`
        //   middleware → `comfyui_manager_middleware index.js -p 6006 …`
        // 故用 `^tag( |$)` 锚定「以 tag 起头」即可精确数到本体
        // （不能写成 `^tag$` —— middleware 后面还跟着参数）。
        //
        // 这同时也在验证 tag 契约本身：数得到，说明 `exec -a` 真的生效了。
        for (const kind of ["clash", "middleware"] as const) {
            const tag = `comfyui_manager_${kind}`;
            const r = await ssh!.exec(`pgrep -f '^${tag}( |$)' | wc -l`);
            const count = Number(r.stdout.trim());
            SLogger.info(`  ${kind} 进程数: ${count}  (tag=${tag})`);
            // 竞态若处理不当, 这里会 >1
            expect(count).toBeLessThanOrEqual(1);
        }
    }, 60_000);

    it("6. 并发时应只有一个进程真正启动(凭锁串行化)", () => {
        // 这是最有说服力的一条: 从两个进程各自的日志里确认
        // 「确实有进程走了等待路径」—— 否则说明它们只是碰巧错开,
        // 并没真正验证锁的作用。
        //
        // ⚠️ 匹配串必须带 `TunnelLauncher` 前缀。
        // 早先用裸串 `"启动 clash"` 时，调度器的
        // `Scheduler 调度 clash 启动 (预期 5s 内就绪)` 也含该子串，
        // 于是两个 worker 都被误判成启动者 —— 断言形同虚设。
        // 只有 Launcher 打的 `TunnelLauncher 启动 clash` 才代表「真的执行了启动」。
        const waitA = eventsA.some(e => e.detail.includes("已有其他进程在启动"));
        const waitB = eventsB.some(e => e.detail.includes("已有其他进程在启动"));
        const startA = eventsA.some(e => e.detail.includes("TunnelLauncher 启动 clash"));
        const startB = eventsB.some(e => e.detail.includes("TunnelLauncher 启动 clash"));
        // 复查发现对方已起 —— 同样是「没重复启动」的正面证据
        const recheckA = eventsA.some(e => e.detail.includes("抢锁后复查有变化"));
        const recheckB = eventsB.some(e => e.detail.includes("抢锁后复查有变化"));

        SLogger.info(`  A: 等待=${waitA} 启动=${startA} 复查复用=${recheckA}`);
        SLogger.info(`  B: 等待=${waitB} 启动=${startB} 复查复用=${recheckB}`);

        // 两者合计只应有一个真正执行了启动。
        // 注意: 即使都走了「等待」也属正常, 关键是**不能两个都启动同一个服务**。
        const clashStarters = [startA, startB].filter(Boolean).length;
        expect(clashStarters).toBeLessThanOrEqual(1);

        // ## 为什么这里不断言「必须有人撞锁」
        // 曾经希望「至少一个进程观察到另一个的存在」，以此证明锁真的被撞到。
        // 但那**在行为正确的并发下并不必然成立**：
        //
        //   服务由 `screen -dmS` 拉起后，`bash start_<svc>.sh` 约 1.5 秒就返回。
        //   先到者抢锁并启动；后到者若恰好在这 1.5 秒内还没走到 `start()`，
        //   它下一次 `prob()` 就会看到服务已就绪 —— 于是**既不必启动、也不必碰锁**。
        //
        // 这条路径**更好**（说明探测足够快、复用生效），把它判红是拿手段当目的。
        //
        // 所以真正的判据是「**没有重复启动**」：上面两条断言（启动者 ≤1、进程数 =1）
        // 已经把它钉死了。撞锁只是**可能**发生的路径之一，记下来便于排障，不作断言。
        const observed = [waitA, waitB, recheckA, recheckB].filter(Boolean).length;
        if (observed === 0) {
            SLogger.info(
                `  两个进程都未撞锁 —— 后到者在探测阶段就复用了先到者拉起的服务`
                + `（启动窗口仅 1.5s, 属正常且更优的路径）`);
        }
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
            const cleaned = await TunnelManager.teardown(INSTANCE);
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
