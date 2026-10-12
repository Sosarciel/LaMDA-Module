/** ComfyUI-Manager 测试共用工具
 *
 * ## 测试分组（与 AutoDL-Manager 的既有做法一致）
 * | 组 | 目录 | 语义 |
 * |----|------|------|
 * | **可用性** | `src/RealApi/ComfyUI-Manager/` | 预期实例**已在无卡模式启动**，直接测服务可用性 |
 * | **危险·生命周期** | `.../Dangerous/` | 完全管理实例启停，**会产生 GPU 费用**，默认禁用 |
 * | **多进程** | `.../MultiProcess/` | 两个独立进程无 IPC 接入同一实例 |
 *
 * ## 与 AutoDL-Manager 测试的区别
 * AutoDL-Manager 测的是**基础能力**（隧道、终端），测试自己拉一个极简 HTTP 服务即可。
 * ComfyUI-Manager 测的是**托管服务**（clash / Middleware / ComfyUI），
 * 这三者不是 AutoDL 镜像自带的基础设施 —— 它们必须**由使用方部署**到实例上。
 *
 * 因此遵循与 AutoDL 相同的原则：**不依赖远端预置环境** ——
 * 但这里的「环境」指「服务二进制是否就位」，而不是「服务是否已启动」。
 * 缺失时**明确失败并给出路径**，而不是静默跳过（静默跳过会让测试变成假绿）。
 */

import { execFileSync } from "node:child_process";

import { SLogger } from "@zwa73/utils";
import { resolveServices } from "@sosraciel-lamda/autodl-manager";
import type { ServiceKind } from "@sosraciel-lamda/autodl-manager";

import { COMFY_LOCAL_PORT, getAutoDLCred } from "@/src/Constant";

/** 测试用实例名（ComfyUI-Manager 侧的实例名） */
export const INSTANCE = "TestComfyHost";

/** 承载服务的 Jupyter 终端名
 *
 * ⚠️ 只能用 `[A-Za-z0-9_]` —— Jupyter 的 WS 路由 `\w+` 不匹配连字符。
 * 与模块内 `SERVICE_TERMINAL` 常量保持一致（此处独立声明以免测试单向依赖模块内部约定）。
 */
export const TERMINAL = "akaset_services";

/** 远端端口（由服务自身的启动参数决定，测试不可改） */
export const REMOTE_PORT = {
    jupyter: 8888,
    clash: 7890,
    middleware: 6006,
    comfyui: 6005,
} as const;

/** 本测试使用的端口映射表
 * @returns 端口映射数组
 */
export const portForwards = () => [
    { local_port: COMFY_LOCAL_PORT.jupyter, remote_port: REMOTE_PORT.jupyter },
    { local_port: COMFY_LOCAL_PORT.middleware, remote_port: REMOTE_PORT.middleware },
];

/** ComfyUI-Manager 侧实例的配置数据
 * @returns 云端 ComfyUI 实例的接入数据
 */
export const instanceData = () => ({
    autodl_instance: "AutoDLHost",
    terminal_name: TERMINAL,
    port_forwards: portForwards(),
});

/** 解析出测试使用的服务配置（用于前置校验与断言）
 * @returns 各服务的最终配置
 */
export const services = () => resolveServices(instanceData());

/** 各服务的二进制路径（用于前置校验） */
const SERVICE_BINARY: Record<ServiceKind, string> = {
    clash: "/root/clash/mihomo",
    middleware: "/root/Middleware/index.js",
    comfyui: "/root/ComfyUI/main.py",
};

/** AutoDL-Manager 侧实例的配置数据
 *
 * ComfyUI-Manager 通过它取得 AutoDL 实例 —— 两个 Manager 各自持有
 * 自己职责范围内的配置，这正是指挥官要求的边界。
 * @returns AutoDL 实例的配置数据
 */
export const autodlInstanceData = () => {
    const cred = getAutoDLCred();
    return {
        token: cred.token,
        instance_uuid: cred.instance_uuid,
        keep_alive_sec: 1800,
        port_forwards: portForwards(),
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
    } catch {
        return undefined;
    }
};

/** 断言实例处于运行中, 否则在**模块顶层**抛错让整个测试集失败
 *
 * ## 为什么要重试
 * 实测遇到过 API **瞬时**返回异常值（同一实例前后两次查询分别是
 * `shutdown` 与 `running`）。单次查询就下结论会把网络抖动误报成
 * 「实例没开」，给出误导性的排查方向。
 *
 * 因此这里重试若干次，且**只在连续多次都查不到时**才判定为查询失败。
 * 注意区分两种情形，它们的排查方向完全不同：
 * - **查不到** → 网络/凭据问题
 * - **确实关机** → 需要人工开机
 *
 * @param context - 出错提示里显示的上下文(如文件名)
 * @throws 实例未运行或状态查询失败时抛出
 */
export const assertInstanceRunning = (context: string): void => {
    const ATTEMPTS = 3;
    let status: string | undefined;
    const seen: string[] = [];

    for (let i = 0; i < ATTEMPTS; i++) {
        status = fetchStatusSync(20);
        seen.push(status ?? "(查不到)");
        // running 立即通过, 不必等满重试次数
        if (status === "running") return;
        if (i < ATTEMPTS - 1) {
            // 用同步 sleep: 本函数在模块顶层调用, 不能用 await
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3_000);
        }
    }

    if (status === undefined) {
        throw new Error(
            `[${context}] 连续 ${ATTEMPTS} 次都无法查询 AutoDL 实例状态`
            + ` (历次结果: ${seen.join(" → ")})。\n`
            + `这属于**查询失败**, 请检查网络与 Test/data/Cred.json 中的 AutoDL 凭据,\n`
            + `而不是实例没开机。`);
    }
    throw new Error(
        `[${context}] 实例当前状态为 "${status}", 本测试要求实例已启动。\n`
        + `AutoDL 的开机 API 只支持有卡模式(payload 仅接受 "gpu"),`
        + ` 无卡模式必须由人工在控制台开启, 故不自动开机。\n`
        + `请先手动开机后再跑本测试。`);
};

/** 校验服务所需的文件是否已部署到实例上
 *
 * ComfyUI 这一套（clash / Middleware / ComfyUI）**不是 AutoDL 镜像自带的**，
 * 需要事先部署。缺失时**明确报错并给出路径**，而不是静默跳过 ——
 * 静默跳过会让测试变成假绿，掩盖「环境没准备好」这一事实。
 *
 * @param ssh   - SSH 客户端
 * @param kinds - 要校验的服务
 * @returns 缺失项的描述; 全部就位时返回空数组
 */
export const checkDeployed = async (
    ssh: { exec: (cmd: string) => Promise<{ stdout: string }> },
    kinds: ServiceKind[],
): Promise<string[]> => {
    const missing: string[] = [];
    for (const kind of kinds) {
        const p = SERVICE_BINARY[kind];
        const r = await ssh.exec(`test -e ${p} && echo OK || echo MISSING`);
        if (r.stdout.trim() !== "OK") missing.push(`${kind}: ${p}`);
    }
    return missing;
};

/** 断言的辅助：把探测结果整理成人可读摘要
 * @param probe - 探测结果表
 * @returns 形如 "clash=ready middleware=none"
 */
export const summarize = (probe: Record<string, { ready: boolean; procAlive: boolean }>): string =>
    Object.entries(probe)
        .map(([k, v]) => `${k}=${v.ready ? "ready" : v.procAlive ? "proc" : "none"}`)
        .join(" ");

/** 停掉测试涉及的远端服务（制造冷启动条件的公共部分）
 *
 * ## 为什么优先用 pgrep 而非 pid 文件
 * 实测发现只按 pid 文件杀**不可靠**：pid 文件可能已被之前的清理逻辑删掉，
 * 于是 `kill $(cat ...)` 落空、服务其实还活着 ——
 * 这会让「冷启动」类测试**静默地测不到想测的东西**（假绿）。
 *
 * 因此改为**先按 pid 文件，再按进程特征兜底**，并用 `[x]` 技巧避免
 * pgrep 匹配到探测命令自身。
 *
 * @param ssh   - SSH 客户端
 * @param kinds - 要停止的服务
 * @param cfg   - 各服务的配置（取 proc_pattern 做兜底匹配）
 */
export const stopRemoteServices = async (
    ssh: { exec: (cmd: string) => Promise<{ stdout: string }> },
    kinds: ServiceKind[],
    cfg?: Partial<Record<ServiceKind, { proc_pattern: string }>>,
): Promise<void> => {
    for (const kind of kinds) {
        const pattern = cfg?.[kind]?.proc_pattern;
        // 进程特征串同样要防自匹配
        const safe = pattern == undefined
            ? undefined
            : `[${pattern[0]}]${pattern.slice(1)}`;

        const cmd = [
            `if [ -f /root/akaset_${kind}.pid ]; then`,
            `  kill $(cat /root/akaset_${kind}.pid) 2>/dev/null;`,
            `  rm -f /root/akaset_${kind}.pid;`,
            `fi;`,
            safe == undefined ? "" : `pkill -f '${safe}' 2>/dev/null;`,
            `sleep 1;`,
            safe == undefined
                ? `echo done;`
                : `pgrep -f '${safe}' >/dev/null 2>&1 && echo STILL_ALIVE || echo GONE;`,
        ].join(" ");

        const r = await ssh.exec(cmd);
        const out = r.stdout.trim();
        SLogger.info(`停止 ${kind}: ${out}`);
        if (out.includes("STILL_ALIVE"))
            SLogger.warn(`⚠️ ${kind} 停止后进程仍在, 冷启动测试的前提不成立!`);
    }
};
