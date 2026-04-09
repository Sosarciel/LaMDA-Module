import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { DialogStore, MessageEntity } from "@sosraciel-lamda/dialog-store";
import type { MessageStruct, MessageStructExt, ConversationStructExt } from "@sosraciel-lamda/dialog-store";
import { FirstEntity, ConversationEntity } from "@sosraciel-lamda/dialog-store";
import { UtilFunc } from "@zwa73/utils";
import { PG_PORT } from "@/src/Constant";
import { TestLightData, TestHeavyData, TestMessageExt, TestConversationExt, createTestMessage, setupTestDb, teardownTestDb } from "./Util";

describe("Dialog-Store MessageEntity 测试", () => {
    let manager: DBManager;

    beforeAll(async () => {
        manager = await setupTestDb();
    }, 30000);

    afterAll(async () => {
        await teardownTestDb(manager);
    }, 30000);

    describe("Entity 泛型测试", () => {
        test("14. MessageEntity 应正确处理泛型 heavy_data", async () => {
            // 创建对话实体
            const convEntity = await ConversationEntity.create<TestConversationExt>({
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

        test("15. FirstEntity 应正确工作", async () => {
            // 创建对话实体
            const convEntity = await ConversationEntity.create<TestConversationExt>({
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

    describe("Entity.updateData 深层合并行为测试", () => {
        test("30. MessageEntity.updateData传入undefined删除heavy_data中的key", async () => {
            // 创建对话实体
            const convEntity = await ConversationEntity.create<TestConversationExt>({});

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
            const loadedMsg = await MessageEntity.load<TestMessageExt>(firstMsg.getMessageId() ?? convEntity.getFirstMessageId());
            expect(loadedMsg?.getHeavyField('metadata')).toBeUndefined();
            expect(loadedMsg?.getHeavyField('translate_content_table')).toEqual({ en: 'Hello', zh: '你好' });
        });

        test("32. MessageEntity.updateData传入空对象不删除字段", async () => {
            // 创建对话实体
            const convEntity = await ConversationEntity.create<TestConversationExt>({});

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
            const loadedMsg = await MessageEntity.load<TestMessageExt>(firstMsg.getMessageId() ?? convEntity.getFirstMessageId());
            expect(loadedMsg?.getHeavyField('translate_content_table')).toEqual({ en: 'Hello' });
            expect(loadedMsg?.getHeavyField('metadata')).toEqual({ key: 'value1' });
        });
    });
});