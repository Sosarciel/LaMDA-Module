import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { AnchorModel, ConversationModel, genAnchorId, parseAnchorId, genStatusString, parseStatusString } from "@sosraciel-lamda/dialog-domain";
import { setupTestDb, teardownTestDb, createTestScene } from "./Util";

describe("Dialog-Domain AnchorModel 测试", () => {
    let manager: DBManager;

    beforeAll(async () => {
        manager = await setupTestDb();
    }, 30000);

    afterAll(async () => {
        await teardownTestDb(manager);
    }, 30000);

    test("38. 应成功生成和解析锚点ID", async () => {
        const threadId = "thread:12345";
        const charId = "char:test-char";

        // 生成锚点ID
        const anchorId = genAnchorId(threadId, charId);
        expect(anchorId).toBe(`anchor|thread_id:${threadId}|char_id:${charId}`);

        // 解析锚点ID
        const parsed = parseAnchorId(anchorId);
        expect(parsed).toBeDefined();
        expect(parsed?.threadId).toBe(threadId);
        expect(parsed?.charId).toBe(charId);

        // 测试无效锚点ID
        const invalidParsed = parseAnchorId("invalid-id");
        expect(invalidParsed).toBeUndefined();
    });

    test("39. 应成功生成和解析状态字符串", async () => {
        const convId = "conv-123";// 不能含有分隔符 -
        const msgId = "msg-456";

        // 生成状态字符串
        const statusStr = genStatusString(convId, msgId);
        expect(statusStr).toBe(`${convId}|${msgId}`);

        // 解析状态字符串
        const parsed = parseStatusString(statusStr);
        expect(parsed.conversationId).toBe(convId);
        expect(parsed.messageId).toBe(msgId);

        // 测试空值
        const emptyStatusStr = genStatusString(undefined, undefined);
        expect(emptyStatusStr).toBe("|");

        const emptyParsed = parseStatusString(emptyStatusStr);
        expect(emptyParsed.conversationId).toBeUndefined();
        expect(emptyParsed.messageId).toBeUndefined();
    });

    test("40. 应成功创建和加载锚点", async () => {
        const threadId = "thread:create-test";
        const charId = "char:test-char";

        // 创建锚点
        const anchorModel = await AnchorModel.create(threadId, charId);
        expect(anchorModel).toBeDefined();
        expect(anchorModel.getThreadId()).toBe(threadId);
        expect(anchorModel.getCharId()).toBe(charId);
        expect(anchorModel.getConversationId()).toBeUndefined();
        expect(anchorModel.getMessageId()).toBeUndefined();

        // 加载锚点
        const loadedModel = await AnchorModel.load(threadId, charId);
        expect(loadedModel).toBeDefined();
        expect(loadedModel?.getThreadId()).toBe(threadId);
        expect(loadedModel?.getCharId()).toBe(charId);
    });

    test("41. 应成功使用loadOrCreate", async () => {
        const threadId = "thread:load-or-create";
        const charId = "char:test-char";

        // 第一次调用应创建
        const model1 = await AnchorModel.loadOrCreate(threadId, charId);
        expect(model1).toBeDefined();

        // 第二次调用应加载
        const model2 = await AnchorModel.loadOrCreate(threadId, charId);
        expect(model2).toBeDefined();
        expect(model2.getAnchorId()).toBe(model1.getAnchorId());
    });

    test("42. 应成功更新锚点数据", async () => {
        const threadId = "thread:update-test";
        const charId = "char:test-char";

        // 创建锚点
        const anchorModel = await AnchorModel.create(threadId, charId);

        // 创建对话用于测试
        const testScene = createTestScene();
        const convModel = await ConversationModel.create({ scene: testScene });
        const convId = convModel.getConversationId();

        // 更新锚点数据
        const msgId = "msg-test-123";
        await anchorModel.updateData({
            conversation_id: convId,
            message_id: msgId,
        });

        // 验证更新
        expect(anchorModel.getConversationId()).toBe(convId);
        expect(anchorModel.getMessageId()).toBe(msgId);

        // 重新加载验证持久化
        const loadedModel = await AnchorModel.load(threadId, charId);
        expect(loadedModel?.getConversationId()).toBe(convId);
        expect(loadedModel?.getMessageId()).toBe(msgId);
    });

    test("43. 应成功导出和导入状态字符串", async () => {
        const threadId = "thread:export-test";
        const charId = "char:test-char";

        // 创建锚点并设置数据
        const anchorModel = await AnchorModel.create(threadId, charId);
        const convId = "conv-export-test";
        const msgId = "msg-export-test";
        await anchorModel.updateData({
            conversation_id: convId,
            message_id: msgId,
        });

        // 导出状态字符串
        const statusStr = anchorModel.exportStatusToString();
        expect(statusStr).toBe(`${convId}|${msgId}`);

        // 创建新锚点并导入状态
        const threadId2 = "thread:import-test";
        const anchorModel2 = await AnchorModel.create(threadId2, charId);
        const importResult = await anchorModel2.importStatusFromString(statusStr);
        expect(importResult).toBe(true);
        expect(anchorModel2.getConversationId()).toBe(convId);
        expect(anchorModel2.getMessageId()).toBe(msgId);
    });

    test("44. 应成功获取定位数据", async () => {
        const threadId = "thread:pos-data-test";
        const charId = "char:test-char";

        // 创建锚点并设置数据
        const anchorModel = await AnchorModel.create(threadId, charId);
        const convId = "conv-pos-test";
        const msgId = "msg-pos-test";
        await anchorModel.updateData({
            conversation_id: convId,
            message_id: msgId,
        });

        // 获取定位数据
        const posData = anchorModel.getPosData();
        expect(posData.conversationId).toBe(convId);
        expect(posData.messageId).toBe(msgId);
    });

    test("45. 应成功清理无效会话", async () => {
        const threadId = "thread:cleanup-test";
        const charId = "char:test-char";

        // 创建对话
        const testScene = createTestScene();
        const convModel = await ConversationModel.create({ scene: testScene });
        const oldConvId = convModel.getConversationId();

        // 创建锚点并关联到对话
        const anchorModel = await AnchorModel.create(threadId, charId);
        await anchorModel.updateData({
            conversation_id: oldConvId,
            message_id: undefined,
        });

        // 验证关联
        expect(anchorModel.getConversationId()).toBe(oldConvId);

        // 创建新对话
        const newConvModel = await ConversationModel.create({ scene: testScene });
        const newConvId = newConvModel.getConversationId();

        // 更新锚点到新对话（旧对话没有消息，应该被清理）
        await anchorModel.updateData({
            conversation_id: newConvId,
        });

        // 验证旧对话被清理
        const oldConvExists = await ConversationModel.load(oldConvId);
        expect(oldConvExists).toBeUndefined();

        // 验证新对话存在
        const newConvExists = await ConversationModel.load(newConvId);
        expect(newConvExists).toBeDefined();
    });

    test("46. 应正确处理importStatusFromString无效参数", async () => {
        const threadId = "thread:invalid-import";
        const charId = "char:test-char";

        // 创建锚点
        const anchorModel = await AnchorModel.create(threadId, charId);

        // 测试无效状态字符串
        const result1 = await anchorModel.importStatusFromString("");
        expect(result1).toBe(false);

        const result2 = await anchorModel.importStatusFromString("-");
        expect(result2).toBe(false);

        // 验证数据未被修改
        expect(anchorModel.getConversationId()).toBeUndefined();
        expect(anchorModel.getMessageId()).toBeUndefined();
    });

    test("47. 应正确拒绝空threadId入库", async () => {
        const charId = "char:test-char";

        // 测试空threadId
        await expect(AnchorModel.create("", charId)).rejects.toThrow("threadId 不允许为空字符串");
        await expect(AnchorModel.load("", charId)).rejects.toThrow("threadId 不允许为空字符串");
        await expect(AnchorModel.loadOrCreate("", charId)).rejects.toThrow("threadId 不允许为空字符串");
    });

    test("48. 应正确拒绝空charId入库", async () => {
        const threadId = "thread:empty-char-test";

        // 测试空charId
        await expect(AnchorModel.create(threadId, "")).rejects.toThrow("charId 不允许为空字符串");
        await expect(AnchorModel.load(threadId, "")).rejects.toThrow("charId 不允许为空字符串");
        await expect(AnchorModel.loadOrCreate(threadId, "")).rejects.toThrow("charId 不允许为空字符串");
    });

    test("49. 应正确拒绝空threadId和charId入库", async () => {
        // 测试两者都为空
        await expect(AnchorModel.create("", "")).rejects.toThrow("threadId 不允许为空字符串");
        await expect(AnchorModel.load("", "")).rejects.toThrow("threadId 不允许为空字符串");
        await expect(AnchorModel.loadOrCreate("", "")).rejects.toThrow("threadId 不允许为空字符串");
    });

    test("50. 应正确拒绝包含分隔符的ID入库", async () => {
        const threadId = "thread|invalid";
        const charId = "char|invalid";

        // 测试包含|的threadId
        await expect(AnchorModel.create(threadId, "char:valid")).rejects.toThrow("threadId 不允许包含 \"|\" 字符");

        // 测试包含|的charId
        await expect(AnchorModel.create("thread:valid", charId)).rejects.toThrow("charId 不允许包含 \"|\" 字符");
    });
});
