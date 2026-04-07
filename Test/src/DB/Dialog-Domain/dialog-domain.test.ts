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
        manager = await DBManager.create({
            port: PG_PORT,
            user: "postgres",
            database: "postgres",
            host: "localhost",
            max: 10,
            idleTimeoutMillis: 1000 * 30,
        });

        const result = await manager.client.query("SELECT 1");
        expect(result.rowCount).toBe(1);

        DialogStore.initInject(Promise.resolve(manager));
        await DialogStore.inited;

        await manager.client.query(`DELETE FROM dialog.message`);
        await manager.client.query(`DELETE FROM dialog.conversation`);
    }, 30000);

    afterAll(async () => {
        try {
            if (manager) {
                await manager.client.query(`DELETE FROM dialog.message`);
                await manager.client.query(`DELETE FROM dialog.conversation`);
                await manager.stop();
            }
            DBCache.dispose();
        } catch (e) {
            // 忽略错误
        }
    }, 30000);

    test("1. 应成功初始化数据库", async () => {
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

        await DialogStore.setConversation(testConversation);

        const retrievedConversation = await DialogStore.getConversation(testConversation.data.conversation_id);
        expect(retrievedConversation).toBeDefined();
        expect(retrievedConversation?.data.conversation_id).toBe(testConversation.data.conversation_id);
        expect((retrievedConversation?.data.heavy_data as ConversationHeavyData)?.background_info).toBe(testConversation.data.heavy_data?.background_info);
    });

    test("3. 应成功创建和获取消息记录", async () => {
        const testConversation = createTestConversation();
        await DialogStore.setConversation(testConversation);

        const testMessage = createTestMessage(testConversation.data.conversation_id, { content: "I need help with my order" });
        await DialogStore.setMessage(testMessage);

        const retrievedMessage = await DialogStore.getMessage(testMessage.data.message_id);
        expect(retrievedMessage).toBeDefined();
        expect(retrievedMessage?.data.message_id).toBe(testMessage.data.message_id);
        expect(retrievedMessage?.data.content).toBe(testMessage.data.content);
    });

    test("4. 应成功创建消息树结构", async () => {
        const testConversation = createTestConversation();
        await DialogStore.setConversation(testConversation);

        const parentMessage = createTestMessage(testConversation.data.conversation_id, { content: "What's the weather today?" });
        await DialogStore.setMessage(parentMessage);

        const childMessage = createTestMessage(testConversation.data.conversation_id, {
            parent_message_id: parentMessage.data.message_id,
            sender_id: "assistant",
            content: "It's sunny today!"
        });
        await DialogStore.setMessage(childMessage);

        const retrievedChildMessage = await DialogStore.getMessage(childMessage.data.message_id);
        expect(retrievedChildMessage).toBeDefined();
        expect(retrievedChildMessage?.data.parent_message_id).toBe(parentMessage.data.message_id);
    });

    test("5. 应成功测试消息树联动删除（删除根消息时删除枝消息）", async () => {
        const testConversation = createTestConversation();
        await DialogStore.setConversation(testConversation);

        const parentMessage = createTestMessage(testConversation.data.conversation_id, { content: "What's the weather today?" });
        await DialogStore.setMessage(parentMessage);

        const childMessage = createTestMessage(testConversation.data.conversation_id, {
            parent_message_id: parentMessage.data.message_id,
            sender_id: "assistant",
            content: "It's sunny today!"
        });
        await DialogStore.setMessage(childMessage);

        let childMessageExists = await DialogStore.getMessage(childMessage.data.message_id);
        expect(childMessageExists).toBeDefined();

        const parentMessageExists = await DialogStore.getMessage(parentMessage.data.message_id);
        expect(parentMessageExists).toBeDefined();

        await DialogStore.deleteMessage(parentMessage.data.message_id);

        await sleep(500);

        const deletedParentMessage = await DialogStore.getMessage(parentMessage.data.message_id);
        expect(deletedParentMessage).toBeUndefined();

        const deletedChildMessage = await DialogStore.getMessage(childMessage.data.message_id);
        expect(deletedChildMessage).toBeUndefined();
    });

    test("6. 应成功测试对话联动删除（删除对话时删除所有相关消息）", async () => {
        const testConversation = createTestConversation();
        await DialogStore.setConversation(testConversation);

        const testMessage = createTestMessage(testConversation.data.conversation_id, { content: "I need help with my order" });
        await DialogStore.setMessage(testMessage);

        const newMessage = createTestMessage(testConversation.data.conversation_id, { content: "Test message for cascade delete" });
        await DialogStore.setMessage(newMessage);

        let message = await DialogStore.getMessage(newMessage.data.message_id);
        expect(message).toBeDefined();

        const conversation = await DialogStore.getConversation(testConversation.data.conversation_id);
        expect(conversation).toBeDefined();

        await DialogStore.deleteConversation(testConversation.data.conversation_id);

        await sleep(500);

        const deletedConversation = await DialogStore.getConversation(testConversation.data.conversation_id, { ignoreCache: true });
        expect(deletedConversation).toBeUndefined();

        const deletedMessage = await DialogStore.getMessage(newMessage.data.message_id, { ignoreCache: true });
        expect(deletedMessage).toBeUndefined();

        const originalMessage = await DialogStore.getMessage(testMessage.data.message_id, { ignoreCache: true });
        expect(originalMessage).toBeUndefined();
    });

    test("7. 应成功执行事务操作", async () => {
        const newConversationId = UtilFunc.genUUID();

        await DialogStore.transaction(async (client) => {
            const testConversation = createTestConversation({ conversation_id: newConversationId });
            await DialogStore.setConversation(testConversation, { client });

            const testMessage = createTestMessage(newConversationId, { content: "I need help with my order" });
            await DialogStore.setMessage(testMessage, { client });
        });

        const conversation = await DialogStore.getConversation(newConversationId);
        expect(conversation).toBeDefined();
    });

    test("8. 应成功使用ConversationLog创建和管理对话", async () => {
        const testScene = createTestScene();

        const conversationLog = await ConversationLog.create({ scene: testScene });
        expect(conversationLog).toBeDefined();

        const conversationId = conversationLog.getConversationId();
        expect(conversationId).toBeDefined();
        expect(typeof conversationId).toBe("string");

        const loadedConversationLog = await ConversationLog.load(conversationId);
        expect(loadedConversationLog).toBeDefined();
        expect(loadedConversationLog?.getConversationId()).toBe(conversationId);

        const testBackgroundInfo = "This is a test background info";
        await conversationLog.updateData({ background_info: testBackgroundInfo });

        expect(conversationLog.hasBackgroundInfo()).toBe(true);
        expect(conversationLog.getBackgroundInfo()).toBe(testBackgroundInfo);
    });

    test("9. 应成功使用MessageLog创建和管理消息", async () => {
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

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

        const messageId = messageLog.getMessageId();
        expect(messageId).toBeDefined();
        expect(typeof messageId).toBe("string");

        const testTranslation = "我需要帮助处理我的订单";
        console.log('设置')
        await messageLog.setTransContent("zh", testTranslation);
        console.log('完成设置')

        const retrievedTranslation = messageLog.getTransContent("zh");
        expect(retrievedTranslation).toBe(testTranslation);

        const messageChoiceList = await messageLog.getMessageChoiceList();
        expect(Array.isArray(messageChoiceList)).toBe(true);
        expect(messageChoiceList.length).toBe(0);
    });

    test("10. 应成功获取消息选择列表", async () => {
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

        const testMessage1 = createTestMessage(conversationId, { content: "First message" });
        const testMessage2 = createTestMessage(conversationId, { content: "Second message" });
        const testMessage3 = createTestMessage(conversationId, { content: "Third message" });

        await DialogStore.setMessage(testMessage1);
        await DialogStore.setMessage(testMessage2);
        await DialogStore.setMessage(testMessage3);

        const messageChoiceList = await DialogStore.getMessageChoiceList(conversationId);
        expect(Array.isArray(messageChoiceList)).toBe(true);

        const messageIds = messageChoiceList.map(msg => msg.data.message_id);
        expect(messageIds).toEqual([testMessage1.data.message_id, testMessage2.data.message_id, testMessage3.data.message_id]);
    });

    test("11. 应正确排序消息选择列表", async () => {
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

        const firstMessage = createTestMessage(conversationId, { content: "First message" });
        const secondMessage = createTestMessage(conversationId, { content: "Second message" });
        const thirdMessage = createTestMessage(conversationId, { content: "Third message" });

        await DialogStore.setMessage(firstMessage);
        await DialogStore.setMessage(secondMessage);
        await DialogStore.setMessage(thirdMessage);

        const messageChoiceList = await DialogStore.getMessageChoiceList(conversationId);
        expect(Array.isArray(messageChoiceList)).toBe(true);
        expect(messageChoiceList.length).toBe(3);

        const messageIds = messageChoiceList.map(msg => msg.data.message_id);

        expect(messageIds).toEqual([firstMessage.data.message_id, secondMessage.data.message_id, thirdMessage.data.message_id]);
    });

    test("12. 应成功使用DialogStore获取消息选择ID列表", async () => {
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

        const testMessage1 = createTestMessage(conversationId, { content: "First message" });
        const testMessage2 = createTestMessage(conversationId, { content: "Second message" });
        const testMessage3 = createTestMessage(conversationId, { content: "Third message" });

        await DialogStore.setMessage(testMessage1);
        await DialogStore.setMessage(testMessage2);
        await DialogStore.setMessage(testMessage3);

        const messageChoiceIdList = await DialogStore.getMessageChoiceIdList(conversationId);
        expect(Array.isArray(messageChoiceIdList)).toBe(true);
        expect(messageChoiceIdList.length).toBe(3);

        expect(messageChoiceIdList).toEqual([testMessage1.data.message_id, testMessage2.data.message_id, testMessage3.data.message_id]);
    });

    test("13. 应成功使用DialogStore获取消息选择列表（带parentid）", async () => {
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

        const parentMessage = createTestMessage(conversationId, { content: "Parent message" });
        await DialogStore.setMessage(parentMessage);

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

        const messageChoiceList = await DialogStore.getMessageChoiceList(conversationId, parentMessage.data.message_id);
        expect(Array.isArray(messageChoiceList)).toBe(true);
        expect(messageChoiceList.length).toBe(3);

        const messageIds = messageChoiceList.map(msg => msg.data.message_id);
        expect(messageIds).toEqual([childMessage1.data.message_id, childMessage2.data.message_id, childMessage3.data.message_id]);
    });

    test("14. 应成功测试对话记录的更新操作", async () => {
        const testConversation = createTestConversation({ background_info: "Initial background" });
        await DialogStore.setConversation(testConversation);

        const updatedConversation = createTestConversation({
            conversation_id: testConversation.data.conversation_id,
            background_info: "Updated background info"
        });
        await DialogStore.setConversation(updatedConversation);

        const retrievedConversation = await DialogStore.getConversation(testConversation.data.conversation_id);
        expect(retrievedConversation).toBeDefined();
        expect((retrievedConversation?.data.heavy_data as ConversationHeavyData)?.background_info).toBe("Updated background info");
    });

    test("15. 应成功测试消息记录的更新操作", async () => {
        const testConversation = createTestConversation();
        await DialogStore.setConversation(testConversation);

        const testMessage = createTestMessage(testConversation.data.conversation_id, { content: "Initial content" });
        await DialogStore.setMessage(testMessage);

        const updatedMessage = createTestMessage(testConversation.data.conversation_id, {
            message_id: testMessage.data.message_id,
            parent_message_id: testMessage.data.parent_message_id,
            content: "Updated content"
        });
        await DialogStore.setMessage(updatedMessage);

        const retrievedMessage = await DialogStore.getMessage(testMessage.data.message_id);
        expect(retrievedMessage).toBeDefined();
        expect(retrievedMessage?.data.content).toBe("Updated content");
    });

    test("16. 应成功测试缓存与数据库通知的同步（通过直接调用SQL）", async () => {
        const testConversation = createTestConversation();
        await DialogStore.setConversation(testConversation);

        const testMessage = createTestMessage(testConversation.data.conversation_id, { content: "Initial content" });
        await DialogStore.setMessage(testMessage);

        const cachedMessage = await DialogStore.getMessage(testMessage.data.message_id);
        expect(cachedMessage).toBeDefined();
        expect(cachedMessage?.data.content).toBe("Initial content");

        await manager.client.query(`
            UPDATE dialog.message
            SET data = jsonb_set(data, '{content}', to_jsonb('Updated via SQL'::text), true)
            WHERE data->>'message_id' = '${testMessage.data.message_id}';
        `);

        await sleep(500);

        const updatedCachedMessage = await DialogStore.getMessage(testMessage.data.message_id);
        expect(updatedCachedMessage).toBeDefined();
        expect(updatedCachedMessage?.data.content).toBe("Updated via SQL");
    });

    test("17. 应成功测试对话场景的设置与获取", async () => {
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

        const initialScene = conversationLog.getScene();
        expect(initialScene).toBeDefined();
        expect(initialScene.name).toBe("test_scene");

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

        await conversationLog.setScene(newScene);

        const updatedScene = conversationLog.getScene();
        expect(updatedScene).toBeDefined();
        expect(updatedScene.name).toBe("new_test_scene");
        expect(updatedScene.define).toBe("new_test_define");
    });

    test("18. 应成功测试FirstLog的updateData设置translate_content_table", async () => {
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const firstLog = await FirstLog.loadOrCreate(conversationLog);

        const testTranslation = "这是首条消息的翻译";
        await firstLog.setTransContent("zh", testTranslation);

        const retrievedTranslation = firstLog.getTransContent("zh");
        expect(retrievedTranslation).toBe(testTranslation);

        const anotherTranslation = "This is the first message translation";
        await firstLog.setTransContent("en", anotherTranslation);

        expect(firstLog.getTransContent("zh")).toBe(testTranslation);
        expect(firstLog.getTransContent("en")).toBe(anotherTranslation);
    });

    test("19. 应成功测试MessageLog.updateData传入undefined删除key", async () => {
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

        const messageLog = await MessageLog.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "test_user",
            sender_type: "user",
            content: "Test content for undefined deletion",
            translate_content_table: { zh: "初始翻译", en: "initial translation" }
        });

        const messageId = messageLog.getMessageId();

        expect(messageLog.getTransContent("zh")).toBe("初始翻译");
        expect(messageLog.getTransContent("en")).toBe("initial translation");

        const loadedMessage1 = await MessageLog.load(messageId);
        expect(loadedMessage1?.getTransContent("zh")).toBe("初始翻译");

        await messageLog.updateData({
            translate_content_table: { en: "updated translation" }
        });

        const loadedMessage2 = await MessageLog.load(messageId);
        expect(loadedMessage2?.getTransContent("zh")).toBeUndefined();
        expect(loadedMessage2?.getTransContent("en")).toBe("updated translation");
    });

    test("20. 应成功测试recordMessageLog批量记录消息", async () => {
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

        const firstLog = await FirstLog.loadOrCreate(conversationLog);

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

        expect(messages.length).toBe(3);
        expect(messages[0].getContent()).toBe("First message");
        expect(messages[0].getSenderId()).toBe("user1");
        expect(messages[0].getSenderType()).toBe("user");

        expect(messages[1].getContent()).toBe("Second message");
        expect(messages[1].getSenderId()).toBe("char1");
        expect(messages[1].getSenderType()).toBe("char");

        expect(messages[2].getContent()).toBe("Third message");
        expect(messages[2].getSenderId()).toBe("user2");
        expect(messages[2].getSenderType()).toBe("user");

        const loadedMessage0 = await MessageLog.load(messages[0].getMessageId());
        expect(loadedMessage0).toBeDefined();
        expect(loadedMessage0?.getContent()).toBe("First message");
    });

    test("21. 应成功测试DialogHelper.getHistMessageList获取历史消息", async () => {
        const testScene = createTestScene();
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

        const firstLog = await FirstLog.loadOrCreate(conversationLog);

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

        const defineScene = {
            define: "test_define_scene",
            memory: [],
            name: "test_define",
            dialog: [
                { type: "chat" as const, content: "Define scene dialog 1", sender_name: "Narrator" },
                { type: "chat" as const, content: "Define scene dialog 2", sender_name: "Narrator" }
            ]
        };

        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxLength: 1000,
            maxCount: 10,
            convLog: conversationLog,
            msgLog: msg3
        });

        expect(Array.isArray(histMessages)).toBe(true);
        expect(histMessages.length).toBeGreaterThanOrEqual(3);

        const chatMessages = histMessages.filter(m => m.type === 'chat' && 'sender_id' in m);
        expect(chatMessages.length).toBe(3);

        const msgContents = chatMessages.map(m => m.content);
        expect(msgContents).toContain("User message 1");
        expect(msgContents).toContain("Character response 1");
        expect(msgContents).toContain("User message 2");
    });

    test("22. 应成功测试DialogHelper.getHistMessageList的强断言验证", async () => {
        const testScene = {
            define: "strong_assert_test",
            memory: [],
            name: "test_scene",
            dialog: []
        };
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

        const firstLog = await FirstLog.loadOrCreate(conversationLog);

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

        const defineScene = {
            define: "strong_assert_test",
            memory: [],
            name: "test",
            dialog: []
        };

        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxLength: 1000,
            maxCount: 10,
            convLog: conversationLog,
            msgLog: msg2
        });

        const chatMessages = histMessages.filter(m => m.type === 'chat' && 'sender_id' in m);
        expect(chatMessages.length).toBe(2);

        const firstMsg = chatMessages[0];
        expect(firstMsg.type).toBe("chat");
        if (firstMsg.type === 'chat' && 'sender_id' in firstMsg) {
            expect(firstMsg.sender_id).toBe("test_user");
            expect(firstMsg.sender_type).toBe("user");
            expect(firstMsg.content).toBe("Hello world");
            expect(firstMsg.id).toBe(msg1.getMessageId());
        }

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

        const firstLog = await FirstLog.loadOrCreate(conversationLog);

        const msg1 = await MessageLog.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user",
            sender_type: "user",
            content: "User message after first"
        });

        const defineScene = {
            define: "define_test",
            memory: [],
            name: "define",
            dialog: [
                { type: "chat" as const, content: "Define opening", sender_name: "System" }
            ]
        };

        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxLength: 1000,
            maxCount: 10,
            convLog: conversationLog,
            msgLog: firstLog
        });

        expect(Array.isArray(histMessages)).toBe(true);

        const chatMessages = histMessages.filter(m => m.type === 'chat' && 'sender_id' in m);
        expect(chatMessages.length).toBe(0);

        const sceneDialogs = histMessages.filter(m => m.type === 'chat' && 'sender_name' in m);
        expect(sceneDialogs.length).toBeGreaterThan(0);
    });

    test("24. 应成功测试DialogHelper.getDialogPos和getDialogPosId", async () => {
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

        const posId = DialogHelper.getDialogPosId({
            message: messageLog,
            conversation: conversationLog
        });

        expect(posId.conversationId).toBe(conversationId);
        expect(posId.messageId).toBe(messageLog.getMessageId());

        const retrievedPos = await DialogHelper.getDialogPos(posId);
        expect(retrievedPos).toBeDefined();
        expect(retrievedPos?.conversation.getConversationId()).toBe(conversationId);
        expect(retrievedPos?.message.getMessageId()).toBe(messageLog.getMessageId());
    });
});
