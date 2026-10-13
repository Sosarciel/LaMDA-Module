/** 依赖调度器测试
 *
 * ## 为什么这个测试以前写不出来
 * 指挥官指出调度逻辑与 `ensureServiceList` 强耦合导致难以测试：
 * > 这个依赖表的确有点复杂，如果和 ensureList 强耦合的话难以测试…
 * > 这样的话我们也可以直接对这个依赖解析器做测试，
 * > 测试其在复杂依赖下的可靠性
 *
 * 现在 `scheduleService` 只吃 `start`/`prob` 两个纯函数，
 * 于是可以拿假函数把**并发时序**测穿 —— 不需要 SSH、不需要真实例。
 *
 * ## 为什么本文件在 `Unit/AutoDL-Manager/` 而**不在** `Tunnel/` 下
 * 指挥官明确：
 * > Scheduler.ts 我挪到了顶层，因为它实际上是一个服务无关的 Promise 依赖解析器，
 * > 如果测试里有专门对他负责的比如复杂依赖解析测试那么也应该放到
 * > AutoDL-Manager/xxx 这边，不要往 Tunnel 塞
 *
 * 核对属实：`Scheduler.ts` 现在位于 `src/` 顶层，与 `Tunnel/`、`AutoDL/` 并列。
 * 它**连「服务」这个概念都不需要** —— `PromiseKind` 只是任意字符串键，
 * 换成一堆 Promise 任务同样成立。故它的测试也不该被塞进 Tunnel 的语义里。
 *
 * ## 测的是「本地调度逻辑」，不是远端软件
 * 依指挥官对测试主题的一贯要求 —— 断言的是**我们自己的调度器行为**：
 * 谁在等谁、谁与谁并发、失败怎么传播。
 */

import { Failed, Success, Terminated } from "@zwa73/utils";
import type { PromiseStatus } from "@zwa73/utils";
import { scheduleService, validateDeps, expandDeps } from "@sosraciel-lamda/autodl-manager";
import type { ServiceFunc, ServiceFuncTable } from "@sosraciel-lamda/autodl-manager";

/** 造一个可控的假服务
 *
 * @param opt.readyAfterTries - start 之后第几次 prob 返回 Success（默认 1 = 起完即就绪）
 * @param opt.log             - 事件记录数组
 * @param opt.name            - 服务名（写日志用）
 * @param opt.startMs         - start 耗时
 * @param opt.failForever     - 一直 Failed（模拟起不来）
 * @param opt.terminated      - prob 直接返回 Terminated
 * @param opt.expectReadySec  - 预期启动耗时（秒），缺省 10（测试里的假服务都很快）
 * @param opt.pollIntervalMs  - 轮询间隔（毫秒），缺省 10
 *
 * ⚠️ `readyAfterTries` 缺省是 **1** 而非 0 —— 0 表示「一开始就就绪」，
 * 那会让调度器**跳过 start**（这正是 case 6 验证的行为），
 * 于是其余用例里根本不会有 `start` 事件，断言全部落空。
 */
const fakeService = (opt: {
    name: string;
    log: string[];
    readyAfterTries?: number;
    startMs?: number;
    failForever?: boolean;
    terminated?: boolean;
    deps?: string[];
    expectReadySec?: number;
    pollIntervalMs?: number;
}) => {
    const {
        name, log, readyAfterTries = 1,
        startMs = 0, failForever = false, terminated = false, deps,
        expectReadySec = 10, pollIntervalMs = 10,
    } = opt;
    let tries = 0;
    let started = false;

    return {
        deps,
        expectReadySec,
        pollIntervalMs,
        start: async () => {
            log.push(`${name}:start`);
            if (startMs > 0) await new Promise(r => setTimeout(r, startMs));
            started = true;
            log.push(`${name}:started`);
        },
        prob: async () => {
            if (terminated) return Terminated;
            if (failForever) return Failed;
            // 未 start 过时永远未就绪 —— 这样「跳过 start」只可能发生在
            // 显式传 readyAfterTries: 0 的用例里
            if (!started) return Failed;
            tries++;
            return tries >= readyAfterTries ? Success : Failed;
        },
    };
};

describe("依赖调度器", () => {

    it("1. 无依赖的服务应并发启动, 而非串行", async () => {
        // 三个互不依赖的服务, 各耗时 200ms。
        // 并发 => 总耗时约 200ms; 串行 => 约 600ms。
        const log: string[] = [];
        const t0 = Date.now();
        const res = await scheduleService({
            a: fakeService({ name: "a", log, startMs: 200 }),
            b: fakeService({ name: "b", log, startMs: 200 }),
            c: fakeService({ name: "c", log, startMs: 200 }),
        });
        const elapsed = Date.now() - t0;

        expect(Object.values(res).every(r => r.ready)).toBe(true);
        // 三个 start 应当在任何一个 started 之前全部发出 —— 这正是并发的证据
        const startIdx = ["a:start", "b:start", "c:start"].map(e => log.indexOf(e));
        const startedIdx = ["a:started", "b:started", "c:started"].map(e => log.indexOf(e));
        expect(Math.max(...startIdx)).toBeLessThan(Math.min(...startedIdx));
        // 真正的串行会是 600ms+, 给足余量只断言「明显小于串行」
        expect(elapsed).toBeLessThan(500);
    }, 20_000);

    it("2. 有依赖者应等前置就绪, 且**不等无关服务**（指挥官的核心用例）", async () => {
        // 复刻真实拓扑: clash 与 middleware 无依赖(并发),
        // comfyui 只依赖 clash —— 它不应等 middleware。
        //
        // 时序设计: clash 快(50ms), middleware 慢(400ms), comfyui 依赖 clash。
        // 若 comfyui 错等了 middleware, 它的 start 必然晚于 middleware:started。
        const log: string[] = [];
        const res = await scheduleService({
            clash: fakeService({ name: "clash", log, startMs: 50 }),
            middleware: fakeService({ name: "middleware", log, startMs: 400 }),
            comfyui: fakeService({ name: "comfyui", log, deps: ["clash"] }),
        });

        expect(Object.values(res).every(r => r.ready)).toBe(true);

        const clashStarted = log.indexOf("clash:started");
        const midStarted = log.indexOf("middleware:started");
        const comfyStart = log.indexOf("comfyui:start");

        expect(clashStarted).toBeGreaterThanOrEqual(0);
        expect(midStarted).toBeGreaterThanOrEqual(0);
        // comfyui 必须在 clash 就绪之后
        expect(comfyStart).toBeGreaterThan(clashStarted);
        // **且不必等 middleware** —— 这是本设计的全部意义
        expect(comfyStart).toBeLessThan(midStarted);
    }, 20_000);

    it("3. 传递依赖应被展开: 祖先未就绪时孙辈也不启动", async () => {
        // a → b → c, 依赖是传递的
        const log: string[] = [];
        const res = await scheduleService({
            a: fakeService({ name: "a", log }),
            b: fakeService({ name: "b", log, deps: ["a"] }),
            c: fakeService({ name: "c", log, deps: ["b"] }),
        });

        expect(Object.values(res).every(r => r.ready)).toBe(true);
        expect(log.indexOf("b:start")).toBeGreaterThan(log.indexOf("a:start"));
        expect(log.indexOf("c:start")).toBeGreaterThan(log.indexOf("b:start"));
    }, 20_000);

    it("4. 前置起不来时, 下游应被标为 skipped 且**不调用其 start**", async () => {
        const log: string[] = [];
        // 给 a 一个 1 秒的小预算 —— 它必然失败, 但测试不必为此等 10 秒
        const res = await scheduleService({
            a: fakeService({ name: "a", log, failForever: true, expectReadySec: 1 }),
            b: fakeService({ name: "b", log, deps: ["a"] }),
            // 无关服务不受影响, 仍应成功
            z: fakeService({ name: "z", log }),
        });

        expect(res.a!.ready).toBe(false);
        expect(res.b!.ready).toBe(false);
        // 关键: 区分「跳过」与「启动了但失败」
        expect(res.b!.skipped).toBe(true);
        expect(res.a!.skipped).toBe(false);
        // 下游的 start **根本不该被调用** —— 那只会白等一轮超时
        expect(log).not.toContain("b:start");
        // 无关服务照常就绪
        expect(res.z!.ready).toBe(true);
    }, 20_000);

    it("5. prob 返回 Terminated 应立即判死, 不等满 expect_ready_sec", async () => {
        // 这是三态设计的核心收益: 「脚本不存在」这类硬错误不必干等超时。
        const log: string[] = [];
        const t0 = Date.now();
        const res = await scheduleService({
            // 给 30 秒预算, 但 Terminated 应当让它立刻返回
            a: fakeService({ name: "a", log, terminated: true, expectReadySec: 30 }),
        });
        const elapsed = Date.now() - t0;

        expect(res.a!.ready).toBe(false);
        expect(elapsed).toBeLessThan(5_000);
    }, 20_000);

    it("6. 已在运行的服务应跳过启动（幂等）", async () => {
        // 模拟「服务其实已经跑着」—— 此时 prob 一开始就 Success, 不该调 start。
        // 这正是「另一个进程刚拉起」或「上次没停干净」时的期待行为:
        // 重启 ComfyUI 要从头加载一遍, 反而更慢。
        const log: string[] = [];
        // 显式标注 prob 的返回类型 —— `Success` 是 Symbol,
        // 不标注会被推成 `Promise<symbol>` 而不匹配 `PromiseStatus` 联合
        const alreadyRunning: ServiceFunc = {
            start: async () => { log.push("a:start"); },
            prob: async (): Promise<PromiseStatus> => Success,
        };
        const res = await scheduleService({ a: alreadyRunning });

        expect(res.a!.ready).toBe(true);
        expect(log).not.toContain("a:start");
    }, 20_000);

    it("7. 启动需要多轮探测才能就绪时, 应持续轮询直到成功", async () => {
        // 模拟 ComfyUI: start 后要探好几次才就绪
        const log: string[] = [];
        const res = await scheduleService({
            slow: fakeService({ name: "slow", log, startMs: 30, readyAfterTries: 3 }),
        });

        expect(res.slow!.ready).toBe(true);
    }, 20_000);

    it("8. 超过预期启动时间应判失败", async () => {
        const log: string[] = [];
        const res = await scheduleService({
            // 1 秒预算内一直 Failed => 必须判失败
            stuck: fakeService({
                name: "stuck", log, startMs: 10,
                failForever: true, expectReadySec: 1,
            }),
        });

        expect(res.stuck!.ready).toBe(false);
        // 它是「启动了但没成就」, 而不是「被前置拖累跳过」
        expect(res.stuck!.skipped).toBe(false);
    }, 20_000);

    it("9. 依赖成环应在调度前抛错（否则会永远等下去）", async () => {
        const log: string[] = [];
        await expect(scheduleService({
            a: fakeService({ name: "a", log, deps: ["b"] }),
            b: fakeService({ name: "b", log, deps: ["a"] }),
        })).rejects.toThrow(/环/);
    }, 20_000);

    it("10. 自依赖与悬空引用也应被检出", async () => {
        const log: string[] = [];
        await expect(scheduleService({
            a: fakeService({ name: "a", log, deps: ["a"] }),
        })).rejects.toThrow(/依赖了自己/);

        await expect(scheduleService({
            a: fakeService({ name: "a", log, deps: ["nonexistent"] }),
        })).rejects.toThrow(/不存在的服务/);
    }, 20_000);

    it("11. validateDeps 对合法表不抛错, expandDeps 能展开传递依赖", () => {
        const log: string[] = [];
        const table: ServiceFuncTable = {
            a: fakeService({ name: "a", log }),
            b: fakeService({ name: "b", log, deps: ["a"] }),
            c: fakeService({ name: "c", log, deps: ["b"] }),
        };
        expect(() => validateDeps(table)).not.toThrow();
        // c 的全部前置是 a 与 b
        expect([...expandDeps(table, "c")].sort()).toEqual(["a", "b"]);
        expect([...expandDeps(table, "a")]).toEqual([]);
    });

    it("12. 菱形依赖: 汇聚点应等齐两条分支, 但两条分支彼此并发", async () => {
        //   a
        //  / \
        // b   c
        //  \ /
        //   d
        const log: string[] = [];
        const t0 = Date.now();
        const res = await scheduleService({
            a: fakeService({ name: "a", log, startMs: 50 }),
            b: fakeService({ name: "b", log, startMs: 200, deps: ["a"] }),
            c: fakeService({ name: "c", log, startMs: 200, deps: ["a"] }),
            d: fakeService({ name: "d", log, deps: ["b", "c"] }),
        });
        const elapsed = Date.now() - t0;

        expect(Object.values(res).every(r => r.ready)).toBe(true);
        // b、c 都在 a 之后就绪
        expect(log.indexOf("b:start")).toBeGreaterThan(log.indexOf("a:started"));
        expect(log.indexOf("c:start")).toBeGreaterThan(log.indexOf("a:started"));
        // d 必须在 b、c 都就绪之后
        const dStart = log.indexOf("d:start");
        expect(dStart).toBeGreaterThan(log.indexOf("b:started"));
        expect(dStart).toBeGreaterThan(log.indexOf("c:started"));
        // b 与 c 并发 => 总计约 50+200+探测, 而非 50+200+200
        expect(elapsed).toBeLessThan(600);
    }, 20_000);
});
