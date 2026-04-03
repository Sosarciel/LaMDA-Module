import { DBManager, UtilDB } from "@sosraciel-lamda/postgresql-manager";
import { DialogStore } from "@sosraciel-lamda/dialog-store";
import type { ConversationStruct, MessageStruct, NullPartial } from "@sosraciel-lamda/dialog-store";
import { ConversationEntity, FirstEntity } from "@sosraciel-lamda/dialog-store";
import { sleep, UtilFunc, type JObject } from "@zwa73/utils";
import { DBCache, DBCacheKH } from "@sosraciel-lamda/dialog-store/dist/DBCache";
import { PG_PORT } from "@/src/Constant";

type TestLightData = {
    sender_type?: 'user' | 'char';
    status?: string;
};

type TestHeavyData = {
    translate_content_table?: Record<string, string>;
    metadata?: { key: string; value?: string };
};

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

    describe("基础 CRUD 测试", () => {
        test("1. 应成功初始化数据库表", async () => {
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
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);

            const retrievedConversation = await DialogStore.getConversation(testConversation.data.conversation_id);
            expect(retrievedConversation).toBeDefined();
            expect(retrievedConversation?.data.conversation_id).toBe(testConversation.data.conversation_id);
        });

        test("3. 应成功创建和获取消息记录", async () => {
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);

            const testMessage = createTestMessage(testConversation.data.conversation_id);
            await DialogStore.setMessage(testMessage);

            const retrievedMessage = await DialogStore.getMessage(testMessage.data.message_id);
            expect(retrievedMessage).toBeDefined();
            expect(retrievedMessage?.data.message_id).toBe(testMessage.data.message_id);
        });
    });

    describe("light_data/heavy_data 缓存同步测试", () => {
        test("4. 应正确处理 light_data 的增量更新", async () => {
            const testConversation = createTestConversation<TestLightData, TestHeavyData>({
                light_data: { sender_type: 'user', status: 'active' }
            });
            await DialogStore.setConversation(testConversation);

            const cacheKey = DBCacheKH.getConversationKey(testConversation.data.conversation_id);
            let cachedData = DBCache.peekCache(cacheKey) as ConversationStruct<TestLightData, TestHeavyData> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('user');
            expect((cachedData?.data.light_data as TestLightData)?.status).toBe('active');

            const updatedConversation = createTestConversation<TestLightData, TestHeavyData>({
                conversation_id: testConversation.data.conversation_id,
                light_data: { status: 'inactive' }
            });
            await DialogStore.setConversation(updatedConversation);

            await sleep(100);

            cachedData = DBCache.peekCache(cacheKey) as ConversationStruct<TestLightData, TestHeavyData> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('user');
            expect((cachedData?.data.light_data as TestLightData)?.status).toBe('inactive');
        });

        test("5. 应正确处理 heavy_data 的增量更新", async () => {
            const testConversation = createTestConversation<TestLightData, TestHeavyData>({
                heavy_data: { translate_content_table: { en: 'Hello' }, metadata: { key: 'value' } }
            });
            await DialogStore.setConversation(testConversation);

            const cacheKey = DBCacheKH.getConversationKey(testConversation.data.conversation_id);
            let cachedData = DBCache.peekCache(cacheKey) as ConversationStruct<TestLightData, TestHeavyData> | undefined;
            expect((cachedData?.data.heavy_data as TestHeavyData)?.translate_content_table?.en).toBe('Hello');
            expect((cachedData?.data.heavy_data as TestHeavyData)?.metadata?.key).toBe('value');

            const updatedConversation = createTestConversation<TestLightData, TestHeavyData>({
                conversation_id: testConversation.data.conversation_id,
                heavy_data: { translate_content_table: { zh: '你好' } }
            });
            await DialogStore.setConversation(updatedConversation);

            await sleep(100);

            cachedData = DBCache.peekCache(cacheKey) as ConversationStruct<TestLightData, TestHeavyData> | undefined;
            expect((cachedData?.data.heavy_data as TestHeavyData)?.translate_content_table?.en).toBe('Hello');
            expect((cachedData?.data.heavy_data as TestHeavyData)?.translate_content_table?.zh).toBe('你好');
            expect((cachedData?.data.heavy_data as TestHeavyData)?.metadata?.key).toBe('value');
        });

        test("6. 应正确处理 light_data 字段删除（设为 null）", async () => {
            const testConversation = createTestConversation<TestLightData, TestHeavyData>({
                light_data: { sender_type: 'user', status: 'active' }
            });
            await DialogStore.setConversation(testConversation);

            const cacheKey = DBCacheKH.getConversationKey(testConversation.data.conversation_id);

            const updatedConversation = createTestConversation<TestLightData, TestHeavyData>({
                conversation_id: testConversation.data.conversation_id,
                light_data: { status: null }
            });
            await DialogStore.setConversation(updatedConversation);

            await sleep(100);

            const cachedData = DBCache.peekCache(cacheKey) as ConversationStruct<TestLightData, TestHeavyData> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('user');
            expect((cachedData?.data.light_data as TestLightData)?.status).toBeUndefined();
        });

        test("7. 应正确处理消息的 light_data 缓存同步", async () => {
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);

            const testMessage = createTestMessage<TestLightData, TestHeavyData>(
                testConversation.data.conversation_id,
                { light_data: { sender_type: 'char' } }
            );
            await DialogStore.setMessage(testMessage);

            const cacheKey = DBCacheKH.getMessageKey(testMessage.data.message_id);
            let cachedData = DBCache.peekCache(cacheKey) as MessageStruct<TestLightData, TestHeavyData> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('char');

            const updatedMessage = createTestMessage<TestLightData, TestHeavyData>(
                testConversation.data.conversation_id,
                {
                    message_id: testMessage.data.message_id,
                    light_data: { sender_type: 'user', status: 'pending' }
                }
            );
            await DialogStore.setMessage(updatedMessage);

            await sleep(100);

            cachedData = DBCache.peekCache(cacheKey) as MessageStruct<TestLightData, TestHeavyData> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('user');
            expect((cachedData?.data.light_data as TestLightData)?.status).toBe('pending');
        });
    });

    describe("SQL 触发器与 TS 缓存一致性测试", () => {
        test("8. SQL 更新后缓存应正确同步 light_data", async () => {
            const testConversation = createTestConversation<TestLightData, TestHeavyData>({
                light_data: { sender_type: 'user' }
            });
            await DialogStore.setConversation(testConversation);

            const cacheKey = DBCacheKH.getConversationKey(testConversation.data.conversation_id);

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

            await sleep(500);

            const cachedData = DBCache.peekCache(cacheKey) as ConversationStruct<TestLightData, TestHeavyData> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.status).toBe('synced');
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('user');
        });

        test("9. SQL 更新后缓存应正确同步 heavy_data", async () => {
            const testConversation = createTestConversation<TestLightData, TestHeavyData>({
                heavy_data: { translate_content_table: { en: 'Hello' } }
            });
            await DialogStore.setConversation(testConversation);

            const cacheKey = DBCacheKH.getConversationKey(testConversation.data.conversation_id);

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

            await sleep(500);

            const cachedData = DBCache.peekCache(cacheKey) as ConversationStruct<TestLightData, TestHeavyData> | undefined;
            expect((cachedData?.data.heavy_data as TestHeavyData)?.metadata?.key).toBe('sql-value');
            expect((cachedData?.data.heavy_data as TestHeavyData)?.translate_content_table?.en).toBe('Hello');
        });

        test("10. data_hash 应在 SQL 触发器中正确生成", async () => {
            const testConversation = createTestConversation<TestLightData, TestHeavyData>({
                light_data: { sender_type: 'user' }
            });
            await DialogStore.setConversation(testConversation);

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
        test("11. ConversationEntity 应正确处理泛型 light_data", async () => {
            const entity = await ConversationEntity.create<TestLightData, TestHeavyData>({
                light_data: { sender_type: 'char', status: 'active' }
            });

            expect(entity.getLightField('sender_type')).toBe('char');
            expect(entity.getLightField('status')).toBe('active');

            await entity.updateData({
                light_data: { status: 'completed' } as NullPartial<TestLightData>
            });

            expect(entity.getLightField('sender_type')).toBe('char');
            expect(entity.getLightField('status')).toBe('completed');
        });

        test("12. MessageEntity 应正确处理泛型 heavy_data", async () => {
            const convEntity = await ConversationEntity.create<TestLightData, TestHeavyData>({
                light_data: {}
            });
            const firstMsg = await convEntity.getFirstMessageEntity();

            await firstMsg.updateData({
                heavy_data: { translate_content_table: { en: 'Hello', zh: '你好' } }
            });

            expect(firstMsg.getHeavyField('translate_content_table')?.en).toBe('Hello');
            expect(firstMsg.getHeavyField('translate_content_table')?.zh).toBe('你好');
        });

        test("13. FirstEntity 应正确工作", async () => {
            const convEntity = await ConversationEntity.create<TestLightData, TestHeavyData>({
                light_data: {}
            });
            const firstMsg = await convEntity.getFirstMessageEntity();

            expect(firstMsg).toBeDefined();
            expect(firstMsg.getMessageId()).toContain(FirstEntity.FirstMessageFlag);
        });
    });

    describe("UtilDB.mergeAndClean 行为验证", () => {
        test("14. mergeAndClean 应正确合并并清理 null 值", async () => {
            const base: JObject = { a: 1, b: null, c: 3 };
            const target: JObject = { b: 2, d: null, e: 4 };

            const result = UtilDB.mergeAndClean(base, target);

            expect(result.a).toBe(1);
            expect(result.b).toBe(2);
            expect(result.c).toBe(3);
            expect(result.d).toBeUndefined();
            expect(result.e).toBe(4);
        });

        test("15. mergeAndClean 应正确处理 undefined（忽略）", async () => {
            const base: JObject = { a: 1, b: 2 };
            const target: JObject = { b: undefined, c: 3 };

            const result = UtilDB.mergeAndClean(base, target);

            expect(result.a).toBe(1);
            expect(result.b).toBe(2);
            expect(result.c).toBe(3);
        });
    });

    describe("消息树与联动删除测试", () => {
        test("16. 应成功创建消息树结构", async () => {
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);

            const parentMessage = createTestMessage(testConversation.data.conversation_id);
            await DialogStore.setMessage(parentMessage);

            const childMessage = createTestMessage(testConversation.data.conversation_id, {
                parent_message_id: parentMessage.data.message_id
            });
            await DialogStore.setMessage(childMessage);

            const retrievedChildMessage = await DialogStore.getMessage(childMessage.data.message_id);
            expect(retrievedChildMessage).toBeDefined();
            expect(retrievedChildMessage?.data.parent_message_id).toBe(parentMessage.data.message_id);
        });

        test("17. 删除根消息时应联动删除子消息", async () => {
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);

            const parentMessage = createTestMessage(testConversation.data.conversation_id);
            await DialogStore.setMessage(parentMessage);

            const childMessage = createTestMessage(testConversation.data.conversation_id, {
                parent_message_id: parentMessage.data.message_id
            });
            await DialogStore.setMessage(childMessage);

            await DialogStore.deleteMessage(parentMessage.data.message_id);
            await sleep(500);

            const deletedParentMessage = await DialogStore.getMessage(parentMessage.data.message_id);
            expect(deletedParentMessage).toBeUndefined();

            const deletedChildMessage = await DialogStore.getMessage(childMessage.data.message_id);
            expect(deletedChildMessage).toBeUndefined();
        });

        test("18. 删除对话时应联动删除所有相关消息", async () => {
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);

            const testMessage = createTestMessage(testConversation.data.conversation_id);
            await DialogStore.setMessage(testMessage);

            await DialogStore.deleteConversation(testConversation.data.conversation_id);
            await sleep(500);

            const deletedConversation = await DialogStore.getConversation(testConversation.data.conversation_id, { ignoreCache: true });
            expect(deletedConversation).toBeUndefined();

            const deletedMessage = await DialogStore.getMessage(testMessage.data.message_id, { ignoreCache: true });
            expect(deletedMessage).toBeUndefined();
        });
    });

    describe("消息选择列表测试", () => {
        test("19. 应成功获取消息选择列表", async () => {
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);

            const testMessage1 = createTestMessage(testConversation.data.conversation_id);
            const testMessage2 = createTestMessage(testConversation.data.conversation_id);
            const testMessage3 = createTestMessage(testConversation.data.conversation_id);

            await DialogStore.setMessage(testMessage1);
            await DialogStore.setMessage(testMessage2);
            await DialogStore.setMessage(testMessage3);

            const messageChoiceList = await DialogStore.getMessageChoiceList(testConversation.data.conversation_id);
            expect(Array.isArray(messageChoiceList)).toBe(true);
            expect(messageChoiceList.length).toBe(3);

            const messageIds = messageChoiceList.map(msg => msg.data.message_id);
            expect(messageIds).toEqual([testMessage1.data.message_id, testMessage2.data.message_id, testMessage3.data.message_id]);
        });

        test("20. 应成功获取带 parent_message_id 的消息选择列表", async () => {
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);

            const parentMessage = createTestMessage(testConversation.data.conversation_id);
            await DialogStore.setMessage(parentMessage);

            const childMessage1 = createTestMessage(testConversation.data.conversation_id, {
                parent_message_id: parentMessage.data.message_id
            });
            const childMessage2 = createTestMessage(testConversation.data.conversation_id, {
                parent_message_id: parentMessage.data.message_id
            });

            await DialogStore.setMessage(childMessage1);
            await DialogStore.setMessage(childMessage2);

            const messageChoiceList = await DialogStore.getMessageChoiceList(testConversation.data.conversation_id, parentMessage.data.message_id);
            expect(Array.isArray(messageChoiceList)).toBe(true);
            expect(messageChoiceList.length).toBe(2);

            const messageIds = messageChoiceList.map(msg => msg.data.message_id);
            expect(messageIds).toEqual([childMessage1.data.message_id, childMessage2.data.message_id]);
        });
    });
});
