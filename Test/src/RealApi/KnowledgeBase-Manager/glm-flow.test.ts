/** GLM 知识库真实 API 完整流程测试
 * 对真实 GLM 知识库服务执行「建立知识库 → 写入文档 → 读取检索 → 删除文档 → 删除知识库」的完整闭环。
 *
 * API Key 从 `data/Cred.json` 读取 (该文件已被 .gitignore 忽略)。
 * 凭据缺失时在模块加载阶段抛错, 使**整个测试集直接失败** (报告 0 个用例),
 * 而不是被静默跳过或让每个用例各报一次同样的错误。
 *
 * 运行方式 (注意不要跑全量):
 * ```
 * cross-env WITH_API=true npm run test -- --selectProjects real-api src/RealApi/KnowledgeBase-Manager/glm-flow.test.ts
 * ```
 *
 * 实测要点:
 * - 上传 txt/md 必须显式指定切片方式, 不传会落到服务端动态解析并对无结构纯文本判定失败
 * - 文档的 embedding_stat 与实际可检索性**不同步**, 实测恒为 1 而文档早已可检索,
 *   因此判定就绪必须以"试检索有结果"为准, 不能等 embeddingStatus 变成 completed
 * - 全程实测约 3.4 秒: 建库 0.2s / 上传 1.8s / 可检索 1.3s / 删库 0.08s
 */

import { GLMKBClient } from "@sosraciel-lamda/knowledgebase-manager";
import { SLogger } from "@zwa73/utils";

import { CRED_PATH, getGLMApiKey } from "@/src/Constant";

/** 测试知识库名称 */
const TEST_KB_NAME = "集成测试知识库";

/** 测试知识库描述 */
const TEST_KB_DESCRIPTION = "由 glm-flow.test 自动创建, 测试结束后会被删除";

/** 测试文档名 */
const TEST_DOC_NAME = "集成测试记忆.txt";

/** 测试文档内容 */
const TEST_DOC_CONTENT = [
    "【记忆一】Akaset 是周克王国的皇家战舰核心AI，在沉睡300年后被指挥官唤醒。",
    "机体为16岁人类少女体态，身高129.53cm，体重26kg。",
    "拥有白色蓬松短发与灰色的眼眸，头部带有两根头饰状天线。",
    "头饰状天线是Akaset的情绪指示器：开心时摇动、处理数据时竖起、紧张或报错时低垂颤动。",
    "【记忆二】Akaset 对指挥官绝对忠诚，习惯用数据和机体状态表达情感，对指挥官极其依恋。",
    "【记忆三】Akaset 永远称呼用户为指挥官，并以 Akaset 自称。",
].join("\n");

/** 检索查询语句 */
const TEST_QUERY = "Akaset 的身高体重是多少";

/** 期望在检索结果中出现的关键词 */
const EXPECTED_KEYWORD = "129.53";

/** 各步骤的超时上限/毫秒
 * 依据实测耗时设定, 留约 10 倍余量而非宽松的绝对值
 */
const TIMEOUT = {
    /** 普通 API 调用 (实测 <0.5s) */
    api: 10_000,
    /** 建立知识库 (实测 0.2s) */
    createKb: 10_000,
    /** 上传文档 (实测 1.8s) */
    upload: 10_000,
    /** 等待可检索 (实测 1.3s) */
    index: 20_000,
    /** 检索 (实测 <0.5s) */
    retrieve: 10_000,
};

/** 上传失败时的最大重试次数 */
const UPLOAD_MAX_RETRIES = 3;

/** 上传失败后重试的间隔/毫秒 */
const UPLOAD_RETRY_INTERVAL_MS = 500;

/** 索引就绪的轮询间隔/毫秒 */
const POLL_INTERVAL_MS = 500;

/** 索引就绪的最大等待时间/毫秒 */
const INDEX_TIMEOUT_MS = 20_000;

/** 等待指定毫秒
 * @param ms - 等待时长/毫秒
 * @returns 等待完成后 resolve
 */
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 读取 API Key
 * 在模块顶层调用, 使凭据缺失时整个测试集直接失败而不是逐用例报错
 * @returns API Key
 * @throws 未在 data/Cred.json 中配置时抛出
 */
const readApiKey = (): string => {
    const apiKey = getGLMApiKey();
    if (!apiKey)
        throw new Error(`未在 ${CRED_PATH} 中配置 GLM.api_key, 无法执行真实 API 测试`);
    return apiKey;
};

/** 测试用 API Key, 模块加载时即完成校验 */
const API_KEY = readApiKey();

describe("GLM 知识库完整流程", () => {
    let client: GLMKBClient;
    let knowledgeBaseId: string | undefined;
    let documentId: string | undefined;

    beforeAll(() => {
        client = new GLMKBClient({ apiKey: API_KEY });
    }, TIMEOUT.api);

    afterAll(async () => {
        if (!client || !knowledgeBaseId) return;
        // 无论测试结果如何都清理, 避免在服务端残留测试资源
        if (documentId) {
            SLogger.info(`兜底清理: 删除残留文档 ${documentId}`);
            await client.deleteDocument(documentId);
        }
        SLogger.info(`兜底清理: 删除残留知识库 ${knowledgeBaseId}`);
        await client.deleteKnowledgeBase(knowledgeBaseId);
    },TIMEOUT.api);

    it("1. 建立知识库", async () => {
        const kb = await client.createKnowledgeBase({
            name: TEST_KB_NAME,
            description: TEST_KB_DESCRIPTION,
            enableContextual: false,
        });

        expect(kb).toBeDefined();
        expect(kb?.id).toBeTruthy();
        expect(kb?.name).toBe(TEST_KB_NAME);

        knowledgeBaseId = kb!.id;
        SLogger.info(`知识库已建立: ${kb!.name} (${knowledgeBaseId})`);

        const detail = await client.getKnowledgeBase(knowledgeBaseId);
        expect(detail).toBeDefined();
        expect(detail?.id).toBe(knowledgeBaseId);
    },TIMEOUT.createKb);

    it("2. 写入文档", async () => {
        expect(knowledgeBaseId).toBeDefined();

        let uploaded: string | undefined;
        for (let i = 1; i <= UPLOAD_MAX_RETRIES && !uploaded; i++) {
            const result = await client.uploadFileDocument({
                knowledgeBaseId: knowledgeBaseId!,
                fileName: TEST_DOC_NAME,
                fileContent: Buffer.from(TEST_DOC_CONTENT, "utf-8"),
                // txt 必须显式指定切片方式, 不传会被服务端动态解析并报"文档损坏"
                documentType: "title_paragraph",
            });

            expect(result).toBeDefined();
            if (result!.failedInfos.length > 0) {
                const fail = result!.failedInfos[0];
                SLogger.warn(`上传失败: ${fail.identifier} - ${fail.failReason} (${i}/${UPLOAD_MAX_RETRIES})`);
                if (i < UPLOAD_MAX_RETRIES) await wait(UPLOAD_RETRY_INTERVAL_MS);
                continue;
            }
            expect(result!.successInfos).toHaveLength(1);
            uploaded = result!.successInfos[0].documentId;
        }

        expect(uploaded).toBeDefined();
        documentId = uploaded;
        SLogger.info(`文档已写入: ${TEST_DOC_NAME} (${documentId})`);

        const docList = await client.listDocuments({ knowledgeBaseId: knowledgeBaseId! });
        expect(docList).toBeDefined();
        expect(docList!.total).toBeGreaterThan(0);
        SLogger.info(`文档列表读取成功, 共 ${docList!.total} 个文档`);
    },TIMEOUT.upload);

    it("3. 读取检索", async () => {
        expect(knowledgeBaseId).toBeDefined();
        expect(documentId).toBeDefined();

        // 等待索引就绪: 以"试检索有结果"为判据, 因为 embedding_stat 与实际可用性不同步
        const deadline = Date.now() + INDEX_TIMEOUT_MS;
        let segments: { content: string; score: number }[] = [];
        while (Date.now() < deadline) {
            const probe = await client.retrieveMulti({
                query: TEST_QUERY,
                knowledgeBaseIds: [knowledgeBaseId!],
                topK: 5,
            });
            // 检索失败(如文档尚未就绪)时返回 undefined, 继续等待
            if (probe && probe.segments.length > 0) {
                segments = probe.segments;
                break;
            }
            const doc = await client.getDocument(documentId!);
            if (doc?.failInfo)
                throw new Error(`索引构建失败: [${doc.failInfo.code}] ${doc.failInfo.message}`);
            await wait(POLL_INTERVAL_MS);
        }

        expect(segments.length).toBeGreaterThan(0);
        SLogger.info(`检索命中 ${segments.length} 条:`);
        for (const seg of segments)
            SLogger.info(`  [${(seg.score * 100).toFixed(1)}%] ${seg.content.slice(0, 60)}`);

        const hit = segments.some((seg) => seg.content.includes(EXPECTED_KEYWORD));
        expect(hit).toBe(true);
        SLogger.info(`检索内容校验通过, 命中关键词 "${EXPECTED_KEYWORD}"`);
    }, TIMEOUT.index);

    it("4. 删除文档", async () => {
        expect(knowledgeBaseId).toBeDefined();
        expect(documentId).toBeDefined();

        const deleted = await client.deleteDocument(documentId!);
        expect(deleted).toBe(true);
        documentId = undefined;
        SLogger.info("文档已删除");

        const docList = await client.listDocuments({ knowledgeBaseId: knowledgeBaseId! });
        expect(docList).toBeDefined();
        expect(docList!.total).toBe(0);
        SLogger.info("文档删除校验通过, 列表已为空");
    },TIMEOUT.api);

    it("5. 删除知识库", async () => {
        expect(knowledgeBaseId).toBeDefined();

        const deletedId = knowledgeBaseId!;
        const deleted = await client.deleteKnowledgeBase(deletedId);
        expect(deleted).toBe(true);
        knowledgeBaseId = undefined;
        SLogger.info("知识库已删除");

        const after = await client.getKnowledgeBase(deletedId);
        expect(after).toBeUndefined();
        SLogger.info("知识库删除校验通过, 详情已不可读取");
    },TIMEOUT.api);
});
