/** 多进程测试的**独立工作进程**
 *
 * ## 这个文件要证明什么
 * 指挥官描述的最基础使用场景：
 * > 两个物理机连着一个 autodl 实例发生图任务
 *
 * 即**两个独立进程**（模拟两台物理机）同时接入同一实例，
 * 彼此**没有任何进程间通讯**，各自独立地：
 * 1. 判断远端服务是否已启动
 * 2. 未启动则自己去叫 Jupyter 终端把它拉起来
 *
 * 关键风险是**竞态**：两个进程同时探测到「服务没起」，
 * 于是都去启动，造成端口抢占、进程翻倍、`Address already in use` 之类的事故。
 *
 * 本进程只做一件事：**按 TunnelManager 的正常用法接入并确保就绪**，
 * 然后把观测到的过程以 JSON 报给父进程做时间线比对。
 *
 * ## 为什么用独立 js 文件而非 jest 内联
 * 必须是真的**独立进程**才有意义 —— jest 的模块内联无法模拟这个场景。
 * 本文件作为 .mjs 直接运行，走编译产物（dist），与生产使用方式一致。
 *
 * ## 用法
 * ```
 * node worker.mjs <workerId> <eventFile>
 * ```
 */

import fs from "node:fs";
import { createRequire } from "node:module";

/** CommonJS require —— 被测模块是 CJS(无 exports 映射),
 *  ESM 的 import 解析不了包名, 故用 createRequire 走 Node 的 CJS 解析规则。
 */
const require = createRequire(import.meta.url);

/** 命令行参数
 * - argv[2]: 本进程的标识（A / B）
 * - argv[3]: 事件输出的 JSON 文件路径（父进程读取比对）
 */
const WORKER_ID = process.argv[2] ?? "?";
const EVENT_FILE = process.argv[3];

/** 事件缓冲：记录带时间戳的关键节点，供父进程还原时间线 */
const events = [];

/** 记录一个事件
 * @param phase - 阶段名
 * @param detail - 补充信息
 */
const record = (phase, detail = "") => {
    const ev = { worker: WORKER_ID, phase, detail, at: Date.now() };
    events.push(ev);
    console.log(`[${WORKER_ID}] ${phase} ${detail}`);
};

/** 截获 SLogger 的输出
 *
 * 单纯靠自定义的 record() 无法观察到模块内部「走的是等待路径还是启动路径」——
 * 那发生在 `ensureService` 内部。因此把 SLogger 的输出也挂钩下来，
 * 凡是含关键字的日志都记成事件，供父进程断言「锁真的起了作用」。
 *
 * ## ⚠️ 关键词必须是**带来源前缀的完整串**
 * 早先用的是 `"启动 clash"` 这种裸串，于是新增的调度器日志
 * `Scheduler 调度 clash 启动 (预期 5s 内就绪)` 也被算作「真的执行了启动」，
 * 导致两个 worker 都被计成启动者 —— 判定完全失效。
 *
 * 现在一律带模块前缀：只有 `TunnelLauncher` 打的才算「执行了启动」，
 * 调度器只是**决定**要启动，真正拉起的是 Launcher。
 *
 * @param SLogger - 被测模块使用的 logger
 */
const hookLogger = (SLogger) => {
    const KEYWORDS = [
        // 抢锁失败的信号 —— 出现它说明锁真的协调了两个进程
        "TunnelLauncher clash 已有其他进程在启动",
        "TunnelLauncher middleware 已有其他进程在启动",
        // 真正执行了启动(抢到锁且复查为 dead 之后才打)
        "TunnelLauncher 启动 clash",
        "TunnelLauncher 启动 middleware",
        // 复查发现已有进程 —— 也是「没重复启动」的证据
        "TunnelLauncher clash 抢锁后复查有变化",
        "TunnelLauncher middleware 抢锁后复查有变化",
    ];
    const origInfo = SLogger.info.bind(SLogger);
    SLogger.info = (msg, ...rest) => {
        const text = String(msg);
        const hit = KEYWORDS.find(k => text.includes(k));
        if (hit != undefined) record("log", text.slice(0, 160));
        return origInfo(msg, ...rest);
    };
};

/** 把事件写入文件（父进程据此比对） */
const flush = () => {
    if (EVENT_FILE) fs.writeFileSync(EVENT_FILE, JSON.stringify(events, null, 2));
};

/** 载入 MCP 侧与本地凭据 */
const readCred = () => {
    const p = "F:/Sosarciel/Sosarciel-LaMDA/LaMDA-Module/Service-Manager/AutoDL-Manager/data/cred.txt";
    const L = fs.readFileSync(p, "utf8").split(/\r?\n/).map(s => s.trim());
    return { token: L[1], uuid: L[10] };
};

const main = async () => {
    const cred = readCred();
    // 走包名解析 —— Test 项目已在 workspace 中 link 了该模块,
    // 用相对路径会因 worker 位于 src/ 深层而算错。
    const { AutoDLManager, TunnelManager, comfyuiService } = require("@sosraciel-lamda/autodl-manager");
    // 挂钩 logger 以观察模块内部的决策路径(走等待还是走启动)
    hookLogger(require("@zwa73/utils").SLogger);

    // ── 建立自己的 AutoDL 侧能力 ──────────────────────────────
    // 注意：两个进程**各自**初始化自己的 Manager，彼此不共享任何状态，
    // 这正是「无进程间通讯」的含义。
    AutoDLManager.initInject({
        serviceTable: {
            instance_table: {
                BJ: {
                    type: "ProInstance",
                    name: "BJ",
                    data: {
                        token: cred.token,
                        instance_uuid: cred.uuid,
                        keep_alive_sec: 1800,
                        // 两个进程用**不同**的本地端口，模拟两台物理机 ——
                        // 它们各自的隧道映射到同一个远端服务(6006)
                        local_port_forward: {
                            [26610 + Number(WORKER_ID.charCodeAt(0) % 10)]: "6006",
                        },
                    },
                },
            },
        },
    });
    await AutoDLManager.sm.inited;
    record("autodl-init");

    TunnelManager.initInject({
        // 不再传 host —— TunnelManager 直接依赖 AutoDLManager 全局单例
        serviceTable: {
            instance_table: {
                CloudA: {
                    type: "TunnelInstance",
                    name: "CloudA",
                    data: {
                        autodl_instance: "BJ",
                        script_dir: "/root/ComfyUI-Manager",
                        // 两个 worker 用**同一个** prefix —— 它们连的是同一台机器上的
                        // 同一组服务，本就该看到同样的进程特征（这正是竞态测试的前提）
                        prefix: "comfyui_manager_",
                        service: comfyuiService("/root/ComfyUI-Manager"),
                    },
                },
            },
        },
    });
    await TunnelManager.sm.inited;
    record("comfyuimgr-init");

    // ── 只读探测：此刻远端服务是什么状态？ ────────────────────
    const before = await TunnelManager.probe("CloudA");
    const snapshot = before == undefined
        ? "不可用"
        : Object.entries(before).map(([k, v]) => `${k}=${v.ready ? "ready" : v.alive ? "starting" : "none"}`).join(",");
    record("probe-before", snapshot);

    // ── 确保就绪：需要时自己去叫终端拉起 ──────────────────────
    // 只要求 clash + middleware —— 本测试验证的是「并发接入与竞态」,
    // ComfyUI 本体在无卡模式下必然失败, 与竞态无关。
    record("ensure-start");
    const ep = await TunnelManager.ensureReady({
        instanceName: "CloudA",
        require: ["clash", "middleware"],
        timeoutSec: 60,
    });
    record("ensure-done", `endpoint=${ep ?? "undefined"}`);

    // ── 事后探测 ──────────────────────────────────────────────
    const after = await TunnelManager.probe("CloudA");
    const snapAfter = after == undefined
        ? "不可用"
        : Object.entries(after).map(([k, v]) => `${k}=${v.ready ? "ready" : v.alive ? "starting" : "none"}`).join(",");
    record("probe-after", snapAfter);

    record("exit", `ok=${ep != undefined}`);

    // ── 收尾：关闭自己的隧道 ──────────────────────────────────
    // ⚠️ **不停服务** —— 服务是两个 worker 共享的，一个 worker 停掉会
    // 影响另一个（本测试正是要验证它们能互不干扰地共用）。
    // 服务的清理由父测试的 afterAll 统一负责。
    //
    // 但**必须关掉自己的隧道**，否则本进程退出后它占用的本地端口（2661x）
    // 会残留，影响后续测试的端口分配。
    try {
        const hostIns = await AutoDLManager.getInstance("BJ");
        await hostIns?.closeTunnel();
        record("tunnel-closed");
    } catch (e) {
        record("tunnel-close-failed", String(e?.message ?? e));
    }

    flush();
    process.exit(0);
};

main().catch(e => {
    record("fatal", String(e?.message ?? e));
    flush();
    process.exit(1);
});
