/**为 Conductor 常驻隧道
 *
 * 这是「完整业务测试」链路的中段：
 * `autodlmgr 拉起容器 → [本脚本] 建隧道并确保服务 → Conductor 跑工作流`
 *
 * 隧道随本进程存活而存在，故本脚本**不主动退出**，
 * 由外部（后台作业）控制生命周期。
 */

import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const { AutoDLManager, TunnelManager, comfyuiService } = require("@sosraciel-lamda/autodl-manager");

const credPath = "F:/Sosarciel/Sosarciel-LaMDA/LaMDA-Module/Service-Manager/AutoDL-Manager/data/cred.txt";
const L = fs.readFileSync(credPath, "utf8").split(/\r?\n/).map(s => s.trim());

AutoDLManager.initInject({
    allowPowerControl: false,
    serviceTable: {
        instance_table: {
            BJ: {
                type: "ProInstance", name: "BJ",
                data: {
                    token: L[1],
                    instance_uuid: L[10],
                    keep_alive_sec: 18000,
                    // 端口协定：远端 6006(网关) → 本地 26531
                    local_port_forward: { "26531": "6006" },
                },
            },
        },
    },
});
await AutoDLManager.sm.inited;

TunnelManager.initInject({
    serviceTable: {
        instance_table: {
            CloudA: {
                type: "TunnelInstance", name: "CloudA",
                data: {
                    autodl_instance: "BJ",
                    script_dir: "/root/ComfyUI-Manager",
                    prefix: "comfyui_manager_",
                    service: comfyuiService("/root/ComfyUI-Manager"),
                },
            },
        },
    },
});
await TunnelManager.sm.inited;

const ok = await TunnelManager.ensureReady({
    instanceName: "CloudA",
    require: ["clash", "middleware", "comfyui"],
    timeoutSec: 300,
});
console.log(`READY=${ok}`);

// 常驻：隧道随本进程存活，不主动退出
setInterval(() => { }, 1 << 30);
