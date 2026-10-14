/** 真实业务工作流测试（需 GPU，独立于固定 Tunnel 测试）
 *
 * ## 为什么单独建文件
 * 指挥官：
 * > 真实工作流测试不要丢进 `full-lifecycle.test.ts`，单独区分出来一个测试。
 * > 固定的 tunnel 测试不要和实际业务耦合，因为业务变动会比较频繁，
 * > 而测试追求的是固定
 *
 * 本文件验证的是**完整业务链路**：
 * `autodlmgr 拉起容器 → tunnelmgr 拉起 ComfyUI → Conductor 跑真实生图 → 产物下载`
 *
 * 它不像固定测试那样追求「每次都能跑、低波动」，而是**真实生图**，
 * 会消耗 GPU 与算力，默认跳过；由 `AUTODL_REAL_WORKFLOW=true` 显式开启。
 */

import { AutoDLManager, TunnelManager, comfyuiService } from "@sosraciel-lamda/autodl-manager";
import { SLogger } from "@zwa73/utils";

import { COMFY_LOCAL_PORT } from "@/src/Constant";
import { getAutoDLCred } from "@/src/Constant";

import { runConductorWithRenew } from "./Conductor";

/** 危险测试总开关：仅当显式设置环境变量才启用 */
const ENABLED = process.env.AUTODL_REAL_WORKFLOW === "true";
const describeFlow = ENABLED ? describe : describe.skip;

if (!ENABLED) {
    SLogger.warn("真实业务工作流测试跳过。需要 GPU 算力，且只有显式设置 AUTODL_REAL_WORKFLOW=true 才执行。");
}

/** AutoDL 侧实例名 */
const HOST_INSTANCE = "AutoDLHost";
/** Tunnel 侧实例名 */
const INSTANCE = "RealWorkflowHost";

/** 本地映射端口 —— 与 Conductor 的 COMFY_URL 对应 */
const GATEWAY_LOCAL = COMFY_LOCAL_PORT.middleware;

/** 超时上限/毫秒（真实生图含队列等待，给足余量） */
const TIMEOUT = {
    setup: 120_000,
    ensureReady: 300_000,
    workflow: 3_600_000,   // 1 小时兜底，远端队列可能让总时长扩展数倍
};

describeFlow("真实业务工作流", () => {

    beforeAll(async () => {
        const cred = getAutoDLCred();
        AutoDLManager.initInject({
            allowPowerControl: false,
            serviceTable: {
                instance_table: {
                    [HOST_INSTANCE]: {
                        type: "ProInstance",
                        name: HOST_INSTANCE,
                        data: {
                            token: cred.token,
                            instance_uuid: cred.instance_uuid,
                            keep_alive_sec: 18000,
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

    it("应拉起 ComfyUI 并跑通真实生图，产物下载到本地", async () => {
        // ① 确保隧道与三个服务都就绪
        const ok = await TunnelManager.ensureReady({
            instanceName: INSTANCE,
            require: ["clash", "middleware", "comfyui"],
            timeoutSec: 300,
        });
        expect(ok).toBe(true);
        SLogger.info(`真实业务工作流: 隧道/服务就绪, 网关 ${GATEWAY_LOCAL}`);

        // ② 跑 Conductor 工作流（自带上游续签 + 1 小时兜底超时）
        const conductorDir = "K:/Model/StableDiffusion/SoulTide-ImageData-Manager/ComfyUI-Conductor";
        const command = "powershell -NoProfile -ExecutionPolicy Bypass -File flow.ps1 SosarcielLaMDA/run";
        const res = await runConductorWithRenew({
            autoDLInstance: HOST_INSTANCE,
            command,
            keepAliveSec: 300,
            renewIntervalMs: 30_000,
            execOpt: { cwd: conductorDir, nodeModules: "None" },
        });

        // ③ CLI 输出里应能看到「下载完成」的成功日志
        const output = `${res.stdout}\n${res.stderr}`;
        expect(output).toContain("下载完成");
        SLogger.info("真实业务工作流 完成", res.stdout.slice(-3000));
    }, TIMEOUT.workflow);
});
