import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { DialogStore, ConversationLog, MessageLog } from "@sosraciel-lamda/dialog-domain";
import type { ConversationStruct, MessageStruct } from "@sosraciel-lamda/dialog-domain";
import { sleep, UtilFunc } from "@zwa73/utils";
// 导入DBCache以访问缓存池
import { DBCache } from "@sosraciel-lamda/dialog-domain/dist/DBCache";

/**创建测试对话结构体 */
const createTestConversation = (options?: {
    conversation_id?: string;
    background_info?: string;
}): ConversationStruct => {
    return {
        data: {
            conversation_id: options?.conversation_id || UtilFunc.genUUID(),
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
            },
            ...(options?.background_info && { background_info: options.background_info })
        }
    };
};

/**创建测试消息结构体 */
const createTestMessage = (conversationId: string, options?: {
    parent_message_id?: string | null;
    sender_id?: string;
    sender_type?: "user" | "char";
    content?: string;
}): MessageStruct => {
    return {
        data: {
            message_id: UtilFunc.genUUID(),
            conversation_id: conversationId,
            parent_message_id: options?.parent_message_id || null,
            sender_id: options?.sender_id || "user",
            sender_type: options?.sender_type || "user" as const,
            content: options?.content || "Test message",
            translate_content_table: {}
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
            port: 5433,
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
    }, 30000); // 增加超时时间

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
            // 注意：由于DBCache是内部实现，我们通过访问其缓存池来清理
            // @ts-ignore 访问私有属性进行清理
            if (DBCache.cache) {
                // 调用dispose方法清理缓存
                // @ts-ignore 调用dispose方法
                DBCache.cache.dispose();
            }
        } catch (e) {
            // 忽略错误
        }
    }, 30000); // 增加超时时间

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
        expect(retrievedConversation?.data.background_info).toBe(testConversation.data.background_info);
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
        const testMessageData = {
            conversation_id: conversationId,
            parent_message_id: null,
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
});
