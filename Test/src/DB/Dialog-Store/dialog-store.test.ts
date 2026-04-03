import { DBManager, UtilDB } from "@sosraciel-lamda/postgresql-manager";
import { DialogStore } from "@sosraciel-lamda/dialog-store";
import type { ConversationStruct, MessageStruct, NullPartial } from "@sosraciel-lamda/dialog-store";
import { ConversationEntity, FirstEntity } from "@sosraciel-lamda/dialog-store";
import { sleep, UtilFunc, type JObject } from "@zwa73/utils";
import { DBCache, DBCacheKH } from "@sosraciel-lamda/dialog-store/dist/DBCache";
import { PG_PORT } from "@/src/Constant";

/**测试用轻数据类型 */
type TestLightData = {
    sender_type?: 'user' | 'char';
    status?: string;
};

/**测试用重数据类型 */
type TestHeavyData = {
    translate_content_table?: Record<string, string>;
    metadata?: { key: string; value?: string };
};

/**创建测试对话结构体 */
const createTestConversation = <TLight extends JObject = {}, THeavy extends JObject = {}>(
    options?: {
        conversation_id?: string;
        light_data?: NullPartial<TLight>;
        heavy_data?: NullPartial<THeavy>;
    }
): ConversationStruct<TLight, THeavy> => {
    return {
        data: {
            conversation_id: options?.conversation_id || UtilFunc.genUUID(),
            ...(options?.light_data && { light_data: options.light_data }),
            ...(options?.heavy_data && { heavy_data: options.heavy_data }),
        }
    } as ConversationStruct<TLight, THeavy>;
};

/**创建测试消息结构体 */
const createTestMessage = <TLight extends JObject = {}, THeavy extends JObject = {}>(
    conversationId: string,
    options?: {
        message_id?: string;
        parent_message_id?: string | null;
        sender_id?: string;
        content?: string;
        light_data?: NullPartial<TLight>;
        heavy_data?: NullPartial<THeavy>;
    }
): MessageStruct<TLight, THeavy> => {
    return {
        data: {
            message_id: options?.message_id || UtilFunc.genUUID(),
            conversation_id: conversationId,
            parent_message_id: options?.parent_message_id || null,
            sender_id: options?.sender_id || "user",
            content: options?.content || "Test message",
            ...(options?.light_data && { light_data: options.light_data }),
            ...(options?.heavy_data && { heavy_data: options.heavy_data }),
        }
    } as MessageStruct<TLight, THeavy>;
};

describe("Dialog-Store 模块测试", () => {
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
            DBCache.dispose();

        } catch (e) {
            // 忽略错误
        }
    }, 30000);

    describe("基础 CRUD 测试", () => {
        test("1. 应成功初始化数据库表", async () => {
            // 验证 conversation 表是否存在
            const conversationTableResult = await manager.client.sql`
                SELECT table_name
                FROM information_schema.tables
                WHERE table_name = 'conversation'
                AND table_schema = 'dialog';
            `;
            expect(conversationTableResult.rowCount).toBe(1);

            // 验证 message 表是否存在
            const messageTableResult = await manager.client.sql`
                SELECT table_name
                FROM information_schema.tables
                WHERE table_name = 'message'
                AND table_schema = 'dialog';
            `;
            expect(messageTableResult.rowCount).toBe(1);
        });

        test("2. 应成功创建和获取对话记录", async () => {
            const testConversation = createTestConversation();

            // 创建对话记录
            await DialogStore.setConversation(testConversation);

            // 获取对话记录
            const retrievedConversation = await DialogStore.getConversation(testConversation.data.conversation_id);
            expect(retrievedConversation).toBeDefined();
            expect(retrievedConversation?.data.conversation_id).toBe(testConversation.data.conversation_id);
        });

        test("3. 应成功创建和获取消息记录", async () => {
            // 先创建对话
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);

            // 创建消息记录
            const testMessage = createTestMessage(testConversation.data.conversation_id);
            await DialogStore.setMessage(testMessage);

            // 获取消息记录
            const retrievedMessage = await DialogStore.getMessage(testMessage.data.message_id);
            expect(retrievedMessage).toBeDefined();
            expect(retrievedMessage?.data.message_id).toBe(testMessage.data.message_id);
        });
    });

    describe("light_data/heavy_data 缓存同步测试", () => {
        test("4. 应正确处理 light_data 的全量更新", async () => {
            // 创建带有 light_data 的对话
            const testConversation = createTestConversation<TestLightData, TestHeavyData>({
                light_data: { sender_type: 'user', status: 'active' }
            });
            await DialogStore.setConversation(testConversation);

            // 验证缓存中的 light_data
            const cacheKey = DBCacheKH.getConversationKey(testConversation.data.conversation_id);
            let cachedData = DBCache.peekCache(cacheKey) as ConversationStruct<TestLightData, TestHeavyData> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('user');
            expect((cachedData?.data.light_data as TestLightData)?.status).toBe('active');

            // 全量更新 light_data（注意：是全量替换，不是增量合并）
            const updatedConversation = createTestConversation<TestLightData, TestHeavyData>({
                conversation_id: testConversation.data.conversation_id,
                light_data: { sender_type: 'char', status: 'inactive' }
            });
            await DialogStore.setConversation(updatedConversation);

            // 等待通知处理
            await sleep(100);

            // 验证缓存已更新为新值
            cachedData = DBCache.peekCache(cacheKey) as ConversationStruct<TestLightData, TestHeavyData> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('char');
            expect((cachedData?.data.light_data as TestLightData)?.status).toBe('inactive');
        });

        test("5. 应正确处理 heavy_data 的全量更新", async () => {
            // 创建带有 heavy_data 的对话
            const testConversation = createTestConversation<TestLightData, TestHeavyData>({
                heavy_data: { translate_content_table: { en: 'Hello' } }
            });
            await DialogStore.setConversation(testConversation);

            // 验证缓存中的 heavy_data
            const cacheKey = DBCacheKH.getConversationKey(testConversation.data.conversation_id);
            let cachedData = DBCache.peekCache(cacheKey) as ConversationStruct<TestLightData, TestHeavyData> | undefined;
            expect((cachedData?.data.heavy_data as TestHeavyData)?.translate_content_table?.en).toBe('Hello');

            // 全量更新 heavy_data（注意：是全量替换，不是增量合并）
            const updatedConversation = createTestConversation<TestLightData, TestHeavyData>({
                conversation_id: testConversation.data.conversation_id,
                heavy_data: { translate_content_table: { zh: '你好' } }
            });
            await DialogStore.setConversation(updatedConversation);

            // 等待通知处理
            await sleep(100);

            // 验证缓存已更新为新值（en 已被替换掉）
            cachedData = DBCache.peekCache(cacheKey) as ConversationStruct<TestLightData, TestHeavyData> | undefined;
            expect((cachedData?.data.heavy_data as TestHeavyData)?.translate_content_table?.zh).toBe('你好');
            expect((cachedData?.data.heavy_data as TestHeavyData)?.translate_content_table?.en).toBeUndefined();
        });

        test("6. 应正确处理消息的 light_data 缓存同步", async () => {
            // 先创建对话
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);

            // 创建带有 light_data 的消息
            const testMessage = createTestMessage<TestLightData, TestHeavyData>(
                testConversation.data.conversation_id,
                { light_data: { sender_type: 'char' } }
            );
            await DialogStore.setMessage(testMessage);

            // 验证缓存中的 light_data
            const cacheKey = DBCacheKH.getMessageKey(testMessage.data.message_id);
            let cachedData = DBCache.peekCache(cacheKey) as MessageStruct<TestLightData, TestHeavyData> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('char');

            // 全量更新 light_data
            const updatedMessage = createTestMessage<TestLightData, TestHeavyData>(
                testConversation.data.conversation_id,
                {
                    message_id: testMessage.data.message_id,
                    light_data: { sender_type: 'user', status: 'pending' }
                }
            );
            await DialogStore.setMessage(updatedMessage);

            // 等待通知处理
            await sleep(100);

            // 验证缓存已更新
            cachedData = DBCache.peekCache(cacheKey) as MessageStruct<TestLightData, TestHeavyData> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('user');
            expect((cachedData?.data.light_data as TestLightData)?.status).toBe('pending');
        });
    });

    describe("SQL 触发器与 TS 缓存一致性测试", () => {
        test("7. SQL 增量更新后缓存应正确同步 light_data", async () => {
            // 创建带有 light_data 的对话
            const testConversation = createTestConversation<TestLightData, TestHeavyData>({
                light_data: { sender_type: 'user' }
            });
            await DialogStore.setConversation(testConversation);

            const cacheKey = DBCacheKH.getConversationKey(testConversation.data.conversation_id);

            // 通过 SQL 增量更新 light_data（使用 jsonb_set 添加新字段）
            // 这与 setConversation 的全量更新不同，是增量更新
            await manager.client.query(`
                UPDATE dialog.conversation
                SET data = jsonb_set(
                    data,
                    '{light_data,status}',
                    '"synced"'::jsonb,
                    true
                )
                WHERE data->>'conversation_id' = '${testConversation.data.conversation_id}';
            `);

            // 等待 SQL 触发器发送通知和缓存同步
            await sleep(500);

            // 验证缓存已同步 SQL 的增量更新
            const cachedData = DBCache.peekCache(cacheKey) as ConversationStruct<TestLightData, TestHeavyData> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.status).toBe('synced');
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('user');
        });

        test("8. SQL 增量更新后缓存应正确同步 heavy_data", async () => {
            // 创建带有 heavy_data 的对话
            const testConversation = createTestConversation<TestLightData, TestHeavyData>({
                heavy_data: { translate_content_table: { en: 'Hello' } }
            });
            await DialogStore.setConversation(testConversation);

            const cacheKey = DBCacheKH.getConversationKey(testConversation.data.conversation_id);

            // 通过 SQL 增量更新 heavy_data（使用 jsonb_set 添加新字段）
            await manager.client.query(`
                UPDATE dialog.conversation
                SET data = jsonb_set(
                    data,
                    '{heavy_data,metadata}',
                    '{"key":"sql-value"}'::jsonb,
                    true
                )
                WHERE data->>'conversation_id' = '${testConversation.data.conversation_id}';
            `);

            // 等待 SQL 触发器发送通知和缓存同步
            await sleep(500);

            // 验证缓存已同步 SQL 的增量更新
            const cachedData = DBCache.peekCache(cacheKey) as ConversationStruct<TestLightData, TestHeavyData> | undefined;
            expect((cachedData?.data.heavy_data as TestHeavyData)?.metadata?.key).toBe('sql-value');
            expect((cachedData?.data.heavy_data as TestHeavyData)?.translate_content_table?.en).toBe('Hello');
        });

        test("9. data_hash 应在 SQL 触发器中正确生成", async () => {
            // 创建对话
            const testConversation = createTestConversation<TestLightData, TestHeavyData>({
                light_data: { sender_type: 'user' }
            });
            await DialogStore.setConversation(testConversation);

            // 验证数据库中的 data_hash 已生成
            const result = await manager.client.query(`
                SELECT data->>'data_hash' as data_hash
                FROM dialog.conversation
                WHERE data->>'conversation_id' = '${testConversation.data.conversation_id}';
            `);

            expect(result.rows[0].data_hash).toBeDefined();
            expect(result.rows[0].data_hash).toBe(testConversation.data.data_hash);
        });
    });

    describe("Entity 泛型测试", () => {
        test("10. ConversationEntity 应正确处理泛型 light_data", async () => {
            // 创建带有泛型 light_data 的对话实体
            const entity = await ConversationEntity.create<TestLightData, TestHeavyData>({
                light_data: { sender_type: 'char', status: 'active' }
            });

            // 验证 getLightField 方法
            expect(entity.getLightField('sender_type')).toBe('char');
            expect(entity.getLightField('status')).toBe('active');

            // 更新 light_data
            await entity.updateData({
                light_data: { status: 'completed' } as NullPartial<TestLightData>
            });

            // 验证更新后的值
            expect(entity.getLightField('sender_type')).toBe('char');
            expect(entity.getLightField('status')).toBe('completed');
        });

        test("11. MessageEntity 应正确处理泛型 heavy_data", async () => {
            // 创建对话实体
            const convEntity = await ConversationEntity.create<TestLightData, TestHeavyData>({
                light_data: {}
            });

            // 获取首条消息实体
            const firstMsg = await convEntity.getFirstMessageEntity();

            // 更新 heavy_data
            await firstMsg.updateData({
                heavy_data: { translate_content_table: { en: 'Hello', zh: '你好' } }
            });

            // 验证 getHeavyField 方法
            expect(firstMsg.getHeavyField('translate_content_table')?.en).toBe('Hello');
            expect(firstMsg.getHeavyField('translate_content_table')?.zh).toBe('你好');
        });

        test("12. FirstEntity 应正确工作", async () => {
            // 创建对话实体
            const convEntity = await ConversationEntity.create<TestLightData, TestHeavyData>({
                light_data: {}
            });

            // 获取首条消息实体
            const firstMsg = await convEntity.getFirstMessageEntity();

            // 验证首条消息标识
            expect(firstMsg).toBeDefined();
            expect(firstMsg.getMessageId()).toContain(FirstEntity.FirstMessageFlag);
        });
    });

    describe("消息树与联动删除测试", () => {
        test("13. 应成功创建消息树结构", async () => {
            // 先创建对话
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);

            // 创建根消息
            const parentMessage = createTestMessage(testConversation.data.conversation_id);
            await DialogStore.setMessage(parentMessage);

            // 创建子消息
            const childMessage = createTestMessage(testConversation.data.conversation_id, {
                parent_message_id: parentMessage.data.message_id
            });
            await DialogStore.setMessage(childMessage);

            // 验证子消息是否存在
            const retrievedChildMessage = await DialogStore.getMessage(childMessage.data.message_id);
            expect(retrievedChildMessage).toBeDefined();
            expect(retrievedChildMessage?.data.parent_message_id).toBe(parentMessage.data.message_id);
        });

        test("14. 删除根消息时应联动删除子消息", async () => {
            // 先创建对话
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);

            // 创建根消息
            const parentMessage = createTestMessage(testConversation.data.conversation_id);
            await DialogStore.setMessage(parentMessage);

            // 创建子消息
            const childMessage = createTestMessage(testConversation.data.conversation_id, {
                parent_message_id: parentMessage.data.message_id
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

        test("15. 删除对话时应联动删除所有相关消息", async () => {
            // 先创建对话
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);

            // 创建消息
            const testMessage = createTestMessage(testConversation.data.conversation_id);
            await DialogStore.setMessage(testMessage);

            // 验证消息存在
            let message = await DialogStore.getMessage(testMessage.data.message_id);
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

            const deletedMessage = await DialogStore.getMessage(testMessage.data.message_id, { ignoreCache: true });
            expect(deletedMessage).toBeUndefined();
        });
    });

    describe("消息选择列表测试", () => {
        test("16. 应成功获取消息选择列表", async () => {
            // 先创建对话
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);

            // 创建3个消息
            const testMessage1 = createTestMessage(testConversation.data.conversation_id);
            const testMessage2 = createTestMessage(testConversation.data.conversation_id);
            const testMessage3 = createTestMessage(testConversation.data.conversation_id);

            await DialogStore.setMessage(testMessage1);
            await DialogStore.setMessage(testMessage2);
            await DialogStore.setMessage(testMessage3);

            // 获取消息选择列表
            const messageChoiceList = await DialogStore.getMessageChoiceList(testConversation.data.conversation_id);
            expect(Array.isArray(messageChoiceList)).toBe(true);
            expect(messageChoiceList.length).toBe(3);

            // 验证消息选择列表包含所有创建的消息，并且顺序正确（按插入顺序）
            const messageIds = messageChoiceList.map(msg => msg.data.message_id);
            expect(messageIds).toEqual([testMessage1.data.message_id, testMessage2.data.message_id, testMessage3.data.message_id]);
        });

        test("17. 应成功获取带 parent_message_id 的消息选择列表", async () => {
            // 先创建对话
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);

            // 创建父消息
            const parentMessage = createTestMessage(testConversation.data.conversation_id);
            await DialogStore.setMessage(parentMessage);

            // 创建2个子消息
            const childMessage1 = createTestMessage(testConversation.data.conversation_id, {
                parent_message_id: parentMessage.data.message_id
            });
            const childMessage2 = createTestMessage(testConversation.data.conversation_id, {
                parent_message_id: parentMessage.data.message_id
            });

            await DialogStore.setMessage(childMessage1);
            await DialogStore.setMessage(childMessage2);

            // 获取消息选择列表（带 parent_message_id）
            const messageChoiceList = await DialogStore.getMessageChoiceList(testConversation.data.conversation_id, parentMessage.data.message_id);
            expect(Array.isArray(messageChoiceList)).toBe(true);
            expect(messageChoiceList.length).toBe(2);

            // 验证消息选择列表的完整内容和顺序（按插入顺序）
            const messageIds = messageChoiceList.map(msg => msg.data.message_id);
            expect(messageIds).toEqual([childMessage1.data.message_id, childMessage2.data.message_id]);
        });
    });
});
