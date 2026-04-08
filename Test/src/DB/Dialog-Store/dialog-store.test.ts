import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { DialogStore, DialogStoreHelper, MessageEntity } from "@sosraciel-lamda/dialog-store";
import type { ConversationStruct, MessageStruct } from "@sosraciel-lamda/dialog-store";
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
        light_data?: Partial<TLight>;
        heavy_data?: Partial<THeavy>;
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
        light_data?: Partial<TLight>;
        heavy_data?: Partial<THeavy>;
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

            // 全量更新 light_data 的每一个字段
            const updatedConversation = createTestConversation<TestLightData, TestHeavyData>({
                conversation_id: testConversation.data.conversation_id,
                light_data: { sender_type: 'char', status: 'inactive' }
            });
            await DialogStore.setConversation(updatedConversation);

            // 内部set对缓存的影响应该随promise结果, 经过内部调用的set通知一起完成, 无需等待

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

            // 全量更新 heavy_data 的每一个字段
            const updatedConversation = createTestConversation<TestLightData, TestHeavyData>({
                conversation_id: testConversation.data.conversation_id,
                heavy_data: { translate_content_table: { zh: '你好' } }
            });
            await DialogStore.setConversation(updatedConversation);

            // 内部set对缓存的影响应该随promise结果, 经过内部调用的set通知一起完成, 无需等待

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

            // 内部set对缓存的影响应该随promise结果, 经过内部调用的set通知一起完成, 无需等待

            // 验证缓存已更新
            cachedData = DBCache.peekCache(cacheKey) as MessageStruct<TestLightData, TestHeavyData> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('user');
            expect((cachedData?.data.light_data as TestLightData)?.status).toBe('pending');
        });
    });

    describe("SQL 触发器与 TS 缓存一致性测试", () => {
        test("7. 外部SQL 增量更新后缓存应正确同步 light_data", async () => {
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
            await sleep(100);

            // 验证缓存已同步 SQL 的增量更新
            const cachedData = DBCache.peekCache(cacheKey) as ConversationStruct<TestLightData, TestHeavyData> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.status).toBe('synced');
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('user');
        });

        test("8. 外部SQL 增量更新后缓存应正确同步 heavy_data", async () => {
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
            await sleep(100);

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
        test("10. ConversationEntity 应正确处理泛型 light_data（深合并）", async () => {
            // 创建带有泛型 light_data 的对话实体
            const entity = await ConversationEntity.create<TestLightData, TestHeavyData>({
                light_data: { sender_type: 'char', status: 'active' }
            });

            // 验证 getLightField 方法
            expect(entity.getLightField('sender_type')).toBe('char');
            expect(entity.getLightField('status')).toBe('active');

            // 深层合并：只更新status，保留sender_type
            await entity.updateData({
                light_data: {
                    status: 'completed'
                }
            });

            // 验证sender_type保留，status更新
            expect(entity.getLightField('sender_type')).toBe('char');
            expect(entity.getLightField('status')).toBe('completed');

            // 传入undefined删除status
            await entity.updateData({
                light_data: {
                    status: undefined
                }
            });

            // 验证status已删除，sender_type仍存在
            expect(entity.getLightField('status')).toBeUndefined();
            expect(entity.getLightField('sender_type')).toBe('char');

            // 重新加载验证持久化
            const loadedEntity = await ConversationEntity.load<TestLightData, TestHeavyData>(entity.getConversationId());
            expect(loadedEntity?.getLightField('status')).toBeUndefined();
            expect(loadedEntity?.getLightField('sender_type')).toBe('char');
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

            // 验证 getFirstMessageId 返回包含 flag 的真实 ID
            const firstMessageId = convEntity.getFirstMessageId();
            expect(firstMessageId).toContain(FirstEntity.FirstMessageFlag);

            // 获取首条消息实体
            const firstMsg = await convEntity.getFirstMessageEntity();

            // 验证首条消息实体存在
            expect(firstMsg).toBeDefined();

            // FirstEntity.getMessageId() 设计上返回 undefined，表示这是根节点
            expect(firstMsg.getMessageId()).toBeUndefined();

            // 验证可以通过 getConversationId 获取对话 ID
            expect(firstMsg.getConversationId()).toBe(convEntity.getConversationId());

            // 验证 FirstEntity 被写入数据库
            const dbFirstMsg = await DialogStore.getMessage(firstMessageId);
            expect(dbFirstMsg).toBeDefined();
            expect(dbFirstMsg?.data.message_id).toBe(firstMessageId);
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
            await sleep(100);

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
            await sleep(100);

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

    describe("边界情况与数据清理测试", () => {
        test("18. UPDATE 时应保留 created_at 时间戳（含SQL覆盖保护）", async () => {
            // 创建对话
            const testConversation = createTestConversation<TestLightData, TestHeavyData>({
                light_data: { sender_type: 'user' }
            });
            await DialogStore.setConversation(testConversation);

            // 等待 SQL 触发器生成的 created_at
            await sleep(100);

            // created_at 缓存同步问题说明：
            // 1. setConversation 设置缓存, created_at 完全由数据库触发器生成, ts端没有 created_at
            // 2. SQL INSERT/UPDATE 触发，发送 insert/update 通知
            // 3. insert 通知快于 set 时，缓存不存在，insert 被 CachePool.has(key) 防积极水化逻辑拦截而忽略
            // 4. insert 通知后到 或下一次 update 通知到达时，由于 data_hash 去重逻辑会排除 created_at 字段计算hash，update/insert 被跳过
            // 5. 导致 created_at 永远不会同步到缓存, 同理其他被 data_hash 忽略的字段也都不可能同步到本地缓存
            // 
            // 这是预期行为：去重逻辑避免重复处理，但代价是 created_at 不会同步
            // 解决方案：需要 created_at 时使用 ignoreCache:true 从数据库获取

            // 使用 ignoreCache:true 从数据库获取完整数据（包含 created_at）
            const initialData = await DialogStore.getConversation(
                testConversation.data.conversation_id,
                { ignoreCache: true }
            );
            const initialCreatedAt = initialData?.data.created_at;
            expect(initialCreatedAt).toBeDefined();

            // 等待一小段时间确保时间戳有差异
            await sleep(100);

            // 更新对话（深合并更新light_data）
            const updatedConversation = createTestConversation<TestLightData, TestHeavyData>({
                conversation_id: testConversation.data.conversation_id,
                light_data: { sender_type: 'char', status: 'updated' }
            });
            await DialogStore.setConversation(updatedConversation);

            // 等待通知处理
            await sleep(100);

            // 验证 created_at 未被修改（从数据库获取）
            const afterUpdateData = await DialogStore.getConversation(
                testConversation.data.conversation_id,
                { ignoreCache: true }
            );
            expect(afterUpdateData?.data.created_at).toBe(initialCreatedAt);

            // 验证 updated_at 已更新
            expect(afterUpdateData?.data.updated_at).toBeDefined();

            // 通过 SQL 直接更新，尝试覆盖 created_at（验证触发器保护）
            await manager.client.query(`
                UPDATE dialog.conversation
                SET data = jsonb_set(
                    data,
                    '{created_at}',
                    '"2099-01-01T00:00:00Z"'::jsonb,
                    false
                )
                WHERE data->>'conversation_id' = '${testConversation.data.conversation_id}';
            `);

            // 等待触发器处理
            await sleep(100);

            // 验证 created_at 仍为初始值（触发器强制保留 OLD 值）
            const afterSqlUpdate = await manager.client.query(`
                SELECT data->>'created_at' as created_at
                FROM dialog.conversation
                WHERE data->>'conversation_id' = '${testConversation.data.conversation_id}';
            `);

            // created_at 应该保持原值，而不是被改为 2099 年
            expect(afterSqlUpdate.rows[0].created_at).toBe(initialCreatedAt);
        });

        test("19. 空对象 light_data/heavy_data 应被清理", async () => {
            // 创建带有空 light_data 的对话
            const testConversation = createTestConversation({
                light_data: {} as TestLightData
            });

            // 手动添加空对象到数据中
            (testConversation.data as any).light_data = {};

            await DialogStore.setConversation(testConversation);

            // 等待通知处理
            await sleep(100);

            // 从数据库直接查询验证空对象已被删除
            const result = await manager.client.query(`
                SELECT data->'light_data' as light_data, data->'heavy_data' as heavy_data
                FROM dialog.conversation
                WHERE data->>'conversation_id' = '${testConversation.data.conversation_id}';
            `);

            // light_data 应该是 null（被删除），而不是 '{}'
            expect(result.rows[0].light_data).toBeNull();
            expect(result.rows[0].heavy_data).toBeNull();

            // 验证缓存中也无空对象
            const cacheKey = DBCacheKH.getConversationKey(testConversation.data.conversation_id);
            const cachedData = DBCache.peekCache(cacheKey);
            expect((cachedData?.data as any).light_data).toBeUndefined();
            expect((cachedData?.data as any).heavy_data).toBeUndefined();
        });
    });

    describe("DialogStoreHelper.createHistChain 测试", () => {
        test("20. 应在遇到 FirstEntity 时正常结束", async () => {
            // 创建对话
            const convEntity = await ConversationEntity.create<TestLightData, TestHeavyData>({});

            // 创建消息链
            const msg1 = await MessageEntity.create({
                conversation_id: convEntity.getConversationId(),
                sender_id: 'user1',
                content: '消息1',
            });
            const msg2 = await MessageEntity.create({
                conversation_id: convEntity.getConversationId(),
                parent_message_id: msg1.getMessageId(),
                sender_id: 'char1',
                content: '消息2',
            });

            // 测试 createHistChain
            const result = await DialogStoreHelper.createHistChain({
                convEntity,
                startEntity: msg2,
                maxLength: 10000,
                maxCount: 100,
                computeLength: (entity) => entity.getContent().length,
            });

            // 验证结果
            expect(result.chain.length).toBe(2);
            expect(result.totalCount).toBe(2);
            expect(result.stopReason.reason).toBe('first');
            expect(result.chain[0].getMessageId()).toBe(msg1.getMessageId());
            expect(result.chain[1].getMessageId()).toBe(msg2.getMessageId());
        });

        test("21. 应在消息条数超限时停止", async () => {
            // 创建对话
            const convEntity = await ConversationEntity.create<TestLightData, TestHeavyData>({});

            // 创建 5 条消息
            const messages: MessageEntity[] = [];
            let parentId: string | undefined;
            for (let i = 0; i < 5; i++) {
                const msg = await MessageEntity.create({
                    conversation_id: convEntity.getConversationId(),
                    parent_message_id: parentId,
                    sender_id: `sender${i}`,
                    content: `消息${i}`,
                });
                messages.push(msg);
                parentId = msg.getMessageId();
            }

            // 测试 createHistChain，maxCount 设为 3
            const result = await DialogStoreHelper.createHistChain({
                convEntity,
                startEntity: messages[4],
                maxLength: 10000,
                maxCount: 3,
                computeLength: (entity) => entity.getContent().length,
            });

            // 验证结果
            expect(result.chain.length).toBe(3);
            expect(result.totalCount).toBe(3);
            expect(result.stopReason.reason).toBe('count');
            if (result.stopReason.reason === 'count') {
                expect(result.stopReason.exceededCount).toBe(4);
            }
        });

        test("22. 应在总长度超限时停止", async () => {
            // 创建对话
            const convEntity = await ConversationEntity.create<TestLightData, TestHeavyData>({});

            // 创建消息链，每条消息长度为 10
            const msg1 = await MessageEntity.create({
                conversation_id: convEntity.getConversationId(),
                sender_id: 'user1',
                content: '0123456789', // 长度 10
            });
            const msg2 = await MessageEntity.create({
                conversation_id: convEntity.getConversationId(),
                parent_message_id: msg1.getMessageId(),
                sender_id: 'char1',
                content: '0123456789', // 长度 10
            });
            const msg3 = await MessageEntity.create({
                conversation_id: convEntity.getConversationId(),
                parent_message_id: msg2.getMessageId(),
                sender_id: 'user2',
                content: '0123456789', // 长度 10
            });

            // 测试 createHistChain，maxLength 设为 25
            const result = await DialogStoreHelper.createHistChain({
                convEntity,
                startEntity: msg3,
                maxLength: 25,
                maxCount: 100,
                computeLength: (entity) => entity.getContent().length,
            });

            // 验证结果
            expect(result.chain.length).toBe(2);
            expect(result.totalLength).toBe(20);
            expect(result.totalCount).toBe(2);
            expect(result.stopReason.reason).toBe('length');
            if (result.stopReason.reason === 'length') {
                // 如果接入第 3 条消息，总长度会是 30
                expect(result.stopReason.wouldBeLength).toBe(30);
            }
        });

        test("23. 应支持自定义 computeLength 计算", async () => {
            // 创建对话
            const convEntity = await ConversationEntity.create<TestLightData, TestHeavyData>({});

            // 创建消息链，内容中包含不同数量的 'a' 字符
            const msg1 = await MessageEntity.create({
                conversation_id: convEntity.getConversationId(),
                sender_id: 'user1',
                content: 'aaabbb', // 包含 3 个 'a'
            });
            const msg2 = await MessageEntity.create({
                conversation_id: convEntity.getConversationId(),
                parent_message_id: msg1.getMessageId(),
                sender_id: 'char1',
                content: 'aaaaacccc', // 包含 5 个 'a'
            });
            const msg3 = await MessageEntity.create({
                conversation_id: convEntity.getConversationId(),
                parent_message_id: msg2.getMessageId(),
                sender_id: 'user2',
                content: 'aaaaaaadddd', // 包含 7 个 'a'
            });

            // 自定义 computeLength：计算内容中 'a' 字符的个数
            const countA = (str: string) => str.split('a').length - 1;

            // 测试 createHistChain，maxLength 设为 10（按 'a' 的个数计算）
            // msg3: 7 个 'a'，可以接入，总长度 7
            // msg2: 5 个 'a'，接入后总长度 12 > 10，停止
            const result = await DialogStoreHelper.createHistChain({
                convEntity,
                startEntity: msg3,
                maxLength: 10,
                maxCount: 100,
                computeLength: (entity) => countA(entity.getContent()),
            });

            // 验证结果
            expect(result.chain.length).toBe(1);
            expect(result.totalLength).toBe(7);
            expect(result.totalCount).toBe(1);
            expect(result.stopReason.reason).toBe('length');
            if (result.stopReason.reason === 'length') {
                // 如果接入 msg2，总长度会是 7 + 5 = 12
                expect(result.stopReason.wouldBeLength).toBe(12);
            }
        });
    });

    describe("Entity.updateData 深层合并行为测试", () => {
        test("24. ConversationEntity.updateData传入undefined删除heavy_data中的key", async () => {
            // 创建带有多个heavy_data字段的对话
            const entity = await ConversationEntity.create<TestLightData, TestHeavyData>({
                heavy_data: {
                    translate_content_table: { en: 'Hello', zh: '你好' },
                    metadata: { key: 'value1' }
                }
            });

            // 验证初始数据
            expect(entity.getHeavyField('translate_content_table')).toEqual({ en: 'Hello', zh: '你好' });
            expect(entity.getHeavyField('metadata')).toEqual({ key: 'value1' });

            // 传入undefined删除translate_content_table
            await entity.updateData({
                heavy_data: {
                    translate_content_table: undefined
                }
            });

            // 验证translate_content_table已删除，metadata仍存在
            expect(entity.getHeavyField('translate_content_table')).toBeUndefined();
            expect(entity.getHeavyField('metadata')).toEqual({ key: 'value1' });

            // 重新加载验证持久化
            const loadedEntity = await ConversationEntity.load<TestLightData, TestHeavyData>(entity.getConversationId());
            expect(loadedEntity?.getHeavyField('translate_content_table')).toBeUndefined();
            expect(loadedEntity?.getHeavyField('metadata')).toEqual({ key: 'value1' });
        });

        test("25. MessageEntity.updateData传入undefined删除heavy_data中的key", async () => {
            // 创建对话实体
            const convEntity = await ConversationEntity.create<TestLightData, TestHeavyData>({});

            // 获取首条消息实体并设置heavy_data
            const firstMsg = await convEntity.getFirstMessageEntity();
            await firstMsg.updateData({
                heavy_data: {
                    translate_content_table: { en: 'Hello', zh: '你好' },
                    metadata: { key: 'value1' }
                }
            });

            // 验证初始数据
            expect(firstMsg.getHeavyField('translate_content_table')).toEqual({ en: 'Hello', zh: '你好' });
            expect(firstMsg.getHeavyField('metadata')).toEqual({ key: 'value1' });

            // 传入undefined删除metadata
            await firstMsg.updateData({
                heavy_data: {
                    metadata: undefined
                }
            });

            // 验证metadata已删除，translate_content_table仍存在
            expect(firstMsg.getHeavyField('metadata')).toBeUndefined();
            expect(firstMsg.getHeavyField('translate_content_table')).toEqual({ en: 'Hello', zh: '你好' });

            // 重新加载验证持久化
            const loadedMsg = await MessageEntity.load<TestLightData, TestHeavyData>(firstMsg.getMessageId() ?? convEntity.getFirstMessageId());
            expect(loadedMsg?.getHeavyField('metadata')).toBeUndefined();
            expect(loadedMsg?.getHeavyField('translate_content_table')).toEqual({ en: 'Hello', zh: '你好' });
        });

        test("26. ConversationEntity.updateData传入空对象不删除字段", async () => {
            // 创建带有heavy_data的对话
            const entity = await ConversationEntity.create<TestLightData, TestHeavyData>({
                heavy_data: {
                    translate_content_table: { en: 'Hello' },
                    metadata: { key: 'value1' }
                }
            });

            // 验证初始数据
            expect(entity.getHeavyField('translate_content_table')).toEqual({ en: 'Hello' });
            expect(entity.getHeavyField('metadata')).toEqual({ key: 'value1' });

            // 传入空对象{}应无操作
            await entity.updateData({
                heavy_data: {}
            });

            // 验证heavy_data字段仍然存在
            expect(entity.getHeavyField('translate_content_table')).toEqual({ en: 'Hello' });
            expect(entity.getHeavyField('metadata')).toEqual({ key: 'value1' });

            // 重新加载验证持久化
            const loadedEntity = await ConversationEntity.load<TestLightData, TestHeavyData>(entity.getConversationId());
            expect(loadedEntity?.getHeavyField('translate_content_table')).toEqual({ en: 'Hello' });
            expect(loadedEntity?.getHeavyField('metadata')).toEqual({ key: 'value1' });
        });

        test("27. MessageEntity.updateData传入空对象不删除字段", async () => {
            // 创建对话实体
            const convEntity = await ConversationEntity.create<TestLightData, TestHeavyData>({});

            // 获取首条消息实体并设置heavy_data
            const firstMsg = await convEntity.getFirstMessageEntity();
            await firstMsg.updateData({
                heavy_data: {
                    translate_content_table: { en: 'Hello' },
                    metadata: { key: 'value1' }
                }
            });

            // 验证初始数据
            expect(firstMsg.getHeavyField('translate_content_table')).toEqual({ en: 'Hello' });
            expect(firstMsg.getHeavyField('metadata')).toEqual({ key: 'value1' });

            // 传入空对象{}应无操作
            await firstMsg.updateData({
                heavy_data: {}
            });

            // 验证heavy_data字段仍然存在
            expect(firstMsg.getHeavyField('translate_content_table')).toEqual({ en: 'Hello' });
            expect(firstMsg.getHeavyField('metadata')).toEqual({ key: 'value1' });

            // 重新加载验证持久化
            const loadedMsg = await MessageEntity.load<TestLightData, TestHeavyData>(firstMsg.getMessageId() ?? convEntity.getFirstMessageId());
            expect(loadedMsg?.getHeavyField('translate_content_table')).toEqual({ en: 'Hello' });
            expect(loadedMsg?.getHeavyField('metadata')).toEqual({ key: 'value1' });
        });
    });
});
