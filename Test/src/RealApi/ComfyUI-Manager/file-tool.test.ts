/** 网关文件工具测试：只验证「上传 → 探针 → 下载」这条链路
 *
 * ## 为什么不依赖真实 ComfyUI
 * Middleware 网关的 `/tool/probe` `/tool/save` `/tool/download` 三个端点
 * **完全在网关内实现**，与 ComfyUI 的推理无关。
 * 因此零 GPU 就能把整条链路验完：
 * ```
 * 本地调用 → SSH 隧道 → 网关 → 远端文件系统 → 原路返回
 * ```
 *
 * ## 价值
 * 生图出问题时可先跑本文件，快速区分两类故障：
 * - 本文件失败 → **链路坏了**（隧道/网关/权限）
 * - 本文件通过但生图失败 → 问题在模型或工作流，与链路无关
 *
 * ## 对应的代码工作流
 * 业务侧等价物见 `ComfyUI-Conductor` 的 `Workspace/ComfyUIFileFlow`，
 * 它以 CLI 形式做同样的「上传文件 → uid → 下载目录」流程。
 */

import { AutoDLManager, ComfyUIManager } from "@sosraciel-lamda/autodl-manager";

import { COMFY_LOCAL_PORT } from "@/src/Constant";

import { INSTANCE, assertInstanceRunning, autodlInstanceData, instanceData } from "./Util";

/** AutoDL 侧实例名 */
const HOST_INSTANCE = "AutoDLHost";

/** 实例未运行时在模块加载阶段抛错, 让整个测试集直接失败 */
assertInstanceRunning("file-tool.test.ts");

/** 本测试使用的文件前缀（便于精确清理, 不误伤他人产物） */
const TEST_PREFIX = "akaset_gateway_test";

/** 超时上限/毫秒 */
const TIMEOUT = {
    setup: 120_000,
    api: 30_000,
};

/** 网关的远端工具根目录（由 Middleware 启动命令的 -d 参数决定） */
const TOOL_ROOT = "/root/ComfyUI/output";

/** 网关本地地址 */
const HOST = () => `http://127.0.0.1:${COMFY_LOCAL_PORT.middleware}`;

/** 构造带唯一标记的测试内容
 *
 * 内容里刻意含中文、制表符、反斜杠、引号 —— 任何编码/转义问题都会暴露
 * @param stamp - 本次运行的时间戳
 * @returns 测试文本
 */
const buildContent = (stamp: string): string => [
    "AKASET_GATEWAY_FILE_TEST",
    `stamp=${stamp}`,
    "中文内容校验行",
    "特殊字符: \t tab | \\ backslash | \" quote",
    "",
].join("\n");

describe("ComfyUI-Manager 网关文件工具", () => {

    /** 本次测试上传的文件名, 供后续步骤定位 */
    let uploadedName = "";

    /** 本次测试使用的内容标记 */
    let stamp = "";

    beforeAll(async () => {
        AutoDLManager.initInject({
            serviceTable: {
                instance_table: {
                    [HOST_INSTANCE]: {
                        type: "ProInstance",
                        name: HOST_INSTANCE,
                        data: autodlInstanceData(),
                    },
                },
            },
        });
        await AutoDLManager.sm.inited;

        ComfyUIManager.initInject({
            host: AutoDLManager,
            serviceTable: {
                instance_table: {
                    [INSTANCE]: {
                        type: "CloudComfyUI",
                        name: INSTANCE,
                        data: instanceData(),
                    },
                },
            },
        });
        await ComfyUIManager.sm.inited;

        // 文件工具只依赖网关, 不需要 ComfyUI 本体(无卡模式下它也无法启动)
        const endpoint = await ComfyUIManager.ensureReady(
            INSTANCE, { require: ["clash", "middleware"], timeoutSec: 120 });
        if (endpoint == undefined) throw new Error("Middleware 网关未能就绪, 文件工具不可用");
    }, TIMEOUT.setup);

    it("1. 上传文本应返回自动定序的服务端路径", async () => {
        stamp = String(Date.now());

        const fd = new FormData();
        fd.append("prefix", TEST_PREFIX);
        fd.append("ext", ".txt");
        fd.append("sep", "_");
        fd.append("pad", "2");
        fd.append("file", new Blob([buildContent(stamp)],
            { type: "text/plain;charset=utf-8" }), `${TEST_PREFIX}.txt`);

        const res = await fetch(`${HOST()}/tool/save`, { method: "POST", body: fd });
        expect(res.status).toBe(200);

        const result = await res.json() as {
            success: boolean; filename: string; path: string; size: number;
        };
        expect(result.success).toBe(true);
        // 文件名形如 akaset_gateway_test_01.txt —— 前缀_序号.扩展名
        expect(result.filename).toMatch(new RegExp(`^${TEST_PREFIX}_\\d+\\.txt$`));
        expect(result.path).toBe(`${TOOL_ROOT}/${result.filename}`);
        expect(result.size).toBeGreaterThan(0);

        uploadedName = result.filename;
    }, TIMEOUT.api);

    it("2. 探针应能按正则匹配到刚上传的文件", async () => {
        const res = await fetch(`${HOST()}/tool/probe`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pattern: TEST_PREFIX, dir: TOOL_ROOT, recursive: false }),
        });
        expect(res.status).toBe(200);

        const data = await res.json() as {
            count: number; files: { name: string; path: string; size: number }[];
        };
        expect(data.count).toBeGreaterThan(0);
        // 必须包含本次上传的那一个
        expect(data.files.some(f => f.name === uploadedName)).toBe(true);
    }, TIMEOUT.api);

    it("3. 下载应逐字取回上传的内容(含中文与特殊字符)", async () => {
        expect(stamp).not.toBe("");
        expect(uploadedName).not.toBe("");

        const res = await fetch(`${HOST()}/tool/download`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: uploadedName, dir: TOOL_ROOT }),
        });
        expect(res.status).toBe(200);

        const text = Buffer.from(await res.arrayBuffer()).toString("utf-8");
        // 逐字一致即证明二进制回环无损（编码、转义、截断都无处遁形）
        expect(text).toBe(buildContent(stamp));
    }, TIMEOUT.api);

    afterAll(async () => {
        // 按前缀精确清理本次产生的测试文件, 不碰其他产物
        try {
            const ins = await AutoDLManager.getInstance(HOST_INSTANCE);
            const ssh = await ins?.getSshClient();
            if (ssh != undefined) {
                await ssh.exec(`rm -f ${TOOL_ROOT}/${TEST_PREFIX}_*.txt 2>/dev/null; echo ok`);
            }
        } catch {
            // 清理失败不应让测试结果变红 —— 用例本身已全部断言完毕
        }
    }, TIMEOUT.api);
});
