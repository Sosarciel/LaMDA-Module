import fs from "fs";
import path from "pathe";

import { memoize, SLogger } from "@zwa73/utils";

export const ROOT_PATH = path.join(__dirname, '..');
export const DATA_PATH = path.join(ROOT_PATH, 'data');
export const CACHE_PATH = path.join(ROOT_PATH, 'cache');

export const LAM_PORT = 3000;
export const KB_PORT = 3001;
export const PG_PORT = 5433;

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
