import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { DialogStore } from "@sosraciel-lamda/dialog-store";
import type { ConversationStruct, MessageStruct, AnchorStruct } from "@sosraciel-lamda/dialog-store";
import { sleep } from "@zwa73/utils";
import { DBCache, DBCacheKH } from "@sosraciel-lamda/dialog-store/dist/DBCache";
import { TestLightData, TestHeavyData, TestMessageExt, TestConversationExt, TestAnchorExt, createTestConversation, createTestMessage, createTestAnchor, setupTestDb, teardownTestDb } from "./Util";

describe("Dialog-Store 缓存同步 测试", () => {
    let manager: DBManager;

    beforeAll(async () => {
        manager = await setupTestDb();
    }, 30000);

    afterAll(async () => {
        await teardownTestDb(manager);
    }, 30000);

    describe("light_data/heavy_data 缓存同步测试", () => {
        test("1. 应正确处理 light_data 的全量更新", async () => {
            // 创建带有 light_data 的对话
            const testConversation = createTestConversation<TestConversationExt>({
                light_data: { sender_type: 'user', status: 'active' }
            });
            await DialogStore.setConversation(testConversation);

            // 验证缓存中的 light_data
            const cacheKey = DBCacheKH.getConversationKey(testConversation.data.conversation_id);
            let cachedData = DBCache.peekCache(cacheKey) as ConversationStruct<TestConversationExt> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('user');
            expect((cachedData?.data.light_data as TestLightData)?.status).toBe('active');

            // 全量更新 light_data 的每一个字段
            const updatedConversation = createTestConversation<TestConversationExt>({
                conversation_id: testConversation.data.conversation_id,
                light_data: { sender_type: 'char', status: 'inactive' }
            });
            await DialogStore.setConversation(updatedConversation);

            // 内部set对缓存的影响应该随promise结果, 经过内部调用的set通知一起完成, 无需等待

            // 验证缓存已更新为新值
            cachedData = DBCache.peekCache(cacheKey) as ConversationStruct<TestConversationExt> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('char');
            expect((cachedData?.data.light_data as TestLightData)?.status).toBe('inactive');
        });

        test("2. 应正确处理 heavy_data 的全量更新", async () => {
            // 创建带有 heavy_data 的对话
            const testConversation = createTestConversation<TestConversationExt>({
                heavy_data: { translate_content_table: { en: 'Hello' } }
            });
            await DialogStore.setConversation(testConversation);

            // 验证缓存中的 heavy_data
            const cacheKey = DBCacheKH.getConversationKey(testConversation.data.conversation_id);
            let cachedData = DBCache.peekCache(cacheKey) as ConversationStruct<TestConversationExt> | undefined;
            expect((cachedData?.data.heavy_data as TestHeavyData)?.translate_content_table?.en).toBe('Hello');

            // 全量更新 heavy_data 的每一个字段
            const updatedConversation = createTestConversation<TestConversationExt>({
                conversation_id: testConversation.data.conversation_id,
                heavy_data: { translate_content_table: { zh: '你好' } }
            });
            await DialogStore.setConversation(updatedConversation);

            // 内部set对缓存的影响应该随promise结果, 经过内部调用的set通知一起完成, 无需等待

            // 验证缓存已更新为新值（en 已被替换掉）
            cachedData = DBCache.peekCache(cacheKey) as ConversationStruct<TestConversationExt> | undefined;
            expect((cachedData?.data.heavy_data as TestHeavyData)?.translate_content_table?.zh).toBe('你好');
            expect((cachedData?.data.heavy_data as TestHeavyData)?.translate_content_table?.en).toBeUndefined();
        });

        test("3. 应正确处理消息的 light_data 缓存同步", async () => {
            // 先创建对话
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);

            // 创建带有 light_data 的消息
            const testMessage = createTestMessage<TestMessageExt>(
                testConversation.data.conversation_id,
                { light_data: { sender_type: 'char' } }
            );
            await DialogStore.setMessage(testMessage);

            // 验证缓存中的 light_data
            const cacheKey = DBCacheKH.getMessageKey(testMessage.data.message_id);
            let cachedData = DBCache.peekCache(cacheKey) as MessageStruct<TestMessageExt> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('char');

            // 全量更新 light_data
            const updatedMessage = createTestMessage<TestMessageExt>(
                testConversation.data.conversation_id,
                {
                    message_id: testMessage.data.message_id,
                    light_data: { sender_type: 'user', status: 'pending' }
                }
            );
            await DialogStore.setMessage(updatedMessage);

            // 内部set对缓存的影响应该随promise结果, 经过内部调用的set通知一起完成, 无需等待

            // 验证缓存已更新
            cachedData = DBCache.peekCache(cacheKey) as MessageStruct<TestMessageExt> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('user');
            expect((cachedData?.data.light_data as TestLightData)?.status).toBe('pending');
        });

        test("4. 应正确处理锚点的 light_data 缓存同步", async () => {
            // 创建带有 light_data 的锚点
            const testAnchor = createTestAnchor<TestAnchorExt>({
                light_data: { sender_type: 'user', status: 'active' }
            });
            await DialogStore.setAnchor(testAnchor);

            // 验证缓存中的 light_data
            const cacheKey = DBCacheKH.getAnchorKey(testAnchor.data.anchor_id);
            let cachedData = DBCache.peekCache(cacheKey) as AnchorStruct<TestAnchorExt> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('user');
            expect((cachedData?.data.light_data as TestLightData)?.status).toBe('active');

            // 全量更新 light_data
            const updatedAnchor = createTestAnchor<TestAnchorExt>({
                anchor_id: testAnchor.data.anchor_id,
                light_data: { sender_type: 'char', status: 'inactive' }
            });
            await DialogStore.setAnchor(updatedAnchor);

            // 验证缓存已更新
            cachedData = DBCache.peekCache(cacheKey) as AnchorStruct<TestAnchorExt> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('char');
            expect((cachedData?.data.light_data as TestLightData)?.status).toBe('inactive');
        });
    });

    describe("SQL 触发器与 TS 缓存一致性测试", () => {
        test("5. 外部SQL 增量更新后缓存应正确同步 light_data", async () => {
            // 创建带有 light_data 的对话
            const testConversation = createTestConversation<TestConversationExt>({
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
            const cachedData = DBCache.peekCache(cacheKey) as ConversationStruct<TestConversationExt> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.status).toBe('synced');
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('user');
        });

        test("6. 外部SQL 增量更新后缓存应正确同步 heavy_data", async () => {
            // 创建带有 heavy_data 的对话
            const testConversation = createTestConversation<TestConversationExt>({
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
            const cachedData = DBCache.peekCache(cacheKey) as ConversationStruct<TestConversationExt> | undefined;
            expect((cachedData?.data.heavy_data as TestHeavyData)?.metadata?.key).toBe('sql-value');
            expect((cachedData?.data.heavy_data as TestHeavyData)?.translate_content_table?.en).toBe('Hello');
        });

        test("7. data_hash 应在 SQL 触发器中正确生成", async () => {
            // 创建对话
            const testConversation = createTestConversation<TestConversationExt>({
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

        test("8. 外部SQL 增量更新锚点后缓存应正确同步", async () => {
            // 创建锚点
            const testAnchor = createTestAnchor<TestAnchorExt>({
                light_data: { sender_type: 'user' }
            });
            await DialogStore.setAnchor(testAnchor);

            const cacheKey = DBCacheKH.getAnchorKey(testAnchor.data.anchor_id);

            // 通过 SQL 增量更新 light_data
            await manager.client.query(`
                UPDATE dialog.anchor
                SET data = jsonb_set(
                    data,
                    '{light_data,status}',
                    '"anchor-synced"'::jsonb,
                    true
                )
                WHERE data->>'anchor_id' = '${testAnchor.data.anchor_id}';
            `);

            // 等待 SQL 触发器发送通知和缓存同步
            await sleep(100);

            // 验证缓存已同步 SQL 的增量更新
            const cachedData = DBCache.peekCache(cacheKey) as AnchorStruct<TestAnchorExt> | undefined;
            expect((cachedData?.data.light_data as TestLightData)?.status).toBe('anchor-synced');
            expect((cachedData?.data.light_data as TestLightData)?.sender_type).toBe('user');
        });
    });

    describe("消息选择列表缓存失效测试", () => {
        test("9. 取过列表后插入新消息，重取应能看到新消息", async () => {
            // 先创建对话
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);
            const conversationId = testConversation.data.conversation_id;

            // 创建3个消息
            const testMessage1 = createTestMessage(conversationId, { content: "First message" });
            const testMessage2 = createTestMessage(conversationId, { content: "Second message" });
            const testMessage3 = createTestMessage(conversationId, { content: "Third message" });
            await DialogStore.setMessage(testMessage1);
            await DialogStore.setMessage(testMessage2);
            await DialogStore.setMessage(testMessage3);

            // 第一次取列表，此步会填充 choice_list 缓存
            const choiceIdList1 = await DialogStore.getMessageChoiceIdList(conversationId);
            expect(choiceIdList1).toEqual([
                testMessage1.data.message_id,
                testMessage2.data.message_id,
                testMessage3.data.message_id,
            ]);

            // 缓存此刻应已填充
            const cacheKey = DBCacheKH.getChoiceListKey(conversationId);
            expect(DBCache.hasCache(cacheKey)).toBe(true);

            // 插入新消息(模拟 genChoice 之后产生的新分支)
            const testMessage4 = createTestMessage(conversationId, { content: "Fourth message" });
            await DialogStore.setMessage(testMessage4);
            await sleep(100);

            // 新消息的 set 必须令 choice_list 缓存失效，否则下列读取会命中陈旧列表
            expect(DBCache.hasCache(cacheKey)).toBe(false);

            // 重取列表必须包含新消息
            const choiceIdList2 = await DialogStore.getMessageChoiceIdList(conversationId);
            expect(choiceIdList2).toEqual([
                testMessage1.data.message_id,
                testMessage2.data.message_id,
                testMessage3.data.message_id,
                testMessage4.data.message_id,
            ]);

            // 完整结构列表同样应包含新消息且顺序正确
            const choiceList2 = await DialogStore.getMessageChoiceList(conversationId);
            expect(choiceList2.map(v => v.data.message_id)).toEqual(choiceIdList2);
        });

        test("10. 取过列表后插入子消息，父消息的分支列表应失效", async () => {
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);
            const conversationId = testConversation.data.conversation_id;

            // 创建父消息与2个子消息
            const parentMessage = createTestMessage(conversationId, { content: "Parent message" });
            await DialogStore.setMessage(parentMessage);
            const childMessage1 = createTestMessage(conversationId, {
                parent_message_id: parentMessage.data.message_id,
                content: "Child message 1",
            });
            const childMessage2 = createTestMessage(conversationId, {
                parent_message_id: parentMessage.data.message_id,
                content: "Child message 2",
            });
            await DialogStore.setMessage(childMessage1);
            await DialogStore.setMessage(childMessage2);

            // 第一次取分支列表，填充该父消息下的 choice_list 缓存
            const branchIdList1 = await DialogStore.getMessageChoiceIdList(conversationId, parentMessage.data.message_id);
            expect(branchIdList1).toEqual([
                childMessage1.data.message_id,
                childMessage2.data.message_id,
            ]);

            const cacheKey = DBCacheKH.getChoiceListKey(conversationId, parentMessage.data.message_id);
            expect(DBCache.hasCache(cacheKey)).toBe(true);

            // 再插入一个子消息
            const childMessage3 = createTestMessage(conversationId, {
                parent_message_id: parentMessage.data.message_id,
                content: "Child message 3",
            });
            await DialogStore.setMessage(childMessage3);
            await sleep(100);

            expect(DBCache.hasCache(cacheKey)).toBe(false);

            // 重取分支列表必须包含新子消息
            const branchIdList2 = await DialogStore.getMessageChoiceIdList(conversationId, parentMessage.data.message_id);
            expect(branchIdList2).toEqual([
                childMessage1.data.message_id,
                childMessage2.data.message_id,
                childMessage3.data.message_id,
            ]);
        });

        test("11. 更新已存在于列表中的老消息，不应清空列表缓存", async () => {
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);
            const conversationId = testConversation.data.conversation_id;

            const testMessage1 = createTestMessage(conversationId, { content: "First message" });
            await DialogStore.setMessage(testMessage1);

            // 取列表填充缓存
            const cacheKey = DBCacheKH.getChoiceListKey(conversationId);
            await DialogStore.getMessageChoiceIdList(conversationId);
            expect(DBCache.hasCache(cacheKey)).toBe(true);

            // 更新这个老消息的内容(其 id 已在列表中)，结构未变故缓存应保留
            const updatedMessage = createTestMessage(conversationId, {
                message_id: testMessage1.data.message_id,
                parent_message_id: testMessage1.data.parent_message_id,
                content: "Updated content",
            });
            await DialogStore.setMessage(updatedMessage);
            await sleep(100);

            expect(DBCache.hasCache(cacheKey)).toBe(true);

            // 列表内容保持不变
            const choiceIdList = await DialogStore.getMessageChoiceIdList(conversationId);
            expect(choiceIdList).toEqual([testMessage1.data.message_id]);
        });

        test("12. 删除消息后重取列表，应不再包含被删消息", async () => {
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);
            const conversationId = testConversation.data.conversation_id;

            const testMessage1 = createTestMessage(conversationId, { content: "First message" });
            const testMessage2 = createTestMessage(conversationId, { content: "Second message" });
            await DialogStore.setMessage(testMessage1);
            await DialogStore.setMessage(testMessage2);

            const cacheKey = DBCacheKH.getChoiceListKey(conversationId);
            const choiceIdList1 = await DialogStore.getMessageChoiceIdList(conversationId);
            expect(choiceIdList1).toEqual([
                testMessage1.data.message_id,
                testMessage2.data.message_id,
            ]);
            expect(DBCache.hasCache(cacheKey)).toBe(true);

            // 删除一条消息
            await DialogStore.deleteMessage(testMessage2.data.message_id);
            await sleep(100);

            expect(DBCache.hasCache(cacheKey)).toBe(false);

            const choiceIdList2 = await DialogStore.getMessageChoiceIdList(conversationId);
            expect(choiceIdList2).toEqual([testMessage1.data.message_id]);
        });

        test("13. 选择列表缓存的键应区分根列表与各父消息分支", async () => {
            const testConversation = createTestConversation();
            await DialogStore.setConversation(testConversation);
            const conversationId = testConversation.data.conversation_id;

            const parentMessage = createTestMessage(conversationId, { content: "Parent message" });
            await DialogStore.setMessage(parentMessage);
            const childMessage = createTestMessage(conversationId, {
                parent_message_id: parentMessage.data.message_id,
                content: "Child message",
            });
            await DialogStore.setMessage(childMessage);

            // 同时填充根列表与分支列表两个缓存条目
            const rootIdList = await DialogStore.getMessageChoiceIdList(conversationId);
            const branchIdList = await DialogStore.getMessageChoiceIdList(conversationId, parentMessage.data.message_id);

            // 根列表为 null 父消息的分支, 不包含子消息
            expect(rootIdList).toEqual([parentMessage.data.message_id]);
            // 分支列表为该父消息下的子消息
            expect(branchIdList).toEqual([childMessage.data.message_id]);

            // 两个键必须不同, 且同时存在互不覆盖
            const rootKey = DBCacheKH.getChoiceListKey(conversationId);
            const branchKey = DBCacheKH.getChoiceListKey(conversationId, parentMessage.data.message_id);
            expect(rootKey).not.toBe(branchKey);
            expect(DBCache.hasCache(rootKey)).toBe(true);
            expect(DBCache.hasCache(branchKey)).toBe(true);
            expect(DBCache.peekCache(rootKey)).toEqual([parentMessage.data.message_id]);
            expect(DBCache.peekCache(branchKey)).toEqual([childMessage.data.message_id]);
        });
    });
});
