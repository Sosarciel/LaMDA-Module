import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { DialogStore, ConversationLog, MessageLog } from "@sosraciel-lamda/dialog-domain";
import type { ConversationStruct, MessageStruct } from "@sosraciel-lamda/dialog-domain";
import { sleep, UtilFunc } from "@zwa73/utils";
// 导入DBCache以访问缓存池
import { DBCache } from "@sosraciel-lamda/dialog-domain/dist/DBCache";

describe("Dialog-Domain 模块测试", () => {
    let manager: DBManager;
    let testConversationId: string;
    let testMessageId: string;
    let testParentMessageId: string;
    let testChildMessageId: string;

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
        const testConversation: ConversationStruct = {
            data: {
                conversation_id: UtilFunc.genUUID(),
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
                background_info: "Test background info"
            }
        };

        // 创建对话记录
        await DialogStore.setConversation(testConversation);

        // 获取对话记录
        const retrievedConversation = await DialogStore.getConversation(testConversation.data.conversation_id);
        expect(retrievedConversation).toBeDefined();
        expect(retrievedConversation?.data.conversation_id).toBe(testConversation.data.conversation_id);
        expect(retrievedConversation?.data.background_info).toBe(testConversation.data.background_info);

        // 保存对话ID用于后续测试
        testConversationId = testConversation.data.conversation_id;
    });

    test("3. 应成功创建和获取消息记录", async () => {
        // 创建消息记录
        const testMessage: MessageStruct = {
            data: {
                message_id: UtilFunc.genUUID(),
                conversation_id: testConversationId,
                parent_message_id: null,
                sender_id: "user",
                sender_type: "user" as const,
                content: "I need help with my order",
                translate_content_table: {}
            }
        };
        await DialogStore.setMessage(testMessage);

        // 获取消息记录
        const retrievedMessage = await DialogStore.getMessage(testMessage.data.message_id);
        expect(retrievedMessage).toBeDefined();
        expect(retrievedMessage?.data.message_id).toBe(testMessage.data.message_id);
        expect(retrievedMessage?.data.content).toBe(testMessage.data.content);

        // 保存消息ID用于后续测试
        testMessageId = testMessage.data.message_id;
    });

    test("4. 应成功创建消息树结构", async () => {
        // 创建根消息
        const parentMessage: MessageStruct = {
            data: {
                message_id: UtilFunc.genUUID(),
                conversation_id: testConversationId,
                parent_message_id: null,
                sender_id: "user",
                sender_type: "user" as const,
                content: "What's the weather today?",
                translate_content_table: {}
            }
        };
        await DialogStore.setMessage(parentMessage);

        // 保存根消息ID
        testParentMessageId = parentMessage.data.message_id;

        // 创建子消息
        const childMessage: MessageStruct = {
            data: {
                message_id: UtilFunc.genUUID(),
                conversation_id: testConversationId,
                parent_message_id: testParentMessageId,
                sender_id: "assistant",
                sender_type: "user" as const,
                content: "It's sunny today!",
                translate_content_table: {}
            }
        };
        await DialogStore.setMessage(childMessage);

        // 保存子消息ID
        testChildMessageId = childMessage.data.message_id;

        // 验证子消息是否存在
        const retrievedChildMessage = await DialogStore.getMessage(testChildMessageId);
        expect(retrievedChildMessage).toBeDefined();
        expect(retrievedChildMessage?.data.parent_message_id).toBe(testParentMessageId);
    });

    test("5. 应成功测试消息树联动删除（删除根消息时删除枝消息）", async () => {
        // 验证子消息存在
        let childMessage = await DialogStore.getMessage(testChildMessageId);
        expect(childMessage).toBeDefined();

        // 验证根消息存在
        const parentMessage = await DialogStore.getMessage(testParentMessageId);
        expect(parentMessage).toBeDefined();

        // 执行删除根消息操作
        await DialogStore.deleteMessage(testParentMessageId);

        //等待联动删除副作用通知下发
        await sleep(500);

        // 验证根消息和子消息都已删除（由于触发器联动删除）
        const deletedParentMessage = await DialogStore.getMessage(testParentMessageId);
        expect(deletedParentMessage).toBeUndefined();

        const deletedChildMessage = await DialogStore.getMessage(testChildMessageId);
        expect(deletedChildMessage).toBeUndefined();
    });

    test("6. 应成功测试对话联动删除（删除对话时删除所有相关消息）", async () => {
        // 创建新的消息用于测试
        const newMessage: MessageStruct = {
            data: {
                message_id: UtilFunc.genUUID(),
                conversation_id: testConversationId,
                parent_message_id: null,
                sender_id: "user",
                sender_type: "user" as const,
                content: "Test message for cascade delete",
                translate_content_table: {}
            }
        };
        await DialogStore.setMessage(newMessage);

        // 验证消息存在
        let message = await DialogStore.getMessage(newMessage.data.message_id);
        expect(message).toBeDefined();

        // 验证对话存在
        const conversation = await DialogStore.getConversation(testConversationId);
        expect(conversation).toBeDefined();

        // 执行删除对话操作
        await DialogStore.deleteConversation(testConversationId);

        // 等待触发器执行
        await sleep(500);

        // 验证对话和所有相关消息都已删除（由于触发器联动删除）
        const deletedConversation = await DialogStore.getConversation(testConversationId, { ignoreCache: true });
        expect(deletedConversation).toBeUndefined();

        const deletedMessage = await DialogStore.getMessage(newMessage.data.message_id, { ignoreCache: true });
        expect(deletedMessage).toBeUndefined();

        // 验证原始消息也已被删除
        const originalMessage = await DialogStore.getMessage(testMessageId, { ignoreCache: true });
        expect(originalMessage).toBeUndefined();
    });

    test("7. 应成功执行事务操作", async () => {
        const newConversationId = UtilFunc.genUUID();

        await DialogStore.transaction(async (client) => {
            // 创建对话
            const testConversation: ConversationStruct = {
                data: {
                    conversation_id: newConversationId,
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
            };
            await DialogStore.setConversation(testConversation, { client });

            // 创建消息
            const testMessage: MessageStruct = {
                data: {
                    message_id: UtilFunc.genUUID(),
                    conversation_id: newConversationId,
                    parent_message_id: null,
                    sender_id: "user",
                    sender_type: "user" as const,
                    content: "I need help with my order",
                    translate_content_table: {}
                }
            };
            await DialogStore.setMessage(testMessage, { client });
        });

        // 验证事务操作结果
        const conversation = await DialogStore.getConversation(newConversationId);
        expect(conversation).toBeDefined();
    });

    test("8. 应成功使用ConversationLog创建和管理对话", async () => {
        const testScene = {
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
        const testScene = {
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
        await messageLog.setTransContent("zh", testTranslation);

        // 获取翻译内容
        const retrievedTranslation = messageLog.getTransContent("zh");
        expect(retrievedTranslation).toBe(testTranslation);

        // 获取消息选择列表
        const messageChoiceList = await messageLog.getMessageChoiceList();
        expect(Array.isArray(messageChoiceList)).toBe(true);
    });

    test("10. 应成功获取消息选择列表", async () => {
        // 先创建对话
        const testScene = {
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
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

        // 创建消息
        const testMessage: MessageStruct = {
            data: {
                message_id: UtilFunc.genUUID(),
                conversation_id: conversationId,
                parent_message_id: null,
                sender_id: "user",
                sender_type: "user" as const,
                content: "I need help with my order",
                translate_content_table: {}
            }
        };
        await DialogStore.setMessage(testMessage);

        // 获取消息选择列表
        const messageChoiceList = await DialogStore.getMessageChoiceList(conversationId);
        expect(Array.isArray(messageChoiceList)).toBe(true);
    });

    test("11. 应正确排序消息选择列表", async () => {
        // 先创建对话
        const testScene = {
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
        const conversationLog = await ConversationLog.create({ scene: testScene });
        const conversationId = conversationLog.getConversationId();

        // 创建第一条消息
        const firstMessage: MessageStruct = {
            data: {
                message_id: UtilFunc.genUUID(),
                conversation_id: conversationId,
                parent_message_id: null,
                sender_id: "user",
                sender_type: "user" as const,
                content: "First message",
                translate_content_table: {}
            }
        };
        await DialogStore.setMessage(firstMessage);

        // 创建第二条消息
        const secondMessage: MessageStruct = {
            data: {
                message_id: UtilFunc.genUUID(),
                conversation_id: conversationId,
                parent_message_id: null,
                sender_id: "user",
                sender_type: "user" as const,
                content: "Second message",
                translate_content_table: {}
            }
        };
        await DialogStore.setMessage(secondMessage);

        // 获取消息选择列表
        const messageChoiceList = await DialogStore.getMessageChoiceList(conversationId);
        expect(Array.isArray(messageChoiceList)).toBe(true);
        expect(messageChoiceList.length).toBeGreaterThanOrEqual(2);

        // 检查消息是否按正确顺序排序
        // 注意：具体排序逻辑取决于数据库实现，这里我们假设按创建时间排序
        // 第一条消息应该在第二条消息之前
        const firstMessageInList = messageChoiceList.find(msg => msg.data.message_id === firstMessage.data.message_id);
        const secondMessageInList = messageChoiceList.find(msg => msg.data.message_id === secondMessage.data.message_id);
        
        expect(firstMessageInList).toBeDefined();
        expect(secondMessageInList).toBeDefined();
        
        // 获取两条消息在列表中的索引
        const firstIndex = messageChoiceList.indexOf(firstMessageInList!);
        const secondIndex = messageChoiceList.indexOf(secondMessageInList!);
        
        // 验证第一条消息的索引小于第二条消息的索引（按创建时间排序）
        expect(firstIndex).toBeLessThan(secondIndex);
    });
});
