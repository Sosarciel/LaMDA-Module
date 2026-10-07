import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { DialogStore } from "@sosraciel-lamda/dialog-store";
import { sleep } from "@zwa73/utils";
import { DBCache, DBCacheKH } from "@sosraciel-lamda/dialog-store/dist/DBCache";
import { TestLightData, TestConversationExt, createTestConversation, createTestMessage, createTestAnchor, setupTestDb, teardownTestDb } from "./Util";

describe("Dialog-Store 主测试", () => {
    let manager: DBManager;

    beforeAll(async () => {
        manager = await setupTestDb();
    }, 30000);

    afterAll(async () => {
        await teardownTestDb(manager);
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

            // 验证 anchor 表是否存在
            const anchorTableResult = await manager.client.sql`
                SELECT table_name
                FROM information_schema.tables
                WHERE table_name = 'anchor'
                AND table_schema = 'dialog';
            `;
            expect(anchorTableResult.rowCount).toBe(1);
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

        test("4. 应成功创建和获取锚点记录", async () => {
            const testAnchor = createTestAnchor();

            // 创建锚点记录
            await DialogStore.setAnchor(testAnchor);

            // 获取锚点记录
            const retrievedAnchor = await DialogStore.getAnchor(testAnchor.data.anchor_id);
            expect(retrievedAnchor).toBeDefined();
            expect(retrievedAnchor?.data.anchor_id).toBe(testAnchor.data.anchor_id);
        });
    });


    describe("消息树与联动删除测试", () => {
        test("5. 应成功创建消息树结构", async () => {
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

        test("6. 删除根消息时应联动删除子消息", async () => {
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

        test("7. 删除对话时应联动删除所有相关消息", async () => {
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
        test("8. 应成功获取消息选择列表", async () => {
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

        test("9. 应成功获取带 parent_message_id 的消息选择列表", async () => {
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
        test("10. UPDATE 时应保留 created_at 时间戳（含SQL覆盖保护）", async () => {
            // 创建对话
            const testConversation = createTestConversation<TestConversationExt>({
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
            const updatedConversation = createTestConversation<TestConversationExt>({
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

        test("11. 空对象 light_data/heavy_data 应被清理", async () => {
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
});
