/** 真实业务完整链路测试（需 GPU，管理与业务一体）
 *
 * ## 为什么这里「不管生命周期」是伪命题（指挥官裁定）
 * > 不管生命周期的「真实业务」其实是个伪命题，其他「预期启动」的测试都是
 * > 建立在我手动开了 cpu 实例，但真实业务一定是 gpu 的，而 gpu 一定是
 * > 测完就应该关掉的。
 * > 此前你自行开后台 autodlmgr 做保活实际上是一个调试过程，而不是测试过程，
 * > 所以，应该改造成真的完整生命周期测试。
 *
 * 确实：其它测试的 `assertInstanceRunning` 之所以成立，是因为**CPU 模式实例
 * 可以长期开着**（不计 GPU 费）。而真实生图**必然需要 GPU**，那就必然要
 * 有始有终 —— 所以本测试**自己拉起、自己收尾**。
 *
 * ## 覆盖的完整链路
 * `autodlmgr 开机 → 建隧道/映射 → tunnelmgr 拉起服务 → Conductor 跑真实生图
 *  → 产物下载到本地 → 主动关停实例（按签约文件所有权判定）`
 *
 * ## ⚠️ 防呆
 * `AUTODL_REAL_WORKFLOW=true` 才启用 —— 它会**真实开机并产生 GPU 费用**。
 */

import fs from "node:fs";
import path from "pathe";
import { AutoDLManager, TunnelManager, comfyuiService } from "@sosraciel-lamda/autodl-manager";
import { SLogger } from "@zwa73/utils";

import { COMFY_LOCAL_PORT, getAutoDLCred } from "@/src/Constant";

import { runConductorWorkflow } from "./Conductor";

/** 真实生图总开关：仅当显式设置环境变量才启用（会真实开机烧 GPU） */
const ENABLED = process.env.AUTODL_REAL_WORKFLOW === "true";

const describeFlow = ENABLED ? describe : describe.skip;

if (!ENABLED) {
    SLogger.warn("真实业务完整链路测试跳过。它会真实开机并产生 GPU 费用，"
        + "只有显式设置 AUTODL_REAL_WORKFLOW=true 才执行。");
}

/** AutoDL 侧实例名 */
const HOST_INSTANCE = "AutoDLHost";
/** Tunnel 侧实例名 */
const INSTANCE = "RealWorkflowHost";

/** 本地映射端口 —— 与 Conductor 的 COMFY_URL 对应 */
const GATEWAY_LOCAL = COMFY_LOCAL_PORT.middleware;

/** 产物资源根目录
 *
 * **由 LaMDA 侧决定**，经 `--res` 传给 Conductor 的 CLI，
 * 实际产物落在 `<PRODUCT_DIR>/<uid>/`。
 *
 * 刻意**不用** Conductor 项目里那个默认 `out` —— 产物属于我们的业务，
 * 该落在我们自己的工作区里。
 */
const PRODUCT_DIR = process.env.AUTODL_REAL_PRODUCT_DIR
    ?? path.join(__dirname, "../../../../data/real-workflow-out");

/** 超时上限/毫秒（真实生图含队列等待，给足余量） */
const TIMEOUT = {
    setup: 120_000,
    boot: 300_000,
    ensureReady: 600_000,   // 含开机（冷启动可能较慢）
    workflow: 3_600_000,    // 1 小时兜底，远端队列可能让总时长扩展数倍
    shutdown: 180_000,
};

describeFlow("真实业务完整链路", () => {

    beforeAll(async () => {
        const cred = getAutoDLCred();
        AutoDLManager.initInject({
            // ⚠️ **本组必须允许真实开关机** —— 它管理实例生命周期。
            // 若沿用默认的 false, 开关机会被安全闸门静默拦下, 变成假绿。
            allowPowerControl: true,
            serviceTable: {
                instance_table: {
                    [HOST_INSTANCE]: {
                        type: "ProInstance",
                        name: HOST_INSTANCE,
                        data: {
                            token: cred.token,
                            instance_uuid: cred.instance_uuid,
                            // 保活 1 小时: 足够跑完一次真实生图; 进程若异常退出,
                            // 还有退出守护按所有权判定关停
                            keep_alive_sec: 3600,
                            local_port_forward: {
                                [String(GATEWAY_LOCAL)]: "6006",
                            },
                        },
                    },
                },
            },
        });
        await AutoDLManager.sm.inited;

        TunnelManager.initInject({
            serviceTable: {
                instance_table: {
                    [INSTANCE]: {
                        type: "TunnelInstance",
                        name: INSTANCE,
                        data: {
                            autodl_instance: HOST_INSTANCE,
                            script_dir: "/root/ComfyUI-Manager",
                            prefix: "comfyui_manager_",
                            service: comfyuiService("/root/ComfyUI-Manager"),
                        },
                    },
                },
            },
        });
        await TunnelManager.sm.inited;
    }, TIMEOUT.setup);

    it("应完整走通 开机→映射→服务→生图→下载 全链路", async () => {
        // ① 开机 + 建隧道 + 拉起服务
        //
        // ⚠️ `ensureReady` 内部会**开机(有卡模式)** —— 这一步开始计费。
        // 若开机失败（无空闲 GPU / 无卡模式 / 闸门拦下），模块内部已打印
        // 具体原因，此处**不解析错误类型**：实质上所有 powerOn=false 的情况
        // 都不是本地代码能修的（指挥官裁定），故直接中断测试。
        const st0 = await (await AutoDLManager.getInstance(HOST_INSTANCE))!.getStatus();
        SLogger.info(`真实业务完整链路: 初始实例状态 ${st0}`);

        const ok = await TunnelManager.ensureReady({
            instanceName: INSTANCE,
            require: ["clash", "middleware", "comfyui"],
            timeoutSec: TIMEOUT.ensureReady / 1000,
        });

        if (!ok) {
            // 明确区分「起不来」与「断言失败」：起不来通常意味着环境问题
            // （无空闲 GPU / 无卡模式），不是被测逻辑的缺陷。
            const st = await (await AutoDLManager.getInstance(HOST_INSTANCE))!.getStatus();
            const detail = st === "shutdown"
                ? "实例仍为 shutdown —— 开机未能成功(常见原因: 无空闲 GPU 或闸门拦下)。"
                + "请查看上方 AutoDLProClient.powerOn 的日志, 待资源可用后重跑。"
                : `实例当前 ${st}, 但服务未全部就绪。`;
            throw new Error(`真实业务完整链路 前置失败: ${detail}`);
        }
        SLogger.info(`真实业务完整链路: 隧道/服务就绪, 网关 ${GATEWAY_LOCAL}`);

        // ② LaMDA 侧完整驱动 Conductor 的 CLI
        //    自己生成 uid、渲染 payload、指定产物目录，跑完清理临时 payload
        const { uid, stdout, stderr } = await runConductorWorkflow({
            autoDLInstance: HOST_INSTANCE,
            resDir: PRODUCT_DIR,
            renewIntervalMs: 30_000,
            timeoutMs: TIMEOUT.workflow,
            value: {
                CharName: "Akaset",
                Custom: "Vanilla",
                PromptTemplate: "NSFW_CG",
                Scene: [
                    "*Akaset 跪坐在舷窗边，指尖抵着冰凉的玻璃，望着外面缓慢旋转的星环*",
                    "",
                    "指挥官……Akaset 把这一帧留给您。",
                ].join("\n"),
                Premise: "周克王国的皇家战舰在星环轨道上待机，舷窗外是缓慢旋转的碎石带。",
            },
        });

        // ②-1 先把 CLI 的**完整输出落盘**，再做任何断言
        //
        // ## 为什么必须落盘
        // 实测踩到：一次真实链路跑失败，错误文本是
        // `[<uid>-EnhancePrompt]:增强提示词为空` —— 这是 **Conductor CLI 自己打印的**，
        // 而 CLI 是子进程，输出只经 `UtilFunc.exec` 的返回值回到这里。
        //
        // 先前只在断言失败时看 jest 的差异片段，**整份输出就此丢失**，
        // 于是只能对着错误文本反复猜测（甚至猜错过整条因果链）。
        // 落盘一次就再也不会丢 —— 失败时直接读文件，不靠回忆。
        const logPath = path.join(PRODUCT_DIR, `${uid}.cli.log`);
        await fs.promises.mkdir(PRODUCT_DIR, { recursive: true });
        await fs.promises.writeFile(
            logPath,
            `=== uid: ${uid} ===\n=== stdout ===\n${stdout}\n=== stderr ===\n${stderr}\n`,
            "utf-8",
        );
        SLogger.info(`真实业务完整链路: CLI 完整输出已落盘 → ${logPath}`);

        // ③ CLI 输出里应能看到下载完成的成功日志
        const output = `${stdout}\n${stderr}`;
        if (!output.includes("下载完成"))
            SLogger.error(`真实业务完整链路 CLI 未报告下载完成, 完整输出见 ${logPath}`);
        expect(output).toContain("下载完成");

        // ④ 产物应落在 LaMDA 侧指定的 `<resDir>/<uid>/` 下
        const productDir = path.join(PRODUCT_DIR, uid);
        const files = await fs.promises.readdir(productDir).catch(() => [] as string[]);
        expect(files.length).toBeGreaterThan(0);
        SLogger.info(`真实业务完整链路: 生图完成 uid=${uid}, 产物 ${files.length} 个 → ${productDir}`);
    }, TIMEOUT.workflow);

    // ⑤ 收尾：停服务 + 关实例
    //
    // ## 为什么收尾要显式做，而不是只靠退出守护
    // `startExitGuard` 挂的是 `SIGINT`/`SIGTERM`/`uncaughtException` ——
    // 那些回调**可以 await**，故能真正关掉远端实例。
    // 但 `process.on('exit')` 不行（回调只能跑同步代码，发不出 HTTP）。
    // 实测语境里「实际调用时要关闭必然是 Ctrl+C」，那条路径是安全的；
    // 而**测试跑完是正常退出**，不会触发 SIGINT —— 故这里主动收尾一次，
    // 保证「测完即关、无泄漏」。
    afterAll(async () => {
        SLogger.info("真实业务完整链路: 开始收尾");
        try {
            const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
            if (ins == undefined) return;

            // 实例没在跑就没什么可停的 —— 服务都挂在它的托管终端里。
            //
            // 实测：无库存时 `ensureReady` 在开机那步就返回 false，
            // 实例始终是 shutdown，而收尾仍去停服务，于是刷出一串
            // `ECONNREFUSED` 的 warn。那些**噪音会掩盖真问题**，
            // 故这里先确认状态，不在跑的实例直接跳过停服务。
            const st = await ins.getStatus();
            if (st === "running") {
                await TunnelManager.teardown(INSTANCE).catch(e =>
                    SLogger.warn(`真实业务完整链路: 停服务失败(不影响关机): ${e}`));
            } else {
                SLogger.info(`真实业务完整链路: 实例为 ${st}, 无需停服务`);
            }

            // 再按**所有权判定**关停实例 —— 与退出守护走同一条逻辑
            await ins.shutdownOnExit();
            SLogger.info("真实业务完整链路: 收尾关停已执行");
        } catch (e) {
            SLogger.error(`真实业务完整链路: 收尾失败 ${e}`);
        }
    }, TIMEOUT.shutdown);
});
