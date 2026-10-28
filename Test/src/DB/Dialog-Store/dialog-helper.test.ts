import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { DialogStoreHelper, MessageEntity, WaypointEntity } from "@sosraciel-lamda/dialog-store";
import { ConversationEntity } from "@sosraciel-lamda/dialog-store";
import type { WaypointStructExt } from "@sosraciel-lamda/dialog-store";
import { TestMessageExt, TestConversationExt, setupTestDb, teardownTestDb } from "./Util";

/**测试用 waypoint 扩展类型 */
type TestWaypointExt = WaypointStructExt;

describe("Dialog-Store DialogStoreHelper 测试", () => {
    let manager: DBManager;

    beforeAll(async () => {
        manager = await setupTestDb();
        // 自愈: 若上次运行中断在禁用触发器的窗口内 此处无条件恢复 避免污染后续用例
        await manager.client.query(`ALTER TABLE dialog.message ENABLE TRIGGER trg__message__before_insert_or_update`);
    }, 30000);

    afterAll(async () => {
        await teardownTestDb(manager);
    }, 30000);

    /**创建直线消息链 */
    const createMsgChain = async (
        conversationEntity: ConversationEntity<TestConversationExt>,
        count: number,
        prefix: string,
    ): Promise<MessageEntity<TestMessageExt>[]> => {
        const messages: MessageEntity<TestMessageExt>[] = [];
        for (let i = 0; i < count; i++) {
            const msg = await MessageEntity.create<TestMessageExt>({
                conversation_id: conversationEntity.getConversationId(),
                parent_message_id: i === 0 ? undefined : messages[i - 1].getMessageId(),
                sender_id: "user",
                heavy_data: { content: `${prefix}${i}` },
            });
            messages.push(msg);
        }
        return messages;
    };

    /**把消息的 target_waypoint_id 直接改写成任意值 绕过存在性校验触发器 */
    const setRawWaypointId = async (
        messageEntity: MessageEntity<TestMessageExt>,
        waypointId: string,
    ) => {
        await manager.client.query(`ALTER TABLE dialog.message DISABLE TRIGGER trg__message__before_insert_or_update`);
        try {
            await manager.client.query(
                `UPDATE dialog.message SET data = jsonb_set(data, '{target_waypoint_id}', to_jsonb($1::text))` +
                ` WHERE data->>'message_id' = $2`,
                [waypointId, messageEntity.getMessageId()]
            );
        } finally {
            await manager.client.query(`ALTER TABLE dialog.message ENABLE TRIGGER trg__message__before_insert_or_update`);
        }
    };

    /**收集遍历产出的游标标识 根游标记为 'first' 一并收集以便断言其走法 */
    const collectSteps = async (
        generator: AsyncGenerator<{ entity: unknown; move: unknown }, void, unknown>,
    ): Promise<{ ids: string[]; moves: string[] }> => {
        const ids: string[] = [];
        const moves: string[] = [];
        for await (const step of generator) {
            const entity = step.entity as {
                getMessageId?: () => string;
                getWaypointId?: () => string;
            };
            const messageId = entity.getMessageId?.();
            const waypointId = entity.getWaypointId?.();
            if (messageId != undefined) ids.push(messageId);
            else if (waypointId != undefined) ids.push(waypointId);
            else ids.push("first");
            moves.push(step.move as string);
        }
        return { ids, moves };
    };

    test("1. 消息 target_waypoint_id 指向不存在的 waypoint 时清除指针并走稠密树", async () => {
        const conversationEntity = await ConversationEntity.create<TestConversationExt>({});
        const msgs = await createMsgChain(conversationEntity, 4, "d1_msg");
        const ghostWaypointId = "ghost-waypoint-not-exist";
        await setRawWaypointId(msgs[3], ghostWaypointId);

        const { ids, moves } = await collectSteps(DialogStoreHelper.traverseUp<TestConversationExt>({
            conversationEntity,
            messageEntity: msgs[3],
            onJump: () => 'jumpWaypoint',
        }));

        // 悬垂指针被自检清除 随后每步都沿稠密树 最终产出根游标
        expect(ids).toEqual([
            msgs[3].getMessageId(),
            msgs[2].getMessageId(),
            msgs[1].getMessageId(),
            msgs[0].getMessageId(),
            "first",
        ]);
        expect(moves).toEqual(['continue', 'continue', 'continue', 'continue', 'continue']);

        // 指针确实被写回清除
        const reloaded = await MessageEntity.load<TestMessageExt>(msgs[3].getMessageId());
        expect(reloaded?.getWaypointId()).toBeUndefined();
    });

    test("2. 消息游标返回 jumpMessage 时回落稠密树", async () => {
        const conversationEntity = await ConversationEntity.create<TestConversationExt>({});
        const msgs = await createMsgChain(conversationEntity, 3, "d2_msg");

        const { ids, moves } = await collectSteps(DialogStoreHelper.traverseUp<TestConversationExt>({
            conversationEntity,
            messageEntity: msgs[2],
            onJump: () => 'jumpMessage',
        }));

        expect(ids).toEqual([
            msgs[2].getMessageId(),
            msgs[1].getMessageId(),
            msgs[0].getMessageId(),
            "first",
        ]);
        expect(moves).toEqual(['continue', 'continue', 'continue', 'continue']);
    });

    test("3. 消息游标指定不存在的落点消息时回落稠密树", async () => {
        const conversationEntity = await ConversationEntity.create<TestConversationExt>({});
        const msgs = await createMsgChain(conversationEntity, 3, "d3_msg");

        const { ids, moves } = await collectSteps(DialogStoreHelper.traverseUp<TestConversationExt>({
            conversationEntity,
            messageEntity: msgs[2],
            onJump: () => ({ jumpMessage: "not-exist-message" }),
        }));

        expect(ids).toEqual([
            msgs[2].getMessageId(),
            msgs[1].getMessageId(),
            msgs[0].getMessageId(),
            "first",
        ]);
        expect(moves).toEqual(['continue', 'continue', 'continue', 'continue']);
    });

    test("4. 消息游标返回 stop 时就地产出并终止", async () => {
        const conversationEntity = await ConversationEntity.create<TestConversationExt>({});
        const msgs = await createMsgChain(conversationEntity, 3, "d4_msg");

        const { ids, moves } = await collectSteps(DialogStoreHelper.traverseUp<TestConversationExt>({
            conversationEntity,
            messageEntity: msgs[2],
            onJump: () => 'stop',
        }));

        expect(ids).toEqual([msgs[2].getMessageId()]);
        expect(moves).toEqual(['stop']);
    });

    test("5. waypoint 游标返回 continue 时因无稠密树边而终止", async () => {
        const conversationEntity = await ConversationEntity.create<TestConversationExt>({});
        const msgs = await createMsgChain(conversationEntity, 3, "d5_msg");
        const wp = await WaypointEntity.create<TestWaypointExt>({
            conversation_id: conversationEntity.getConversationId(),
            base_message_id: msgs[1].getMessageId(),
        });
        const waypointId = wp.getWaypointId();
        await msgs[2].updateData({ target_waypoint_id: waypointId });

        const { ids, moves } = await collectSteps(DialogStoreHelper.traverseUp<TestConversationExt>({
            conversationEntity,
            messageEntity: msgs[2],
            onJump: ({ currEntity }) => (
                currEntity instanceof WaypointEntity ? 'continue' : 'jumpWaypoint'
            ),
        }));

        // msg2 跳到 waypoint 后 waypoint 游标返回 continue 不成立 故直接终止不再产出该步
        expect(ids).toEqual([msgs[2].getMessageId()]);
        expect(moves).toEqual(['jumpWaypoint']);
    });

    test("6. 不传 onJump 时即使消息挂载 waypoint 也完全走稠密树", async () => {
        const conversationEntity = await ConversationEntity.create<TestConversationExt>({});
        const msgs = await createMsgChain(conversationEntity, 4, "d6_msg");
        const wp = await WaypointEntity.create<TestWaypointExt>({
            conversation_id: conversationEntity.getConversationId(),
            base_message_id: msgs[1].getMessageId(),
        });
        await msgs[3].updateData({ target_waypoint_id: wp.getWaypointId() });

        const { ids, moves } = await collectSteps(DialogStoreHelper.traverseUp<TestConversationExt>({
            conversationEntity,
            messageEntity: msgs[3],
        }));

        // 未启用 onJump 时 waypoint 完全不参与 逐条产出真实消息直到根
        expect(ids).toEqual([
            msgs[3].getMessageId(),
            msgs[2].getMessageId(),
            msgs[1].getMessageId(),
            msgs[0].getMessageId(),
            "first",
        ]);
        expect(moves).toEqual(['continue', 'continue', 'continue', 'continue', 'continue']);
    });

    test("7. waypoint 指向 waypoint 时连续多跳", async () => {
        const conversationEntity = await ConversationEntity.create<TestConversationExt>({});
        const msgs = await createMsgChain(conversationEntity, 5, "d7_msg");
        const wpOld = await WaypointEntity.create<TestWaypointExt>({
            conversation_id: conversationEntity.getConversationId(),
            base_message_id: msgs[1].getMessageId(),
        });
        const wpNew = await WaypointEntity.create<TestWaypointExt>({
            conversation_id: conversationEntity.getConversationId(),
            target_waypoint_id: wpOld.getWaypointId(),
        });
        await msgs[4].updateData({ target_waypoint_id: wpNew.getWaypointId() });

        const { ids, moves } = await collectSteps(DialogStoreHelper.traverseUp<TestConversationExt>({
            conversationEntity,
            messageEntity: msgs[4],
            onJump: ({ currEntity }) => (
                currEntity instanceof WaypointEntity ? 'jumpWaypoint' : 'jumpWaypoint'
            ),
        }));

        // msg4 跳 wpNew 再跳 wpOld wpOld 无落点 waypoint 视为指向根 产出后终止
        expect(ids).toEqual([
            msgs[4].getMessageId(),
            wpNew.getWaypointId(),
            wpOld.getWaypointId(),
        ]);
        expect(moves).toEqual(['jumpWaypoint', 'jumpWaypoint', 'jumpWaypoint']);
    });

    test("8. waypoint 成环时告警并终止回溯", async () => {
        const conversationEntity = await ConversationEntity.create<TestConversationExt>({});
        const msgs = await createMsgChain(conversationEntity, 3, "d8_msg");
        const wpA = await WaypointEntity.create<TestWaypointExt>({
            conversation_id: conversationEntity.getConversationId(),
        });
        const wpB = await WaypointEntity.create<TestWaypointExt>({
            conversation_id: conversationEntity.getConversationId(),
            target_waypoint_id: wpA.getWaypointId(),
        });
        await wpA.updateData({ target_waypoint_id: wpB.getWaypointId() });
        await msgs[2].updateData({ target_waypoint_id: wpB.getWaypointId() });

        const { ids, moves } = await collectSteps(DialogStoreHelper.traverseUp<TestConversationExt>({
            conversationEntity,
            messageEntity: msgs[2],
            onJump: () => 'jumpWaypoint',
        }));

        // 环上每个 waypoint 各产出一次后命中已访问集合终止
        expect(ids).toEqual([
            msgs[2].getMessageId(),
            wpB.getWaypointId(),
            wpA.getWaypointId(),
        ]);
        expect(moves).toEqual(['jumpWaypoint', 'jumpWaypoint', 'jumpWaypoint']);
    });
});
