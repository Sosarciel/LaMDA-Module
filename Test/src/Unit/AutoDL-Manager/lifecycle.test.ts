/** 生命周期注册文件的读取语义测试
 *
 * ## 为什么必须有这个测试
 * `readLifecycle` 的结论**直接决定「要不要关掉云实例」**。
 * 它把结局分成三种，而三者的后果完全不同：
 * - `ok`      —— 读到记录，按 pid / 过期时间判归属
 * - `missing` —— 确认没有文件 = **无人认领** → 守护循环会关机
 * - `fail`    —— 没能确认 = **状态未知** → 守护循环**不关**，等下一轮
 *
 * 曾把后两者揉成一个 `undefined`，于是这条链**关掉了正在生图的实例**
 * （指挥官实测，2026-10-16，两 session 同时 genimage）：
 * ```
 * 某条 SSH 命令失败 → `_withRetry` 的 `_onDisconnect()` → conn.end() 掐掉整条连接
 *   → 并发的 readLifecycle 拿到**空 stdout**
 *   → 旧代码当成「无注册文件」→ 守护循环判定「无人认领」→ 关机
 * ```
 * 日志实据：
 * ```
 * [07:05:59] 生命周期注册: pid=73020 预期关闭 07:15:58   ← 写入成功
 * [07:07:01] 生命周期注册: pid=73020 预期关闭 07:17:00   ← 又走「注册」分支, 说明没读到
 * [07:07:32] 守护判定: 无有效注册文件且已启动 351s ≥ 300s, 关闭
 * ```
 *
 * 故这里把契约边界全部钉死 —— 纯判断逻辑，不需要 SSH、不需要真实例。
 */

import { Lifecycle } from "@sosraciel-lamda/autodl-manager";

// 生命周期工具集是按 namespace 导出的；测试里平铺开，让断言读起来干净
const {
    buildWriteCommand, readLifecycle, renewLifecycle, shouldShutdownByLoop, WRITE_MARGIN_SEC,
} = Lifecycle;

/** 造一个只实现 `exec` 的假 SSH 客户端
 *
 * `readLifecycle` 只用到 `exec`，故无需构造完整 SshClient。
 * `responses` 按调用顺序出队 —— 它最多调两次（先 `cat`，内容合法时再 `date -d`）。
 */
const fakeSsh = (responses: string[]): { exec: (cmd: string) => Promise<unknown> } => {
    let i = 0;
    return {
        exec: async () => {
            const stdout = responses[i] ?? "";
            i++;
            return { stdout, stderr: "", code: 0, signal: null };
        },
    };
};

/** 造一个「exec 直接抛错」的假客户端（模拟连接被掐） */
const throwingSsh = (): { exec: (cmd: string) => Promise<unknown> } => ({
    exec: async () => { throw new Error("connect ECONNREFUSED"); },
});

const asSsh = (obj: { exec: (cmd: string) => Promise<unknown> }) =>
    obj as unknown as Parameters<typeof readLifecycle>[0];

describe("readLifecycle 的三种结局", () => {
    it("1. 哨兵 __NO_FILE__ → missing（确认无文件）", async () => {
        const r = await readLifecycle(asSsh(fakeSsh(["__NO_FILE__"])));
        expect(r.state).toBe("missing");
    });

    it("2. 合法内容 → ok，解析出 pid 与过期时刻", async () => {
        const r = await readLifecycle(asSsh(fakeSsh([
            "73020\n2026-10-16 07:17:00\n", "1770000000",
        ])));
        expect(r).toEqual({
            state: "ok",
            record: { pid: 73020, expire_at: 1770000000, expire_text: "2026-10-16 07:17:00" },
        });
    });

    it("3. **空输出必须是 fail, 不能是 missing**", async () => {
        // ★ 本测试的核心。空 stdout 意味着命令没跑成（连接被掐 / channel 中断），
        // 而不是「文件不存在」—— 旧代码把它当 missing，于是关掉了正在生图的实例。
        const r = await readLifecycle(asSsh(fakeSsh([""])));
        expect(r.state).toBe("fail");
    });

    it("4. 只有空白字符同样判 fail", async () => {
        const r = await readLifecycle(asSsh(fakeSsh(["   \n  \n"])));
        expect(r.state).toBe("fail");
    });

    it("5. exec 抛错 → fail（不向外抛，用状态表达）", async () => {
        const r = await readLifecycle(asSsh(throwingSsh()));
        expect(r.state).toBe("fail");
        if (r.state === "fail") expect(r.reason).toMatch(/ECONNREFUSED/);
    });

    it("6. 行数不足 → fail，且理由含原文", async () => {
        const r = await readLifecycle(asSsh(fakeSsh(["73020"])));
        expect(r.state).toBe("fail");
        if (r.state === "fail") expect(r.reason).toMatch(/行数不足/);
    });

    it("7. pid 非法 → fail", async () => {
        const r = await readLifecycle(asSsh(fakeSsh(["notanumber\n2026-10-16 07:17:00\n"])));
        expect(r.state).toBe("fail");
    });

    it("8. 时间无法解析 → fail", async () => {
        const r = await readLifecycle(asSsh(fakeSsh(["73020\n不是时间\n", "__PARSE_FAIL__"])));
        expect(r.state).toBe("fail");
    });
});

describe("shouldShutdownByLoop 对三种结局的处理", () => {
    /** 造一个**按命令内容**回答的假 ssh
     *
     * ⚠️ 不能用「按调用顺序出队」的假 ssh —— `getContainerUptime` 内部是
     * `Promise.all([getContainerStartTime, getRemoteNow])`，两条命令**并发发出**，
     * 顺序不确定，按序出队会随机错配（实测踩到）。
     *
     * 故改成认命令内容：
     * - `stat -c %Y /proc/1` → 容器启动时刻
     * - `cat ... 注册文件`    → 样例内容
     * - `date +%s`           → 当前时刻
     * - `date -d ...`        → 把注册里的时间解析成 epoch
     */
    const mkSsh = (param: {
        /** `cat 注册文件` 的输出 */
        reg: string;
        /** 容器启动时刻（epoch 秒）；越小则 uptime 越大 */
        startSec: number;
        /** 当前时刻（epoch 秒） */
        nowSec: number;
        /** `date -d <注册里的时间>` 解析出的 epoch；缺省给 2100 年（未过期） */
        expireEpoch?: number;
    }) => {
        const { reg, startSec, nowSec, expireEpoch = 4102444800 } = param;
        return asSsh({
            exec: async (cmd: string) => {
                let stdout = "";
                if (cmd.includes("/proc/1")) stdout = `${startSec}\n`;
                else if (cmd.includes("__NO_FILE__")) stdout = reg;
                else if (cmd.startsWith("date -d")) stdout = `${expireEpoch}\n`;
                else if (cmd.includes("date +%s")) stdout = `${nowSec}\n`;
                return { stdout, stderr: "", code: 0, signal: null };
            },
        });
    };
    /** 启动已久（uptime 远超阈值） */
    const overIdleSsh = (reg: string) =>
        mkSsh({ reg, startSec: 1770000000, nowSec: 1770000000 + 10_000 });
    /** **刚启动**（uptime 不足阈值） */
    const freshSsh = (reg: string) =>
        mkSsh({ reg, startSec: 1770000600 - 30, nowSec: 1770000600 });

    it("1. 读取失败时**同样关机** —— 读不到就是没有证据表明有人在守护", async () => {
        // 指挥官裁定：
        // > 没文件 读不出 所有读失败的情况 `就是` 应该关机，这有什么错？
        // 确实没错：读不出来时我们**没有任何证据**表明有别人在守护，
        // 而放过的代价是实例持续计费。
        const v = await shouldShutdownByLoop(overIdleSsh(""), 300);
        expect(v.shutdown).toBe(true);
        expect(v.reason).toMatch(/读取失败/);
    });

    it("2. 读取失败时理由含原始错误, 便于排查", async () => {
        const v = await shouldShutdownByLoop(overIdleSsh(""), 300);
        expect(v.reason).toMatch(/未返回任何输出/);
    });

    it("3. 确认无注册文件时**同样关机**", async () => {
        const v = await shouldShutdownByLoop(overIdleSsh("__NO_FILE__"), 300);
        expect(v.shutdown).toBe(true);
        expect(v.reason).toMatch(/无注册文件/);
    });

    it("3b. **读不到时判定结果要带 `readFailed`** —— 调用方据此计数", async () => {
        // 指挥官定：
        // > 我们弄个失败计数器，如果连续3次读失败，再关机，
        // > 这样可以防止一些链接抖动导致误关
        //
        // 计数是**跨轮次**状态，属于驱动层；判定函数只负责如实标记
        // 「这一轮的结论是因为读不到而得出」。
        const vFail = await shouldShutdownByLoop(overIdleSsh(""), 300);
        expect(vFail.readFailed).toBe(true);

        const vMissing = await shouldShutdownByLoop(overIdleSsh("__NO_FILE__"), 300);
        expect(vMissing.readFailed).toBe(true);
    });

    it("3c. **注册真过期时不带 `readFailed`** —— 那不该被计数器容忍", async () => {
        // 关键区分：容忍只针对「读不到」（可能是链路抖动），
        // 而「确实过期了」是明确事实，必须立即关 —— 不能被计数器拖成 3 轮。
        const now = 1770000000 + 10_000;
        const v = await shouldShutdownByLoop(
            mkSsh({
                reg: "73020\n2026-10-16 08:00:00\n",
                startSec: 1770000000,
                nowSec: now,
                expireEpoch: now - 60,      // 比「现在」早 60 秒 → 已过期
            }), 300);
        expect(v.shutdown).toBe(true);
        expect(v.reason).toMatch(/已过期/);
        // ★ 不带 readFailed → 驱动层不会把它计入失败 streak
        expect(v.readFailed).toBeUndefined();
    });

    it("4. **启动保护期内也要读注册文件**, 并把读到什么写进理由", async () => {
        // ★ 指挥官指出：
        // > 我认为启动300s这个防杀应该是在读文件之后触发的，
        // > 不然前300秒的文件到底有没读到又没写入我们都不知道
        //
        // 那次误关恰好发生在前 300 秒内（实例 07:01 启动，07:07:32 就关机），
        // 而旧顺序在保护期内**直接返回、根本不读** —— 那 5 轮全成盲区。
        // 现在无论是否保护期，读的结果都要出现在理由里。
        const v = await shouldShutdownByLoop(
            freshSsh("73020\n2026-10-16 08:25:00\n"), 300);
        expect(v.shutdown).toBe(false);
        expect(v.reason).toMatch(/防手动刚开被杀/);
        // 关键：理由里必须带上「读到了什么」
        expect(v.reason).toMatch(/pid=73020/);
        expect(v.reason).toMatch(/2026-10-16 08:25:00/);
    });

    it("5. 保护期内读到「无注册文件」也要如实反映", async () => {
        const v = await shouldShutdownByLoop(freshSsh("__NO_FILE__"), 300);
        expect(v.shutdown).toBe(false);          // 保护期内不关
        expect(v.reason).toMatch(/无注册文件/);    // 但必须说清读到了什么
    });

    it("6. 保护期内读取失败同样要如实反映", async () => {
        const v = await shouldShutdownByLoop(freshSsh(""), 300);
        expect(v.shutdown).toBe(false);
        expect(v.reason).toMatch(/读取失败/);
    });
});

describe("writeLifecycle 的原子写", () => {
    const REG = "/root/autodl_lifecycle.register";

    it("1. 必须写临时文件再 mv —— 不能就地截断目标文件", () => {
        // ★ 本测试的核心。SFTP 的 `createWriteStream` 会**就地截断**目标文件，
        // 于是存在「文件已空、内容未落」的窗口；此刻别人 `cat` 会读到空文件，
        // 而空输出与「命令没跑成」在读侧无法区分 → 被当成「无注册」→ 误关实例。
        // 原子写让这个窗口**不存在**。
        const cmd = buildWriteCommand(73020, "2026-10-16 07:17:00");
        expect(cmd).toContain(`cat > ${REG}.tmp.73020`);
        expect(cmd).toContain(`mv -f ${REG}.tmp.73020 ${REG}`);
    });

    it("2. 不得出现直接写目标文件的 `cat > 目标 <`", () => {
        const cmd = buildWriteCommand(1, "2030-01-01 00:00:00");
        // 目标文件只能作为 `mv` 的目的地出现
        expect(cmd).not.toMatch(new RegExp(`cat > ${REG}\\b(?!\\.tmp)`));
    });

    it("3. 内容与改名必须**在同一条命令**里（无本地往返窗口）", () => {
        const cmd = buildWriteCommand(1, "2030-01-01 00:00:00");
        const catIdx = cmd.indexOf("cat >");
        const mvIdx = cmd.indexOf("mv -f");
        expect(catIdx).toBeGreaterThanOrEqual(0);
        expect(mvIdx).toBeGreaterThan(catIdx);
    });

    it("4. pid 与时间应出现在文件内容里（各占一行）", () => {
        const cmd = buildWriteCommand(73020, "2026-10-16 07:17:00");
        // heredoc 体: 开定界符一行 → pid 一行 → 时间一行 → 闭定界符一行
        expect(cmd).toMatch(/'LIFECYCLE_EOF'\n73020\n2026-10-16 07:17:00\nLIFECYCLE_EOF/);
    });

    it("5. heredoc 定界符要加引号，防止内容被 shell 展开", () => {
        // 时间文本经 `date` 生成, 本身不含 `$`/反引号, 但加引号能杜绝这一类风险
        const cmd = buildWriteCommand(1, "2030-01-01 00:00:00");
        expect(cmd).toContain("<< 'LIFECYCLE_EOF'");
    });

    it("6. 临时文件名带 pid, 两个进程并发写不会互相踩", () => {
        // 并发场景（两 session 同时 genimage）下, 各自的临时文件互相独立
        const a = buildWriteCommand(111, "2030-01-01 00:00:00");
        const b = buildWriteCommand(222, "2030-01-01 00:00:00");
        expect(a).toContain(".tmp.111");
        expect(b).toContain(".tmp.222");
    });
});

describe("renewLifecycle 的写入防抖", () => {
    /** 当前远端时刻（epoch 秒）—— 测试里固定, 便于算差值 */
    const NOW = 1770000000;
    /** keepAlive 与实现里的缺省一致（600 秒） */
    const KEEP = 600;

    /** 造一个「远端有注册文件」的假 ssh，并记录是否发生了写入
     *
     * 认命令内容回答：
     * - `date +%s`        → 当前时刻
     * - `cat ... 注册文件` → 给定的注册内容
     * - `date -d <文本>`  → 把注册里的时间解析成 epoch
     * - `date -d @N`      → 格式化目标时刻（回一个可解析的文本）
     * - 写命令（含 heredoc）→ 记一次写入
     */
    const mkRenewSsh = (param: {
        /** 注册文件里记的 pid */
        regPid: number;
        /** 注册文件里记的过期 epoch */
        regExpire: number;
        /** 当前时刻；缺省 `NOW` */
        nowSec?: number;
    }) => {
        const writes: string[] = [];
        const nowSec = param.nowSec ?? NOW;
        const ssh = {
            exec: async (cmd: string) => {
                let stdout = "";
                if (cmd.includes("LIFECYCLE_EOF")) {
                    writes.push(cmd);                      // 这是一次写入
                    stdout = "";
                } else if (cmd.includes("__NO_FILE__")) {
                    stdout = `${param.regPid}\n2026-10-16 09:00:00\n`;
                } else if (cmd.startsWith("date -d @")) {
                    stdout = "2026-10-16 09:30:00\n";      // 格式化目标时刻
                } else if (cmd.startsWith("date -d")) {
                    stdout = `${param.regExpire}\n`;       // 解析注册里的时间
                } else if (cmd.includes("date +%s")) {
                    stdout = `${nowSec}\n`;
                }
                return { stdout, stderr: "", code: 0, signal: null };
            },
        };
        return { ssh: ssh as unknown as Parameters<typeof renewLifecycle>[0], writes };
    };

    it("1. 归自己 + 增量充足 → 写", async () => {
        const { ssh, writes } = mkRenewSsh({
            regPid: process.pid,                       // 归自己
            regExpire: NOW + KEEP - 100,               // 增量 100 秒 > 10
        });
        expect(await renewLifecycle(ssh, KEEP)).toBe(true);
        expect(writes.length).toBe(1);
    });

    it("2. 归自己 + 增量不足 → **跳过**", async () => {
        const { ssh, writes } = mkRenewSsh({
            regPid: process.pid,
            regExpire: NOW + KEEP - 3,                 // 增量 3 秒 < 10
        });
        expect(await renewLifecycle(ssh, KEEP)).toBe(false);
        expect(writes.length).toBe(0);
    });

    it("3. **接管 + 增量不足 → 也必须跳过**（否则两进程会无限互相接管）", async () => {
        // ★ 指挥官指出：
        // > 接管也需要防抖，不然两个并行必然是互相不停接管
        //
        // 场景：进程 B 看到 A 的注册（不归自己），而 A 是 30 秒前写的 ——
        // B 的 target 必然比 A 的新，旧实现于是**每轮都接管写**：
        //   A 写 → B 接管 → A 又接管 → B 又接管 → …（30 秒一轮，永不停止）
        const { ssh, writes } = mkRenewSsh({
            regPid: process.pid === 1 ? 2 : 1,          // 绝不等于自己 → 走接管分支
            regExpire: NOW + KEEP - 3,                  // 增量仅 3 秒 < 10
        });
        expect(await renewLifecycle(ssh, KEEP)).toBe(false);
        expect(writes.length).toBe(0);                  // ← 关键：一次都没写
    });

    it("4. 接管 + 增量充足 → 仍要接管（不能在该写时不写）", async () => {
        const { ssh, writes } = mkRenewSsh({
            regPid: process.pid === 1 ? 2 : 1,
            regExpire: NOW + KEEP - 500,                // 增量 500 秒 > 10
        });
        expect(await renewLifecycle(ssh, KEEP)).toBe(true);
        expect(writes.length).toBe(1);
    });

    it("5. 读不到 → **必然写**（没有现值可比，write 的契约就是让它出现）", async () => {
        const writes: string[] = [];
        const ssh = {
            exec: async (cmd: string) => {
                let stdout = "";
                if (cmd.includes("LIFECYCLE_EOF")) {
                    writes.push(cmd);
                } else if (cmd.includes("__NO_FILE__")) {
                    stdout = "__NO_FILE__\n";           // 明确没有文件
                } else if (cmd.startsWith("date -d @")) {
                    stdout = "2026-10-16 09:30:00\n";
                } else if (cmd.includes("date +%s")) {
                    stdout = `${NOW}\n`;
                }
                return { stdout, stderr: "", code: 0, signal: null };
            },
        };
        expect(await renewLifecycle(
            ssh as unknown as Parameters<typeof renewLifecycle>[0], KEEP)).toBe(true);
        expect(writes.length).toBe(1);
    });

    it("6. 防抖阈值就是一个 `WRITE_MARGIN_SEC`", async () => {
        // 边界：恰好等于阈值 → 写（判定是 `< WRITE_MARGIN_SEC` 才跳过）
        const { ssh, writes } = mkRenewSsh({
            regPid: process.pid,
            regExpire: NOW + KEEP - WRITE_MARGIN_SEC,
        });
        expect(await renewLifecycle(ssh, KEEP)).toBe(true);
        expect(writes.length).toBe(1);
    });
});
