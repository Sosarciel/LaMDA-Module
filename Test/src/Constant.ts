import fs from "fs";
import path from "pathe";

import { memoize, SLogger } from "@zwa73/utils";

export const ROOT_PATH = path.join(__dirname, '..');
export const DATA_PATH = path.join(ROOT_PATH, 'data');
export const CACHE_PATH = path.join(ROOT_PATH, 'cache');

//5500是liveserver默认端口需避开

//26500 - 26509划定为mock服务
//mock的lam服务
export const LAM_PORT = 26500;
//mock知识库服务
export const KB_PORT = 26502;

//26510 - 26519划定为参与测试的psql
//自动测试的psql
export const PG_PORT = 26510;
//test-server的pslq为26511

/** `AutoDL/` 那组测试用的本地映射端口
 *
 * 从 26520 起连续分配, **整个 2652x 段保留给这组** ——
 * 端口映射的本地端必须全局唯一(同一时刻不能让两个测试抢同一个本地端口),
 * 因此这里集中登记, 各测试文件只引用常量、不再自带字面量。
 *
 * 远端端口无此约束(在容器内部, 各测试互不影响), 统一用 6006。
 */
export const AUTODL_LOCAL_PORT = {
    /** SSH 链路测试: 单端口映射 */
    sshA: 26520,
    /** SSH 链路测试: 第二端口映射 */
    sshB: 26521,
    /** Jupyter 终端测试 */
    jupyter: 26522,
    /** 多实例测试: 实例 A 的两个端口 */
    multiA1: 26523,
    multiA2: 26524,
    /** 多实例测试: 实例 B 的端口(与 multiA1 映射同一远端服务以验证互不干扰) */
    multiB1: 26525,
    /** 全路径测试 */
    flow: 26526,
} as const;

/** Tunnel（服务托管）测试用的本地映射端口
 *
 * **与 AutoDL 的 2652x 段分开占用 2653x** ——
 * Tunnel 被测的是「托管服务」这一层（本用例里是 clash 代理、Middleware 网关、
 * ComfyUI 本体），与 `AutoDL/` 那组的「隧道/终端」基础能力不是一回事，
 * 端口分段落便于一眼看出是哪个包在占用。
 *
 * ⚠️ 与 `src/` 的组织对齐：`AutoDL/` 与 `Tunnel/` 是同一模块下并列的两个包，
 * 测试目录也一一对应（`AutoDL-Manager/AutoDL/` 与 `AutoDL-Manager/Tunnel/`）。
 *
 * 远端端口是**服务自身的端口**（clash 7890 / Middleware 6006 / ComfyUI 6005），
 * 由服务的启动命令决定，不是测试可以随意改的，故不在此登记。
 */
export const COMFY_LOCAL_PORT = {
    /** Jupyter 终端(用于在托管终端里启动服务) */
    jupyter: 26530,
    /** Middleware 网关(远端 6006, ComfyUI 的统一入口) */
    middleware: 26531,
    /** ComfyUI 本体(远端 6005); 仅在需要绕过网关直连时使用 */
    comfyui: 26532,
} as const;

/** AutoDL 测试用的远端服务端口（**基础值**）
 *
 * 测试服务由测试自己拉起（见 Util.ts 的 `buildServiceScript`），不依赖实例预置环境。
 *
 * ## ⚠️ 为什么避开 6006/6008（曾被「统一用 6006」害过）
 * 原先的理由是「远端端口在容器内部，各测试互不影响」，但那个前提**只在
 * 「远端只有本套测试在跑」时成立**。实际上同一实例上还可能有别的模块的服务：
 * 实测 `ComfyUI-Manager` 的 Middleware 网关**必然监听 6006**（那是它的设计端口，
 * 不该为测试让步），于是本组测试起服务时报
 * `OSError: [Errno 98] Address already in use` 而全部失败。
 *
 * 因此本组改用与那些**都不冲突**的端口段：
 * - `6006` 被 ComfyUI 的 Middleware 网关占用 → **避开**
 * - `6007` 被镜像自带的 TensorBoard 占用（实测返回 TensorBoard 页面）→ **避开**
 * - `6008` 是 AutoDL **自动映射到公网**的端口，测试它需要专门的目的 → **避开**
 *
 * ## ⚠️⚠️ 每个测试文件必须用**自己独占**的一对端口
 * 仅避开 6006/6008 还不够。若两个测试文件共用同一对端口，**后者的
 * `startTestServices` 会把前者正在用的服务杀掉**（它按端口反查占用者并清理），
 * 于是前者在后续用例里连不上服务而整组失败。
 *
 * 实测（2026-10-12）：`ssh-tunnel` 与 `multi-instance` 共用 6016/6018 时，
 * 跑 4 次里有 2 次出现 15 个用例齐挂 —— 因为失败的两个套件恰好前后相接。
 *
 * 故按测试文件分配互不重叠的**端口对**：
 * - `ssh-tunnel`   → {@link AUTODL_REMOTE_PORT}      (6016 / 6018)
 * - `multi-instance` → {@link AUTODL_REMOTE_PORT_MI}  (6026 / 6028)
 *
 * 新增用例请继续按 +10 的步长错开。
 */
export const AUTODL_REMOTE_PORT = 6016;

/** AutoDL 测试用的第二个远端服务端口
 *
 * 用于「同一实例上两个端口映射到不同服务」的场景。
 * 与 `AUTODL_REMOTE_PORT` 一样避开 6006/6007/6008，理由见上。
 */
export const AUTODL_REMOTE_PORT_B = 6018;

/** `multi-instance` 测试独占的远端端口对
 *
 * **必须与 `ssh-tunnel` 那对错开** —— 两个套件各有自己的
 * `startTestServices`，会按端口清理占用者，共用端口就会互相残杀。
 * 详见 {@link AUTODL_REMOTE_PORT} 的说明。
 */
export const AUTODL_REMOTE_PORT_MI = 6026;

/** `multi-instance` 测试独占的第二个远端端口
 * @see AUTODL_REMOTE_PORT_MI
 */
export const AUTODL_REMOTE_PORT_MI_B = 6028;

/** 凭据配置文件路径
 * 该文件已被 .gitignore 忽略, 不会随仓库分发
 */
export const CRED_PATH = path.join(DATA_PATH, 'Cred.json');

/** 凭据配置结构 */
type CredConfig = {
    /** GLM 平台凭据 */
    GLM?: {
        /** API Key */
        api_key?: string;
    };
    /** AutoDL 平台凭据 */
    AutoDL?: {
        /** 开发者 Token (JWT) */
        token?: string;
        /** 实例 uuid, 形如 pro-xxxxxxxxxxxx */
        instance_uuid?: string;
        /** 实例所在地区名, 仅用于日志显示 */
        region_name?: string;
    };
};

/** 读取凭据配置
 * @returns 凭据配置对象, 文件缺失或解析失败时返回空对象
 */
const readCred = memoize((): CredConfig => {
    if (!fs.existsSync(CRED_PATH)) {
        SLogger.warn(`凭据文件不存在: ${CRED_PATH}`);
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(CRED_PATH, 'utf-8')) as CredConfig;
    } catch (e) {
        SLogger.error(`凭据文件解析失败: ${e}`);
        return {};
    }
});

/** 获取 GLM API Key
 * @returns API Key, 未配置时返回 undefined
 */
export const getGLMApiKey = (): string | undefined => readCred().GLM?.api_key;

/** AutoDL 凭据
 * 三项均必需, 缺失时由 getAutoDLCred 直接抛错
 */
type AutoDLCred = {
    /** 开发者 Token */
    token: string;
    /** 实例 uuid */
    instance_uuid: string;
    /** 地区名 */
    region_name: string;
};

/** 获取 AutoDL 凭据
 * 与 getGLMApiKey 不同, 这里在缺失时**直接抛错**:
 * 真实的 AutoDL 测试必须依赖可用凭据, 静默降级只会让测试变成假绿。
 * 在模块顶层调用即可让整个测试集直接失败(报告 0 个用例), 而非每个用例各报一次同样的错误。
 * @returns AutoDL 凭据
 */
export const getAutoDLCred = (): AutoDLCred => {
    const cred = readCred().AutoDL;
    const missing = (["token", "instance_uuid", "region_name"] as const)
        .filter(k => cred?.[k] == null || cred[k] === "");
    if (missing.length > 0)
        throw new Error(
            `AutoDL 凭据缺失: ${missing.join(", ")}\n` +
            `请在 ${CRED_PATH} 中补齐 "AutoDL" 段:\n` +
            `{"AutoDL":{"token":"<开发者Token>","instance_uuid":"pro-xxxxxxxxxxxx","region_name":"西北B区"}}`,
        );
    return {
        token: cred!.token!,
        instance_uuid: cred!.instance_uuid!,
        region_name: cred!.region_name!,
    };
};
