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

import fs from "node:fs";
import path from "pathe";
import { AsyncHbs, SLogger, UtilFunc } from "@zwa73/utils";
import { AutoDLManager } from "@sosraciel-lamda/autodl-manager";

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
 * ## 续签**经 `Drive` 进行**，保活时长由实例配置决定
 * 这里**不再**接受 `keepAliveSec` —— 保活时长只有一个来源：
 * 实例数据里的 `keep_alive_sec`。传入第二份时长会立刻造成
 * 「配置说一套、实际写另一套」的分裂，正是需要避免的。
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

    /** 续签循环 —— 不 await，与 CLI 并行
     *
     * ## ⚠️ 必须经 `Drive` 续签，不能裸调模块级 `renewLifecycle`
     * 指挥官指出：
     * > renewLifecycle 居然不透过 AutoDLManager 实例？我们居然裸调续签，
     * > 这样的话必定会发生 pid 泄露或者说无人监管的 instance 出现，
     * > autodlmgr 判 pid 不属于自己，不管，实际上也没人管，这很危险
     *
     * 机理（`Lifecycle.ts` 的 `renewLifecycle` 写的是 `process.pid`）：
     * 裸调会把**本临时进程**的 pid 写进远端注册文件，而 `shutdownOnExit`
     * 判定时用的是 **Drive 所在进程**的 pid —— 两者不是同一个，于是：
     * - Drive 判「pid 不归自己」→ 去看注册时间 → 未到 → **不关闭**
     * - 本临时进程跑完就退出 → **再没人续、也没人判**
     * 注册文件成了没人认领的遗书，实例悬在计费里。
     *
     * 经 `Drive.renewLifecycle()` 则 pid 与退出判定**同一主体**，
     * 且自动享受 `auto_shutdown === false`（人工看管不续签）的保护。
     */
    const renewLoop = (async () => {
        SLogger.info(`runConductorWithRenew 续签循环启动 (每 ${renewIntervalMs}ms)`);
        while (!isStop()) {
            try {
                await ins.renewLifecycle();
            } catch (err) {
                // 续签失败不该中断任务：它只是「防杀」协商，
                // 失败最多是被守卫误关，重试即可
                SLogger.warn(`runConductorWithRenew 续签失败(将继续重试): ${err}`);
            }
            await interruptibleSleep(renewIntervalMs, isStop);
        }
        SLogger.info(`runConductorWithRenew 续签循环已停止`);
    })();

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

// ────────────────────────────────────────────────────────────────
// 以下为「驱动 Conductor 工作流」的完整入口（LaMDA 侧）
// ────────────────────────────────────────────────────────────────

/** ComfyUI-Conductor 仓库位置
 *
 * 它**不在 LaMDA 仓库内** —— 是独立的调度项目，故必须显式定位。
 * 允许用环境变量覆盖，换机器时不必改代码。
 */
const conductorDir = (): string =>
    process.env.COMFYUI_CONDUCTOR_DIR
    ?? "K:/Model/StableDiffusion/SoulTide-ImageData-Manager/ComfyUI-Conductor";

/** 工作流目标（`flow.ps1` 的第一个参数，相对 Conductor 的 `Workspace/`）
 *
 * 用 `SosarcielLaMDA`（即其 `index.ts` 的 CLI），而**不是**内部的 `run` 样例 ——
 * 指挥官定：LaMDA 侧要「完整的操作 ComfyUI-Conductor 提供的工作流 cli」，
 * 那就该走它对外暴露的 CLI 契约，而不是去跑它自家写死的样例。
 */
const WORKFLOW_TARGET = "SosarcielLaMDA";

/** 模板占位符渲染
 *
 * 复用 `@zwa73/utils` 的 `AsyncHbs` —— 它就是个 handlebars 包装，
 * `{{Key}}` 取值语义与 Conductor 的 payload 模板一致，
 * 没必要自己再写一套 `split/join`。
 *
 * ⚠️ 渲染失败时 `AsyncHbs.render` 返回 `undefined`（内部已记日志），
 * 这里必须转成抛错 —— 否则模板写错时会静默写出一个空 payload，
 * 一路跑到远端才炸，排查成本极高。
 *
 * @param param.template - 模板全文
 * @param param.value    - 占位符取值表（键不含花括号）
 * @returns 渲染后的文本
 * @throws 渲染失败或结果为空时抛出
 */
const renderPayload = async (param: {
    /** 模板全文 */
    template: string;
    /** 占位符取值表（键不含花括号） */
    value: Record<string, string>;
}): Promise<string> => {
    const { template, value } = param;
    const hbs = await AsyncHbs.create();
    const res = await hbs.render({ template, context:value });
    if (res == undefined) {
        throw new Error(
            "renderPayload 渲染失败 —— 模板语法可能有误"
            + "(AsyncHbs.render 出错时会返回 undefined)");
    }
    if (res.text.trim() === "") {
        throw new Error("renderPayload 渲染结果为空 —— 模板可能没有可用内容");
    }
    return res.text;
};

/** 驱动 Conductor 跑一次工作流（LaMDA 侧的完整入口）
 *
 * ## 职责（指挥官裁定）
 * LaMDA 侧**完整操作** Conductor 提供的工作流 CLI：
 * 1. 自己生成 uid（`UtilFunc.genUUID()` 的 32 位 hex）
 * 2. 读模板、替换 `{{xx}}` 占位符，写成临时 payload
 * 3. 拼 `flow.ps1 <Target> --payload <uid> --uid <uid> --res <resDir>`
 * 4. 跑完删临时 payload，只保留下载回来的产物
 *
 * ## 产物目录也由这里定
 * `--res` 由本函数的 `resDir` 参数决定，产物落到 `<resDir>/<uid>/`，
 * **不再**用 Conductor 项目里那个默认 `out`。
 *
 * ## payload 为什么写在 Conductor 目录里
 * Conductor 的 `PAYLOAD_DIR` 是它 `Workspace/Payload`，
 * `--payload` 只接受**相对该目录的名字**。故临时 payload 必须写在那里，
 * 用完立刻删掉，不给它留下垃圾。
 *
 * @param param.autoDLInstance - AutoDL 实例名（供续签用）
 * @param param.resDir         - 资源根目录，产物落到其下的 uid 子目录
 * @param param.value          - 模板占位符取值表
 * @param param.templateName   - 模板名（相对 Payload 目录，不含 .md），默认 `lamda/default`
 * @param param.uid            - 指定 uid；缺省自动生成
 * @param param.renewIntervalMs- 续签间隔/毫秒，默认 30_000
 * @param param.timeoutMs      - 兜底超时/毫秒，默认 1 小时
 * @param param.keepPayload    - 保留临时 payload（调试用），默认删除
 * @returns uid 与 CLI 输出
 */
export const runConductorWorkflow = async (param: {
    /** AutoDL 实例名 */
    autoDLInstance: string;
    /** 资源根目录，产物落到其下的 uid 子目录 */
    resDir: string;
    /** 模板占位符取值表 */
    value: Record<string, string>;
    /** 模板名（相对 Payload 目录，不含 .md），默认 `lamda/default` */
    templateName?: string;
    /** 指定 uid；缺省自动生成 */
    uid?: string;
    /** 续签间隔/毫秒，默认 30_000 */
    renewIntervalMs?: number;
    /** 兜底超时/毫秒，默认 1 小时 */
    timeoutMs?: number;
    /** 保留临时 payload（调试用），默认删除 */
    keepPayload?: boolean;
}): Promise<{ uid: string; stdout: string; stderr: string }> => {
    const {
        autoDLInstance,
        resDir,
        value,
        templateName = "lamda/default",
        uid = UtilFunc.genUUID(),
        renewIntervalMs,
        timeoutMs,
        keepPayload = false,
    } = param;

    const root = conductorDir();
    const payloadPath = path.join(root, "Workspace", "Payload", `${uid}.md`);
    const templatePath = path.join(root, "Workspace", "Payload", `${templateName}.md`);
    const absRes = path.resolve(resDir);

    // ① 读模板 —— 缺失时明确报错，而不是让 CLI 报一个含糊的错
    const template = await fs.promises.readFile(templatePath, "utf-8")
        .catch(() => undefined);
    if (template == undefined) {
        throw new Error(`runConductorWorkflow 模板不存在: ${templatePath}`);
    }

    // ② 渲染并写临时 payload
    const rendered = await renderPayload({ template, value });
    await fs.promises.mkdir(path.dirname(payloadPath), { recursive: true });
    await fs.promises.writeFile(payloadPath, rendered, "utf-8");
    SLogger.info(`runConductorWorkflow uid=${uid} 临时 payload: ${payloadPath}`);

    try {
        // ③ 走 Conductor 对外的 CLI 契约
        //
        // ## 为什么不经 `flow.ps1`
        // 指挥官指出：
        // > 我们不一定要走 ./flow.ps1，那个是个简单的包装，我们直接 ts-node 就行
        //
        // 核对属实，`flow.ps1` 全文就是一行转发：
        // ```powershell
        // npx ts-node -r tsconfig-paths/register --project tsconfig.json `
        //     Workspace/<Target> @RestArgs
        // ```
        // 直接调 `ts-node` 少一层 PowerShell，也就少一类参数解析坑 ——
        // 实测 `-File flow.ps1 --payload xxx` 会被 PowerShell 抢走 `--payload`，
        // 报 `A parameter cannot be found that matches parameter name '-payload'`
        // （`flow.ps1` 的 `ValueFromRemainingArguments` 对 `--xxx` 形式不生效）。
        //
        // 绕开它之后，参数由 node 侧的 commander 直接接收，不存在解析歧义。
        const command = [
            "npx ts-node -r tsconfig-paths/register --project tsconfig.json",
            `Workspace/${WORKFLOW_TARGET}`,
            `--payload ${uid}`,
            `--uid ${uid}`,
            `--res "${absRes}"`,
        ].join(" ");

        const res = await runConductorWithRenew({
            autoDLInstance,
            command,
            renewIntervalMs,
            timeoutMs,
            execOpt: { cwd: root, nodeModules: "None" },
        });
        return { uid, stdout: res.stdout, stderr: res.stderr };
    } finally {
        // ④ 产物已落盘，临时 payload 不再需要；失败也清掉，免得堆积
        if (!keepPayload) {
            await fs.promises.rm(payloadPath, { force: true })
                .then(() => SLogger.info(`runConductorWorkflow 已清理临时 payload`))
                .catch(err => SLogger.warn(`runConductorWorkflow 清理临时 payload 失败: ${err}`));
        }
    }
};
