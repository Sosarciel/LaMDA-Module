/** SshClient 并发命令的隔离性测试
 *
 * ## 为什么必须有这个测试
 * 实测踩到（2026-10-16）：两个 session 同时 genimage 时，守护循环把
 * **正在生图**的实例关掉了。根因链是：
 * ```
 * shouldShutdownByLoop 里并发跑 readLifecycle 与 getRemoteNow
 *   → 其中一条命令失败
 *   → SshClient._withRetry 无条件 `_onDisconnect()` → conn.end() 掐掉整条连接
 *   → **并发的另一条** channel 被殃及, stdout 变成空串
 *   → readLifecycle 把空串读成「无注册文件」
 *   → 守护循环判定无人认领 → 关机
 * ```
 *
 * 故这里起一个**真实的本地 SSH 服务**（`ssh2.Server`），让 `SshClient` 真连上去，
 * 并发发两条命令、其中一条必然失败，断言：**没失败的那条照常拿到输出**。
 *
 * 这是纯本地的、无外部依赖的可复现验证 —— 不需要 AutoDL 实例。
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "ssh2";
import type { Connection } from "ssh2";
import { SshClient } from "@sosraciel-lamda/autodl-manager";

/** 起一个本地 SSH 服务，按命令内容返回预设结果
 *
 * 支持的「命令」是测试自定义的短标识（不是真 shell），便于精确控制：
 * - `ok:<文本>`    → stdout 输出该文本，退出码 0
 * - `reject`       → **拒绝开 channel**（客户端 `conn.exec` 回调带 err）★ 关键场景
 * - `fail`         → 命令跑完但退出码非 0（业务失败，客户端**不抛错**）
 * - `close:延迟ms` → 延迟后销毁整条连接（连接级断开）
 */
const startFakeSsh = async (): Promise<{
    port: number; close: () => Promise<void>;
}> => {
    const server = new Server({ hostKeys: [await importKey()] }, (client: Connection) => {
        client.on("authentication", (ctx) => {
            if (ctx.method === "password" && ctx.password === "pw") ctx.accept();
            else ctx.reject();
        });
        client.on("ready", () => {
            client.on("session", (accept) => {
                const session = accept();
                session.on("exec", (acceptExec, rejectExec, info) => {
                    const cmd = info.command.trim();

                    if (cmd.startsWith("close:")) {
                        // 连接级断开: 直接销毁底层连接
                        const ms = Number(cmd.slice("close:".length));
                        setTimeout(() => client.end(), ms);
                        rejectExec();
                        return;
                    }

                    // ★ **channel 级失败** —— 拒绝开通道, 但**不动连接**。
                    // 这正是那次误关实例的触发形态: 连接还好好的,
                    // 旧代码却因这个 err 去 `_onDisconnect()` 掐掉整条连接,
                    // 把并发中的另一条命令的输出也清空了。
                    if (cmd === "reject") {
                        rejectExec();
                        return;
                    }

                    const stream = acceptExec();
                    if (cmd === "fail") {
                        // 业务失败: 有输出、退出码非 0, 客户端**不抛错**
                        stream.stderr.write("fake channel failure\n");
                        stream.exit(1);
                        stream.end();
                        return;
                    }
                    if (cmd.startsWith("ok:")) {
                        stream.write(cmd.slice("ok:".length));
                        stream.exit(0);
                        stream.end();
                        return;
                    }
                    stream.write(`unknown: ${cmd}`);
                    stream.exit(0);
                    stream.end();
                });
            });
        });
    });

    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (addr == null || typeof addr === "string")
        throw new Error("fake ssh 未取到端口");

    return {
        port: addr.port,
        close: () => new Promise<void>(resolve => server.close(() => resolve())),
    };
};

/** 生成一个临时主机密钥（测试用）
 *
 * ssh2 需要 PEM 格式的主机密钥；这里用 `ssh-keygen` 现生成一份放临时目录，
 * 避免把密钥硬编码进测试文件。
 */
const importKey = async (): Promise<string> => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-ssh-"));
    const keyPath = path.join(dir, "host_key");
    execFileSync("ssh-keygen", ["-t", "ed25519", "-f", keyPath, "-N", "", "-q"]);
    return fs.readFileSync(keyPath, "utf8");
};

describe("SshClient 并发命令的隔离性", () => {
    let fake: Awaited<ReturnType<typeof startFakeSsh>>;

    beforeAll(async () => { fake = await startFakeSsh(); });
    afterAll(async () => { await fake?.close(); });

    const newClient = (opt: { maxExecAttempts?: number } = {}) => new SshClient({
        host: "127.0.0.1", port: fake.port, user: "root", password: "pw",
        readyTimeout: 5_000,
        // 关掉自动重连, 让断连的影响可观测且不引入额外噪声
        reconnectInterval: 0,
        // ⚠️ 关掉**指令重试** —— 否则 `_withRetry` 会在重试时重建连接,
        // 把「连接被无辜掐掉」这个事实掩盖过去（实测：开着重试时
        // 即便注入了旧缺陷, 测试仍然通过）。
        maxExecAttempts: opt.maxExecAttempts ?? 1,
    });

    it("1. 并发命令互不干扰 —— 一条业务失败不影响另一条的数据完整性", async () => {
        // 这条钉住的是「并发命令共享连接时, 各自的数据必须完整」。
        const ssh = newClient();
        const [good, bad] = await Promise.all([
            ssh.exec("ok:hello").then(r => r.stdout).catch(e => `ERR:${e.message}`),
            ssh.exec("fail").then(r => `code=${r.code} stderr=${r.stderr.trim()}`)
                .catch(e => `ERR:${e.message}`),
        ]);

        expect(good).toBe("hello");           // ← 关键：好命令必须拿到完整输出
        expect(bad).toContain("code=1");      // ← 坏命令是「命令自身失败」, 不是抛错
        await ssh.close();
    });

    it("2. **channel 级失败不得掐掉整条连接** —— 这是误关实例的根因", async () => {
        // ★ 本测试是整次修复的核心断言。
        //
        // ## 那次事故的完整形态
        // 两个 session 同时 genimage → 到同一台实例的 SSH 连接数翻倍，
        // sshd 侧新 channel 可能被拒（MaxSessions/MaxStartups）。
        // 而 `shouldShutdownByLoop` 自己就在**同一条连接**上并发两条命令：
        // ```
        // const [rec, now] = await Promise.all([readLifecycle(ssh), getRemoteNow(ssh)]);
        // ```
        // 旧代码在 `conn.exec` 回调带 err 时**无条件**断连：
        // ```
        // if (err != undefined) { this._onDisconnect("exec-failed"); reject(err); }
        // ```
        // 于是整条连接被 `conn.end()` 掐掉 —— **并发中的另一条**输出被清空，
        // 而空输出在 `readLifecycle` 里被读成「无注册文件」→ 误关正在生图的实例。
        //
        // ## 判据为什么是 `connected` 而不是「下一条命令能否成功」
        // 连接被掐后, 下一次 `exec` 会 `_ensureConn()` **重建**连接并成功 ——
        // 所以「后续命令成功」**抓不到**这个缺陷（实测: 注入旧代码后仍全绿）。
        // 真正的事实是「**连接被无辜掐掉了**」, 故直接断言它。
        const ssh = newClient();
        await ssh.exec("ok:prime").then(r => expect(r.stdout).toBe("prime"));
        expect(ssh.connected).toBe(true);

        // 这一条会被服务端拒绝开 channel —— 但**连接本身是好的**
        await expect(ssh.exec("reject")).rejects.toThrow();

        // ★ 关键断言: 连接必须仍然活着
        expect(ssh.connected).toBe(true);
        await ssh.close();
    });

    it("3. 多条好命令并发互不干扰", async () => {
        const ssh = newClient();
        const outs = await Promise.all([
            ssh.exec("ok:A").then(r => r.stdout),
            ssh.exec("ok:B").then(r => r.stdout),
            ssh.exec("ok:C").then(r => r.stdout),
        ]);
        expect(outs).toEqual(["A", "B", "C"]);
        await ssh.close();
    });

    it("4. 连接级断开后, 后续命令仍能用新连接成功", async () => {
        // 连接被销毁 → 监听器清理 → 下一次 `_ensureConn` 重建。
        // 这里验证「真的断了能自愈」, 免得修复把它一起关掉。
        const ssh = newClient();
        await ssh.exec("ok:before").then(r => expect(r.stdout).toBe("before"));
        await ssh.exec("close:0").catch(() => undefined);
        await new Promise(r => setTimeout(r, 300));
        const after = await ssh.exec("ok:after")
            .then(r => r.stdout)
            .catch(e => `ERR:${e.message}`);
        expect(after).toBe("after");
        await ssh.close();
    });
});
