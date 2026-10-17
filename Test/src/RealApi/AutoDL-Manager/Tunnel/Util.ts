/** Tunnel（服务托管）测试共用工具
 *
 * ## 测试目录对齐 `src/`
 * 本模块（AutoDL-Manager）的 `src/` 下有两个并列的包，测试目录与之一一对应：
 * | `src/` | 测试目录 | 测什么 |
 * |--------|---------|--------|
 * | `AutoDL/` | `src/RealApi/AutoDL-Manager/AutoDL/` | 接管、开关机、隧道、终端 |
 * | `Tunnel/` | `src/RealApi/AutoDL-Manager/Tunnel/` | 服务启停协定与托管编排 |
 * | `Scheduler.ts` | `src/Unit/AutoDL-Manager/` | **服务无关**的 Promise 依赖解析 |
 *
 * 故本目录里**没有** `ComfyUI-Manager` 这样的独立分组 ——
 * 托管 ComfyUI 只是 Tunnel 的一个**用例**，不是与 AutoDL 并列的另一件事。
 *
 * | 组 | 目录 | 语义 |
 * |----|------|------|
 * | **可用性** | `Tunnel/` | 预期实例**已在无卡模式启动**，直接测服务可用性 |
 * | **危险·生命周期** | `Tunnel/Dangerous/` | 完全管理实例启停，**会产生 GPU 费用**，默认禁用 |
 * | **多进程** | `Tunnel/MultiProcess/` | 两个独立进程无 IPC 接入同一实例 |
 *
 * ## 与 `AutoDL/` 那组测试的区别
 * `AutoDL/` 测的是**基础能力**（隧道、终端），测试自己拉一个极简 HTTP 服务即可。
 * `Tunnel/` 测的是**托管服务**（本用例里是 clash / Middleware / ComfyUI），
 * 这三者不是 AutoDL 镜像自带的基础设施 —— 它们必须**由使用方部署**到实例上。
 *
 * 因此遵循与 AutoDL 相同的原则：**不依赖远端预置环境** ——
 * 但这里的「环境」指「服务二进制是否就位」，而不是「服务是否已启动」。
 * 缺失时**明确失败并给出路径**，而不是静默跳过（静默跳过会让测试变成假绿）。
 */

import { execFileSync } from "node:child_process";

import { SLogger } from "@zwa73/utils";
import type { ServiceConfig, ServiceKind } from "@sosraciel-lamda/autodl-manager";

import { COMFY_LOCAL_PORT, getAutoDLCred } from "@/src/Constant";

/** 本用例各服务的托管配置（clash / middleware / comfyui）
 * #region
 * ## 为什么这份配置在**测试侧**而不在模块里
 * 模块的机制是**通用**的（隧道 + 服务启停协定），而「clash + middleware + comfyui」
 * 只是它的**一个用例** —— 换个部署（IndexTTS 之类）就整份替换掉，
 * 机制层（`Probe` / `Launcher` / `Instance`）一行都不用改。
 *
 * 既然没有生产代码消费它，放到模块里就等于把「一个用例」冒充成「模块的默认值」，
 * 会诱导使用者以为模块认识 comfyui。故它归测试所有。
 *
 * ## 只有脚本路径，不含任何实现细节
 * 不在本地硬编码去贴合远端（像 `node-v22.14.0-linux-x64` 连版本号都写上去，
 * 换一版就坏）。启动命令、解释器路径、参数、工作目录全在远端的
 * `/root/ComfyUI-Manager/*.sh` 里，由远端自己掌握。
 *
 * ## ⚠️ 返回的是**有序**表 —— 键的顺序即启动顺序
 * 服务之间存在依赖（clash 先起，Middleware 才能经它出网）。
 * 不必为此单独维护依赖表：**顺序本身就编码了依赖**，排在后面的必然需要前面的一切。
 * 真正的依赖边只用 `deps` 显式声明（本用例只有 ComfyUI 依赖 clash）。
 *
 * ## 探测：默认用特征匹配，需要更准时才给 `probe_<kind>.sh`
 * | 服务 | 探测方式 | 原因 |
 * |------|---------|------|
 * | clash | 特征匹配 | 进程在就说明在工作 |
 * | middleware | 特征匹配 | 打包好的 Node 启动是一瞬间，进程在即可用 |
 * | **comfyui** | **`probe_comfyui.sh`** | 启动要数十秒，进程在≠能用 |
 *
 * 快启动的服务不必加 probe（middleware 顶多 2 秒）。
 * mgr 会**先检查 probe 文件是否存在**：存在就用退出码作判据，不存在就退回特征匹配 ——
 * 故删掉该文件不会报错，只是判定变宽松。
 *
 * ## 各服务显式声明自己的 `unique_tag`
 * 它是 mgr **唯一**该关心的东西 —— 只作 `pgrep -f` / `pkill -f` 的匹配键。
 * 远端拿它去建 screen 会话（好让人 `screen -r <tag>` 检视）属于**附带效果**，
 * 换个实现（tmux / 别的）mgr 也不关心。故这里写字面量，而不是让 mgr 去拼。
 *
 * **必须 unique** —— 共用会让 `pkill` 误杀、`pgrep` 误判。
 * #endregion
 *
 * @param scriptDir - 远端脚本目录
 * @returns 各服务的配置（键序即启动顺序）
 */
export const comfyuiService = (scriptDir: string): Record<ServiceKind, ServiceConfig> => ({
    clash: {
        start: `${scriptDir}/start_clash.sh`,
        log: `${scriptDir}/log_clash.sh`,
        unique_tag: "comfyui_manager_clash",
        // clash 是原生二进制, 起得极快 —— 5 秒还起不来就是真出问题了
        expect_ready_sec: 5,
        // 本地 pgrep, 极廉价 —— 探密些, 早探到就早放行 comfyui
        poll_interval_ms: 500,
    },
    // ⚠️ middleware **不声明任何依赖**, 故与 clash **并发启动**:
    // mid 实质上不依赖任何东西, 也不被任何东西依赖
    middleware: {
        start: `${scriptDir}/start_middleware.sh`,
        log: `${scriptDir}/log_middleware.sh`,
        unique_tag: "comfyui_manager_middleware",
        // 打包好的 Node 启动就是一瞬间
        expect_ready_sec: 5,
        poll_interval_ms: 500,
    },
    comfyui: {
        start: `${scriptDir}/start_comfyui.sh`,
        probe: `${scriptDir}/probe_comfyui.sh`,
        log: `${scriptDir}/log_comfyui.sh`,
        unique_tag: "comfyui_manager_comfyui",
        // ComfyUI 要加载模型与后端, 慢得多 —— 但一分钟内应当能起来
        expect_ready_sec: 60,
        // 它的 probe 要经 SSH 打远端原生 API, 比 pgrep 贵得多 —— 探疏些
        poll_interval_ms: 2_000,
        // 唯一的一条依赖边: ComfyUI 拉模型/插件要经 clash 代理出网
        deps: ["clash"],
    },
});

/** 测试用实例名（Tunnel 侧的实例名） */
export const INSTANCE = "TestComfyHost";

/** 实例级终端名（服务**不再共用**它，见下）
 *
 * ⚠️ 只能用 `[A-Za-z0-9_]` —— Jupyter 的 WS 路由是
 * `/terminals/websocket/(\w+)`，不接受连字符等字符。
 * 非法名在 create 时不会报错，要到连 WS 时才失败（详见模块内
 * `JupyterClient.TERMINAL_NAME_RE` 的说明），故务必守住这个字符集。
 */
export const TERMINAL = "comfyui_manager";

/** 本用例各服务的 **tag**（进程特征串）
 *
 * ## tag 是 mgr 唯一该关心的东西
 * 它只被用作两个内嵌指令的匹配键：
 * ```
 * pgrep -f <tag>    探测进程在不在
 * pkill -f <tag>    停掉服务
 * ```
 * 至于远端**怎么**用它（`screen -r <tag>` / tmux / 别的），属于远端脚本的自由，
 * mgr 不关心也不该关心。
 *
 * ⚠️ **必须 unique** —— 两个服务共用 tag 会让 `pkill` 误杀、`pgrep` 误判。
 *
 * ⚠️ 曾误用大写 `COMFYUI_MANAGER_SVC_` —— 那种新旧特征串不一致的状态
 * 会让 `pgrep` 扫不到旧进程，进而重复启动导致端口冲突而卡满超时。
 */
export const SERVICE_TAG: Record<ServiceKind, string> = {
    clash: "comfyui_manager_clash",
    middleware: "comfyui_manager_middleware",
    comfyui: "comfyui_manager_comfyui",
};

/** 远端端口（由服务自身的启动参数决定，测试不可改） */
export const REMOTE_PORT = {
    jupyter: 8888,
    clash: 7890,
    middleware: 6006,
    comfyui: 6005,
} as const;

/** 本测试使用的网关端口配置
 *
 * ## 为什么网关显式配了本地端口
 * 不配就走 AutoDL 自动暴露的公网地址 —— 那是**生产常态**。
 * 但测试要验证的是「我们自己的链路」（隧道 + 网关 + 服务），
 * 配本地端口能确保走的是 SSH 隧道这条可控路径。
 *
 * Jupyter 则**不配** —— 实测公网 Jupyter 带 token 直连返回 200 完整可用，
 * 映射它是多余的。
 */
export const GATEWAY = {
    remote: REMOTE_PORT.middleware,
    local: COMFY_LOCAL_PORT.middleware,
} as const;

/** ComfyUI 用例的实例配置数据
 *
 * ⚠️ 服务表 `service` 现在是**必填**的 —— 本模块不再有「模块默认值」，
 * 服务清单完全由调用方声明。`comfyuiService()` 是本用例的现成预设。
 *
 * tag 由各服务在 `comfyuiService()` 里显式声明（见 {@link SERVICE_TAG}），
 * 实例级不再有「前缀」这个中间变量。
 *
 * @returns 隧道实例的接入数据
 */
export const instanceData = () => ({
    autodl_instance: "AutoDLHost",
    script_dir: SCRIPT_DIR,
    service: comfyuiService(SCRIPT_DIR),
});

/** 本用例的远端脚本目录 */
export const SCRIPT_DIR = "/root/ComfyUI-Manager";

/** 各服务的二进制路径（用于前置校验） */
const SERVICE_BINARY: Record<ServiceKind, string> = {
    clash: "/root/clash/mihomo",
    middleware: "/root/Middleware/index.js",
    comfyui: "/root/ComfyUI/main.py",
};

/** AutoDL 侧需要的端口映射表（由 ComfyUI 侧配置翻译而来）
 *
 * 只有显式填了本地端口的才产生映射 —— 与 `getPortForwards()` 的语义一致。
 * @returns 远端→本地 的端口映射表
 */
export const portForwards = () => ({
    [GATEWAY.local]: String(GATEWAY.remote),
});

/** AutoDL-Manager 侧实例的配置数据
 *
 * ComfyUI-Manager 通过它取得 AutoDL 实例 —— 两个 Manager 各自持有
 * 自己职责范围内的配置，这正是指挥官要求的边界。
 *
 * ⚠️ 核心侧的 `port_forward` 是**列表**（它对 AutoDL 负责，支持任意多端口），
 * 上面的语义化字段在此翻译成列表条目。
 * @returns AutoDL 实例的配置数据
 */
export const autodlInstanceData = () => {
    const cred = getAutoDLCred();
    return {
        token: cred.token,
        instance_uuid: cred.instance_uuid,
        keep_alive_sec: 1800,
        local_port_forward: portForwards(),
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
export const summarize = (
    probe: Record<string, { ready: boolean; alive: boolean; probeUsed?: boolean }>,
): string =>
    Object.entries(probe)
        .map(([k, v]) => `${k}=${v.ready ? "ready" : v.alive ? "starting" : "none"}`
            + (v.probeUsed ? "(probe)" : ""))
        .join(" ");

/** 停掉测试涉及的远端服务（制造冷启动条件的公共部分）
 *
 * ## 改按「进程特征」而非 pid 文件
 * 服务改为**前台运行在专用终端里**后：
 * - **没有 pid 文件**了（前台进程的 pid 就是终端 pid，无需记录）
 * - 停止统一按 `COMFYUI_MANAGER_SVC_<kind>` 特征 `pkill`
 *
 * 这与模块内 `stopService` 的做法一致 —— 特征串由启动脚本用
 * `exec -a` 写进命令行，是唯一稳定的锚点。
 *
 * ## 为什么还要确认 STILL_ALIVE
 * 只 `pkill` 不复查会让「其实没杀掉」静默通过，
 * 于是「冷启动」类测试**测不到想测的东西**（假绿）。
 *
 * @param ssh   - SSH 客户端
 * @param kinds - 要停止的服务
 */
export const stopRemoteServices = async (
    ssh: { exec: (cmd: string) => Promise<{ stdout: string }> },
    kinds: ServiceKind[],
): Promise<void> => {
    for (const kind of kinds) {
        const tag = SERVICE_TAG[kind];
        // 特征串同样要防自匹配: [C]OMFYUI_... 与 COMFYUI_... 等价但不会匹配到本命令
        const safe = `[${tag[0]}]${tag.slice(1)}`;

        // ⚠️ 用换行连接 —— 空格压成一行会让 if/fi 缺分隔符而整段不执行
        const script = [
            `pkill -9 -f '${safe}' 2>/dev/null`,
            `sleep 1`,
            `if pgrep -f '${safe}' >/dev/null 2>&1; then`,
            `  echo STILL_ALIVE`,
            `else`,
            `  echo GONE`,
            `fi`,
        ].join("\n");

        const r = await ssh.exec(script);
        const out = r.stdout.trim();
        SLogger.info(`停止 ${kind}: ${out}`);
        if (out.includes("STILL_ALIVE"))
            SLogger.warn(`⚠️ ${kind} 停止后进程仍在, 冷启动测试的前提不成立!`);
    }
};
