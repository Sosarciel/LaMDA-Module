import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { DialogStore } from "@sosraciel-lamda/dialog-store";
import { ConversationModel, MessageModel, DialogTemplate, WaypointModel } from "@sosraciel-lamda/dialog-domain";
import type { DialogHistJumpHandler } from "@sosraciel-lamda/dialog-domain";
import type { CharScene } from "@sosraciel-lamda/charprofile-domain";

import { setupTestDb, teardownTestDb, createMsgChain } from "./Util";

/**标准场景（用于 ConversationModel.create）预对话留空 使历史流中只有真实消息 */
const TEST_SCENE = {
    define: "",
    memory: [],
    name: "waypoint-test",
    dialog: [],
} satisfies CharScene;

/**标准 defineScene（用于 createHistMessageStream） */
const TEST_DEFINE = {
    define: "",
    memory: [],
    name: "waypoint-test",
    dialog: [],
} satisfies CharScene;

/**收集历史流内容 */
const collectStream = async (stream: AsyncIterable<{ content: string }>): Promise<string[]> => {
    const list: string[] = [];
    for await (const msg of stream) list.push(msg.content);
    return list;
};

/**取 waypoint 列表的显示名 未命名者落到其 ID */
const nameOf = (waypointList: WaypointModel[]): string[] => waypointList.map(w => w.getName());

/**默认策略: 消息挂了 waypoint 就往 waypoint 方向跳
 * waypoint 侧优先跳 waypoint 其次跳消息 都没有则取全量摘要跳根
 */
const defaultHandler: DialogHistJumpHandler = ({ model }) => {
    if (model instanceof WaypointModel) {
        if (model.getTargetWaypointId() != undefined) return 'jumpWaypoint';
        if (model.getBaseMessageId() != undefined) return 'jumpMessage';
        return 'stop';
    }
    // 消息游标: 挂了 waypoint 就往 waypoint 方向跳 否则沿 parent 继续
    if (model.getWaypointId() != undefined) return 'jumpWaypoint';
    return 'continue';
};

describe("Dialog-Domain waypoint 稀疏跳跃", () => {
    let manager: DBManager;
    let conversationModel: ConversationModel;
    let conversationId: string;

    beforeAll(async () => {
        manager = await setupTestDb();
    }, 30000);

    afterAll(async () => {
        await teardownTestDb(manager);
    }, 30000);

    beforeEach(async () => {
        conversationModel = await ConversationModel.create({ scene: TEST_SCENE });
        conversationId = conversationModel.getConversationId();
    });

    test("1. 不带 onJump 时 逐条回溯全部真实消息", async () => {
        const msgs = await createMsgChain(conversationId, 5, i => `msg${i}`);

        const list = await collectStream(DialogTemplate.createHistMessageStream({
            defineScene: TEST_DEFINE,
            conversationModel,
            messageModel: msgs[4],
        }));

        // 新→旧
        expect(list).toEqual(["msg4", "msg3", "msg2", "msg1", "msg0"]);
    });

    test("2. onJump 返回 continue 时 行为等同于无 waypoint", async () => {
        const msgs = await createMsgChain(conversationId, 3, i => `msg${i}`);
        const wp = await WaypointModel.create({
            conversation_id: conversationId,
            base_message_id: msgs[0].getMessageId(),
            segment_summary: "seg",
        });
        await msgs[2].updateData({ target_waypoint_id: wp.getWaypointId() });

        const list = await collectStream(DialogTemplate.createHistMessageStream({
            defineScene: TEST_DEFINE,
            conversationModel,
            messageModel: await MessageModel.load(msgs[2].getMessageId()) as MessageModel,
            onJump: () => 'continue',
        }));

        expect(list).toEqual(["msg2", "msg1", "msg0"]);
    });

    test("3. waypoint 侧返回 jumpWaypoint 时产出分段摘要 再落 msg 顺延", async () => {
        const msgs = await createMsgChain(conversationId, 6, i => `msg${i}`);
        // wpOld 落到 msg1 作为 waypoint 链末端
        const wpOld = await WaypointModel.create({
            conversation_id: conversationId,
            base_message_id: msgs[1].getMessageId(),
            segment_summary: "seg-old",
        });
        // wpNew 跳 wpOld 摘要代表被跳过的 msg4/3/2 段
        const wpNew = await WaypointModel.create({
            conversation_id: conversationId,
            target_waypoint_id: wpOld.getWaypointId(),
            segment_summary: "seg-new",
        });
        await msgs[5].updateData({ target_waypoint_id: wpNew.getWaypointId() });

        const list = await collectStream(DialogTemplate.createHistMessageStream({
            defineScene: TEST_DEFINE,
            conversationModel,
            messageModel: await MessageModel.load(msgs[5].getMessageId()) as MessageModel,
            onJump: ({ model }) => {
                if (model instanceof WaypointModel)
                    return model.getTargetWaypointId() != undefined ? 'jumpWaypoint' : 'jumpMessage';
                return model.getWaypointId() != undefined ? 'jumpWaypoint' : 'continue';
            },
        }));

        // msg5 保留 wpNew 产出分段摘要 wpOld 选跳消息 落到其建基消息 msg1 的上一条 msg0
        expect(list).toEqual(["msg5", "seg-new", "msg0"]);
    });

    test("4. waypoint 侧返回 jumpMessage 时不产出摘要 直接落 msg 顺延", async () => {
        const msgs = await createMsgChain(conversationId, 6, i => `msg${i}`);
        const wp = await WaypointModel.create({
            conversation_id: conversationId,
            base_message_id: msgs[1].getMessageId(),
            segment_summary: "seg-5-1",
        });
        await msgs[5].updateData({ target_waypoint_id: wp.getWaypointId() });

        const list = await collectStream(DialogTemplate.createHistMessageStream({
            defineScene: TEST_DEFINE,
            conversationModel,
            messageModel: await MessageModel.load(msgs[5].getMessageId()) as MessageModel,
            onJump: ({ model }) => {
                if (model instanceof WaypointModel) return 'jumpMessage';
                return model.getWaypointId() != undefined ? 'jumpWaypoint' : 'continue';
            },
        }));

        // 进入 waypoint 但选择跳消息 故无摘要 直接落到建基消息 msg1 的上一条 msg0
        expect(list).toEqual(["msg5", "msg0"]);
    });

    test("5. waypoint 链 多跳 分段摘要 + 末端全量摘要", async () => {
        const msgs = await createMsgChain(conversationId, 6, i => `msg${i}`);
        const wpOld = await WaypointModel.create({
            conversation_id: conversationId,
            segment_summary: "seg-old",
            full_summary: "full-old",
        });
        const wpNew = await WaypointModel.create({
            conversation_id: conversationId,
            target_waypoint_id: wpOld.getWaypointId(),
            segment_summary: "seg-new",
        });
        await msgs[5].updateData({ target_waypoint_id: wpNew.getWaypointId() });

        const list = await collectStream(DialogTemplate.createHistMessageStream({
            defineScene: TEST_DEFINE,
            conversationModel,
            messageModel: await MessageModel.load(msgs[5].getMessageId()) as MessageModel,
            onJump: defaultHandler,
        }));

        // 每个 waypoint 一次遍历只产出一种摘要: wpNew 出分段 末端 wpOld 出全量
        expect(list).toEqual(["msg5", "seg-new", "full-old"]);
    });

    test("6. 两个指针并存时 由调用方裁决优先级", async () => {
        const msgs = await createMsgChain(conversationId, 4, i => `msg${i}`);
        const wpOld = await WaypointModel.create({
            conversation_id: conversationId,
            segment_summary: "seg-old",
        });
        // 同时具备两个指针
        const wpBoth = await WaypointModel.create({
            conversation_id: conversationId,
            base_message_id: msgs[1].getMessageId(),
            target_waypoint_id: wpOld.getWaypointId(),
            segment_summary: "seg-both",
        });
        await msgs[3].updateData({ target_waypoint_id: wpBoth.getWaypointId() });

        const list = await collectStream(DialogTemplate.createHistMessageStream({
            defineScene: TEST_DEFINE,
            conversationModel,
            messageModel: await MessageModel.load(msgs[3].getMessageId()) as MessageModel,
            // 本次调用方在 waypoint 侧优先落 msg 而非 waypoint
            onJump: ({ model }) => {
                if (!(model instanceof WaypointModel))
                    return model.getWaypointId() != undefined ? 'jumpWaypoint' : 'continue';
                if (model.getBaseMessageId() != undefined) return 'jumpMessage';
                if (model.getTargetWaypointId() != undefined) return 'jumpWaypoint';
                return 'stop';
            },
        }));

        // 选跳消息 落到建基消息 msg1 的上一条 msg0 未走 waypoint 方向故没有 seg-both
        expect(list).toEqual(["msg3", "msg0"]);
    });

    test("7. waypoint 被删除后 消息侧引用悬垂 由自检清除并降级为普通回溯", async () => {
        const msgs = await createMsgChain(conversationId, 3, i => `msg${i}`);
        const wp = await WaypointModel.create({
            conversation_id: conversationId,
            segment_summary: "seg",
        });
        await msgs[2].updateData({ target_waypoint_id: wp.getWaypointId() });
        const waypointId = wp.getWaypointId();

        await WaypointModel.delete(waypointId);
        const reloaded = await DialogStore.getMessage(msgs[2].getMessageId(), { ignoreCache: true });
        expect(reloaded?.data.target_waypoint_id).toBeUndefined();

        const list = await collectStream(DialogTemplate.createHistMessageStream({
            defineScene: TEST_DEFINE,
            conversationModel,
            messageModel: await MessageModel.load(msgs[2].getMessageId()) as MessageModel,
            onJump: defaultHandler,
        }));

        expect(list).toEqual(["msg2", "msg1", "msg0"]);
    });

    test("8. 落点消息被删除后 checkTarget 清除指针", async () => {
        const msgs = await createMsgChain(conversationId, 3, i => `msg${i}`);
        const wp = await WaypointModel.create({
            conversation_id: conversationId,
            base_message_id: msgs[1].getMessageId(),
            segment_summary: "seg",
        });
        // 删除落点消息使其悬垂 msg2 为其子会被级联删除
        await DialogStore.deleteMessage(msgs[1].getMessageId());

        const loaded = await WaypointModel.load(wp.getWaypointId()) as WaypointModel;
        expect(loaded.getBaseMessageId()).toBe(msgs[1].getMessageId());

        const valid = await loaded.checkTarget();
        expect(valid.baseMessageId).toBeUndefined();
        expect(loaded.getBaseMessageId()).toBeUndefined();
    });

    test("9. waypoint 必须归属对话 目标不存在时报错", async () => {
        await expect(WaypointModel.create({
            conversation_id: conversationId,
            base_message_id: "not-exist-message",
            segment_summary: "seg",
        })).rejects.toBeDefined();

        await expect(WaypointModel.create({
            conversation_id: "not-exist-conv",
            segment_summary: "seg",
        })).rejects.toBeDefined();
    });

    test("10. createWaypoint 建基到当前消息自身并串联上一个 waypoint", async () => {
        const msgs = await createMsgChain(conversationId, 5, i => `msg${i}`);

        const first = await msgs[2].createWaypoint({ name: "wp-a", segmentSummary: "seg-a" });
        expect(first).toBeDefined();
        // 建基消息是当前消息自身 落点由回溯时取它的 parent 得出
        expect(first!.getBaseMessageId()).toBe(msgs[2].getMessageId());
        expect(first!.getTargetWaypointId()).toBeUndefined();
        expect(first!.getName()).toBe("wp-a");
        expect(first!.getSegmentSummary()).toBe("seg-a");

        const second = await msgs[4].createWaypoint({ name: "wp-b", segmentSummary: "seg-b" });
        expect(second).toBeDefined();
        expect(second!.getBaseMessageId()).toBe(msgs[4].getMessageId());
        // 向上回溯应串到 msg2 上的 wp-a
        expect(second!.getTargetWaypointId()).toBe(first!.getWaypointId());

        // 消息侧指针已挂上
        const reloaded = await MessageModel.load(msgs[4].getMessageId()) as MessageModel;
        expect(reloaded.getWaypointId()).toBe(second!.getWaypointId());
    });

    test("10.1 原地建 wp 后回溯应原地不动 不得跳过任何消息", async () => {
        const msgs = await createMsgChain(conversationId, 6, i => `msg${i}`);
        // 在当前消息上建 wp 且不带摘要 逐条回落
        await msgs[5].createWaypoint({ name: "self-wp" });

        const list = await collectStream(DialogTemplate.createHistMessageStream({
            defineScene: TEST_DEFINE,
            conversationModel,
            messageModel: await MessageModel.load(msgs[5].getMessageId()) as MessageModel,
            onJump: ({ model }) => {
                if (!(model instanceof WaypointModel))
                    return model.getWaypointId() != undefined ? 'jumpWaypoint' : 'continue';
                // 无摘要的 wp 一律回落消息
                return 'jumpMessage';
            },
        }));

        // 建基若错记成 parent 这里会丢掉 msg4 变成 msg5,msg3,...
        expect(list).toEqual(["msg5", "msg4", "msg3", "msg2", "msg1", "msg0"]);
    });

    test("11. createWaypoint 在首条消息上拒绝创建", async () => {
        const msgs = await createMsgChain(conversationId, 3, i => `msg${i}`);

        const onRoot = await msgs[0].createWaypoint({ name: "wp-root" });
        expect(onRoot).toBeUndefined();
        expect(await conversationModel.findWaypointByName("wp-root")).toBeUndefined();
    });

    test("12. createWaypoint 名字重复时拒绝创建", async () => {
        const msgs = await createMsgChain(conversationId, 5, i => `msg${i}`);
        const first = await msgs[2].createWaypoint({ name: "dup" });
        expect(first).toBeDefined();

        const second = await msgs[4].createWaypoint({ name: "dup" });
        expect(second).toBeUndefined();
        // 未产生第二个同名 waypoint
        expect(nameOf(await conversationModel.getWaypointList())).toEqual(["dup"]);
    });

    test("13. 按名运维 waypoint 并列出回溯路径", async () => {
        const msgs = await createMsgChain(conversationId, 6, i => `msg${i}`);
        await msgs[2].createWaypoint({ name: "old", segmentSummary: "seg-1" });
        await msgs[5].createWaypoint({ name: "new" });

        // 回溯路径由近及远 全量列表按写入顺序
        expect(nameOf(await msgs[5].getPathWaypointList())).toEqual(["new", "old"]);
        expect(nameOf(await conversationModel.getWaypointList())).toEqual(["old", "new"]);

        const target = await conversationModel.findWaypointByName("new");
        expect(target).toBeDefined();
        // 摘要设置与删除
        await target!.updateData({ segment_summary: "seg-new" });
        expect((await conversationModel.findWaypointByName("new"))!.getSegmentSummary()).toBe("seg-new");
        await target!.updateData({ segment_summary: undefined });
        expect((await conversationModel.findWaypointByName("new"))!.getSegmentSummary()).toBeUndefined();
        // 重命名
        await target!.setName("renamed");
        expect(await conversationModel.findWaypointByName("new")).toBeUndefined();
        expect(nameOf(await conversationModel.getWaypointList())).toEqual(["old", "renamed"]);
        // 删除
        await WaypointModel.delete(target!.getWaypointId());
        expect(nameOf(await conversationModel.getWaypointList())).toEqual(["old"]);
        // 删除后消息侧指针被触发器清理 回溯路径只剩 old
        expect(nameOf(await msgs[5].getPathWaypointList())).toEqual(["old"]);
    });

    test("14. 未命名 waypoint 的 getName 回落到 ID 且可按 ID 查找", async () => {
        const msgs = await createMsgChain(conversationId, 5, i => `msg${i}`);
        // createWaypoint 强制要名字 未命名只会来自直接建表或历史数据
        const waypoint = await WaypointModel.create({
            conversation_id: conversationId,
            base_message_id: msgs[2].getMessageId(),
            segment_summary: "无名字段",
        });
        await msgs[2].updateData({ target_waypoint_id: waypoint.getWaypointId() });
        const waypointId = waypoint.getWaypointId();

        // 没设名字时显示 ID 且 hasName 为假
        expect(waypoint.hasName()).toBe(false);
        expect(waypoint.getName()).toBe(waypointId);
        expect(nameOf(await conversationModel.getWaypointList())).toEqual([waypointId]);

        // 按 ID 也能查到 与按名等价
        const byId = await conversationModel.findWaypointByName(waypointId);
        expect(byId?.getWaypointId()).toBe(waypointId);

        // 设名后回落消失 按旧 ID 仍可查到
        await waypoint.setName("named-wp");
        expect(waypoint.hasName()).toBe(true);
        expect(waypoint.getName()).toBe("named-wp");
        expect(nameOf(await conversationModel.getWaypointList())).toEqual(["named-wp"]);
        const stillById = await conversationModel.findWaypointByName(waypointId);
        expect(stillById?.getName()).toBe("named-wp");
    });
});
