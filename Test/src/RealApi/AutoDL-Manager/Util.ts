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
 * @returns 凭据字段
 */
export const credFields = () => {
    const cred = getAutoDLCred();
    return {
        token: cred.token,
        instance_uuid: cred.instance_uuid,
        region_name: cred.region_name,
    };
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
