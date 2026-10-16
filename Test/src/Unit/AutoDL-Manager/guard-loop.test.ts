/** 守护循环判定的端到端测试（真 SSH 服务 + 真 SshClient）
 *
 * ## 与 lifecycle.test.ts 的分工
 * 那边用「假 exec」验证**纯逻辑分支**（三态怎么解释）；
 * 这边用**真实的 SSH 连接**验证**并发下的整条链路**：
 * 注册文件的读写、`Promise.all` 的并发、连接被拒时的相互影响。
 *
 * ## 要复现的事故
 * 两个 session 同时 genimage 时，守护循环把**正在生图**的实例关掉了。
 * 根因是 `shouldShutdownByLoop` 在同一条连接上并发两条命令，
 * 其中一条的失败导致**整条连接**被掐，另一条拿到空 stdout，
 * 而空 stdout 被读成「无注册文件」→ 判定无人认领 → 关机。
 *
 * ## 为什么必须用真连接
 * 「空 stdout」这个现象只在**真连接被中断**时出现 —— 假的 `exec`
 * 只能返回预设值，测不出连接层的相互影响。
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Server } from "ssh2";
import type { Connection } from "ssh2";
import { SshClient, readLifecycle, shouldShutdownByLoop } from "@sosraciel-lamda/autodl-manager";

/** 生成一个临时主机密钥 */
const importKey = async (): Promise<string> => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-ssh-life-"));
    const keyPath = path.join(dir, "host_key");
    execFileSync("ssh-keygen", ["-t", "ed25519", "-f", keyPath, "-N", "", "-q"]);
    return fs.readFileSync(keyPath, "utf8");
};

/** 一个**有真实文件语义**的假 SSH 服务
 *
 * 它真的维护一个注册文件的内容，支持 `cat` 与 `date`，
 * 并且能在指定次数上「拒绝开 channel」以模拟 sshd 侧的压力。
 */
const startStatefulSsh = async (): Promise<{
    port: number;
    close: () => Promise<void>;
    /** 让接下来第 n 次 exec 被拒绝开 channel */
    rejectNext: () => void;
    /** 直接设置注册文件内容（null = 文件不存在） */
    setRegister: (content: string | null) => void;
    /** 设置容器启动时刻（epoch 秒），用于控制 uptime */
    setStartAt: (epoch: number) => void;
}> => {
    let register: string | null = null;
    let startAt = 0;
    let rejectCount = 0;

    const server = new Server({ hostKeys: [await importKey()] }, (client: Connection) => {
        client.on("authentication", ctx => {
            if (ctx.method === "password" && ctx.password === "pw") ctx.accept();
            else ctx.reject();
        });
        client.on("ready", () => {
            client.on("session", accept => {
                const session = accept();
                session.on("exec", (acceptExec, rejectExec, info) => {
                    if (rejectCount > 0) {
                        rejectCount--;
                        rejectExec();      // ★ channel 级失败：只拒这条，连接不动
                        return;
                    }

                    const cmd = info.command;
                    const stream = acceptExec();
                    const ok = (out: string) => {
                        stream.write(out);
                        stream.exit(0);
                        stream.end();
                    };

                    // `cat <文件> ... || echo __NO_FILE__`
                    if (cmd.includes("__NO_FILE__")) {
                        ok(register == null ? "__NO_FILE__\n" : register);
                        return;
                    }
                    // `date -d '...' +%s` —— 把注册里的时间解析成 epoch。
                    // 这里回一个**远未来**值, 让「未过期」这一支可测。
                    if (cmd.startsWith("date -d")) { ok("4102444800\n"); return; }   // 2100-01-01
                    // `date +%s` —— 当前时刻（比上面早很多 → 判定为「未过期」）
                    if (cmd.includes("date +%s")) { ok("1770000600\n"); return; }
                    // 取容器启动时刻
                    if (cmd.includes("/proc/1")) { ok(`${startAt}\n`); return; }
                    ok("");
                });
            });
        });
    });

    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (addr == null || typeof addr === "string") throw new Error("fake ssh 未取到端口");

    return {
        port: addr.port,
        close: () => new Promise<void>(resolve => server.close(() => resolve())),
        rejectNext: () => { rejectCount++; },
        setRegister: (c) => { register = c; },
        setStartAt: (e) => { startAt = e; },
    };
};

describe("守护循环判定（端到端，真 SSH）", () => {
    let fake: Awaited<ReturnType<typeof startStatefulSsh>>;

    beforeAll(async () => { fake = await startStatefulSsh(); });
    afterAll(async () => { await fake?.close(); });

    const newClient = () => new SshClient({
        host: "127.0.0.1", port: fake.port, user: "root", password: "pw",
        readyTimeout: 5_000,
        reconnectInterval: 0,
        maxExecAttempts: 1,
    });

    it("1. 注册未过期 → 保留（这是修复后应有的常态）", async () => {
        // 注册着更晚的过期时刻（1770000000 = date -d 的返回），
        // 而 `date +%s` 回 1770000600（更晚）。
        // ⚠️ 这里故意构造「已过期」的反面: 设置一个很远的过期时刻
        fake.setStartAt(1700000000);              // 启动很久以前 → uptime 超阈值
        fake.setRegister("4242\n2099-01-01 00:00:00\n");

        const ssh = newClient();
        const v = await shouldShutdownByLoop(ssh, 300);
        expect(v.shutdown).toBe(false);
        await ssh.close();
    });

    it("2. 确认无注册文件 → 关机", async () => {
        fake.setStartAt(1700000000);
        fake.setRegister(null);

        const ssh = newClient();
        const v = await shouldShutdownByLoop(ssh, 300);
        expect(v.shutdown).toBe(true);
        expect(v.reason).toMatch(/无注册文件/);
        await ssh.close();
    });

    it("3. **并发命令中一条被拒, 另一条仍须拿到完整输出**", async () => {
        // ★ 复现事故的关键一步。
        // `shouldShutdownByLoop` 内部并发跑 `readLifecycle` 与 `getRemoteNow`。
        // 若其中一条被拒导致整条连接被掐, `readLifecycle` 会拿到空 stdout。
        //
        // 这里先确认「连接层不再被无辜掐掉」—— 直接并发两条真命令,
        // 让服务端拒掉其中一条, 断言另一条仍有完整输出。
        const ssh = newClient();
        await ssh.exec("date +%s").then(r => expect(r.stdout.trim()).toBe("1770000600"));

        fake.rejectNext();
        const results = await Promise.allSettled([
            ssh.exec("date +%s").then(r => r.stdout.trim()),
            ssh.exec("date +%s").then(r => r.stdout.trim()),
        ]);

        const fulfilled = results.filter(r => r.status === "fulfilled");
        // 至少一条成功, 且**成功的那条输出必须完整**（不能是空串）
        expect(fulfilled.length).toBeGreaterThanOrEqual(1);
        for (const f of fulfilled) {
            if (f.status === "fulfilled") expect(f.value).toBe("1770000600");
        }
        // 连接必须仍然活着
        expect(ssh.connected).toBe(true);
        await ssh.close();
    });

    it("4. 该读的内容一个字节都不能少（防止空 stdout 被当成无文件）", async () => {
        const ssh = newClient();
        fake.setRegister("4242\n2030-06-01 12:00:00\n");
        const r = await readLifecycle(ssh);
        expect(r.state).toBe("ok");
        if (r.state === "ok") {
            expect(r.record.pid).toBe(4242);
            expect(r.record.expire_text).toBe("2030-06-01 12:00:00");
        }
        await ssh.close();
    });
});
