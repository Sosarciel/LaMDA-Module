import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { ConversationModel, MessageModel } from "@sosraciel-lamda/dialog-domain";
import { sleep } from "@zwa73/utils";
import { createTestScene, setupTestDb, teardownTestDb } from "./Util";

describe("Dialog-Domain ConversationModel 测试", () => {
    let manager: DBManager;

    beforeAll(async () => {
        manager = await setupTestDb();
    }, 30000);

    afterAll(async () => {
        await teardownTestDb(manager);
    }, 30000);

    test("8. 应成功使用ConversationModel创建和管理对话", async () => {
        const testScene = createTestScene();

        // 创建对话记录
        const conversationModel = await ConversationModel.create({ scene: testScene });
        expect(conversationModel).toBeDefined();

        // 获取对话ID
        const conversationId = conversationModel.getConversationId();
        expect(conversationId).toBeDefined();
        expect(typeof conversationId).toBe("string");

        // 加载对话记录
        const loadedConversationModel = await ConversationModel.load(conversationId);
        expect(loadedConversationModel).toBeDefined();
        expect(loadedConversationModel?.getConversationId()).toBe(conversationId);

        // 更新背景信息
        const testBackgroundInfo = "This is a test background info";
        await conversationModel.updateData({ background_info: testBackgroundInfo });

        // 检查背景信息
        expect(conversationModel.hasBackgroundInfo()).toBe(true);
        expect(conversationModel.getBackgroundInfo()).toBe(testBackgroundInfo);
    });

    test("16. 应成功测试对话场景的设置与获取", async () => {
        // 先创建对话
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 获取初始场景
        const initialScene = conversationModel.getScene();
        expect(initialScene).toBeDefined();
        expect(initialScene.name).toBe("test_scene");

        // 创建新场景
        const newScene = {
            define: "new_test_define",
            memory: [],
            name: "new_test_scene",
            dialog: [
                {
                    type: "chat" as const,
                    content: "Hello, how can I help you today?",
                    sender_name: "Assistant"
                }
            ]
        };

        // 设置新场景
        await conversationModel.setScene(newScene);

        // 获取更新后的场景
        const updatedScene = conversationModel.getScene();
        expect(updatedScene).toBeDefined();
        expect(updatedScene.name).toBe("new_test_scene");
        expect(updatedScene.define).toBe("new_test_define");
    });

    test("23. 应成功测试ConversationModel.updateData清空background_info", async () => {
        // 创建带背景信息的对话
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });

        // 设置背景信息
        await conversationModel.updateData({ background_info: "Initial background info" });
        expect(conversationModel.hasBackgroundInfo()).toBe(true);
        expect(conversationModel.getBackgroundInfo()).toBe("Initial background info");

        // 清空背景信息
        await conversationModel.updateData({ background_info: "" });

        // 验证背景信息已清空
        expect(conversationModel.hasBackgroundInfo()).toBe(false);
        expect(conversationModel.getBackgroundInfo()).toBeUndefined();

        // 重新加载验证持久化
        const loadedConv = await ConversationModel.load(conversationModel.getConversationId());
        expect(loadedConv?.hasBackgroundInfo()).toBe(false);
        expect(loadedConv?.getBackgroundInfo()).toBeUndefined();
    });

    test("34. 应成功测试ConversationModel.updateData传入undefined删除background_info", async () => {
        // 创建带背景信息的对话
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });

        // 设置背景信息
        await conversationModel.updateData({ background_info: "This is background info" });
        expect(conversationModel.hasBackgroundInfo()).toBe(true);
        expect(conversationModel.getBackgroundInfo()).toBe("This is background info");

        // 重新加载验证持久化
        const loadedConv1 = await ConversationModel.load(conversationModel.getConversationId());
        expect(loadedConv1?.hasBackgroundInfo()).toBe(true);
        expect(loadedConv1?.getBackgroundInfo()).toBe("This is background info");

        // 传入undefined删除background_info
        await conversationModel.updateData({ background_info: undefined });

        // 验证背景信息已删除
        expect(conversationModel.hasBackgroundInfo()).toBe(false);
        expect(conversationModel.getBackgroundInfo()).toBeUndefined();

        // 重新加载验证持久化
        const loadedConv2 = await ConversationModel.load(conversationModel.getConversationId());
        expect(loadedConv2?.hasBackgroundInfo()).toBe(false);
        expect(loadedConv2?.getBackgroundInfo()).toBeUndefined();
    });

    test("35. 应成功测试ConversationModel.existsAnyMessage静态方法", async () => {
        // 创建对话
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 刚创建时应该没有消息（只有FirstModel，不算真正的消息）
        const existsBefore = await ConversationModel.existsAnyMessage(conversationId);
        expect(existsBefore).toBe(false);

        // 添加一条消息
        await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user",
            sender_type: "user",
            content: "Test message for existsAnyMessage"
        });

        // 现在应该有消息了
        const existsAfter = await ConversationModel.existsAnyMessage(conversationId);
        expect(existsAfter).toBe(true);

        // 测试不存在的对话ID
        const existsNonExistent = await ConversationModel.existsAnyMessage("non-existent-conversation-id");
        expect(existsNonExistent).toBe(false);
    });

    test("36. 应成功测试ConversationModel.delete静态方法", async () => {
        // 创建对话和消息
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 添加消息
        const messageModel = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user",
            sender_type: "user",
            content: "Test message for delete"
        });

        // 验证消息存在
        const loadedMessage = await MessageModel.load(messageModel.getMessageId());
        expect(loadedMessage).toBeDefined();

        // 删除对话
        await ConversationModel.delete(conversationId);

        // 等待联动删除
        await sleep(100);

        // 验证对话和消息都被删除
        const deletedConv = await ConversationModel.load(conversationId);
        expect(deletedConv).toBeUndefined();

        const deletedMessage = await MessageModel.load(messageModel.getMessageId());
        expect(deletedMessage).toBeUndefined();
    });
});
