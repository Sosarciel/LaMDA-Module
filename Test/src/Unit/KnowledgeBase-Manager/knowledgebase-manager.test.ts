/** KnowledgeBase-Manager 测试
 * 测试知识库管理器的核心功能
 */

import { KnowledgeBaseManager } from "@sosraciel-lamda/knowledgebase-manager";
import { UtilFT } from "@zwa73/utils";
import path from "pathe";

import { KBMockServer } from "@sosraciel-lamda/knowledgebase-manager/mock";
import {
    KBMockTool
} from "@sosraciel-lamda/knowledgebase-manager/mock";
import { CACHE_PATH, KB_PORT } from "@/src/Constant";


const {
    MOCK_KNOWLEDGE_BASE,
    MOCK_DOCUMENT,
    MOCK_SEGMENT,
} = KBMockTool;

/** Mock 服务配置表 (使用自定义端口) */
const MOCK_KB_SERVICE_TABLE = KBMockTool.getMockKBServiceTable(KB_PORT);

// #region 测试套件

const server = new KBMockServer(KB_PORT);

beforeAll(async () => {
    await server.start();

    const KBServiceTablePath = path.join(CACHE_PATH, "KBManager.json");
    await UtilFT.writeJSONFile(KBServiceTablePath, MOCK_KB_SERVICE_TABLE);

    KnowledgeBaseManager.initInject({
        serviceTable: KBServiceTablePath,
    });
});

afterAll(async () => {
    await server.stop();
});

describe("KnowledgeBase-Manager 集成测试", () => {
    describe("1. 知识库管理", () => {
        it("1.1 应成功获取知识库列表", async () => {
            const result = await KnowledgeBaseManager.listKnowledgeBases("GLM_Test");

            expect(result).toBeDefined();
            expect(result?.list).toHaveLength(1);
            expect(result?.total).toBe(1);
            expect(result?.list[0].id).toBe(MOCK_KNOWLEDGE_BASE.id);
            expect(result?.list[0].name).toBe(MOCK_KNOWLEDGE_BASE.name);
        });

        it("1.2 应成功获取知识库详情", async () => {
            const result = await KnowledgeBaseManager.getKnowledgeBase("GLM_Test", MOCK_KNOWLEDGE_BASE.id);

            expect(result).toBeDefined();
            expect(result?.id).toBe(MOCK_KNOWLEDGE_BASE.id);
            expect(result?.name).toBe(MOCK_KNOWLEDGE_BASE.name);
        });

        it("1.3 应成功创建知识库", async () => {
            const newName = "新建测试知识库";
            const newDesc = "新建知识库描述";

            const result = await KnowledgeBaseManager.createKnowledgeBase("GLM_Test", {
                name: newName,
                description: newDesc,
            });

            expect(result).toBeDefined();
            expect(result?.name).toBe(newName);
            expect(result?.description).toBe(newDesc);
            expect(result?.id).toMatch(/^kb-/);
        });

        it("1.4 应成功删除知识库", async () => {
            const result = await KnowledgeBaseManager.deleteKnowledgeBase("GLM_Test", MOCK_KNOWLEDGE_BASE.id);

            expect(result).toBe(true);
        });
    });

    describe("2. 文档管理", () => {
        it("2.1 应成功获取文档列表", async () => {
            const result = await KnowledgeBaseManager.listDocuments("GLM_Test", {
                knowledgeBaseId: MOCK_KNOWLEDGE_BASE.id,
            });

            expect(result).toBeDefined();
            expect(result?.list).toHaveLength(1);
            expect(result?.total).toBe(1);
            expect(result?.list[0].id).toBe(MOCK_DOCUMENT.id);
        });

        it("2.2 应成功获取文档详情", async () => {
            const result = await KnowledgeBaseManager.getDocument("GLM_Test", MOCK_DOCUMENT.id);

            expect(result).toBeDefined();
            expect(result?.id).toBe(MOCK_DOCUMENT.id);
            expect(result?.name).toBe(MOCK_DOCUMENT.name);
        });

        it("2.3 应成功上传文件文档", async () => {
            const result = await KnowledgeBaseManager.uploadFileDocument("GLM_Test", {
                knowledgeBaseId: MOCK_KNOWLEDGE_BASE.id,
                fileName: "test-file.txt",
                fileContent: Buffer.from("测试文件内容"),
            });

            expect(result).toBeDefined();
            expect(result?.successInfos).toHaveLength(1);
            expect(result?.failedInfos).toHaveLength(0);
            expect(result?.successInfos[0].identifier).toBe("uploaded-file.txt");
        });

        it("2.4 应成功删除文档", async () => {
            const result = await KnowledgeBaseManager.deleteDocument("GLM_Test", MOCK_DOCUMENT.id);

            expect(result).toBe(true);
        });
    });

    describe("3. 检索功能", () => {
        it("3.1 应成功执行相似性检索", async () => {
            const query = "测试查询";
            const result = await KnowledgeBaseManager.retrieve("GLM_Test", {
                query: query,
                knowledgeBaseId: MOCK_KNOWLEDGE_BASE.id,
                topK: 5,
                scoreThreshold: 0.7,
            });

            expect(result).toBeDefined();
            expect(result?.segments).toHaveLength(1);
            expect(result?.segments[0].content).toContain(query);
            expect(result?.segments[0].score).toBe(MOCK_SEGMENT.score);
        });
    });

    describe("4. 适配器获取", () => {
        it("4.1 应成功获取通用适配器", async () => {
            const adapter = await KnowledgeBaseManager.getAdapter("GLM_Test");

            expect(adapter).toBeDefined();
            expect(adapter?.name).toBe("GLM");
        });

        it("4.2 应成功获取GLM专用适配器", async () => {
            const adapter = await KnowledgeBaseManager.getGLMAdapter("GLM_Test");

            expect(adapter).toBeDefined();
            expect(adapter?.name).toBe("GLM");
            expect(adapter?.client).toBeDefined();
        });

        it("4.3 GLM适配器应支持特有功能", async () => {
            const adapter = await KnowledgeBaseManager.getGLMAdapter("GLM_Test");

            expect(adapter).toBeDefined();
            // 验证client存在且可以调用
            expect(typeof adapter?.client.retrieveMulti).toBe("function");
        });
    });

    describe("5. 错误处理", () => {
        it("5.1 应正确处理无效实例名", async () => {
            const result = await KnowledgeBaseManager.listKnowledgeBases("InvalidInstance");

            expect(result).toBeUndefined();
        });

        it("5.2 非GLM实例获取GLM适配器应返回undefined", async () => {
            // Dify_Test 是 Dify 类型，不是 GLM
            const adapter = await KnowledgeBaseManager.getGLMAdapter("Dify_Test");

            expect(adapter).toBeUndefined();
        });
    });
});

// #endregion
