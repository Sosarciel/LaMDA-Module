import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { ConversationModel, MessageModel, DialogHelper } from "@sosraciel-lamda/dialog-domain";
import { createTestScene, setupTestDb, teardownTestDb } from "./Util";

// ─── 测试集 ───────────────────────────────────────────────

describe("Dialog-Domain DialogHelper 测试", () => {
    let manager: DBManager;

    beforeAll(async () => {
        manager = await setupTestDb();
    }, 30000);

    afterAll(async () => {
        await teardownTestDb(manager);
    }, 30000);

    /**验证 getDialogPosId / getDialogPos 的序列化与反序列化
     * 检查点：posId 结构正确，通过 posId 能恢复出正确的 conversationModel 和 messageModel */
    test("1. 应成功测试DialogHelper.getDialogPos和getDialogPosId", async () => {
        const conversationModel = await ConversationModel.create({ scene: createTestScene() });
        const conversationId = conversationModel.getConversationId();

        const messageModel = await MessageModel.create({
            conversation_id: conversationId, parent_message_id: undefined,
            sender_id: "user", sender_type: "user", content: "Test message for pos"
        });

        // 获取对话位置ID
        const posId = DialogHelper.getDialogPosId({ messageModel, conversationModel });

        // 强断言：验证 posId 完整结构
        expect(posId).toEqual({ conversationId, messageId: messageModel.getMessageId() });

        // 通过位置ID恢复对话位置
        const retrievedPos = await DialogHelper.getDialogPos(posId);
        expect(retrievedPos).toBeDefined();
        // 强断言：验证恢复后的位置完整结构
        expect(retrievedPos?.conversationModel.getConversationId()).toBe(conversationId);
        expect(retrievedPos?.messageModel.getMessageId()).toBe(messageModel.getMessageId());
    });

    /**验证 renderMessageList 的渲染逻辑
     * 检查点：desc 消息保持不变；未渲染消息（有 sender_id）被正确渲染；
     * 已渲染消息（有 sender_name）保持不变 */
    test("2. 应成功测试DialogHelper.renderMessageList渲染逻辑", async () => {
        // 创建未渲染消息列表（混合 desc、未渲染、已渲染）
        const unrenderedList = [
            { type: 'desc' as const, content: "System description" },
            { type: 'chat' as const, sender_id: "user1", sender_type: "user" as const, content: "User message", id: "msg1" },
            { type: 'chat' as const, sender_id: "char1", sender_type: "char" as const, content: "Char message", id: "msg2" },
            { type: 'chat' as const, sender_name: "Narrator", content: "Already rendered message" }
        ];

        const renderFunc = async (msg: { sender_id: string; sender_type: string; content: string }) => {
            const nameMap: Record<string, string> = { "user1": "Alice", "char1": "Bob" };
            return { type: 'chat' as const, content: msg.content, sender_name: nameMap[msg.sender_id] ?? msg.sender_id };
        };

        const renderedList = await DialogHelper.renderMessageList({ list: unrenderedList, render: renderFunc });

        expect(renderedList).toEqual([
            { type: 'desc', content: "System description" },
            { type: 'chat', content: "User message", sender_name: "Alice" },
            { type: 'chat', content: "Char message", sender_name: "Bob" },
            { type: 'chat', content: "Already rendered message", sender_name: "Narrator" },
        ]);
    });
});
