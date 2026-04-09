import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { DialogStore, AnchorEntity } from "@sosraciel-lamda/dialog-store";
import type { AnchorStruct, AnchorStructExt } from "@sosraciel-lamda/dialog-store";
import { UtilFunc } from "@zwa73/utils";
import { PG_PORT } from "@/src/Constant";
import { TestLightData, TestHeavyData, TestAnchorExt, createTestAnchor, setupTestDb, teardownTestDb } from "./Util";

describe("Dialog-Store AnchorEntity 测试", () => {
    let manager: DBManager;

    beforeAll(async () => {
        manager = await setupTestDb();
    }, 30000);

    afterAll(async () => {
        await teardownTestDb(manager);
    }, 30000);

    describe("Entity 泛型测试", () => {
        test("16. AnchorEntity 应正确处理泛型 light_data（深合并）", async () => {
            // 创建带有泛型 light_data 的锚点实体
            const anchorId = `test-anchor-${UtilFunc.genUUID()}`;
            const entity = await AnchorEntity.create<TestAnchorExt>(anchorId);

            // 更新 light_data
            await entity.updateData({
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
            const loadedEntity = await AnchorEntity.load<TestAnchorExt>(anchorId);
            expect(loadedEntity?.getLightField('status')).toBeUndefined();
            expect(loadedEntity?.getLightField('sender_type')).toBe('char');
        });

        test("17. AnchorEntity 应正确处理 conversation_id 和 message_id", async () => {
            // 创建锚点实体
            const anchorId = `test-anchor-conv-${UtilFunc.genUUID()}`;
            const entity = await AnchorEntity.create<TestAnchorExt>(anchorId);

            // 初始状态无 conversation_id 和 message_id
            expect(entity.getConversationId()).toBeUndefined();
            expect(entity.getMessageId()).toBeUndefined();

            // 更新 conversation_id 和 message_id
            const convId = UtilFunc.genUUID();
            const msgId = UtilFunc.genUUID();
            await entity.updateData({
                conversation_id: convId,
                message_id: msgId
            });

            // 验证更新成功
            expect(entity.getConversationId()).toBe(convId);
            expect(entity.getMessageId()).toBe(msgId);

            // 重新加载验证持久化
            const loadedEntity = await AnchorEntity.load<TestAnchorExt>(anchorId);
            expect(loadedEntity?.getConversationId()).toBe(convId);
            expect(loadedEntity?.getMessageId()).toBe(msgId);
        });
    });
});
