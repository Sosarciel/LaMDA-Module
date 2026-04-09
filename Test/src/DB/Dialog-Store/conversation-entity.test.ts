import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { DialogStore } from "@sosraciel-lamda/dialog-store";
import type { ConversationStruct, ConversationStructExt } from "@sosraciel-lamda/dialog-store";
import { ConversationEntity } from "@sosraciel-lamda/dialog-store";
import { UtilFunc } from "@zwa73/utils";
import { PG_PORT } from "@/src/Constant";
import { TestLightData, TestHeavyData, TestConversationExt, createTestConversation, setupTestDb, teardownTestDb } from "./Util";

describe("Dialog-Store ConversationEntity 测试", () => {
    let manager: DBManager;

    beforeAll(async () => {
        manager = await setupTestDb();
    }, 30000);

    afterAll(async () => {
        await teardownTestDb(manager);
    }, 30000);

    describe("Entity 泛型测试", () => {
        test("13. ConversationEntity 应正确处理泛型 light_data（深合并）", async () => {
            // 创建带有泛型 light_data 的对话实体
            const entity = await ConversationEntity.create<TestConversationExt>({
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
            const loadedEntity = await ConversationEntity.load<TestConversationExt>(entity.getConversationId());
            expect(loadedEntity?.getLightField('status')).toBeUndefined();
            expect(loadedEntity?.getLightField('sender_type')).toBe('char');
        });
    });

    describe("Entity.updateData 深层合并行为测试", () => {
        test("29. ConversationEntity.updateData传入undefined删除heavy_data中的key", async () => {
            // 创建带有多个heavy_data字段的对话
            const entity = await ConversationEntity.create<TestConversationExt>({
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
            const loadedEntity = await ConversationEntity.load<TestConversationExt>(entity.getConversationId());
            expect(loadedEntity?.getHeavyField('translate_content_table')).toBeUndefined();
            expect(loadedEntity?.getHeavyField('metadata')).toEqual({ key: 'value1' });
        });

        test("31. ConversationEntity.updateData传入空对象不删除字段", async () => {
            // 创建带有heavy_data的对话
            const entity = await ConversationEntity.create<TestConversationExt>({
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
            const loadedEntity = await ConversationEntity.load<TestConversationExt>(entity.getConversationId());
            expect(loadedEntity?.getHeavyField('translate_content_table')).toEqual({ en: 'Hello' });
            expect(loadedEntity?.getHeavyField('metadata')).toEqual({ key: 'value1' });
        });
    });
});