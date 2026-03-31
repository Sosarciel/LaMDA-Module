/** GLM 知识库 API 真实测试
 * 测试流程:
 * 1. 创建知识库
 * 2. 上传文档
 * 3. 等待向量化完成
 * 4. 测试召回
 * 5. 清理测试数据
 * 
 * 运行前需设置环境变量: GLM_API_KEY
 */

import { KnowledgeBaseManager, GLMKBClient } from "@sosraciel-lamda/knowledgebase-manager";
import { UtilFT } from "@zwa73/utils";
import path from "pathe";
import { CACHE_PATH } from "@/src/Constant";

/** 测试配置 */
const TEST_CONFIG = {
    /** API Key (从环境变量获取) */
    apiKey: process.env.GLM_API_KEY || "",
    /** 测试知识库名称 */
    kbName: "LaMDA测试知识库",
    /** 测试知识库描述 */
    kbDesc: "LaMDA 自动化测试知识库",
    /** 测试文档内容 */
    docContent: `
# 龙王的智慧

## 东海龙王敖绫

敖绫是万海龙王，性格高傲但内心温柔。她有着银白色的龙角和淡蓝色的龙尾。

## 性格特点

- 高傲：常常以"本王"自称
- 温柔：虽然嘴上傲娇，但对凡人很照顾
- 懒散：不太喜欢处理琐事
- 认真：对于重要的事情会非常认真

## 爱好

敖绫最喜欢的活动包括：
1. 在海里游泳
2. 睡觉
3. 品尝美食
4. 和小鱼聊天

## 小知识

龙的寿命非常长，可以活到一万岁以上。
龙族对音乐有特别的爱好。
`,
    /** 测试文档名称 */
    docName: "龙王的智慧.md",
    /** 向量化等待间隔 (毫秒) */
    waitInterval: 10000,
    /** 向量化最大等待次数 */
    maxWaitRetries: 60,
    /** 测试查询列表 */
    testQueries: [
        "龙王敖绫",
        "龙族的特点",
        "东海",
        "龙的寿命",
        "本王",
    ],
};

/** 等待函数 */
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 检查 API Key 是否配置 */
const checkApiKey = () => {
    if (!TEST_CONFIG.apiKey) {
        console.warn("警告: 未设置 GLM_API_KEY 环境变量，测试将被跳过");
        return false;
    }
    return true;
};

/** 初始化 KnowledgeBaseManager */
const initKBManager = async () => {
    const serviceTablePath = path.join(CACHE_PATH, "RealApi_KBManager.json");
    await UtilFT.writeJSONFile(serviceTablePath, {
        instance_table: {
            GLM_RealApi: {
                type: "GLM" as const,
                name: "GLM_RealApi",
                data: {
                    type: "GLM" as const,
                    apiKey: TEST_CONFIG.apiKey,
                },
            },
        },
    });

    KnowledgeBaseManager.initInject({
        serviceTable: serviceTablePath,
    });
};

/** GLM 知识库真实 API 测试 */
describe("GLM 知识库真实 API 测试", () => {
    let client: GLMKBClient;
    let kbId: string | undefined;
    let docId: string | undefined;

    beforeAll(async () => {
        if (!checkApiKey()) {
            return;
        }

        await initKBManager();
        client = new GLMKBClient({
            apiKey: TEST_CONFIG.apiKey,
        });
    }, 30000);

    afterAll(async () => {
        if (kbId && client) {
            console.log(`清理: 删除知识库 ${kbId}`);
            await client.deleteKnowledgeBase(kbId);
        }
    });

    describe("1. 创建知识库", () => {
        it("1.1 应成功创建知识库", async () => {
            if (!checkApiKey()) {
                return;
            }

            const result = await client.createKnowledgeBase({
                name: TEST_CONFIG.kbName,
                description: TEST_CONFIG.kbDesc,
            });

            expect(result).toBeDefined();
            expect(result?.id).toMatch(/^kb-/);
            
            kbId = result?.id;
            console.log(`创建知识库成功: ${kbId}`);
        }, 30000);
    });

    describe("2. 上传文档", () => {
        it("2.1 应成功上传文档", async () => {
            if (!checkApiKey() || !kbId) {
                return;
            }

            const result = await client.uploadFileDocument({
                knowledgeBaseId: kbId,
                fileName: TEST_CONFIG.docName,
                fileContent: Buffer.from(TEST_CONFIG.docContent),
                documentType: "title_paragraph",
            });

            expect(result).toBeDefined();
            expect(result?.successInfos).toHaveLength(1);
            expect(result?.failedInfos).toHaveLength(0);

            docId = result?.successInfos[0].documentId;
            console.log(`上传文档成功: ${docId}`);
        }, 60000);
    });

    describe("3. 等待向量化完成", () => {
        it("3.1 应等待向量化完成", async () => {
            if (!checkApiKey() || !docId) {
                return;
            }

            let status = "pending";
            let retries = 0;

            while (status !== "completed" && status !== "failed" && retries < TEST_CONFIG.maxWaitRetries) {
                await wait(TEST_CONFIG.waitInterval);

                const doc = await client.getDocument(docId);
                if (!doc) {
                    console.log("获取文档状态失败");
                    break;
                }

                status = doc.embeddingStatus || "pending";
                console.log(`向量化状态: ${status} (${retries + 1}/${TEST_CONFIG.maxWaitRetries})`);

                if (status === "failed") {
                    console.log(`向量化失败: ${JSON.stringify(doc.failInfo)}`);
                    break;
                }

                retries++;
            }

            expect(status).toBe("completed");
        }, 600000);
    });

    describe("4. 测试召回", () => {
        it("4.1 应成功召回相关内容", async () => {
            if (!checkApiKey() || !kbId) {
                return;
            }

            for (const query of TEST_CONFIG.testQueries) {
                console.log(`\n查询: "${query}"`);
                
                const result = await client.retrieveMulti({
                    query,
                    knowledgeBaseIds: [kbId],
                    topK: 3,
                });

                expect(result).toBeDefined();
                expect(result?.segments.length).toBeGreaterThan(0);

                for (const seg of result!.segments) {
                    const score = (seg.score * 100).toFixed(1);
                    const content = seg.content.slice(0, 80).replace(/\n/g, " ");
                    console.log(`  - [${score}%] ${content}...`);
                }
            }
        }, 60000);
    });

    describe("5. 知识库管理", () => {
        it("5.1 应成功获取知识库列表", async () => {
            if (!checkApiKey()) {
                return;
            }

            const result = await client.listKnowledgeBases({ page: 1, pageSize: 10 });

            expect(result).toBeDefined();
            expect(result?.total).toBeGreaterThan(0);
            console.log(`知识库总数: ${result?.total}`);
        }, 30000);

        it("5.2 应成功获取知识库详情", async () => {
            if (!checkApiKey() || !kbId) {
                return;
            }

            const result = await client.getKnowledgeBase(kbId);

            expect(result).toBeDefined();
            expect(result?.id).toBe(kbId);
            expect(result?.name).toBe(TEST_CONFIG.kbName);
        }, 30000);

        it("5.3 应成功获取文档列表", async () => {
            if (!checkApiKey() || !kbId) {
                return;
            }

            const result = await client.listDocuments({
                knowledgeBaseId: kbId,
            });

            expect(result).toBeDefined();
            expect(result?.total).toBeGreaterThan(0);
            console.log(`文档总数: ${result?.total}`);
        }, 30000);

        it("5.4 应成功获取文档详情", async () => {
            if (!checkApiKey() || !docId) {
                return;
            }

            const result = await client.getDocument(docId);

            expect(result).toBeDefined();
            expect(result?.id).toBe(docId);
            expect(result?.name).toBe(TEST_CONFIG.docName);
        }, 30000);
    });
});
