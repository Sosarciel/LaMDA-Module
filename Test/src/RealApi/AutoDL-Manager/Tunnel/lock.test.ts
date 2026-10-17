/** Tunnel 服务启动锁（撞锁行为）
 *
 * ## 为什么单独成篇
 * 锁一旦失效，后果是**服务被起成两份** —— 端口冲突、显存翻倍、
 * `Address already in use`，是这个模块最贵的故障。
 * 而并发用例**无法保证撞锁**：启动窗口太短，两个进程大概率自然错开，
 * 锁压根没被考验。故这里两条路并用：
 * - **慢服务**造出真实的撞锁窗口（服务启动要 6 秒，后到者必然赶上）
 * - **预置锁**确定性地构造「他人正持锁」状态（不赌任何时序）
 *
 * ## 被测的行为
 * | 场景 | 期望 |
 * |------|------|
 * | 锁被他人持有 | **不启动**，交给调度器探测等待 |
 * | 锁陈旧（>300s） | 被清理并**成功接管**（持锁者已崩溃） |
 * | 正常启动 | 成功拉起，且 `finally` **释放**锁 |
 * | 脚本目录不存在 | **不建目录**，如实报错（配置错误不该被静默掩盖） |
 *
 * ## 为什么可以直接操作 `.locks`
 * 锁由**远端文件系统**承载（`mkdir` 原子性），本就不依赖进程间通讯 ——
 * 因此外部预置一个锁目录，**就是**「另一个进程正持锁」这个状态本身。
 *
 * ## 全部基于测试自备的假服务
 * 不碰 ComfyUI 镜像：服务是 `python3 -m http.server`，
 * 部署到 `/root/akaset_test_tunnel`，跑完删掉。
 */

import { AutoDLManager, TunnelManager } from "@sosraciel-lamda/autodl-manager";
import { SLogger } from "@zwa73/utils";

import { FIXTURE_DIR, FIXTURE_PORT, FIXTURE_TAG } from "./fixture";
import { cleanupFixtures, deployFixtures, stopFixture } from "./fixtureSetup";
import { autodlInstanceData, assertInstanceRunning } from "./Util";

/** 实例未运行时在模块加载阶段抛错, 让整个测试集直接失败 */
assertInstanceRunning("lock.test.ts");

/** AutoDL 侧实例名 */
const HOST_INSTANCE = "AutoDLHost";
/** Tunnel 侧实例名 */
const INSTANCE = "FixtureLock";

/** 一个**故意不存在**的脚本目录，用来验证配置写错时的行为
 *
 * ⚠️ 它必须是**独立的 Tunnel 实例**而不能复用 {@link INSTANCE}：
 * 同一个实例的 `script_dir` 只声明一次，改它就等于改了整套前置条件。
 */
const BOGUS_INSTANCE = "FixtureBogus";
/** 那个不存在的脚本目录 */
const BOGUS_DIR = "/root/NoSuchManagerDir_ShouldNotBeCreated";

/** 超时上限/毫秒 */
const TIMEOUT = {
    setup: 120_000,
    api: 60_000,
    launch: 180_000,
};

/** 假服务在测试里的两个角色
 * - `fast` 立即监听，用来测「正常启动 / 释放锁」
 * - `slow` 启动后先睡 6 秒才监听，用来**造出撞锁窗口**
 */
const FAST = "fast";
const SLOW = "slow";

/** 测试用的服务配置 —— 完全指向自备假服务
 *
 * 与服务无关的机制（锁、调度、探测）在这里被完整覆盖，
 * 而模块层**不知道**服务是 http.server 还是 ComfyUI。
 */
const fixtureService = () => ({
    [FAST]: {
        start: `${FIXTURE_DIR}/start_fast.sh`,
        probe: `${FIXTURE_DIR}/probe_fast.sh`,
        log: `${FIXTURE_DIR}/log_fast.sh`,
        unique_tag: FIXTURE_TAG.fast,
        expect_ready_sec: 15,
        poll_interval_ms: 300,
    },
    [SLOW]: {
        start: `${FIXTURE_DIR}/start_slow.sh`,
        probe: `${FIXTURE_DIR}/probe_slow.sh`,
        log: `${FIXTURE_DIR}/log_slow.sh`,
        unique_tag: FIXTURE_TAG.slow,
        // 慢服务要 6 秒才监听, 给足预期时长
        expect_ready_sec: 30,
        poll_interval_ms: 300,
    },
});

/** 「脚本目录不存在」用例专用的服务配置
 * #region
 * ## ⚠️ 为什么必须用**不同的** `unique_tag`
 * 探测的判据是「按 tag 找到进程」。若沿用 {@link fixtureService} 的 tag，
 * 而前几条用例已经把那个服务拉起来了，那么 `ensureReady` 一探测就发现
 * 「已就绪」→ **直接返回 true，压根走不到 `tryAcquireLock`**，
 * 于是「脚本目录不存在」这条根本测不到（实测踩到：用例 1618ms 就失败，
 * 拿到的是 `true` 而非 `false`）。
 *
 * 故这里给一组**永远不会活着**的 tag，强制流程走到 `start`
 * → `tryAcquireLock` → 远端目录不存在 → `NO_SCRIPT_DIR`。
 *
 * ## 不带 `probe`
 * 不配探测脚本时 `ready` 直接等于 `alive`，而 `alive` 恒为 false ——
 * 正是我们要的「永远不会自己变成就绪」。
 *
 * `expect_ready_sec` 压到 3 秒：本用例等的是**预期失败**，不该按常规服务等 15 秒。
 * #endregion
 */
const bogusService = () => ({
    [FAST]: {
        start: `${BOGUS_DIR}/start_fast.sh`,
        unique_tag: "akaset_test_bogus_fast",
        expect_ready_sec: 3,
        poll_interval_ms: 300,
    },
});

/** 锁目录（与模块 `lockPath` 的拼法一致：`<scriptDir>/.locks/<kind>.lock`） */
const lockDirOf = (kind: string): string => `${FIXTURE_DIR}/.locks/${kind}.lock`;

describe("Tunnel 服务启动锁", () => {

    beforeAll(async () => {
        AutoDLManager.initInject({
            // 预期实例已启动, 绝不应对真实实例开关机
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
            // ## 两个实例**一次性**注册完
            // `UtilFunc.createInjectable` 只认第一次 `initInject`，
            // 之后再调会被静默跳过（只留一条 warn）。早先用例 5 里单独
            // 又调一次注册 `Bogus`，其实**从未生效** —— 于是那条用例拿到的
            // `false` 来自「实例不存在」而非「脚本目录不存在」，
            // 断言碰巧成立但推理链是断的。故这里把两者一并登记。
            serviceTable: {
                instance_table: {
                    [INSTANCE]: {
                        type: "TunnelInstance",
                        name: INSTANCE,
                        data: {
                            autodl_instance: HOST_INSTANCE,
                            script_dir: FIXTURE_DIR,
                            service: fixtureService(),
                        },
                    },
                    [BOGUS_INSTANCE]: {
                        type: "TunnelInstance",
                        name: BOGUS_INSTANCE,
                        data: {
                            autodl_instance: HOST_INSTANCE,
                            script_dir: BOGUS_DIR,
                            service: bogusService(),
                        },
                    },
                },
            },
        });
        await TunnelManager.sm.inited;
    }, TIMEOUT.setup);

    afterAll(async () => {
        // ## 必须先关隧道再清服务
        // jest 的 `--runInBand` / `maxWorkers:1` 让所有套件**共用同一进程与端口空间**。
        // 本套件 `ensureReady` 会开隧道占用本地端口，若不关，
        // 下一个套件的 `openTunnel` 就会撞上「本地端口已被其它进程占用」，
        // 建成失败 → `probe` 返回 undefined → 表现为「服务不可用」的假失败。
        // 实测踩到：26531 被本套件占着，`tunnel-hosting` 随即整组崩。
        try {
            const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
            const ssh = await ins?.getSshClient();
            if (ssh != undefined) await cleanupFixtures(ssh);
            await ins?.closeTunnel();
        } catch (e) {
            // 收尾失败不该让测试变红 —— 用例本身已断言完毕
            SLogger.warn(`锁测试收尾失败: ${e}`);
        }
    }, TIMEOUT.api);

    /** 取 SSH 客户端（各用例都要用） */
    const getSsh = async () => {
        const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
        return (await ins!.getSshClient())!;
    };

    it("1. 锁被他人持有时, 不应启动服务(交给探测等待)", async () => {
        const ssh = await getSsh();
        const lock = lockDirOf(FAST);

        // 先确保服务没在跑, 否则会走「探测已就绪」的短路, 根本到不了锁
        await stopFixture({ ssh, kind: FAST });

        // **预置锁** = 「另一个进程正在启动它」。给一个足够新的时间戳,
        // 免得被判为陈旧锁直接接管（那是用例 2 的事）。
        await ssh.exec(`mkdir -p '${lock}' && date +%s > '${lock}/ts' && echo SET`);

        const before = await ssh.exec(
            `test -d '${lock}' && echo LOCK_PRESENT || echo LOCK_GONE`);
        expect(before.stdout).toContain("LOCK_PRESENT");

        // 此刻 ensureReady 应当**抢不到锁** → 不启动 → 由 Scheduler 轮询探测。
        // 服务始终不会被拉起（没人真的在启动它），故最终必然超时返回 false。
        // ⚠️ 超时设小一些（12 秒）—— 这是**故意等失败**，不是等成功。
        const ok = await TunnelManager.ensureReady({
            instanceName: INSTANCE,
            require: [FAST],
            timeoutSec: 12,
        });
        expect(ok).toBe(false);

        // 关键判据：服务**没有**被这个进程启动起来
        const n = await ssh.exec(`screen -ls 2>/dev/null | grep -c '[.]${FIXTURE_TAG.fast}[[:space:]]'`);
        expect(Number(n.stdout.trim())).toBe(0);

        // 锁仍在原地 —— 我们抢不到, 也就无权删它
        const after = await ssh.exec(
            `test -d '${lock}' && echo LOCK_PRESENT || echo LOCK_GONE`);
        expect(after.stdout).toContain("LOCK_PRESENT");

        SLogger.info(`  锁被占时未启动服务, 且未误删他人的锁`);
    }, TIMEOUT.launch);

    it("2. 陈旧锁应被清理并成功接管(持锁者已崩溃)", async () => {
        const ssh = await getSsh();
        const lock = lockDirOf(FAST);

        await stopFixture({ ssh, kind: FAST });

        // 预置一个**陈旧**锁：时间戳设在 400 秒前（阈值是 300 秒）。
        // 这正是「持锁进程崩溃、锁没人释放」的真实形态。
        const stale = Math.floor(Date.now() / 1000) - 400;
        await ssh.exec(`mkdir -p '${lock}' && echo ${stale} > '${lock}/ts' && echo SET`);

        const ok = await TunnelManager.ensureReady({
            instanceName: INSTANCE,
            require: [FAST],
            timeoutSec: 60,
        });
        expect(ok).toBe(true);

        // 服务确实起来了, 且真的能服务请求
        const n = await ssh.exec(`screen -ls 2>/dev/null | grep -c '[.]${FIXTURE_TAG.fast}[[:space:]]'`);
        expect(Number(n.stdout.trim())).toBe(1);
        const probe = await ssh.exec(`bash '${FIXTURE_DIR}/probe_fast.sh' && echo UP || echo DOWN`);
        expect(probe.stdout).toContain("UP");

        SLogger.info(`  陈旧锁已被清理, 服务正常接管启动`);
    }, TIMEOUT.launch);

    it("3. 正常启动后应释放锁(不把锁留给后来者)", async () => {
        const ssh = await getSsh();
        const lock = lockDirOf(SLOW);

        await stopFixture({ ssh, kind: SLOW });
        await ssh.exec(`rm -rf '${lock}'`);

        const ok = await TunnelManager.ensureReady({
            instanceName: INSTANCE,
            require: [SLOW],
            timeoutSec: 90,
        });
        expect(ok).toBe(true);

        // ⚠️ `finally` 里 releaseLock —— 锁不该残留。
        // 残留会让**后续每次启动**都白等 LOCK_STALE_SEC (300s)。
        const r = await ssh.exec(
            `test -d '${lock}' && echo STILL_LOCKED || echo RELEASED`);
        expect(r.stdout).toContain("RELEASED");

        SLogger.info(`  启动完成后锁已释放`);
    }, TIMEOUT.launch);

    it("4. 慢服务启动期间, 应能被探测为「进程在但未就绪」", async () => {
        const ssh = await getSsh();

        await stopFixture({ ssh, kind: SLOW });
        // 锁也要清 —— 上一个用例正常启动后已释放, 但保险起见
        await ssh.exec(`rm -rf '${lockDirOf(SLOW)}'`);

        // 只下发启动, 不等它就绪 —— 直接去看那 6 秒窗口里的状态
        const startP = TunnelManager.ensureReady({
            instanceName: INSTANCE,
            require: [SLOW],
            timeoutSec: 90,
        });

        // ## 轮询等「会话已建」, 而不是死等固定秒数
        // `ensureReady` 内部要先探测、抢锁、再下发脚本，这一串的耗时
        // 会随远端负载浮动。写死「等 2 秒」在串行跑整个套件时就不够 ——
        // 实测会拿到 elapsed 0，会话还没建出来。
        // 故这里以**可观测的最终状态**为判据：会话出现即进入窗口。
        const tag = FIXTURE_TAG.slow;
        let sessions = 0;
        for (let i = 0; i < 40; i++) {
            const r = await ssh.exec(
                `screen -ls 2>/dev/null | grep -c '[.]${tag}[[:space:]]'`);
            sessions = Number(r.stdout.trim());
            if (sessions >= 1) break;
            await new Promise(r2 => setTimeout(r2, 250));
        }
        expect(sessions).toBeGreaterThanOrEqual(1);

        // 此刻慢服务**进程已起、端口未开**（它在 sleep 阶段）
        const probeOut = await ssh.exec(`bash '${FIXTURE_DIR}/probe_slow.sh' && echo UP || echo DOWN`);

        SLogger.info(`  慢服务窗口内: 会话=${sessions} probe=${probeOut.stdout.trim()}`
            + `（正是 ComfyUI 慢启动的形态）`);
        // ⚠️ 若此刻已 UP，说明 6 秒窗口已经过去（时序太晚），
        // 那就失去了意义 —— 但那是**环境太慢**导致的，应判红而非静默放过。
        expect(probeOut.stdout).toContain("DOWN");

        // 收尾：等它真正就绪
        await expect(startP).resolves.toBe(true);
    }, TIMEOUT.launch);

    it("5. 脚本目录不存在时应如实报错, 且不擅自建目录", async () => {
        const ssh = await getSsh();

        await ssh.exec(`rm -rf '${BOGUS_DIR}'`);

        // ## 先确认实例**真的在册**
        // 这是本用例成立的前提：若 `FixtureBogus` 没注册上，
        // `ensureReady` 会因「实例不存在」返回 false —— 与脚本目录无关，
        // 断言就变成了假绿。故这里显式断言它确实被 ServiceManager 管着。
        const names = await TunnelManager.listInstances();
        expect(names).toContain(BOGUS_INSTANCE);

        const bogusIns = await TunnelManager.getInstance(BOGUS_INSTANCE);
        expect(bogusIns).toBeDefined();
        expect(bogusIns!.getData().script_dir).toBe(BOGUS_DIR);

        const ok = await TunnelManager.ensureReady({
            instanceName: BOGUS_INSTANCE,
            require: [FAST],
            timeoutSec: 30,
        });
        expect(ok).toBe(false);

        // ⚠️ 不能因为 `mkdir -p $(dirname ...)` 就把脚本目录"顺手"建出来 ——
        // 那会把「目录指错了」这件配置错误掩盖成「脚本找不到」。
        const r = await ssh.exec(
            `test -d '${BOGUS_DIR}' && echo CREATED || echo NOT_CREATED`);
        expect(r.stdout).toContain("NOT_CREATED");

        // 也**不该有任何进程**被拉起 —— 脚本都不存在，无从拉起。
        // 这里用 bogus 自己的 tag（永不会活着），故 0 是确定的，
        // 不受前面用例是否起过 fast 影响。
        const n = await ssh.exec(
            `screen -ls 2>/dev/null | grep -c '[.]akaset_test_bogus[[:space:]]'`);
        expect(Number(n.stdout.trim())).toBe(0);

        SLogger.info(`  脚本目录不存在时如实失败, 未擅自建目录, 也未拉起任何进程`);
    }, TIMEOUT.launch);
});
