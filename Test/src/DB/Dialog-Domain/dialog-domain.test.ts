import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { DialogStore } from "@sosraciel-lamda/dialog-store";
import type { ConversationStruct, MessageStruct } from "@sosraciel-lamda/dialog-store";
import { ConversationModel, MessageModel, FirstModel, DialogHelper, AnchorModel } from "@sosraciel-lamda/dialog-domain";
import type { DialogMessageData } from "@sosraciel-lamda/dialog-domain";
import type { ConversationHeavyData, MessageModelExt, ConversationModelExt } from "@sosraciel-lamda/dialog-domain";
import { genAnchorId, parseAnchorId, genStatusString, parseStatusString } from "@sosraciel-lamda/dialog-domain";
import { sleep, UtilFunc } from "@zwa73/utils";
import { DBCache } from "@sosraciel-lamda/dialog-store/dist/DBCache";
import { PG_PORT } from "@/src/Constant";
import { createTestConversation, createTestMessage, createTestScene, setupTestDb, teardownTestDb } from "./Util";

describe("Dialog-Domain 主测试", () => {
    let manager: DBManager;

    beforeAll(async () => {
        manager = await setupTestDb();
    }, 30000);

    afterAll(async () => {
        await teardownTestDb(manager);
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
});
