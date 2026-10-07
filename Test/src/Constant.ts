import fs from "fs";
import path from "pathe";

import { memoize, SLogger } from "@zwa73/utils";

export const ROOT_PATH = path.join(__dirname, '..');
export const DATA_PATH = path.join(ROOT_PATH, 'data');
export const CACHE_PATH = path.join(ROOT_PATH, 'cache');

//5501 - 5509划定为mock服务
//5500是liveserver默认端口需避开
//mock的lam服务
export const LAM_PORT = 5501;
//mock知识库服务
export const KB_PORT = 5502;

//5510 - 5519划定为参与测试的psql
//自动测试的psql
export const PG_PORT = 5510;
//test-server的pslq为5511

/** AutoDL 测试用的本地映射端口
 *
 * 从 5520 起连续分配, **整个 552x 段保留给 AutoDL** ——
 * 端口映射的本地端必须全局唯一(同一时刻不能让两个测试抢同一个本地端口),
 * 因此这里集中登记, 各测试文件只引用常量、不再自带字面量。
 *
 * 远端端口无此约束(在容器内部, 各测试互不影响), 统一用 6006。
 */
export const AUTODL_LOCAL_PORT = {
    /** SSH 链路测试: 单端口映射 */
    sshA: 5520,
    /** SSH 链路测试: 第二端口映射 */
    sshB: 5521,
    /** Jupyter 终端测试 */
    jupyter: 5522,
    /** 多实例测试: 实例 A 的两个端口 */
    multiA1: 5523,
    multiA2: 5524,
    /** 多实例测试: 实例 B 的端口(与 multiA1 映射同一远端服务以验证互不干扰) */
    multiB1: 5525,
    /** 全路径测试 */
    flow: 5526,
} as const;

/** AutoDL 测试用的远端服务端口
 *
 * 与本地端口不同，远端端口在容器内部，各测试互不影响，故统一用 6006。
 * 测试服务由测试自己拉起（见 helpers.ts 的 buildServiceScript），不依赖实例预置环境。
 *
 * ⚠️ 实例上 **6007 被镜像自带的 TensorBoard 占用**（实测返回 TensorBoard 页面），
 * 6006 空闲可用，因此第二个测试服务用 `AUTODL_REMOTE_PORT + 1` 之外的值时需注意避开 6007。
 * 各测试文件的第二个服务端口固定在 6007 即可 ——
 * 因为测试启动服务前会用共享标记清掉所有测试服务，不会互相抢占。
 */
export const AUTODL_REMOTE_PORT = 6006;

/** AutoDL 测试用的第二个远端服务端口
 *
 * 用于「同一实例上两个端口映射到不同服务」的场景，
 * 必须是 6006 之外的、且**不被镜像自带服务占用**的端口。
 * （6007 是 TensorBoard，故避开）
 */
export const AUTODL_REMOTE_PORT_B = 6008;

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
