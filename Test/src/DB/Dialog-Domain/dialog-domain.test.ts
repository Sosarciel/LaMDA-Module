import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { DialogStore } from "@sosraciel-lamda/dialog-store";
import type { ConversationStruct, MessageStruct } from "@sosraciel-lamda/dialog-store";
import { ConversationModel, MessageModel, FirstModel, DialogHelper } from "@sosraciel-lamda/dialog-domain";
import type { DialogMessageData } from "@sosraciel-lamda/dialog-domain";
import type { ConversationHeavyData, MessageModelExt, ConversationModelExt } from "@sosraciel-lamda/dialog-domain";
import { sleep, UtilFunc } from "@zwa73/utils";
import { DBCache } from "@sosraciel-lamda/dialog-store/dist/DBCache";
import { PG_PORT } from "@/src/Constant";

/**创建测试对话结构体 */
const createTestConversation = (options?: {
    conversation_id?: string;
    background_info?: string;
}): ConversationStruct<ConversationModelExt> => {
    return {
        data: {
            conversation_id: options?.conversation_id || UtilFunc.genUUID(),
            heavy_data: {
                background_info: options?.background_info,
                scene: {
                    define: "test_define",
                    memory: [],
                    name: "test_scene",
                    dialog: [
                        {
                            type: "chat" as const,
                            content: "Hello, how can I help you?",
                            sender_name: "Assistant"
                        }
                    ]
                }
            }
        }
    };
};

/**创建测试消息结构体 */
const createTestMessage = (conversationId: string, options?: {
    message_id?: string;
    parent_message_id?: string | null;
    sender_id?: string;
    sender_type?: "user" | "char";
    content?: string;
}): MessageStruct<MessageModelExt> => {
    return {
        data: {
            message_id: options?.message_id || UtilFunc.genUUID(),
            conversation_id: conversationId,
            parent_message_id: options?.parent_message_id ?? undefined,
            sender_id: options?.sender_id || "user",
            content: options?.content || "Test message",
            light_data: {
                sender_type: options?.sender_type || "user" as const,
            },
            heavy_data: {
                translate_content_table: {}
            }
        }
    };
};

/**创建测试场景结构体 */
const createTestScene = () => {
    return {
        define: "test_define",
        memory: [],
        name: "test_scene",
        dialog: [
            {
                type: "chat" as const,
                content: "Hello, how can I help you?",
                sender_name: "Assistant"
            }
        ]
    };
};

describe("Dialog-Domain 模块测试", () => {
    let manager: DBManager;

    beforeAll(async () => {
        // 创建数据库管理器
        manager = await DBManager.create({
            port: PG_PORT,
            user: "postgres",
            database: "postgres",
            host: "localhost",
            max: 10,
            idleTimeoutMillis: 1000 * 30,
        });

        // 测试数据库连接
        const result = await manager.client.query("SELECT 1");
        expect(result.rowCount).toBe(1);

        // 初始化DialogStore
        DialogStore.initInject(Promise.resolve(manager));
        await DialogStore.inited;

        // 清理测试数据
        await manager.client.query(`DELETE FROM dialog.message`);
        await manager.client.query(`DELETE FROM dialog.conversation`);
    }, 30000);

    afterAll(async () => {
        // 清理数据库
        try {
            if (manager) {
                // 删除测试数据
                await manager.client.query(`DELETE FROM dialog.message`);
                await manager.client.query(`DELETE FROM dialog.conversation`);
                // 关闭数据库连接
                await manager.stop();
            }

            // 清理缓存
            // 使用DBCacheCoordinator的dispose方法清理缓存资源
            DBCache.dispose();

        } catch (e) {
            // 忽略错误
        }
    }, 30000);

    test("1. 应成功初始化数据库", async () => {
        // 验证表是否存在
        const conversationTableResult = await manager.client.sql`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_name = 'conversation'
            AND table_schema = 'dialog';
        `;
        expect(conversationTableResult.rowCount).toBe(1);

        const messageTableResult = await manager.client.sql`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_name = 'message'
            AND table_schema = 'dialog';
        `;
        expect(messageTableResult.rowCount).toBe(1);
    });

    test("2. 应成功创建和获取对话记录", async () => {
        const testConversation = createTestConversation({ background_info: "Test background info" });

        // 创建对话记录
        await DialogStore.setConversation(testConversation);

        // 获取对话记录
        const retrievedConversation = await DialogStore.getConversation(testConversation.data.conversation_id);
        expect(retrievedConversation).toBeDefined();
        expect(retrievedConversation?.data.conversation_id).toBe(testConversation.data.conversation_id);
        expect((retrievedConversation?.data.heavy_data as ConversationHeavyData)?.background_info).toBe(testConversation.data.heavy_data?.background_info);
    });

    test("3. 应成功创建和获取消息记录", async () => {
        // 先创建对话
        const testConversation = createTestConversation();
        await DialogStore.setConversation(testConversation);

        // 创建消息记录
        const testMessage = createTestMessage(testConversation.data.conversation_id, { content: "I need help with my order" });
        await DialogStore.setMessage(testMessage);

        // 获取消息记录
        const retrievedMessage = await DialogStore.getMessage(testMessage.data.message_id);
        expect(retrievedMessage).toBeDefined();
        expect(retrievedMessage?.data.message_id).toBe(testMessage.data.message_id);
        expect(retrievedMessage?.data.content).toBe(testMessage.data.content);
    });

    test("4. 应成功创建消息树结构", async () => {
        // 先创建对话
        const testConversation = createTestConversation();
        await DialogStore.setConversation(testConversation);

        // 创建根消息
        const parentMessage = createTestMessage(testConversation.data.conversation_id, { content: "What's the weather today?" });
        await DialogStore.setMessage(parentMessage);

        // 创建子消息
        const childMessage = createTestMessage(testConversation.data.conversation_id, {
            parent_message_id: parentMessage.data.message_id,
            sender_id: "assistant",
            content: "It's sunny today!"
        });
        await DialogStore.setMessage(childMessage);

        // 验证子消息是否存在
        const retrievedChildMessage = await DialogStore.getMessage(childMessage.data.message_id);
        expect(retrievedChildMessage).toBeDefined();
        expect(retrievedChildMessage?.data.parent_message_id).toBe(parentMessage.data.message_id);
    });

    test("5. 应成功测试消息树联动删除（删除根消息时删除枝消息）", async () => {
        // 先创建对话
        const testConversation = createTestConversation();
        await DialogStore.setConversation(testConversation);

        // 创建根消息
        const parentMessage = createTestMessage(testConversation.data.conversation_id, { content: "What's the weather today?" });
        await DialogStore.setMessage(parentMessage);

        // 创建子消息
        const childMessage = createTestMessage(testConversation.data.conversation_id, {
            parent_message_id: parentMessage.data.message_id,
            sender_id: "assistant",
            content: "It's sunny today!"
        });
        await DialogStore.setMessage(childMessage);

        // 验证子消息存在
        let childMessageExists = await DialogStore.getMessage(childMessage.data.message_id);
        expect(childMessageExists).toBeDefined();

        // 验证根消息存在
        const parentMessageExists = await DialogStore.getMessage(parentMessage.data.message_id);
        expect(parentMessageExists).toBeDefined();

        // 执行删除根消息操作
        await DialogStore.deleteMessage(parentMessage.data.message_id);

        // 等待联动删除副作用通知下发
        await sleep(100);

        // 验证根消息和子消息都已删除（由于触发器联动删除）
        const deletedParentMessage = await DialogStore.getMessage(parentMessage.data.message_id);
        expect(deletedParentMessage).toBeUndefined();

        const deletedChildMessage = await DialogStore.getMessage(childMessage.data.message_id);
        expect(deletedChildMessage).toBeUndefined();
    });

    test("6. 应成功测试对话联动删除（删除对话时删除所有相关消息）", async () => {
        // 先创建对话
        const testConversation = createTestConversation();
        await DialogStore.setConversation(testConversation);

        // 创建消息
        const testMessage = createTestMessage(testConversation.data.conversation_id, { content: "I need help with my order" });
        await DialogStore.setMessage(testMessage);

        // 创建新的消息用于测试
        const newMessage = createTestMessage(testConversation.data.conversation_id, { content: "Test message for cascade delete" });
        await DialogStore.setMessage(newMessage);

        // 验证消息存在
        let message = await DialogStore.getMessage(newMessage.data.message_id);
        expect(message).toBeDefined();

        // 验证对话存在
        const conversation = await DialogStore.getConversation(testConversation.data.conversation_id);
        expect(conversation).toBeDefined();

        // 执行删除对话操作
        await DialogStore.deleteConversation(testConversation.data.conversation_id);

        // 等待联动删除副作用通知下发
        await sleep(100);

        // 验证对话和所有相关消息都已删除（由于触发器联动删除）
        const deletedConversation = await DialogStore.getConversation(testConversation.data.conversation_id, { ignoreCache: true });
        expect(deletedConversation).toBeUndefined();

        const deletedMessage = await DialogStore.getMessage(newMessage.data.message_id, { ignoreCache: true });
        expect(deletedMessage).toBeUndefined();

        // 验证原始消息也已被删除
        const originalMessage = await DialogStore.getMessage(testMessage.data.message_id, { ignoreCache: true });
        expect(originalMessage).toBeUndefined();
    });

    test("7. 应成功执行事务操作", async () => {
        const newConversationId = UtilFunc.genUUID();

        await DialogStore.transaction(async (client) => {
            // 创建对话
            const testConversation = createTestConversation({ conversation_id: newConversationId });
            await DialogStore.setConversation(testConversation, { client });

            // 创建消息
            const testMessage = createTestMessage(newConversationId, { content: "I need help with my order" });
            await DialogStore.setMessage(testMessage, { client });
        });

        // 验证事务操作结果
        const conversation = await DialogStore.getConversation(newConversationId);
        expect(conversation).toBeDefined();
    });

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

    test("10. 应成功获取消息选择列表并验证排序", async () => {
        // 先创建对话
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 创建3个消息
        const testMessage1 = createTestMessage(conversationId, { content: "First message" });
        const testMessage2 = createTestMessage(conversationId, { content: "Second message" });
        const testMessage3 = createTestMessage(conversationId, { content: "Third message" });

        await DialogStore.setMessage(testMessage1);
        await DialogStore.setMessage(testMessage2);
        await DialogStore.setMessage(testMessage3);

        // 获取消息选择列表
        const messageChoiceList = await DialogStore.getMessageChoiceList(conversationId);
        expect(Array.isArray(messageChoiceList)).toBe(true);
        expect(messageChoiceList.length).toBe(3);

        // 验证消息选择列表的完整内容和顺序（按插入顺序）
        const messageIds = messageChoiceList.map(msg => msg.data.message_id);
        expect(messageIds).toEqual([testMessage1.data.message_id, testMessage2.data.message_id, testMessage3.data.message_id]);
    });

    test("11. 应成功使用DialogStore获取消息选择ID列表", async () => {
        // 先创建对话
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 创建3个消息
        const testMessage1 = createTestMessage(conversationId, { content: "First message" });
        const testMessage2 = createTestMessage(conversationId, { content: "Second message" });
        const testMessage3 = createTestMessage(conversationId, { content: "Third message" });

        await DialogStore.setMessage(testMessage1);
        await DialogStore.setMessage(testMessage2);
        await DialogStore.setMessage(testMessage3);

        // 获取消息选择ID列表
        const messageChoiceIdList = await DialogStore.getMessageChoiceIdList(conversationId);
        expect(Array.isArray(messageChoiceIdList)).toBe(true);
        expect(messageChoiceIdList.length).toBe(3);

        // 直接验证消息选择ID列表的完整内容和顺序（按插入顺序）
        expect(messageChoiceIdList).toEqual([testMessage1.data.message_id, testMessage2.data.message_id, testMessage3.data.message_id]);
    });

    test("12. 应成功使用DialogStore获取消息选择列表（带parentid）", async () => {
        // 先创建对话
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 创建父消息
        const parentMessage = createTestMessage(conversationId, { content: "Parent message" });
        await DialogStore.setMessage(parentMessage);

        // 创建3个子消息
        const childMessage1 = createTestMessage(conversationId, {
            parent_message_id: parentMessage.data.message_id,
            content: "Child message 1"
        });
        const childMessage2 = createTestMessage(conversationId, {
            parent_message_id: parentMessage.data.message_id,
            content: "Child message 2"
        });
        const childMessage3 = createTestMessage(conversationId, {
            parent_message_id: parentMessage.data.message_id,
            content: "Child message 3"
        });

        await DialogStore.setMessage(childMessage1);
        await DialogStore.setMessage(childMessage2);
        await DialogStore.setMessage(childMessage3);

        // 获取消息选择列表（带parentid）
        const messageChoiceList = await DialogStore.getMessageChoiceList(conversationId, parentMessage.data.message_id);
        expect(Array.isArray(messageChoiceList)).toBe(true);
        expect(messageChoiceList.length).toBe(3);

        // 直接验证消息选择列表的完整内容和顺序（按插入顺序）
        const messageIds = messageChoiceList.map(msg => msg.data.message_id);
        expect(messageIds).toEqual([childMessage1.data.message_id, childMessage2.data.message_id, childMessage3.data.message_id]);
    });

    test("13. 应成功测试对话记录的更新操作", async () => {
        // 先创建对话
        const testConversation = createTestConversation({ background_info: "Initial background" });
        await DialogStore.setConversation(testConversation);

        // 更新对话记录 - 使用新的结构体
        const updatedConversation = createTestConversation({
            conversation_id: testConversation.data.conversation_id,
            background_info: "Updated background info"
        });
        await DialogStore.setConversation(updatedConversation);

        // 获取更新后的对话记录
        const retrievedConversation = await DialogStore.getConversation(testConversation.data.conversation_id);
        expect(retrievedConversation).toBeDefined();
        expect((retrievedConversation?.data.heavy_data as ConversationHeavyData)?.background_info).toBe("Updated background info");
    });

    test("14. 应成功测试消息记录的更新操作", async () => {
        // 先创建对话
        const testConversation = createTestConversation();
        await DialogStore.setConversation(testConversation);

        // 创建消息记录
        const testMessage = createTestMessage(testConversation.data.conversation_id, { content: "Initial content" });
        await DialogStore.setMessage(testMessage);

        // 更新消息记录 - 使用新的结构体，保持相同的消息ID
        const updatedMessage = createTestMessage(testConversation.data.conversation_id, {
            message_id: testMessage.data.message_id,
            parent_message_id: testMessage.data.parent_message_id,
            content: "Updated content"
        });
        await DialogStore.setMessage(updatedMessage);

        // 获取更新后的消息记录
        const retrievedMessage = await DialogStore.getMessage(testMessage.data.message_id);
        expect(retrievedMessage).toBeDefined();
        expect(retrievedMessage?.data.content).toBe("Updated content");
    });

    test("15. 应成功测试缓存与数据库通知的同步（通过直接调用SQL）", async () => {
        // 先创建对话
        const testConversation = createTestConversation();
        await DialogStore.setConversation(testConversation);

        // 创建消息记录
        const testMessage = createTestMessage(testConversation.data.conversation_id, { content: "Initial content" });
        await DialogStore.setMessage(testMessage);

        // 验证缓存
        const cachedMessage = await DialogStore.getMessage(testMessage.data.message_id);
        expect(cachedMessage).toBeDefined();
        expect(cachedMessage?.data.content).toBe("Initial content");

        // 不通过访问器，直接用mgr发指令更新数据
        await manager.client.query(`
            UPDATE dialog.message
            SET data = jsonb_set(data, '{content}', to_jsonb('Updated via SQL'::text), true)
            WHERE data->>'message_id' = '${testMessage.data.message_id}';
        `);

        // 等待通知处理
        await sleep(100);

        // 验证缓存是否已更新
        const updatedCachedMessage = await DialogStore.getMessage(testMessage.data.message_id);
        expect(updatedCachedMessage).toBeDefined();
        expect(updatedCachedMessage?.data.content).toBe("Updated via SQL");
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

    test("20. 应成功测试DialogHelper.getHistMessageList获取历史消息（强断言）", async () => {
        // 创建无预对话的场景，便于精确验证
        const testScene = {
            define: "strong_assert_test",
            memory: [],
            name: "test_scene",
            dialog: []
        };
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 创建FirstModel
        const firstModel = await FirstModel.loadOrCreate(conversationModel);

        // 创建消息链：user -> char -> user
        const msg1 = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user",
            sender_type: "user",
            content: "User message 1"
        });

        const msg2 = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: msg1.getMessageId(),
            sender_id: "char",
            sender_type: "char",
            content: "Character response 1"
        });

        const msg3 = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: msg2.getMessageId(),
            sender_id: "user",
            sender_type: "user",
            content: "User message 2"
        });

        // 定义无预对话的场景
        const defineScene = {
            define: "strong_assert_test",
            memory: [],
            name: "test",
            dialog: []
        };

        // 获取历史消息列表
        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxLength: 1000,
            maxCount: 10,
            convModel: conversationModel,
            msgModel: msg3
        });

        // 验证返回的是数组
        expect(Array.isArray(histMessages)).toBe(true);

        // 筛选用户消息进行强断言验证
        const chatMessages = histMessages.filter(m => m.type === 'chat' && 'sender_id' in m);
        expect(chatMessages.length).toBe(3);

        // 验证第一条消息的完整结构
        expect(chatMessages[0]).toEqual({
            type: "chat",
            sender_id: "user",
            sender_type: "user",
            content: "User message 1",
            id: msg1.getMessageId()
        });

        // 验证第二条消息的完整结构
        expect(chatMessages[1]).toEqual({
            type: "chat",
            sender_id: "char",
            sender_type: "char",
            content: "Character response 1",
            id: msg2.getMessageId()
        });

        // 验证第三条消息的完整结构
        expect(chatMessages[2]).toEqual({
            type: "chat",
            sender_id: "user",
            sender_type: "user",
            content: "User message 2",
            id: msg3.getMessageId()
        });
    });

    test("21. 应成功测试DialogHelper.getHistMessageList从FirstModel开始", async () => {
        // 创建带预对话的场景
        const testScene = {
            define: "first_model_test",
            memory: [],
            name: "test_scene",
            dialog: [
                { type: "chat" as const, content: "Opening line from scene", sender_name: "Character" }
            ]
        };
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 创建FirstModel
        const firstModel = await FirstModel.loadOrCreate(conversationModel);

        // 创建用户消息（在FirstModel之后）
        const msg1 = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user",
            sender_type: "user",
            content: "User message after first"
        });

        // 定义场景
        const defineScene = {
            define: "define_test",
            memory: [],
            name: "define",
            dialog: [
                { type: "chat" as const, content: "Define opening", sender_name: "System" }
            ]
        };

        // 从FirstModel开始获取历史消息
        // FirstModel代表对话起点，此时应只返回场景预对话
        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxLength: 1000,
            maxCount: 10,
            convModel: conversationModel,
            msgModel: firstModel
        });

        // 验证返回的是数组
        expect(Array.isArray(histMessages)).toBe(true);

        // 从FirstModel开始，不应有用户消息（带sender_id的）
        const chatMessages = histMessages.filter(m => m.type === 'chat' && 'sender_id' in m);
        expect(chatMessages.length).toBe(0);

        // 应包含场景预对话（带sender_name的）
        const sceneDialogs = histMessages.filter(m => m.type === 'chat' && 'sender_name' in m);
        expect(sceneDialogs.length).toBeGreaterThan(0);
    });

    test("22. 应成功测试DialogHelper.getDialogPos和getDialogPosId", async () => {
        // 创建对话和消息
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        const messageModel = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user",
            sender_type: "user",
            content: "Test message for pos"
        });

        // 获取对话位置ID
        const posId = DialogHelper.getDialogPosId({
            message: messageModel,
            conversation: conversationModel
        });

        // 验证位置ID
        expect(posId.conversationId).toBe(conversationId);
        expect(posId.messageId).toBe(messageModel.getMessageId());

        // 通过位置ID恢复对话位置
        const retrievedPos = await DialogHelper.getDialogPos(posId);
        expect(retrievedPos).toBeDefined();
        expect(retrievedPos?.conversation.getConversationId()).toBe(conversationId);
        expect(retrievedPos?.message.getMessageId()).toBe(messageModel.getMessageId());
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

    test("24. 应成功测试DialogHelper.getCurrMessageList完整流程", async () => {
        // 创建带完整场景的对话
        const testScene = {
            define: "Scene define content",
            memory: [
                { type: "chat" as const, content: "Scene memory 1", sender_name: "System" },
                { type: "chat" as const, content: "Scene memory 2", sender_name: "System" }
            ],
            name: "test_scene",
            dialog: [
                { type: "chat" as const, content: "Scene dialog 1", sender_name: "Character" }
            ]
        };
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 设置背景信息
        await conversationModel.updateData({ background_info: "Background info content" });

        // 创建FirstModel和消息链
        const firstModel = await FirstModel.loadOrCreate(conversationModel);
        const msg1 = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user",
            sender_type: "user",
            content: "User message"
        });
        const msg2 = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: msg1.getMessageId(),
            sender_id: "char",
            sender_type: "char",
            content: "Character response"
        });

        // 定义defineScene
        const defineScene = {
            define: "Define scene content",
            memory: [
                { type: "chat" as const, content: "Define memory 1", sender_name: "System" }
            ],
            name: "define",
            dialog: [
                { type: "chat" as const, content: "Define dialog 1", sender_name: "System" }
            ]
        };

        // 获取当前消息列表
        const messageList = await DialogHelper.getCurrMessageList({
            defineScene,
            maxLength: 10000,
            maxCount: 100,
            convModel: conversationModel,
            msgModel: msg2
        });

        // 验证返回结果
        expect(messageList).toBeDefined();
        expect(Array.isArray(messageList)).toBe(true);

        // 分离不同类型的消息
        const descMessages = messageList?.filter(m => m.type === 'desc') ?? [];
        const chatWithSenderId = messageList?.filter(m => m.type === 'chat' && 'sender_id' in m) ?? [];
        const chatWithSenderName = messageList?.filter(m => m.type === 'chat' && 'sender_name' in m && !('sender_id' in m)) ?? [];

        // 验证desc消息（define和background_info）
        expect(descMessages.length).toBe(3);
        const descContents = descMessages.map(m => m.content);
        expect(descContents).toEqual([
            "Define scene content",
            "Scene define content",
            "Background info content"
        ]);

        // 验证chat with sender_name消息（memory和dialog）
        expect(chatWithSenderName.length).toBe(5);
        const senderNameContents = chatWithSenderName.map(m => m.content);
        expect(senderNameContents).toEqual([
            "Define memory 1",
            "Scene memory 1",
            "Scene memory 2",
            "Define dialog 1",
            "Scene dialog 1"
        ]);

        // 验证chat with sender_id消息（历史消息）
        expect(chatWithSenderId.length).toBe(2);
        expect(chatWithSenderId[0]).toEqual({
            type: "chat",
            sender_id: "user",
            sender_type: "user",
            content: "User message",
            id: msg1.getMessageId()
        });
        expect(chatWithSenderId[1]).toEqual({
            type: "chat",
            sender_id: "char",
            sender_type: "char",
            content: "Character response",
            id: msg2.getMessageId()
        });
    });

    test("25. 应成功测试DialogHelper.renderMessageList渲染逻辑", async () => {
        // 创建未渲染消息列表
        const unrenderedList = [
            { type: 'desc' as const, content: "System description" },
            { type: 'chat' as const, sender_id: "user1", sender_type: "user" as const, content: "User message", id: "msg1" },
            { type: 'chat' as const, sender_id: "char1", sender_type: "char" as const, content: "Char message", id: "msg2" },
            { type: 'chat' as const, sender_name: "Narrator", content: "Already rendered message" }
        ];

        // 渲染函数：将sender_id转换为sender_name
        const renderFunc = async (msg: { sender_id: string; sender_type: string; content: string }) => {
            const nameMap: Record<string, string> = {
                "user1": "Alice",
                "char1": "Bob"
            };
            return {
                type: 'chat' as const,
                content: msg.content,
                sender_name: nameMap[msg.sender_id] ?? msg.sender_id
            };
        };

        // 执行渲染
        const renderedList = await DialogHelper.renderMessageList({
            list: unrenderedList,
            render: renderFunc
        });

        // 验证渲染结果
        expect(renderedList.length).toBe(4);

        // 验证desc消息保持不变
        expect(renderedList[0]).toEqual({ type: 'desc', content: "System description" });

        // 验证未渲染消息被正确渲染
        expect(renderedList[1]).toEqual({ type: 'chat', content: "User message", sender_name: "Alice" });
        expect(renderedList[2]).toEqual({ type: 'chat', content: "Char message", sender_name: "Bob" });

        // 验证已渲染消息保持不变
        expect(renderedList[3]).toEqual({ type: 'chat', content: "Already rendered message", sender_name: "Narrator" });
    });

    test("26. 应成功测试maxLength限制触发时的截断行为", async () => {
        // 创建无预对话的场景
        const testScene = {
            define: "",
            memory: [],
            name: "test",
            dialog: []
        };
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 创建FirstModel
        await FirstModel.loadOrCreate(conversationModel);

        // 创建多条消息，每条约50字符
        const messages: MessageModel[] = [];
        for (let i = 0; i < 10; i++) {
            const msg = await MessageModel.create({
                conversation_id: conversationId,
                parent_message_id: i === 0 ? undefined : messages[i - 1].getMessageId(),
                sender_id: i % 2 === 0 ? "user" : "char",
                sender_type: i % 2 === 0 ? "user" : "char",
                content: `Message number ${i} with some extra content to make it longer`
            });
            messages.push(msg);
        }

        // 定义场景
        const defineScene = {
            define: "",
            memory: [],
            name: "test",
            dialog: []
        };

        // 设置较小的maxLength（约200字符）
        const smallMaxLength = 200;

        // 获取历史消息
        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxLength: smallMaxLength,
            maxCount: 100,
            convModel: conversationModel,
            msgModel: messages[messages.length - 1]
        });

        // 验证总长度不超过maxLength
        const totalLength = histMessages.reduce((sum, m) => sum + m.content.length, 0);
        expect(totalLength).toBeLessThanOrEqual(smallMaxLength);

        // 验证返回的是最新的消息（从后向前截断）
        const chatMessages = histMessages.filter(m => m.type === 'chat' && 'sender_id' in m);
        expect(chatMessages.length).toBeGreaterThan(0);
        expect(chatMessages.length).toBeLessThan(10);
    });

    test("27. 应成功测试maxCount限制触发时的截断行为", async () => {
        // 创建无预对话的场景
        const testScene = {
            define: "",
            memory: [],
            name: "test",
            dialog: []
        };
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 创建FirstModel
        await FirstModel.loadOrCreate(conversationModel);

        // 创建10条消息
        const messages: MessageModel[] = [];
        for (let i = 0; i < 10; i++) {
            const msg = await MessageModel.create({
                conversation_id: conversationId,
                parent_message_id: i === 0 ? undefined : messages[i - 1].getMessageId(),
                sender_id: i % 2 === 0 ? "user" : "char",
                sender_type: i % 2 === 0 ? "user" : "char",
                content: `Message ${i}`
            });
            messages.push(msg);
        }

        // 定义场景
        const defineScene = {
            define: "",
            memory: [],
            name: "test",
            dialog: []
        };

        // 设置maxCount为3
        const smallMaxCount = 3;

        // 获取历史消息
        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxLength: 10000,
            maxCount: smallMaxCount,
            convModel: conversationModel,
            msgModel: messages[messages.length - 1]
        });

        // 验证消息数量不超过maxCount
        const chatMessages = histMessages.filter(m => m.type === 'chat' && 'sender_id' in m);
        expect(chatMessages.length).toBeLessThanOrEqual(smallMaxCount);

        // 验证返回的是最新的消息
        expect(chatMessages[chatMessages.length - 1].content).toBe("Message 9");
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

    test("30. 应成功测试深度消息链遍历", async () => {
        // 创建无预对话的场景
        const testScene = {
            define: "",
            memory: [],
            name: "test",
            dialog: []
        };
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 创建FirstModel
        const firstModel = await FirstModel.loadOrCreate(conversationModel);

        // 创建15层深度的消息链
        const messages: MessageModel[] = [];
        for (let i = 0; i < 15; i++) {
            const msg = await MessageModel.create({
                conversation_id: conversationId,
                parent_message_id: i === 0 ? undefined : messages[i - 1].getMessageId(),
                sender_id: i % 2 === 0 ? "user" : "char",
                sender_type: i % 2 === 0 ? "user" : "char",
                content: `Deep message level ${i}`
            });
            messages.push(msg);
        }

        // 定义场景
        const defineScene = {
            define: "",
            memory: [],
            name: "test",
            dialog: []
        };

        // 获取历史消息
        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxLength: 10000,
            maxCount: 100,
            convModel: conversationModel,
            msgModel: messages[messages.length - 1]
        });

        // 验证消息链完整性
        const chatMessages = histMessages.filter(m => m.type === 'chat' && 'sender_id' in m);
        expect(chatMessages.length).toBe(15);

        // 验证消息顺序（从旧到新）
        for (let i = 0; i < 15; i++) {
            expect(chatMessages[i].content).toBe(`Deep message level ${i}`);
        }

        // 验证消息ID链的正确性
        for (let i = 1; i < messages.length; i++) {
            const loadedMsg = await MessageModel.load(messages[i].getMessageId());
            expect(loadedMsg?.getPreMessageId()).toBe(messages[i - 1].getMessageId());
        }
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

        // 验证存在的语言
        expect(messageModel.getTransContent("zh")).toBe("中文翻译");

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

        // 删除父消息（使用静态方法）
        await MessageModel.delete(parentMessage.getMessageId());

        // 等待联动删除
        await sleep(100);

        // 验证父消息和子消息都被删除（触发器联动）
        expect(await MessageModel.load(parentMessage.getMessageId())).toBeUndefined();
        expect(await MessageModel.load(childMessage.getMessageId())).toBeUndefined();
    });
});
