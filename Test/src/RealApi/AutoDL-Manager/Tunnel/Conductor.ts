/** ComfyUI-Conductor 的**调用方编排**（实施层）
 *
 * ## 职责边界（指挥官裁定）
 * Conductor **只对端口负责** —— 它跑在本地、只连 `COMFY_URL`，
 * 不知道 AutoDL、不知道实例生命周期、更不知道「续签」这件事。
 *
 * 续签必须由**调用方**负责：本文件在 `UtilFunc.exec` 跑 Conductor CLI
 * 的**同时**开一个 Promise 做循环续签，直到任务完成再关掉。
 *
 * ## 为什么续签不能放进 Conductor
 * 续签要写远端生命周期注册文件（`renewLifecycle`），那是
 * **AutoDL-Manager 的知识**。让 Conductor 依赖它就把「只认端口」这条
 * 边界捅穿了 —— Conductor 也不该知道 AutoDL 的存在。
 *
 * ## 实施层定位
 * 这里是「业务链路」而非「模块能力」，将来应挪去 `server` 主程序
 * 的应用层。当下先在 Test 项目里跑通。
 */

import { SLogger, UtilFunc } from "@zwa73/utils";
import { AutoDLManager, renewLifecycle } from "@sosraciel-lamda/autodl-manager";
import type { SshClient } from "@sosraciel-lamda/autodl-manager";

/** 可中断的定时器等待
 *
 * 刻意不用 `UtilFunc.sleep` —— 那是不可中断的 `setTimeout`，
 * 任务结束后还得空等一整个间隔（默认 30 秒）才能退出续签循环。
 *
 * 这里用**自己的定时器**：每 200ms 看一次是否该停，
 * 停（任务结束）就立刻放行，不会拖住进程退出。
 *
 * @param ms     - 最长等待毫秒数
 * @param isStop - 返回 true 时提前结束等待
 */
const interruptibleSleep = (ms: number, isStop: () => boolean): Promise<void> =>
    new Promise(resolve => {
        const timer = setInterval(() => {
            if (isStop()) {
                clearInterval(timer);
                resolve();
            }
        }, 200);
        setTimeout(() => {
            clearInterval(timer);
            resolve();
        }, ms);
    });

/** 默认保活时长/秒 —— 指挥官原话「5分钟」
 *
 * 任务在跑就每 30 秒把存活期推到「现在 + 300 秒」，
 * 远大于一个真实生图任务的单次执行窗口。
 */
const DEFAULT_KEEP_ALIVE_SEC = 300;

/** 默认 CLI 超时/毫秒 —— 指挥官定的「大时间兜底，一小时」
 *
 * 远端 ComfyUI 有任务队列，可能多个物理客户端同时发任务，
 * 总时长会被扩展数倍，所以**不能**靠预期时间去判断。
 * 我们完全相信 Conductor 的 CLI 会正确返回错误；
 * 这里只是防「进程永久挂死」的保险，不是业务超时。
 */
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;

/** 执行 ComfyUI-Conductor CLI，并在任务期间持续续签实例生命周期
 *
 * 续签循环与 CLI **并行**跑：CLI 跑多久就续多久，
 * CLI 结束（成功或失败）后由 `finally` 立刻停掉。
 *
 * ## 续签要「积极」，与守护循环的分工不同（指挥官裁定）
 * - **续签（本函数）** = **积极保活**：任务在跑就频繁把存活期往后推，
 *   确保**任务期间绝不出现过期窗口**。
 * - **守护循环（`AutoDLManager.guardCheck`）** = **兜底**：
 *   防止「没人管了却还开着」的实例一直烧钱。
 *
 * 故这里的间隔应当**短**（默认 30 秒），而不是去对齐守护循环的 60 秒。
 * 远端 IO 压力不是问题：`renewLifecycle` 内部另有 `WRITE_MARGIN_SEC`
 * 冗余阈值，增量不足时会跳过实际写盘。
 *
 * ## 超时 = 仅兜底，不杀子进程（指挥官裁定）
 * 远端任务是**队列式**的，可能多个客户端一起等，总时长扩展数倍。
 * 因此：
 * - **完全相信 Conductor CLI 正确返回错误**（`pollHistory` 会抛错、CLI 会非零退出）
 * - `exec` 只做一个**大时间兜底**（默认 1 小时），防止永久挂死
 * - 超时用 `Promise.race` 直接放弃等待即可，**不必认真中断 exec 的子进程**
 *
 * ## `execOpt.cwd` 必须由调用方指定
 * `UtilFunc.exec` 在 Windows 走 `cmd.exe`，`cd K:/...` 这种正斜杠路径
 * 会被它判为「找不到路径」。正确做法是把工作目录放进 `execOpt.cwd`，
 * 命令字符串里**不要写 `cd`**。
 *
 * @param param.autoDLInstance  - AutoDL 实例名（用于取 SSH 与续签）
 * @param param.command         - 要执行的 CLI 命令（不含 cd）
 * @param param.keepAliveSec    - 每次续签把存活期设为「现在 + 这个秒数」，默认 300
 * @param param.renewIntervalMs - 续签间隔/毫秒，默认 30_000（积极保活）
 * @param param.timeoutMs       - 兜底超时/毫秒，默认 1 小时
 * @param param.execOpt         - 透传给 `UtilFunc.exec` 的选项，`cwd` 应放这里
 * @returns CLI 的 stdout/stderr
 */
export const runConductorWithRenew = async (param: {
    /** AutoDL 实例名 */
    autoDLInstance: string;
    /** 要执行的 Conductor CLI 命令（不含 cd） */
    command: string;
    /** 每次续签把存活期设为「现在 + 这个秒数」，默认 300（5 分钟） */
    keepAliveSec?: number;
    /** 续签间隔/毫秒，默认 30_000（积极保活，不等同于守护循环周期） */
    renewIntervalMs?: number;
    /** 兜底超时/毫秒，默认 1 小时 */
    timeoutMs?: number;
    /** 透传给 `UtilFunc.exec` 的选项，`cwd` 应放这里 */
    execOpt?: Parameters<typeof UtilFunc.exec>[1];
}): Promise<{ stdout: string; stderr: string }> => {
    const {
        autoDLInstance,
        command,
        keepAliveSec = DEFAULT_KEEP_ALIVE_SEC,
        renewIntervalMs = 30_000,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        execOpt,
    } = param;

    const ins = await AutoDLManager.getInstance(autoDLInstance);
    if (ins == undefined) throw new Error(`AutoDL 实例不存在: ${autoDLInstance}`);
    const ssh = await ins.getSshClient();
    if (ssh == undefined) throw new Error(`AutoDL 实例无法取得 SSH: ${autoDLInstance}`);

    let stopped = false;
    const isStop = () => stopped;

    /** 续签循环 —— 不 await，与 CLI 并行 */
    const renewLoop = (async (ssh: SshClient) => {
        SLogger.info(`runConductorWithRenew 续签循环启动 (每 ${renewIntervalMs}ms)`);
        while (!isStop()) {
            try {
                await renewLifecycle(ssh, keepAliveSec);
            } catch (err) {
                // 续签失败不该中断任务：它只是「防杀」协商，
                // 失败最多是被守卫误关，重试即可
                SLogger.warn(`runConductorWithRenew 续签失败(将继续重试): ${err}`);
            }
            await interruptibleSleep(renewIntervalMs, isStop);
        }
        SLogger.info(`runConductorWithRenew 续签循环已停止`);
    })(ssh);

    try {
        SLogger.info(`runConductorWithRenew 执行 CLI: ${command} (超时兜底 ${timeoutMs}ms)`);
        // 超时只是「不再等待这个 Promise」，不负责杀掉子进程 ——
        // 远端 ComfyUI 队列由 Conductor 的 CLI 自行把错误抛出来
        const result = await Promise.race([
            UtilFunc.exec(command, execOpt),
            new Promise<never>((_, reject) => {
                setTimeout(() => reject(
                    new Error(`runConductorWithRenew CLI 超时(${timeoutMs}ms), 放弃等待`)), timeoutMs);
            }),
        ]);
        SLogger.info(`runConductorWithRenew CLI 完成`);
        return result;
    } finally {
        stopped = true;
        await renewLoop.catch(() => undefined);
    }
};
