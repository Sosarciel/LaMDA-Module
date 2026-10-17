/** Tunnel（服务托管）测试的**通用**共用工具
 *
 * ## 这里只放「与具体服务无关」的东西
 * 本模块的托管机制是**通用**的 —— 它不认识任何具体服务，只认
 * 「远端有一组 `start_<kind>.sh`」「脚本留下可被 `pgrep` 扫到的特征」。
 * 既然测试要验证的是**机制**，测试自带的服务（见 {@link ./fixture}）就够用，
 * 于是这里**不再有任何 ComfyUI 用例的痕迹**：原先的 `comfyuiService` /
 * `SERVICE_TAG` / `instanceData` / 网关端口映射等，都是那个用例的私有物，
 * 已随「测试全面转向自备假服务」一并删除。
 *
 * 具体服务（clash / Middleware / ComfyUI）的验证属**用例验证**，
 * 已下沉到 `test-server` —— 那里跑的是真实业务，本就该验真东西。
 *
 * ## 目录对应
 * | `src/` | 测试目录 | 测什么 |
 * |--------|---------|--------|
 * | `AutoDL/` | `src/RealApi/AutoDL-Manager/AutoDL/` | 接管、开关机、隧道、终端 |
 * | `Tunnel/` | `src/RealApi/AutoDL-Manager/Tunnel/` | 服务启停协定与托管编排 |
 * | `Scheduler.ts` | `src/Unit/AutoDL-Manager/` | **服务无关**的 Promise 依赖解析 |
 *
 * | 组 | 目录 | 语义 |
 * |----|------|------|
 * | **可用性** | `Tunnel/` | 预期实例**已启动**，用自备假服务验机制 |
 * | **危险·生命周期** | `Tunnel/Dangerous/` | 完全管理实例启停，**会产生 GPU 费用**，默认禁用 |
 * | **多进程** | `Tunnel/MultiProcess/` | 两个独立进程无 IPC 接入同一实例 |
 */

import { execFileSync } from "node:child_process";

import { getAutoDLCred } from "@/src/Constant";

/** AutoDL-Manager 侧实例的配置数据
 *
 * ⚠️ 本测试**不需要本地端口映射** —— 假服务只经 SSH 探测
 * （`pgrep` 判存活、`curl` 判就绪），不建本地隧道。
 * 这也顺带消掉了「上一个套件没关隧道，下一个套件撞本地端口」的干扰：
 * 没有映射就不会占用任何本地端口。
 *
 * `keep_alive_sec` 仍要给 —— 实例需要续签保活，与是否映射端口无关。
 *
 * @returns AutoDL 实例的配置数据
 */
export const autodlInstanceData = () => {
    const cred = getAutoDLCred();
    return {
        token: cred.token,
        instance_uuid: cred.instance_uuid,
        keep_alive_sec: 1800,
        local_port_forward: {},
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

/** 断言的辅助：把探测结果整理成人可读摘要
 * @param probe - 探测结果表
 * @returns 形如 "fast=ready slow=none"
 */
export const summarize = (
    probe: Record<string, { ready: boolean; alive: boolean; probeUsed?: boolean }>,
): string =>
    Object.entries(probe)
        .map(([k, v]) => `${k}=${v.ready ? "ready" : v.alive ? "starting" : "none"}`
            + (v.probeUsed ? "(probe)" : ""))
        .join(" ");
