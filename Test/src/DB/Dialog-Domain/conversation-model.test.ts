import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { ConversationModel, MessageModel } from "@sosraciel-lamda/dialog-domain";
import { DialogStore } from "@sosraciel-lamda/dialog-store";
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

    test("37. 应成功测试background_table的读写与懒创建", async () => {
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });

        // 初始时无background_table
        expect(conversationModel.hasBackgroundTable()).toBe(false);
        expect(conversationModel.getBackgroundTable()).toEqual({});
        expect(conversationModel.getBackgroundTableEntry("ja")).toBeUndefined();

        // 通过setBackgroundTableEntry设置单条纯字符串
        await conversationModel.setBackgroundTableEntry("ja", "日本語訳");
        expect(conversationModel.hasBackgroundTable()).toBe(true);
        expect(conversationModel.getBackgroundTableEntry("ja")).toBe("日本語訳");

        // 设置带 order 的对象条目
        await conversationModel.setBackgroundTableEntry("en", { content: "English", order: 10 });
        await conversationModel.setBackgroundTableEntry("zh", { content: "中文", order: -5 });
        expect(conversationModel.getBackgroundTableEntry("en")).toBe("English");
        expect(conversationModel.getBackgroundTableEntry("zh")).toBe("中文");

        // 重新加载验证持久化
        const loaded1 = await ConversationModel.load(conversationModel.getConversationId());
        expect(loaded1?.hasBackgroundTable()).toBe(true);
        expect(loaded1?.getBackgroundTableEntry("ja")).toBe("日本語訳");
        expect(loaded1?.getBackgroundTableEntry("en")).toBe("English");
        expect(loaded1?.getBackgroundTableEntry("zh")).toBe("中文");

        // 通过updateData整体设置（混合纯字符串与对象）
        await conversationModel.updateData({ background_table: { en: {content:"English"}, zh: { content: "中文", order: 1 } } });
        expect(conversationModel.getBackgroundTableEntry("en")).toBe("English");
        expect(conversationModel.getBackgroundTableEntry("zh")).toBe("中文");
        expect(conversationModel.getBackgroundTableEntry("ja")).toBeUndefined();

        // 删除单条条目
        await conversationModel.setBackgroundTableEntry("en", undefined);
        expect(conversationModel.getBackgroundTableEntry("en")).toBeUndefined();
        expect(conversationModel.hasBackgroundTable()).toBe(true);

        // 删除最后一条条目后hasBackgroundTable应为false
        await conversationModel.setBackgroundTableEntry("zh", undefined);
        expect(conversationModel.hasBackgroundTable()).toBe(false);

        // 通过updateData传入undefined删除整个background_table
        await conversationModel.updateData({ background_table: { en: {content:"English"} } });
        expect(conversationModel.hasBackgroundTable()).toBe(true);
        await conversationModel.updateData({ background_table: undefined });
        expect(conversationModel.hasBackgroundTable()).toBe(false);
    });

    test("38. 应成功测试setBackgroundTableEntry连续写入与删除的持久化", async () => {
        const testScene = createTestScene();
        const convId = (await ConversationModel.create({ scene: testScene })).getConversationId();

        // 重新加载，模拟真实场景（与CmdTable一致的操作模式）
        const conv = (await ConversationModel.load(convId))!;

        // 第一次设置（background_table不存在，table是新对象，写入应成功）
        await conv.setBackgroundTableEntry("info", "备注信息");
        const dbRow1 = (await DialogStore.getConversation(convId, { ignoreCache: true }))!.data as any;
        expect(dbRow1.heavy_data?.background_table?.info).toEqual({ content: "备注信息" });

        // 第二次设置（background_table已存在，table是缓存引用，修改引用后structEqual可能误判）
        await conv.setBackgroundTableEntry("desc", { content: "描述", order: 1 });
        const dbRow2 = (await DialogStore.getConversation(convId, { ignoreCache: true }))!.data as any;
        expect(dbRow2.heavy_data?.background_table?.info).toEqual({ content: "备注信息" });
        expect(dbRow2.heavy_data?.background_table?.desc).toEqual({ content: "描述", order: 1 });

        // 第三次设置
        await conv.setBackgroundTableEntry("extra", "额外信息");
        const dbRow3 = (await DialogStore.getConversation(convId, { ignoreCache: true }))!.data as any;
        expect(dbRow3.heavy_data?.background_table?.info).toEqual({ content: "备注信息" });
        expect(dbRow3.heavy_data?.background_table?.desc).toEqual({ content: "描述", order: 1 });
        expect(dbRow3.heavy_data?.background_table?.extra).toEqual({ content: "额外信息" });

        // 删除条目后验证数据库持久化
        await conv.setBackgroundTableEntry("info", undefined);
        const dbRow4 = (await DialogStore.getConversation(convId, { ignoreCache: true }))!.data as any;
        expect(dbRow4.heavy_data?.background_table?.info).toBeUndefined();
        expect(dbRow4.heavy_data?.background_table?.desc).toEqual({ content: "描述", order: 1 });
    });
});
