import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { DialogStore, ConversationEntity, MessageEntity } from "@sosraciel-lamda/dialog-store";
import type { ConversationStruct, MessageStruct } from "@sosraciel-lamda/dialog-store";
import { ConversationLog, MessageLog, FirstLog, DialogHelper } from "@sosraciel-lamda/dialog-domain";
import type { DialogConversationData, DialogMessageData } from "@sosraciel-lamda/dialog-domain";
import type { MessageLightData, MessageHeavyData, ConversationHeavyData } from "@sosraciel-lamda/dialog-domain";
import { sleep, UtilFunc } from "@zwa73/utils";
import { DBCache } from "@sosraciel-lamda/dialog-store/dist/DBCache";
import { PG_PORT } from "@/src/Constant";

/**创建测试对话结构体 */
const createTestConversation = (options?: {
    conversation_id?: string;
    background_info?: string;
}): ConversationStruct<{}, ConversationHeavyData> => {
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
}): MessageStruct<MessageLightData, MessageHeavyData> => {
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
        await sleep(500);

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
        await sleep(500);

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

    test("8. 应成功使用ConversationLog创建和管理对话", async () => {
        const testScene = createTestScene();

        // 创建对话记录
        const conversationLog = await ConversationLog.create({ scene: testScene });
        expect(conversationLog).toBeDefined();

        // 获取对话ID
        const conversationId = conversationLog.getConversationId();
        expect(conversationId).toBeDefined();
        expect(typeof conversationId).toBe("string");

        // 加载对话记录
        const loadedConversationLog = await ConversationLog.load(conversationId);
        expect(loadedConversationLog).toBeDefined();
        expect(loadedConversationLog?.getConversationId()).toBe(conversationId);

        // 更新背景信息
        const testBackgroundInfo = "This is a test background info";
        await conversationLog.updateData({ background_info: testBackgroundInfo });

        // 检查背景信息
        expect(conversationLog.hasBackgroundInfo()).toBe(true);
        expect(conversationLog.getBackgroundInfo()).toBe(testBackgroundInfo);
    });

    test("9. 应成功使用MessageLog创建和管理消息", async () => {
        // 先创建对话
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

        // 创建消息记录
        const testMessageData: Omit<DialogMessageData, 'message_id'> = {
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user",
            sender_type: "user" as const,
            content: "I need help with my order",
            translate_content_table: {}
        };
        const messageLog = await MessageLog.create(testMessageData);
        expect(messageLog).toBeDefined();

        // 获取消息ID
        const messageId = messageLog.getMessageId();
        expect(messageId).toBeDefined();
        expect(typeof messageId).toBe("string");

        // 设置翻译内容
        const testTranslation = "我需要帮助处理我的订单";
        console.log('设置')
        await messageLog.setTransContent("zh", testTranslation);
        console.log('完成设置')

        // 获取翻译内容
        const retrievedTranslation = messageLog.getTransContent("zh");
        expect(retrievedTranslation).toBe(testTranslation);

        // 获取消息选择列表（应为空，因为没有子消息）
        const messageChoiceList = await messageLog.getMessageChoiceList();
        expect(Array.isArray(messageChoiceList)).toBe(true);
        expect(messageChoiceList.length).toBe(0);
    });

    test("10. 应成功获取消息选择列表", async () => {
        // 先创建对话
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

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

        // 验证消息选择列表包含所有创建的消息，并且顺序正确
        const messageIds = messageChoiceList.map(msg => msg.data.message_id);
        expect(messageIds).toEqual([testMessage1.data.message_id, testMessage2.data.message_id, testMessage3.data.message_id]);
    });

    test("11. 应正确排序消息选择列表", async () => {
        // 先创建对话
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

        // 创建3条消息
        const firstMessage = createTestMessage(conversationId, { content: "First message" });
        const secondMessage = createTestMessage(conversationId, { content: "Second message" });
        const thirdMessage = createTestMessage(conversationId, { content: "Third message" });

        await DialogStore.setMessage(firstMessage);
        await DialogStore.setMessage(secondMessage);
        await DialogStore.setMessage(thirdMessage);

        // 获取消息选择列表
        const messageChoiceList = await DialogStore.getMessageChoiceList(conversationId);
        expect(Array.isArray(messageChoiceList)).toBe(true);
        expect(messageChoiceList.length).toBe(3);

        // 提取消息ID列表
        const messageIds = messageChoiceList.map(msg => msg.data.message_id);

        // 直接验证消息选择列表的完整内容和顺序（按插入顺序）
        expect(messageIds).toEqual([firstMessage.data.message_id, secondMessage.data.message_id, thirdMessage.data.message_id]);
    });

    test("12. 应成功使用DialogStore获取消息选择ID列表", async () => {
        // 先创建对话
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

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

    test("13. 应成功使用DialogStore获取消息选择列表（带parentid）", async () => {
        // 先创建对话
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

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

    test("14. 应成功测试对话记录的更新操作", async () => {
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

    test("15. 应成功测试消息记录的更新操作", async () => {
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

    test("16. 应成功测试缓存与数据库通知的同步（通过直接调用SQL）", async () => {
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
        await sleep(500);

        // 验证缓存是否已更新
        const updatedCachedMessage = await DialogStore.getMessage(testMessage.data.message_id);
        expect(updatedCachedMessage).toBeDefined();
        expect(updatedCachedMessage?.data.content).toBe("Updated via SQL");
    });

    test("17. 应成功测试对话场景的设置与获取", async () => {
        // 先创建对话
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

        // 获取初始场景
        const initialScene = conversationLog.getScene();
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
        await conversationLog.setScene(newScene);

        // 获取更新后的场景
        const updatedScene = conversationLog.getScene();
        expect(updatedScene).toBeDefined();
        expect(updatedScene.name).toBe("new_test_scene");
        expect(updatedScene.define).toBe("new_test_define");
    });

    test("18. 应成功测试FirstLog的updateData设置translate_content_table", async () => {
        // 创建对话和FirstLog
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const firstLog = await FirstLog.loadOrCreate(conversationLog);

        // 设置中文翻译
        const testTranslation = "这是首条消息的翻译";
        await firstLog.setTransContent("zh", testTranslation);

        // 验证翻译内容
        const retrievedTranslation = firstLog.getTransContent("zh");
        expect(retrievedTranslation).toBe(testTranslation);

        // 设置英文翻译，验证多语言支持
        const anotherTranslation = "This is the first message translation";
        await firstLog.setTransContent("en", anotherTranslation);

        // 验证两种语言翻译都存在
        expect(firstLog.getTransContent("zh")).toBe(testTranslation);
        expect(firstLog.getTransContent("en")).toBe(anotherTranslation);
    });

    test("19. 应成功测试MessageLog.updateData传入新值覆盖旧值", async () => {
        // 创建对话和消息
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

        // 创建带有初始翻译的消息
        const messageLog = await MessageLog.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "test_user",
            sender_type: "user",
            content: "Test content for undefined deletion",
            translate_content_table: { zh: "初始翻译", en: "initial translation" }
        });

        const messageId = messageLog.getMessageId();

        // 验证初始翻译
        expect(messageLog.getTransContent("zh")).toBe("初始翻译");
        expect(messageLog.getTransContent("en")).toBe("initial translation");

        // 重新加载验证持久化
        const loadedMessage1 = await MessageLog.load(messageId);
        expect(loadedMessage1?.getTransContent("zh")).toBe("初始翻译");

        // 更新翻译表，用新对象完全覆盖旧对象
        await messageLog.updateData({
            translate_content_table: { en: "updated translation" }
        });

        // 重新加载验证更新结果：zh翻译应被删除，en翻译应被更新
        const loadedMessage2 = await MessageLog.load(messageId);
        expect(loadedMessage2?.getTransContent("zh")).toBeUndefined();
        expect(loadedMessage2?.getTransContent("en")).toBe("updated translation");
    });

    test("20. 应成功测试recordMessageLog批量记录消息", async () => {
        // 创建对话
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

        // 创建FirstLog（确保对话初始化完成）
        const firstLog = await FirstLog.loadOrCreate(conversationLog);

        // 批量记录3条消息
        const messages = await MessageLog.recordMessageLog(
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
        const loadedMessage0 = await MessageLog.load(messages[0].getMessageId());
        expect(loadedMessage0).toBeDefined();
        expect(loadedMessage0?.getContent()).toBe("First message");
    });

    test("21. 应成功测试DialogHelper.getHistMessageList获取历史消息", async () => {
        // 创建对话
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

        // 创建FirstLog
        const firstLog = await FirstLog.loadOrCreate(conversationLog);

        // 创建消息链：user -> char -> user
        const msg1 = await MessageLog.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user",
            sender_type: "user",
            content: "User message 1"
        });

        const msg2 = await MessageLog.create({
            conversation_id: conversationId,
            parent_message_id: msg1.getMessageId(),
            sender_id: "char",
            sender_type: "char",
            content: "Character response 1"
        });

        const msg3 = await MessageLog.create({
            conversation_id: conversationId,
            parent_message_id: msg2.getMessageId(),
            sender_id: "user",
            sender_type: "user",
            content: "User message 2"
        });

        // 定义场景（包含预对话）
        const defineScene = {
            define: "test_define_scene",
            memory: [],
            name: "test_define",
            dialog: [
                { type: "chat" as const, content: "Define scene dialog 1", sender_name: "Narrator" },
                { type: "chat" as const, content: "Define scene dialog 2", sender_name: "Narrator" }
            ]
        };

        // 获取历史消息列表
        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxLength: 1000,
            maxCount: 10,
            convLog: conversationLog,
            msgLog: msg3
        });

        // 验证返回的是数组
        expect(Array.isArray(histMessages)).toBe(true);
        // 应包含至少3条消息（可能还包含场景预对话）
        expect(histMessages.length).toBeGreaterThanOrEqual(3);

        // 筛选出用户消息（带sender_id的）
        const chatMessages = histMessages.filter(m => m.type === 'chat' && 'sender_id' in m);
        expect(chatMessages.length).toBe(3);

        // 验证消息内容
        const msgContents = chatMessages.map(m => m.content);
        expect(msgContents).toContain("User message 1");
        expect(msgContents).toContain("Character response 1");
        expect(msgContents).toContain("User message 2");
    });

    test("22. 应成功测试DialogHelper.getHistMessageList的强断言验证", async () => {
        // 创建无预对话的场景，便于精确验证
        const testScene = {
            define: "strong_assert_test",
            memory: [],
            name: "test_scene",
            dialog: []
        };
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

        // 创建FirstLog
        const firstLog = await FirstLog.loadOrCreate(conversationLog);

        // 创建消息链：user -> char
        const msg1 = await MessageLog.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "test_user",
            sender_type: "user",
            content: "Hello world"
        });

        const msg2 = await MessageLog.create({
            conversation_id: conversationId,
            parent_message_id: msg1.getMessageId(),
            sender_id: "test_char",
            sender_type: "char",
            content: "Hi there!"
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
            convLog: conversationLog,
            msgLog: msg2
        });

        // 筛选用户消息进行强断言验证
        const chatMessages = histMessages.filter(m => m.type === 'chat' && 'sender_id' in m);
        expect(chatMessages.length).toBe(2);

        // 验证第一条消息的完整结构
        const firstMsg = chatMessages[0];
        expect(firstMsg.type).toBe("chat");
        if (firstMsg.type === 'chat' && 'sender_id' in firstMsg) {
            expect(firstMsg.sender_id).toBe("test_user");
            expect(firstMsg.sender_type).toBe("user");
            expect(firstMsg.content).toBe("Hello world");
            expect(firstMsg.id).toBe(msg1.getMessageId());
        }

        // 验证第二条消息的完整结构
        const secondMsg = chatMessages[1];
        expect(secondMsg.type).toBe("chat");
        if (secondMsg.type === 'chat' && 'sender_id' in secondMsg) {
            expect(secondMsg.sender_id).toBe("test_char");
            expect(secondMsg.sender_type).toBe("char");
            expect(secondMsg.content).toBe("Hi there!");
            expect(secondMsg.id).toBe(msg2.getMessageId());
        }
    });

    test("23. 应成功测试DialogHelper.getHistMessageList从FirstLog开始", async () => {
        // 创建带预对话的场景
        const testScene = {
            define: "first_log_test",
            memory: [],
            name: "test_scene",
            dialog: [
                { type: "chat" as const, content: "Opening line from scene", sender_name: "Character" }
            ]
        };
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

        // 创建FirstLog
        const firstLog = await FirstLog.loadOrCreate(conversationLog);

        // 创建用户消息（在FirstLog之后）
        const msg1 = await MessageLog.create({
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

        // 从FirstLog开始获取历史消息
        // FirstLog代表对话起点，此时应只返回场景预对话
        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxLength: 1000,
            maxCount: 10,
            convLog: conversationLog,
            msgLog: firstLog
        });

        // 验证返回的是数组
        expect(Array.isArray(histMessages)).toBe(true);

        // 从FirstLog开始，不应有用户消息（带sender_id的）
        const chatMessages = histMessages.filter(m => m.type === 'chat' && 'sender_id' in m);
        expect(chatMessages.length).toBe(0);

        // 应包含场景预对话（带sender_name的）
        const sceneDialogs = histMessages.filter(m => m.type === 'chat' && 'sender_name' in m);
        expect(sceneDialogs.length).toBeGreaterThan(0);
    });

    test("24. 应成功测试DialogHelper.getDialogPos和getDialogPosId", async () => {
        // 创建对话和消息
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

        const messageLog = await MessageLog.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user",
            sender_type: "user",
            content: "Test message for pos"
        });

        // 获取对话位置ID
        const posId = DialogHelper.getDialogPosId({
            message: messageLog,
            conversation: conversationLog
        });

        // 验证位置ID
        expect(posId.conversationId).toBe(conversationId);
        expect(posId.messageId).toBe(messageLog.getMessageId());

        // 通过位置ID恢复对话位置
        const retrievedPos = await DialogHelper.getDialogPos(posId);
        expect(retrievedPos).toBeDefined();
        expect(retrievedPos?.conversation.getConversationId()).toBe(conversationId);
        expect(retrievedPos?.message.getMessageId()).toBe(messageLog.getMessageId());
    });
});
