import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { ConversationModel, MessageModel, FirstModel } from "@sosraciel-lamda/dialog-domain";
import type { DialogMessageData } from "@sosraciel-lamda/dialog-domain";
import { sleep } from "@zwa73/utils";
import { createTestScene, setupTestDb, teardownTestDb } from "./Util";

describe("Dialog-Domain MessageModel 测试", () => {
    let manager: DBManager;

    beforeAll(async () => {
        manager = await setupTestDb();
    }, 30000);

    afterAll(async () => {
        await teardownTestDb(manager);
    }, 30000);

    test("9. 应成功使用MessageModel创建和管理消息", async () => {
        // 先创建对话
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 创建消息记录
        const testMessageData: Omit<DialogMessageData, 'message_id'> = {
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user",
            sender_type: "user" as const,
            content: "I need help with my order",
            translate_content_table: {}
        };
        const messageModel = await MessageModel.create(testMessageData);
        expect(messageModel).toBeDefined();

        // 获取消息ID
        const messageId = messageModel.getMessageId();
        expect(messageId).toBeDefined();
        expect(typeof messageId).toBe("string");

        // 设置翻译内容
        const testTranslation = "我需要帮助处理我的订单";
        console.log('设置')
        await messageModel.setTransContent("zh", testTranslation);
        console.log('完成设置')

        // 获取翻译内容
        const retrievedTranslation = messageModel.getTransContent("zh");
        expect(retrievedTranslation).toBe(testTranslation);

        // 获取消息选择列表（应为空，因为没有子消息）
        const messageChoiceList = await messageModel.getMessageChoiceList();
        expect(Array.isArray(messageChoiceList)).toBe(true);
        expect(messageChoiceList.length).toBe(0);
    });

    test("17. 应成功测试FirstModel的updateData设置translate_content_table", async () => {
        // 创建对话和FirstModel
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const firstModel = await FirstModel.loadOrCreate(conversationModel);

        // 设置中文翻译
        const testTranslation = "这是首条消息的翻译";
        await firstModel.setTransContent("zh", testTranslation);

        // 验证翻译内容
        const retrievedTranslation = firstModel.getTransContent("zh");
        expect(retrievedTranslation).toBe(testTranslation);

        // 设置英文翻译，验证多语言支持
        const anotherTranslation = "This is the first message translation";
        await firstModel.setTransContent("en", anotherTranslation);

        // 验证两种语言翻译都存在
        expect(firstModel.getTransContent("zh")).toBe(testTranslation);
        expect(firstModel.getTransContent("en")).toBe(anotherTranslation);
    });

    test("18. 应成功测试MessageModel.updateData传入新值覆盖旧值（深合并验证）", async () => {
        // 创建对话和消息
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 创建带有多个翻译的消息（测试三个语言）
        const messageModel = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "test_user",
            sender_type: "user",
            content: "Test content for deep merge",
            translate_content_table: { zh: "中文翻译", en: "English translation", ja: "日本語訳" }
        });

        const messageId = messageModel.getMessageId();

        // 验证初始翻译
        expect(messageModel.getTransContent("zh")).toBe("中文翻译");
        expect(messageModel.getTransContent("en")).toBe("English translation");
        expect(messageModel.getTransContent("ja")).toBe("日本語訳");

        // 重新加载验证持久化
        const loadedMessage1 = await MessageModel.load(messageId);
        expect(loadedMessage1?.getTransContent("zh")).toBe("中文翻译");
        expect(loadedMessage1?.getTransContent("en")).toBe("English translation");
        expect(loadedMessage1?.getTransContent("ja")).toBe("日本語訳");

        // 更新翻译表，用新对象完全覆盖旧对象（单层深合并：translate_content_table 整体被覆盖）
        await messageModel.updateData({
            translate_content_table: { en: "updated English" }
        });

        // 重新加载验证更新结果：zh和ja应被删除，en应被更新
        const loadedMessage2 = await MessageModel.load(messageId);
        expect(loadedMessage2?.getTransContent("zh")).toBeUndefined();
        expect(loadedMessage2?.getTransContent("ja")).toBeUndefined();
        expect(loadedMessage2?.getTransContent("en")).toBe("updated English");
    });

    test("19. 应成功测试recordMessageModel批量记录消息", async () => {
        // 创建对话
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 创建FirstModel（确保对话初始化完成）
        const firstModel = await FirstModel.loadOrCreate(conversationModel);

        // 批量记录3条消息
        const messages = await MessageModel.recordMessageModel(
            {
                conversation_id: conversationId,
                content: "First message",
                sender_id: "user1",
                sender_type: "user",
                parent_message_id: undefined
            },
            {
                conversation_id: conversationId,
                content: "Second message",
                sender_id: "char1",
                sender_type: "char",
                parent_message_id: undefined
            },
            {
                conversation_id: conversationId,
                content: "Third message",
                sender_id: "user2",
                sender_type: "user",
                parent_message_id: undefined
            }
        );

        // 验证返回的消息数量
        expect(messages.length).toBe(3);

        // 验证第一条消息的属性
        expect(messages[0].getContent()).toBe("First message");
        expect(messages[0].getSenderId()).toBe("user1");
        expect(messages[0].getSenderType()).toBe("user");

        // 验证第二条消息的属性
        expect(messages[1].getContent()).toBe("Second message");
        expect(messages[1].getSenderId()).toBe("char1");
        expect(messages[1].getSenderType()).toBe("char");

        // 验证第三条消息的属性
        expect(messages[2].getContent()).toBe("Third message");
        expect(messages[2].getSenderId()).toBe("user2");
        expect(messages[2].getSenderType()).toBe("user");

        // 验证消息已持久化到数据库
        const loadedMessage0 = await MessageModel.load(messages[0].getMessageId());
        expect(loadedMessage0).toBeDefined();
        expect(loadedMessage0?.getContent()).toBe("First message");
    });

    test("28. 应成功测试MessageModel.getPreMessageId返回undefined情况", async () => {
        // 创建对话
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 创建FirstModel
        const firstModel = await FirstModel.loadOrCreate(conversationModel);

        // 创建没有parent_message_id的消息（直接跟在FirstModel后）
        const msg = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user",
            sender_type: "user",
            content: "First user message"
        });

        // 验证getPreMessageId返回undefined
        expect(msg.getPreMessageId()).toBeUndefined();

        // 创建有parent_message_id的消息
        const msg2 = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: msg.getMessageId(),
            sender_id: "char",
            sender_type: "char",
            content: "Response"
        });

        // 验证getPreMessageId返回正确的ID
        expect(msg2.getPreMessageId()).toBe(msg.getMessageId());
    });

    test("29. 应成功测试FirstModel.getMessageChoiceList", async () => {
        // 创建对话
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 创建FirstModel
        const firstModel = await FirstModel.loadOrCreate(conversationModel);

        // 在FirstModel后创建多条消息（作为FirstModel的选择）
        const msg1 = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user1",
            sender_type: "user",
            content: "First choice"
        });
        const msg2 = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user2",
            sender_type: "user",
            content: "Second choice"
        });
        const msg3 = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user3",
            sender_type: "user",
            content: "Third choice"
        });

        // 获取FirstModel的消息选择列表
        const choiceList = await firstModel.getMessageChoiceList();

        // 验证返回的消息选择列表
        expect(Array.isArray(choiceList)).toBe(true);
        expect(choiceList.length).toBe(3);

        // 验证消息ID和内容
        const choiceIds = choiceList.map(m => m.getMessageId());
        expect(choiceIds).toContain(msg1.getMessageId());
        expect(choiceIds).toContain(msg2.getMessageId());
        expect(choiceIds).toContain(msg3.getMessageId());
    });

    test("31. 应成功测试多语言翻译覆盖", async () => {
        // 创建对话和消息
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        const messageModel = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user",
            sender_type: "user",
            content: "Original content",
            translate_content_table: {}
        });

        // 第一次设置中文翻译
        await messageModel.setTransContent("zh", "第一次翻译");
        expect(messageModel.getTransContent("zh")).toBe("第一次翻译");

        // 第二次设置中文翻译（覆盖）
        await messageModel.setTransContent("zh", "第二次翻译");
        expect(messageModel.getTransContent("zh")).toBe("第二次翻译");

        // 验证第一次翻译已被覆盖
        expect(messageModel.getTransContent("zh")).not.toBe("第一次翻译");

        // 重新加载验证持久化
        const loadedMsg = await MessageModel.load(messageModel.getMessageId());
        expect(loadedMsg?.getTransContent("zh")).toBe("第二次翻译");
    });

    test("32. 应成功测试getTransContent不存在的语言", async () => {
        // 创建对话和消息
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        const messageModel = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user",
            sender_type: "user",
            content: "Original content",
            translate_content_table: { zh: "中文翻译" }
        });

        // 验证不存在的语言返回undefined
        expect(messageModel.getTransContent("en")).toBeUndefined();
        expect(messageModel.getTransContent("ja")).toBeUndefined();
        expect(messageModel.getTransContent("ko")).toBeUndefined();

        // 验证空字符串语言key
        expect(messageModel.getTransContent("")).toBeUndefined();
    });

    test("33. 应成功测试FirstModel.updateData传入undefined删除translate_content_table中的key", async () => {
        // 创建对话和FirstModel
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const firstModel = await FirstModel.loadOrCreate(conversationModel);

        // 设置多个语言翻译
        await firstModel.setTransContent("zh", "首条消息中文");
        await firstModel.setTransContent("en", "First message English");
        await firstModel.setTransContent("ja", "最初のメッセージ");

        // 验证初始翻译
        expect(firstModel.getTransContent("zh")).toBe("首条消息中文");
        expect(firstModel.getTransContent("en")).toBe("First message English");
        expect(firstModel.getTransContent("ja")).toBe("最初のメッセージ");

        // 使用updateData传入只包含en的table
        await firstModel.updateData({
            translate_content_table: { en: "Updated first message" }
        });

        // 验证zh和ja被删除，en被更新
        expect(firstModel.getTransContent("zh")).toBeUndefined();
        expect(firstModel.getTransContent("ja")).toBeUndefined();
        expect(firstModel.getTransContent("en")).toBe("Updated first message");
    });

    test("37. 应成功测试MessageModel.delete静态方法", async () => {
        // 创建对话和父子消息
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 创建父消息
        const parentMessage = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user",
            sender_type: "user",
            content: "Parent message"
        });

        // 创建子消息
        const childMessage = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: parentMessage.getMessageId(),
            sender_id: "char",
            sender_type: "char",
            content: "Child message"
        });

        // 验证消息存在
        expect(await MessageModel.load(parentMessage.getMessageId())).toBeDefined();
        expect(await MessageModel.load(childMessage.getMessageId())).toBeDefined();

        // 删除父消息（使用静态方法)
        await MessageModel.delete(parentMessage.getMessageId());

        // 等待联动删除
        await sleep(100);

        // 验证父消息和子消息都被删除（触发器联动）
        expect(await MessageModel.load(parentMessage.getMessageId())).toBeUndefined();
        expect(await MessageModel.load(childMessage.getMessageId())).toBeUndefined();
    });
});
