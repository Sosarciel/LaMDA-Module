import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { ConversationModel, MessageModel, FirstModel, DialogTemplate } from "@sosraciel-lamda/dialog-domain";
import type { CharScene } from "@sosraciel-lamda/charprofile-domain";
import { createTestScene, setupTestDb, teardownTestDb } from "./Util";

// ─── 共享常量 ───────────────────────────────────────────────
// 所有测试统一使用 2条memory + predialog 的标准场景结构，
// 避免因场景差异导致测试集碎片化。

/**标准场景（用于 ConversationModel.create）
 * 含 define + 2条memory + 1条predialog */
const TEST_SCENE = createTestScene();

/**标准 defineScene（用于 createHistMessageGraph / createCurrMessageGraph）
 * 含 define + 2条memory + 1条predialog */
const TEST_DEFINE = {
    define: "Define content",
    memory: [
        { type: "chat", content: "Define memory 1", sender_name: "System" },
        { type: "chat", content: "Define memory 2", sender_name: "System" },
    ],
    name: "test",
    dialog: [
        { type: "chat", content: "Define predialog 1", sender_name: "System" },
        { type: "chat", content: "Define predialog 2", sender_name: "System" },
    ],
} satisfies CharScene;

/**createCurrMessageGraph 断言用：define 常量块（desc + 2条memory，不计入预算） */
const DEFINE_DESC_AND_MEMORY = [
    { type: "desc", content: TEST_DEFINE.define },
    ...TEST_DEFINE.memory
] as const;

/**createCurrMessageGraph 断言用：scene 常量块（desc + 2条memory，不计入预算） */
const SCENE_DESC_AND_MEMORY = [
    { type: "desc", content: TEST_SCENE.define },
    ...TEST_SCENE.memory
] as const;

/**两者的predialog */
const PREDIALOG = [
    ...TEST_DEFINE.dialog,
    ...TEST_SCENE.dialog
] as const;

// ─── 测试工具 ───────────────────────────────────────────────

/**创建交替user/char的消息链
 * @param conversationId 对话ID
 * @param count 消息数量
 * @param contentFn 内容生成函数，参数为消息索引
 * @returns 消息模型数组（从旧到新）
 */
const createMsgChain = async (
    conversationId: string,
    count: number,
    contentFn: (i: number) => string,
): Promise<MessageModel[]> => {
    const messages: MessageModel[] = [];
    for (let i = 0; i < count; i++) {
        const msg = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: i === 0 ? undefined : messages[i - 1].getMessageId(),
            sender_id: i % 2 === 0 ? "user" : "char",
            sender_type: i % 2 === 0 ? "user" : "char",
            content: contentFn(i),
        });
        messages.push(msg);
    }
    return messages;
};

// ─── 测试集 ───────────────────────────────────────────────

describe("Dialog-Domain DialogTemplate 测试", () => {
    let manager: DBManager;

    beforeAll(async () => {
        manager = await setupTestDb();
    }, 30000);

    afterAll(async () => {
        await teardownTestDb(manager);
    }, 30000);

    /**验证 createHistMessageGraph 能正确遍历消息链并返回完整结构
     * 检查点：消息顺序（旧→新）、sender_id/type/content/id 全字段正确
     * 验证 predialog 出现在历史消息之前（Define → Scene → history） */
    test("1. 应成功测试DialogTemplate.createHistMessageGraph获取历史消息（强断言）", async () => {
        const conversationModel = await ConversationModel.create({ scene: TEST_SCENE });
        const conversationId = conversationModel.getConversationId();

        // 创建消息链：user → char → user
        const msg1 = await MessageModel.create({
            conversation_id: conversationId, parent_message_id: undefined,
            sender_id: "user", sender_type: "user", content: "User message 1"
        });
        const msg2 = await MessageModel.create({
            conversation_id: conversationId, parent_message_id: msg1.getMessageId(),
            sender_id: "char", sender_type: "char", content: "Character response 1"
        });
        const msg3 = await MessageModel.create({
            conversation_id: conversationId, parent_message_id: msg2.getMessageId(),
            sender_id: "user", sender_type: "user", content: "User message 2"
        });

        // createHistMessageGraph 返回：predialog(Define→Scene) + 历史消息
        const histMessages = await DialogTemplate.createHistMessageGraph({
            defineScene: TEST_DEFINE,
            maxBudget: { maxLength: 1000, maxCount: 10 },
            conversationModel,
            messageModel: msg3
        }).build();

        // 强断言：验证完整结构（predialog在前，历史消息在后）
        expect(histMessages).toEqual([
            ...PREDIALOG,
            { type: 'chat', sender_id: 'user', sender_type: 'user', content: 'User message 1', id: msg1.getMessageId() },
            { type: 'chat', sender_id: 'char', sender_type: 'char', content: 'Character response 1', id: msg2.getMessageId() },
            { type: 'chat', sender_id: 'user', sender_type: 'user', content: 'User message 2', id: msg3.getMessageId() },
        ]);
    });

    /**验证从 FirstModel（对话起点）获取历史消息时，只返回 predialog 不返回历史
     * 检查点：FirstModel 代表对话起点，此时无历史消息，
     * 应只返回 Define 和 Scene 的 predialog */
    test("2. 应成功测试DialogTemplate.createHistMessageGraph从FirstModel开始", async () => {
        const conversationModel = await ConversationModel.create({ scene: TEST_SCENE });
        const firstModel = await FirstModel.loadOrCreate(conversationModel);

        // 从 FirstModel 开始获取历史消息
        const histMessages = await DialogTemplate.createHistMessageGraph({
            defineScene: TEST_DEFINE,
            maxBudget: { maxLength: 1000, maxCount: 10 },
            conversationModel,
            messageModel: firstModel
        }).build();

        // 从 FirstModel 开始无历史消息，只返回 predialog
        expect(histMessages).toEqual([
            ...PREDIALOG,
        ]);
    });

    /**验证 createCurrMessageGraph 返回完整的上下文组装结果
     * 检查点：常量块(define/scene memory) → 背景信息 → 背景表单(按order排序) → predialog → 历史消息
     * 背景表单排序验证：ja(-5) → zh(默认0) → en(10) */
    test("3. 应成功测试DialogTemplate.createCurrMessageGraph完整流程", async () => {
        // 创建带完整场景的对话（2条memory）
        const testScene = {
            define: "Scene define content",
            memory: [
                { type: "chat", content: "Scene memory 1", sender_name: "System" },
                { type: "chat", content: "Scene memory 2", sender_name: "System" },
            ],
            name: "test_scene",
            dialog: [{ type: "chat", content: "Scene dialog 1", sender_name: "Character" }],
        } satisfies CharScene;
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 设置背景信息
        await conversationModel.updateData({ background_info: "Background info content" });
        // 设置背景表（混合纯字符串与带 order 的对象，验证排序）
        // zh: 纯字符串, order 默认 0; en: 对象, order=10; ja: 对象, order=-5
        // 期望排序：ja(-5) → zh(0) → en(10)
        await conversationModel.setBackgroundTableEntry("zh", "中文背景");
        await conversationModel.setBackgroundTableEntry("en", { content: "English background", order: 10 });
        await conversationModel.setBackgroundTableEntry("ja", { content: "日本語背景", order: -5 });

        await FirstModel.loadOrCreate(conversationModel);
        const msg1 = await MessageModel.create({
            conversation_id: conversationId, parent_message_id: undefined,
            sender_id: "user", sender_type: "user", content: "User message"
        });
        const msg2 = await MessageModel.create({
            conversation_id: conversationId, parent_message_id: msg1.getMessageId(),
            sender_id: "char", sender_type: "char", content: "Character response"
        });

        // 自定义 defineScene（与 FULL_DEFINE_SCENE 不同，用于验证内容透传）
        const defineScene = {
            define: "Define scene content",
            memory: [
                { type: "chat", content: "Define memory 1", sender_name: "System" },
                { type: "chat", content: "Define memory 2", sender_name: "System" },
            ],
            name: "define",
            dialog: [{ type: "chat", content: "Define dialog 1", sender_name: "System" }],
        } satisfies CharScene;

        const messageList = await DialogTemplate.createCurrMessageGraph({
            defineScene,
            maxBudget: { maxLength: 10000, maxCount: 100 },
            conversationModel,
            messageModel: msg2
        }).build();

        // 强断言：验证完整组装结构
        expect(messageList).toEqual([
            // 定义常量块（不计入预算）
            { type: "desc", content: "Define scene content" },
            { type: "chat", content: "Define memory 1", sender_name: "System" },
            { type: "chat", content: "Define memory 2", sender_name: "System" },
            // 场景常量块（不计入预算）
            { type: "desc", content: "Scene define content" },
            { type: "chat", content: "Scene memory 1", sender_name: "System" },
            { type: "chat", content: "Scene memory 2", sender_name: "System" },
            // 背景信息
            { type: "desc", content: "Background info content" },
            // 背景表单按 order 排序：ja(-5) → zh(0) → en(10)
            { type: "desc", content: "ja:\n日本語背景" },
            { type: "desc", content: "zh:\n中文背景" },
            { type: "desc", content: "en:\nEnglish background" },
            // predialog（Define 在前，Scene 在后）
            { type: "chat", content: "Define dialog 1", sender_name: "System" },
            { type: "chat", content: "Scene dialog 1", sender_name: "Character" },
            // 历史消息
            { type: "chat", sender_id: "user", sender_type: "user", content: "User message", id: msg1.getMessageId() },
            { type: "chat", sender_id: "char", sender_type: "char", content: "Character response", id: msg2.getMessageId() },
        ]);
    });

    /**验证 maxLength 预算耗尽时的截断行为
     * 检查点：当历史消息总长度超过 maxLength 时，旧消息被截断；
     * predialog 因流顺序（history → scene_predilog → define_predilog）在后，
     * budget 耗尽时不产出 */
    test("4. 应成功测试maxLength限制触发时的截断行为（含memory+predialog）", async () => {
        const conversationModel = await ConversationModel.create({ scene: TEST_SCENE });
        await FirstModel.loadOrCreate(conversationModel);

        // 创建10条消息，每条约50字符（总长约500字符）
        const messages = await createMsgChain(
            conversationModel.getConversationId(), 10,
            i => `Message number ${i} with some extra content to make it longer`,
        );

        // 设置较小的 maxLength=200，只能容纳约3条消息
        const histMessages = await DialogTemplate.createHistMessageGraph({
            defineScene: TEST_DEFINE,
            maxBudget: { maxLength: 200, maxCount: 100 },
            conversationModel,
            messageModel: messages[messages.length - 1]
        }).build();

        // 强断言：验证完整结构（predialog 因 budget 耗尽未产出）
        expect(histMessages).toEqual([
            { type: "chat", sender_id: "char", sender_type: "char", content: "Message number 7 with some extra content to make it longer", id: messages[7].getMessageId() },
            { type: "chat", sender_id: "user", sender_type: "user", content: "Message number 8 with some extra content to make it longer", id: messages[8].getMessageId() },
            { type: "chat", sender_id: "char", sender_type: "char", content: "Message number 9 with some extra content to make it longer", id: messages[9].getMessageId() },
        ]);
    });

    /**验证 maxCount 预算耗尽时的截断行为
     * 检查点：当历史消息条数超过 maxCount 时，旧消息被截断；
     * predialog 因流顺序在后，maxCount 耗尽时不产出 */
    test("5. 应成功测试maxCount限制触发时的截断行为（含memory+predialog）", async () => {
        const conversationModel = await ConversationModel.create({ scene: TEST_SCENE });
        await FirstModel.loadOrCreate(conversationModel);

        const messages = await createMsgChain(
            conversationModel.getConversationId(), 10,
            i => `Message ${i}`,
        );

        // 设置 maxCount=3，只能保留最近3条历史
        const histMessages = await DialogTemplate.createHistMessageGraph({
            defineScene: TEST_DEFINE,
            maxBudget: { maxLength: 10000, maxCount: 3 },
            conversationModel,
            messageModel: messages[messages.length - 1]
        }).build();

        // 强断言：验证完整结构（predialog 因 maxCount 耗尽未产出）
        expect(histMessages).toEqual([
            { type: "chat", sender_id: "char", sender_type: "char", content: "Message 7", id: messages[7].getMessageId() },
            { type: "chat", sender_id: "user", sender_type: "user", content: "Message 8", id: messages[8].getMessageId() },
            { type: "chat", sender_id: "char", sender_type: "char", content: "Message 9", id: messages[9].getMessageId() },
        ]);
    });

    /**验证15层深度消息链的完整遍历
     * 检查点：所有15条消息按正确顺序返回；
     * 每条消息的 sender/content/id 全字段正确；
     * 额外验证 parent_message_id 链的正确性（DB层面） */
    test("6. 应成功测试深度消息链遍历", async () => {
        const conversationModel = await ConversationModel.create({ scene: TEST_SCENE });
        await FirstModel.loadOrCreate(conversationModel);

        // 创建15层深度的消息链
        const messages = await createMsgChain(
            conversationModel.getConversationId(), 15,
            i => `Deep message level ${i}`,
        );

        const histMessages = await DialogTemplate.createHistMessageGraph({
            defineScene: TEST_DEFINE,
            maxBudget: { maxLength: 10000, maxCount: 100 },
            conversationModel,
            messageModel: messages[messages.length - 1]
        }).build();

        // 强断言：predialog + 15条消息的完整结构
        expect(histMessages).toEqual([
            ...PREDIALOG,
            ...Array.from({ length: 15 }, (_, i) => ({
                type: "chat",
                sender_id: i % 2 === 0 ? "user" : "char",
                sender_type: i % 2 === 0 ? "user" : "char",
                content: `Deep message level ${i}`,
                id: messages[i].getMessageId(),
                premise: undefined,
            })),
        ]);

        // 额外验证：消息ID链的正确性（DB层面的 parent_message_id）
        for (let i = 1; i < messages.length; i++) {
            const loadedMsg = await MessageModel.load(messages[i].getMessageId());
            expect(loadedMsg?.getPreMessageId()).toBe(messages[i - 1].getMessageId());
        }
    });

    /**验证 onIntercept 的 include 截断行为
     * 检查点：onIntercept 返回 'include' 时，命中消息计入链但流终止；
     * 流顺序为 traverseUp(msg4→msg3→msg2) → scene_predilog → define_predilog，
     * msg2 命中 include 后截断，后续 predialog 不再产出 */
    test("10. 应成功测试onIntercept的include截断（命中计入链）（含memory+predialog）", async () => {
        const conversationModel = await ConversationModel.create({ scene: TEST_SCENE });
        await FirstModel.loadOrCreate(conversationModel);
        const messages = await createMsgChain(
            conversationModel.getConversationId(), 5,
            i => `Intercept test msg ${i}`,
        );

        // onIntercept 在 msg2 命中include后截断，predialog不再产出
        const histMessages = await DialogTemplate.createHistMessageGraph({
            defineScene: TEST_DEFINE,
            maxBudget: { maxLength: 10000, maxCount: 100 },
            conversationModel,
            messageModel: messages[4],
            onIntercept: (msg) => msg.content.includes("msg 2") ? 'include' : 'continue'
        }).build();

        // 强断言：include 截断后 predialog 不出现（流在 onIntercept 处终止）
        expect(histMessages).toEqual([
            { type: "chat", sender_id: "user", sender_type: "user", content: "Intercept test msg 2", id: messages[2].getMessageId() },
            { type: "chat", sender_id: "char", sender_type: "char", content: "Intercept test msg 3", id: messages[3].getMessageId() },
            { type: "chat", sender_id: "user", sender_type: "user", content: "Intercept test msg 4", id: messages[4].getMessageId() },
        ]);
    });

    /**验证 onIntercept 的 reject 截断行为
     * 检查点：onIntercept 返回 'reject' 时，命中消息不计入链且流终止；
     * 与 include 不同，reject 不将命中消息加入结果 */
    test("11. 应成功测试onIntercept的reject截断（命中不计入链）（含memory+predialog）", async () => {
        const conversationModel = await ConversationModel.create({ scene: TEST_SCENE });
        await FirstModel.loadOrCreate(conversationModel);
        const messages = await createMsgChain(
            conversationModel.getConversationId(), 5,
            i => `Reject test msg ${i}`,
        );

        // onIntercept 在 msg2 命中reject后截断，predialog不再产出
        const histMessages = await DialogTemplate.createHistMessageGraph({
            defineScene: TEST_DEFINE,
            maxBudget: { maxLength: 10000, maxCount: 100 },
            conversationModel,
            messageModel: messages[4],
            onIntercept: (msg) => msg.content.includes("msg 2") ? 'reject' : 'continue'
        }).build();

        expect(histMessages).toEqual([
            { type: "chat", sender_id: "char", sender_type: "char", content: "Reject test msg 3", id: messages[3].getMessageId() },
            { type: "chat", sender_id: "user", sender_type: "user", content: "Reject test msg 4", id: messages[4].getMessageId() },
        ]);
    });

    /**验证 onIntercept 返回 continue 时不截断
     * 检查点：全部5条历史消息应返回；predialog 应出现在历史消息之前（Define → Scene）；
     * 这是 onIntercept 正常工作时的基准行为 */
    test("12. 应成功测试onIntercept的continue不截断（含memory+predialog）", async () => {
        const conversationModel = await ConversationModel.create({ scene: TEST_SCENE });
        await FirstModel.loadOrCreate(conversationModel);
        const messages = await createMsgChain(
            conversationModel.getConversationId(), 5,
            i => `Continue test msg ${i}`,
        );

        // continue不截断，全部5条历史 + predialog 应返回
        const histMessages = await DialogTemplate.createHistMessageGraph({
            defineScene: TEST_DEFINE,
            maxBudget: { maxLength: 10000, maxCount: 100 },
            conversationModel,
            messageModel: messages[4],
            onIntercept: () => 'continue'
        }).build();

        expect(histMessages).toEqual([
            ...PREDIALOG,
            ...messages.map(msg => ({
                type: "chat",
                sender_id: msg.getSenderId(),
                sender_type: msg.getSenderId() === "user" ? "user" : "char",
                content: msg.getContent(),
                id: msg.getMessageId(),
            })),
        ]);
    });

    /**验证 onIntercept 的优先级：maxCount 截断先于 onIntercept 执行
     * 检查点：maxCount=2 只保留最近2条历史，onIntercept 在此之前已被截断；
     * 即使 onIntercept 未触发，budget 耗尽后 predialog 也不产出 */
    test("13. 应成功测试onIntercept在length/count限制之后调用（含memory+predialog）", async () => {
        const conversationModel = await ConversationModel.create({ scene: TEST_SCENE });
        await FirstModel.loadOrCreate(conversationModel);
        const messages = await createMsgChain(
            conversationModel.getConversationId(), 5,
            i => `Priority test msg ${i}`,
        );

        // maxCount=2 优先于 onIntercept
        const histMessages = await DialogTemplate.createHistMessageGraph({
            defineScene: TEST_DEFINE,
            maxBudget: { maxLength: 10000, maxCount: 2 },
            conversationModel,
            messageModel: messages[4],
            onIntercept: (msg) => msg.content.includes("msg 2") ? 'include' : 'continue'
        }).build();

        expect(histMessages).toEqual([
            { type: "chat", sender_id: "char", sender_type: "char", content: "Priority test msg 3", id: messages[3].getMessageId() },
            { type: "chat", sender_id: "user", sender_type: "user", content: "Priority test msg 4", id: messages[4].getMessageId() },
        ]);
    });

    /**验证 createCurrMessageGraph 的 maxCount 仅约束 hist-graph 部分
     * 检查点：memory 是 constant 块，不计入 maxCount 预算；
     * maxCount=3 时，history 占满3条后 predilog 未产出（流顺序：history → scene_predilog → define_predilog） */
    test("20. createCurrMessageGraph的maxCount应仅约束hist部分，不包含memory（强断言）", async () => {
        const conversationModel = await ConversationModel.create({ scene: TEST_SCENE });
        await FirstModel.loadOrCreate(conversationModel);
        const messages = await createMsgChain(
            conversationModel.getConversationId(), 5,
            i => `Hist msg ${i}`,
        );

        // maxCount=3: history占满3条，predialog未产出；memory是constant不计入
        const messageList = await DialogTemplate.createCurrMessageGraph({
            defineScene: TEST_DEFINE,
            maxBudget: { maxLength: 10000, maxCount: 3 },
            conversationModel,
            messageModel: messages[4]
        }).build();

        // 强断言：常量块(2define memory + 2scene memory) + 3条history
        expect(messageList).toEqual([
            ...DEFINE_DESC_AND_MEMORY,
            ...SCENE_DESC_AND_MEMORY,
            { type: "chat", sender_id: "user", sender_type: "user", content: "Hist msg 2", id: messages[2].getMessageId(), premise: undefined },
            { type: "chat", sender_id: "char", sender_type: "char", content: "Hist msg 3", id: messages[3].getMessageId(), premise: undefined },
            { type: "chat", sender_id: "user", sender_type: "user", content: "Hist msg 4", id: messages[4].getMessageId(), premise: undefined },
        ]);
    });

    /**验证 createCurrMessageGraph 的 onIntercept 截断后 memory 仍然存在
     * 检查点：onIntercept reject 后流终止，predialog 不产出；
     * memory 是 constant 块，不受截断影响 */
    test("21. createCurrMessageGraph的onIntercept截断后memory仍应存在，predialog不应出现（强断言）", async () => {
        const conversationModel = await ConversationModel.create({ scene: TEST_SCENE });
        await FirstModel.loadOrCreate(conversationModel);
        const messages = await createMsgChain(
            conversationModel.getConversationId(), 5,
            i => `Intercept curr msg ${i}`,
        );

        // onIntercept reject msg2后流终止，predialog不产出；memory是constant不受影响
        const messageList = await DialogTemplate.createCurrMessageGraph({
            defineScene: TEST_DEFINE,
            maxBudget: { maxLength: 10000, maxCount: 100 },
            conversationModel,
            messageModel: messages[4],
            onIntercept: (msg) => msg.content.includes("msg 2") ? 'reject' : 'continue'
        }).build();

        expect(messageList).toEqual([
            ...DEFINE_DESC_AND_MEMORY,
            ...SCENE_DESC_AND_MEMORY,
            { type: "chat", sender_id: "char", sender_type: "char", content: "Intercept curr msg 3", id: messages[3].getMessageId() },
            { type: "chat", sender_id: "user", sender_type: "user", content: "Intercept curr msg 4", id: messages[4].getMessageId() },
        ]);
    });
});
