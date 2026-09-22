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
