/** AutoDL-Manager 测试共用工具
 *
 * 各测试文件都需要「自己上传被测服务 → 测试 → 删除」这套幂等流程，
 * 把公共部分抽到这里，避免在每个文件里重复一遍。
 *
 * 设计原则：测试**不依赖远端预置环境**，自己上传、自己清理，
 * 唯一的假设是「实例处于运行中且 SSH 可达」。
 */

import { execFileSync } from "node:child_process";

import type { AutoDLDrive } from "@sosraciel-lamda/autodl-manager";
import { SLogger } from "@zwa73/utils";

import { getAutoDLCred } from "@/src/Constant";

/** 构建 instance_table 条目所需的公共字段
 *
 * 含 `keep_alive_sec` —— 它是**必填项**（不给默认值，因为保活时长直接关系到
 * GPU 费用，用隐式回退替使用者做决定是危险的）。
 * 测试里给一个够长的值，避免测试过程中被守护循环判定为过期。
 *
 * @returns 凭据字段
 */
export const credFields = () => {
    const cred = getAutoDLCred();
    return {
        token: cred.token,
        instance_uuid: cred.instance_uuid,
        region_name: cred.region_name,
        /** 测试期间的保活时长/秒; 取 30 分钟, 足够跑完任何单个测试文件 */
        keep_alive_sec: 1800,
    };
};

/** 清理远端测试端口上的**遗留进程**
 *
 * ## 为什么需要
 * 本组测试的语义是「**远端是干净的**」—— 测试会自己在
 * `AUTODL_REMOTE_PORT`(6006) / `AUTODL_REMOTE_PORT_B`(6008) 上拉起极简 HTTP 服务。
 *
 * 但这两个端口可能被**别的东西**占着（实测：`ComfyUI-Manager` 的
 * Middleware 网关正好监听 6006），于是测试服务报
 * `OSError: [Errno 98] Address already in use` 而全部失败。
 *
 * 这属于「测试环境未隔离」的遗留问题，不是被测代码的缺陷 ——
 * 因此在这里显式清理，让本组测试能独立运行。
 *
 * ⚠️ 只清理**占用目标端口**的进程，不做宽泛 pkill。
 * 用 `/proc/net/tcp` 反查 inode → pid，是 `ss`/`lsof` 缺失时唯一可靠的办法
 * （实测该镜像上 `ss`/`lsof`/`netstat`/`nc` 全部不可用）。
 *
 * @param ssh   - SSH 客户端
 * @param ports - 要确保空闲的远端端口
 */
export const freeRemotePorts = async (
    ssh: { exec: (cmd: string) => Promise<{ stdout: string }> },
    ports: number[],
): Promise<void> => {
    for (const port of ports) {
        // 十六进制端口号, /proc/net/tcp 里是大写形式; 状态 0A = LISTEN
        const hex = port.toString(16).toUpperCase().padStart(4, "0");
        // ⚠️ 必须用**换行**连接 —— 用空格压成一行时 `for ... done` 与后续语句
        // 之间会缺分隔符, 整段报语法错误且**什么都不执行**(此处踩过两次)。
        const script = [
            `INODE=$(awk '$2 ~ /:${hex}$/ && $4 == "0A" {print $10}' /proc/net/tcp 2>/dev/null | head -1)`,
            `if [ -z "$INODE" ]; then`,
            `  echo "${port}: FREE"`,
            `  exit 0`,
            `fi`,
            // 用 inode 反查 pid: 遍历 /proc/<pid>/fd。
            // ⚠️ 不能用 `ls -l /proc/*/fd | grep pid` —— ls 在这种通配展开下
            // **不输出文件名**, 拿不到 pid(实测踩过)。
            `PID=""`,
            `for p in /proc/[0-9]*; do`,
            `  if ls -l $p/fd 2>/dev/null | grep -q "socket:\\\\[$INODE\\\\]"; then`,
            `    PID=$(basename $p)`,
            `    break`,
            `  fi`,
            `done`,
            `if [ -z "$PID" ]; then`,
            `  echo "${port}: ORPHAN(无法定位进程)"`,
            `  exit 0`,
            `fi`,
            `NAME=$(cat /proc/$PID/comm 2>/dev/null)`,
            `kill -9 $PID 2>/dev/null`,
            `sleep 1`,
            `if kill -0 $PID 2>/dev/null; then`,
            `  echo "${port}: KILL-FAILED pid=$PID $NAME"`,
            `else`,
            `  echo "${port}: FREED(原为 pid=$PID $NAME)"`,
            `fi`,
        ].join("\n");
        const r = await ssh.exec(script);
        SLogger.info(`  释放远端端口 ${port}: ${r.stdout.trim()}`);
    }
};

/** 同步查询实例状态
 *
 * 用同步子进程而非 await，是为了能在**模块顶层**做前置校验：
 * `beforeAll` 里 `throw` 会让每个用例各报一次同样的错误，
 * 只有模块顶层抛错才能让整个测试集直接失败（报告 0 个用例）。
 *
 * ⚠️ 仅在测试前置校验中使用（每文件一次），不要放进热路径。
 *
 * @param timeoutSec - 超时/秒
 * @returns 实例状态, 查询失败时返回 undefined
 */
const fetchStatusSync = (timeoutSec: number): string | undefined => {
    const cred = getAutoDLCred();
    const url = `https://api.autodl.com/api/v1/dev/instance/pro/status?instance_uuid=${cred.instance_uuid}`;
    const script =
        `fetch(${JSON.stringify(url)},{headers:{Authorization:${JSON.stringify(cred.token)}}})` +
        ".then(r=>r.json()).then(j=>process.stdout.write(String(j.data)))" +
        '.catch(()=>process.stdout.write("__ERR__"));';
    try {
        const out = execFileSync(process.execPath, ["-e", script], {
            timeout: timeoutSec * 1000,
            encoding: "utf-8",
        }).trim();
        if (out === "__ERR__" || out === "") return undefined;
        return out;
    } catch (e) {
        SLogger.error(`同步查询实例状态失败: ${e}`);
        return undefined;
    }
};

/** 断言实例处于运行中, 否则在**模块顶层**抛错让整个测试集失败
 *
 * 用于那些「测的是已启动之后的链路细节」的测试文件。
 * 自动拉起本身由 `full-flow.test.ts` 专门验证。
 *
 * @param context - 出错提示里显示的上下文(如文件名)
 * @throws 实例未运行或状态查询失败时抛出
 */
export const assertInstanceRunning = (context: string): void => {
    const status = fetchStatusSync(20);
    if (status === undefined)
        throw new Error(
            `[${context}] 无法查询 AutoDL 实例状态, 请检查网络与 Test/data/Cred.json 中的 AutoDL 凭据。`);
    if (status !== "running")
        throw new Error(
            `[${context}] 实例当前状态为 "${status}", 本测试要求实例已启动。\n` +
            `AutoDL 的开机是有卡模式且会产生 GPU 费用, 故不自动开机。\n` +
            `请先手动开机; 若要验证「调用即自动拉起」, 请跑 full-flow.test.ts。`);
};

/** 所有 AutoDL 测试服务共有的进程标识
 *
 * 每个测试服务脚本都带这个标记, 使得**任一测试都能清掉其他测试残留的服务**。
 * 这是必须的: 各测试文件的远端工作目录不同(akaset_test_ssh / akaset_test_multi ...),
 * 若只按自己的目录名 pkill, 就杀不掉别的文件留下的进程 ——
 * 实测表现为「Address already in use」, 因为上一轮的服务还占着 6006/6007。
 */
export const TEST_SVC_MARKER = "akaset_autodl_test_svc";

/** 清掉本实例上所有 AutoDL 测试服务
 *
 * ⚠️ `pkill` 未匹配到进程时返回非零, 会截断同一行后续命令, 故单独执行并忽略其结果。
 *
 * @param ssh - SSH 客户端
 */
export const killAllTestServices = async (ssh: { exec: (cmd: string) => Promise<unknown> }): Promise<void> => {
    await ssh.exec(`pkill -f '${TEST_SVC_MARKER}' > /dev/null 2>&1; echo ok`);
    // 给进程退出与端口释放留时间, 否则紧接着起服务仍会 Address already in use
    await new Promise(r => setTimeout(r, 1500));
};

/** 生成一个极简 HTTP 服务的启动脚本
 *
 * ⚠️ 必须用绝对路径 `/root/miniconda3/bin/python3`：
 * 实例的 PATH 里没有 python3，直接写 `python3` 会 `No such file or directory`
 * 且被 nohup 吞掉、静默失败。
 *
 * 日志写到 `<remoteDir>/svc_<port>.log` 而非丢弃 —— 服务起不来时能查原因。
 *
 * @param port      - 监听端口
 * @param body      - 该端口固定返回的内容
 * @param remoteDir - 远端工作目录(用于放日志)
 * @returns 服务启动脚本内容
 */
export const buildServiceScript = (port: number, body: string, remoteDir: string): string => {
    return [
        "#!/bin/bash",
        "cd /",
        `export ${TEST_SVC_MARKER}=1`,
        `nohup /root/miniconda3/bin/python3 -c "`,
        "import http.server, socketserver",
        `class H(http.server.BaseHTTPRequestHandler):`,
        `    def do_GET(self):`,
        `        b = b'${body}'`,
        `        self.send_response(200)`,
        `        self.send_header('Content-Length', str(len(b)))`,
        `        self.end_headers()`,
        `        self.wfile.write(b)`,
        `    def log_message(self, *a): pass`,
        `socketserver.TCPServer(('127.0.0.1', ${port}), H).serve_forever()`,
        `" > ${remoteDir}/svc_${port}.log 2>&1 < /dev/null &`,
        "",
    ].join("\n");
};

/** 在远端拉起若干 HTTP 服务，并等到它们真正就绪
 *
 * 三个实测踩过的坑：
 * 1. **起服务前必须清掉所有测试服务**（用共享标记，而非只清自己的目录）——
 *    否则别的测试文件留下的进程仍占着端口，表现为 `Address already in use`
 * 2. **逐个脚本单独执行** —— 多条 `bash x.sh` 用 `;` 串成一行时，
 *    脚本内的 `nohup ... &` 会影响整行的返回时机，导致后一条根本没执行
 * 3. **`pkill` 单独执行并忽略结果** —— 没匹配到进程时返回非零，会截断同一行后续命令
 *
 * ## 为什么还要额外释放端口
 * 共享标记只能清掉**本套测试自己**起的服务。若目标端口被**别的模块**占着
 * （实测：`ComfyUI-Manager` 的 Middleware 网关正好监听 6006），
 * 清标记也无济于事 —— 必须按端口反查并终止占用者。
 *
 * @param ins       - 实例
 * @param remoteDir - 远端工作目录
 * @param services  - 端口 → 该端口应返回的内容
 */
export const startTestServices = async (
    ins: AutoDLDrive,
    remoteDir: string,
    services: Record<number, string>,
): Promise<void> => {
    const ssh = (await ins.getSshClient())!;
    await ssh.ensureRemoteDir(remoteDir);

    for (const [portStr, body] of Object.entries(services)) {
        const port = Number(portStr);
        await ssh.uploadText(buildServiceScript(port, body, remoteDir), `${remoteDir}/svc_${port}.sh`);
    }

    await killAllTestServices(ssh);
    // 清掉可能被其他模块占用的目标端口, 保证测试服务能正常绑定
    await freeRemotePorts(ssh, Object.keys(services).map(Number));
    // ⚠️ 释放后要**等到端口真的可绑**再起服务。
    // 杀进程只是让监听消失, socket 可能还处于 TIME_WAIT 等状态,
    // 立刻 bind 会 `OSError: [Errno 98] Address already in use`。
    // 实测这导致了间歇性的「测试服务未能就绪」。
    await waitPortBindable(ssh, Object.keys(services).map(Number));
    for (const portStr of Object.keys(services))
        await ssh.exec(`bash ${remoteDir}/svc_${Number(portStr)}.sh`);

    // 轮询到服务真正就绪, 而不是盲等固定时长
    for (const [portStr, body] of Object.entries(services)) {
        const port = Number(portStr);
        let up = false;
        for (let i = 0; i < 20; i++) {
            const r = await ssh.exec(`curl -s -m 2 http://127.0.0.1:${port}/ || true`);
            if (r.stdout.trim() === body) { up = true; break; }
            await new Promise(res => setTimeout(res, 500));
        }
        if (!up) {
            const log = await ssh.readRemoteFile(`${remoteDir}/svc_${port}.log`).catch(() => "");
            SLogger.error(`端口 ${port} 的服务未能就绪, 其日志: ${log || "(空)"}`);
            throw new Error(`测试服务未能就绪: 端口 ${port}`);
        }
    }
    SLogger.info(`测试服务已就绪: ${Object.keys(services).join(", ")}`);
};

/** 等待若干远端端口**真的可以绑定**
 *
 * ## 为什么释放后还要等
 * `freeRemotePorts` 只是把占用者杀掉，但：
 * 1. 进程退出与内核回收监听之间有一小段间隙
 * 2. 若上一条连接刚结束，socket 会处于 `TIME_WAIT`
 *
 * 此时立刻 `bind()` 会得到 `OSError: [Errno 98] Address already in use` ——
 * **即使 `ps` 里已经看不到任何进程**。实测这造成了间歇性的
 * 「测试服务未能就绪」，且难以复现（取决于前后两个测试的时序）。
 *
 * 判定方式是**真的去试绑一次**，而不是看 `ps` 或 `/proc/net/tcp` ——
 * 只有真正 bind 成功才说明可用。
 *
 * @param ssh        - SSH 客户端
 * @param ports      - 要等待的端口
 * @param timeoutSec - 总超时/秒
 * @throws 超时仍有端口不可绑时抛出
 */
export const waitPortBindable = async (
    ssh: { exec: (cmd: string) => Promise<{ stdout: string }> },
    ports: number[],
    timeoutSec = 30,
): Promise<void> => {
    const py = "/root/miniconda3/bin/python3";
    for (const port of ports) {
        const deadline = Date.now() + timeoutSec * 1000;
        let ok = false;
        while (Date.now() < deadline) {
            // 用 SO_REUSEADDR 试探: 能绑上即说明端口可用
            const r = await ssh.exec(
                `${py} -c "import socket;`
                + `s=socket.socket();`
                + `s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1);`
                + `s.bind(('0.0.0.0',${port}));`
                + `s.close();`
                + `print('BINDABLE')" 2>/dev/null || true`);
            if (r.stdout.includes("BINDABLE")) { ok = true; break; }
            await new Promise(res => setTimeout(res, 500));
        }
        if (!ok) throw new Error(`远端端口 ${port} 在 ${timeoutSec}s 内仍不可绑定`);
    }
    SLogger.info(`  远端端口已可绑定: ${ports.join(", ")}`);
};

/** 停掉自建服务并删除整个工作目录
 * 做到「上传 → 测试 → 删除」闭环, 让测试幂等
 * @param ins       - 实例
 * @param remoteDir - 远端工作目录
 */
export const cleanupTestServices = async (
    ins: AutoDLDrive | undefined,
    remoteDir: string,
): Promise<void> => {
    if (ins == undefined) return;
    try {
        const ssh = await ins.getSshClient();
        if (ssh == undefined) return;
        // 用共享标记清掉所有测试服务(含其他测试文件留下的), 再删自己的目录
        await killAllTestServices(ssh);
        // 用 SFTP 递归删除, 比 shell rm 更可靠(不受前序命令返回值影响)
        await ssh.removeRemoteDir(remoteDir);
        SLogger.info(`测试工作目录已清理: ${!(await ssh.remoteExists(remoteDir))}`);
    } catch (e) {
        SLogger.warn(`清理测试工作目录失败(不影响测试结论): ${e}`);
    }
};

/** 通过本地端口取 HTTP 内容
 * @param port    - 本地端口
 * @param timeout - 超时/毫秒
 * @returns 响应文本
 */
export const fetchLocal = async (port: number, timeout = 10_000): Promise<string> => {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(timeout),
    });
    return (await res.text()).trim();
};
