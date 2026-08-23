import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { ConversationModel, MessageModel, FirstModel, DialogHelper } from "@sosraciel-lamda/dialog-domain";
import { createTestScene, setupTestDb, teardownTestDb } from "./Util";

describe("Dialog-Domain DialogHelper 测试", () => {
    let manager: DBManager;

    beforeAll(async () => {
        manager = await setupTestDb();
    }, 30000);

    afterAll(async () => {
        await teardownTestDb(manager);
    }, 30000);

    test("20. 应成功测试DialogHelper.getHistMessageList获取历史消息（强断言）", async () => {
        // 创建无预对话的场景，便于精确验证
        const testScene = {
            define: "strong_assert_test",
            memory: [],
            name: "test_scene",
            dialog: []
        };
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 创建FirstModel
        const firstModel = await FirstModel.loadOrCreate(conversationModel);

        // 创建消息链：user -> char -> user
        const msg1 = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user",
            sender_type: "user",
            content: "User message 1"
        });

        const msg2 = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: msg1.getMessageId(),
            sender_id: "char",
            sender_type: "char",
            content: "Character response 1"
        });

        const msg3 = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: msg2.getMessageId(),
            sender_id: "user",
            sender_type: "user",
            content: "User message 2"
        });

        // 定义无预对话的场景
        const defineScene = {
            define: "strong_assert_test",
            memory: [],
            name: "test",
            dialog: []
        };

        // 获取历史消息列表
        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxBudget: { maxLength: 1000, maxCount: 10 },
            conversationModel: conversationModel,
            messageModel: msg3
        });

        // 验证返回的是数组
        expect(Array.isArray(histMessages)).toBe(true);
        expect(histMessages.length).toBe(3);

        // 强断言验证
        expect(histMessages).toEqual([
            {
                type: 'chat',
                sender_id: 'user',
                sender_type: 'user',
                content: 'User message 1',
                id: msg1.getMessageId(),
            },
            {
                type: 'chat',
                sender_id: 'char',
                sender_type: 'char',
                content: 'Character response 1',
                id: msg2.getMessageId(),
            },
            {
                type: 'chat',
                sender_id: 'user',
                sender_type: 'user',
                content: 'User message 2',
                id: msg3.getMessageId(),
            }
        ]);
    });

    test("21. 应成功测试DialogHelper.getHistMessageList从FirstModel开始", async () => {
        // 创建带预对话的场景
        const testScene = {
            define: "first_model_test",
            memory: [],
            name: "test_scene",
            dialog: [
                { type: "chat" as const, content: "Opening line from scene", sender_name: "Character" }
            ]
        };
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 创建FirstModel
        const firstModel = await FirstModel.loadOrCreate(conversationModel);

        // 创建用户消息（在FirstModel之后）
        const msg1 = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user",
            sender_type: "user",
            content: "User message after first"
        });

        // 定义场景
        const defineScene = {
            define: "define_test",
            memory: [],
            name: "define",
            dialog: [
                { type: "chat" as const, content: "Define opening", sender_name: "System" }
            ]
        };

        // 从FirstModel开始获取历史消息
        // FirstModel代表对话起点，此时应只返回场景预对话
        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxBudget: { maxLength: 1000, maxCount: 10 },
            conversationModel: conversationModel,
            messageModel: firstModel
        });

        // 验证返回的是数组
        expect(Array.isArray(histMessages)).toBe(true);
        expect(histMessages).toEqual([
            { type: "chat", content: "Define opening", sender_name: "System" },
            {
                type: "chat",
                content: "Opening line from scene",
                sender_name: "Character",
            },
        ]);
    });

    test("22. 应成功测试DialogHelper.getDialogPos和getDialogPosId", async () => {
        // 创建对话和消息
        const testScene = createTestScene();
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        const messageModel = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user",
            sender_type: "user",
            content: "Test message for pos"
        });

        // 获取对话位置ID
        const posId = DialogHelper.getDialogPosId({
            messageModel: messageModel,
            conversationModel: conversationModel
        });

        // 强断言：验证posId完整结构
        expect(posId).toEqual({
            conversationId: conversationId,
            messageId: messageModel.getMessageId(),
        });

        // 通过位置ID恢复对话位置
        const retrievedPos = await DialogHelper.getDialogPos(posId);
        expect(retrievedPos).toBeDefined();
        // 强断言：验证恢复后的位置完整结构
        expect(retrievedPos?.conversationModel.getConversationId()).toBe(conversationId);
        expect(retrievedPos?.messageModel.getMessageId()).toBe(messageModel.getMessageId());
    });

    test("24. 应成功测试DialogHelper.getCurrMessageList完整流程", async () => {
        // 创建带完整场景的对话
        const testScene = {
            define: "Scene define content",
            memory: [
                { type: "chat" as const, content: "Scene memory 1", sender_name: "System" },
                { type: "chat" as const, content: "Scene memory 2", sender_name: "System" }
            ],
            name: "test_scene",
            dialog: [
                { type: "chat" as const, content: "Scene dialog 1", sender_name: "Character" }
            ]
        };
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 设置背景信息
        await conversationModel.updateData({ background_info: "Background info content" });

        // 设置背景表（混合纯字符串与带 order 的对象，验证排序）
        // zh: 纯字符串, order 默认 0
        // en: 对象, order=10
        // ja: 对象, order=-5
        // 期望排序：ja(-5) → zh(0) → en(10)
        await conversationModel.setBackgroundTableEntry("zh", "中文背景");
        await conversationModel.setBackgroundTableEntry("en", { content: "English background", order: 10 });
        await conversationModel.setBackgroundTableEntry("ja", { content: "日本語背景", order: -5 });

        // 创建FirstModel和消息链
        const firstModel = await FirstModel.loadOrCreate(conversationModel);
        const msg1 = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: undefined,
            sender_id: "user",
            sender_type: "user",
            content: "User message"
        });
        const msg2 = await MessageModel.create({
            conversation_id: conversationId,
            parent_message_id: msg1.getMessageId(),
            sender_id: "char",
            sender_type: "char",
            content: "Character response"
        });

        // 定义defineScene
        const defineScene = {
            define: "Define scene content",
            memory: [
                { type: "chat" as const, content: "Define memory 1", sender_name: "System" }
            ],
            name: "define",
            dialog: [
                { type: "chat" as const, content: "Define dialog 1", sender_name: "System" }
            ]
        };

        // 获取当前消息列表
        const messageList = await DialogHelper.getCurrMessageList({
            defineScene,
            maxBudget: { maxLength: 10000, maxCount: 100 },
            conversationModel: conversationModel,
            messageModel: msg2
        });

        // 验证返回结果
        expect(messageList).toBeDefined();
        expect(Array.isArray(messageList)).toBe(true);

        console.log("=== Test 24 getCurrMessageList actual output ===");
        console.log(JSON.stringify(messageList, null, 2));

        //强断言
        expect(messageList).toEqual([
            // 内容与记忆
            { type: "desc", content: "Define scene content" }, // 定义内容
            { type: "chat", content: "Define memory 1", sender_name: "System" }, // 定义记忆
            { type: "desc", content: "Scene define content" }, // 场景内容
            { type: "chat", content: "Scene memory 1", sender_name: "System" },// 场景记忆1
            { type: "chat", content: "Scene memory 2", sender_name: "System" },// 场景记忆2
            // 背景
            { type: "desc", content: "Background info content" }, // 背景信息
            // 背景表单 按order排序
            // ja(order=-5) → zh(纯字符串,order默认0) → en(order=10)
            { type: "desc", content: "ja:\n日本語背景" },
            { type: "desc", content: "zh:\n中文背景" },
            { type: "desc", content: "en:\nEnglish background" },
            //预对话
            { type: "chat", content: "Define dialog 1", sender_name: "System" }, // 定义预对话
            { type: "chat", content: "Scene dialog 1", sender_name: "Character" },// 场景预对话
            //聊天消息
            {
                type: "chat",
                sender_id: "user",
                sender_type: "user",
                content: "User message",
                id: msg1.getMessageId(),
            },
            {
                type: "chat",
                sender_id: "char",
                sender_type: "char",
                content: "Character response",
                id: msg2.getMessageId(),
            },
        ]);
    });

    test("25. 应成功测试DialogHelper.renderMessageList渲染逻辑", async () => {
        // 创建未渲染消息列表
        const unrenderedList = [
            { type: 'desc' as const, content: "System description" },
            { type: 'chat' as const, sender_id: "user1", sender_type: "user" as const, content: "User message", id: "msg1" },
            { type: 'chat' as const, sender_id: "char1", sender_type: "char" as const, content: "Char message", id: "msg2" },
            { type: 'chat' as const, sender_name: "Narrator", content: "Already rendered message" }
        ];

        // 渲染函数：将sender_id转换为sender_name
        const renderFunc = async (msg: { sender_id: string; sender_type: string; content: string }) => {
            const nameMap: Record<string, string> = {
                "user1": "Alice",
                "char1": "Bob"
            };
            return {
                type: 'chat' as const,
                content: msg.content,
                sender_name: nameMap[msg.sender_id] ?? msg.sender_id
            };
        };

        // 执行渲染
        const renderedList = await DialogHelper.renderMessageList({
            list: unrenderedList,
            render: renderFunc
        });

        // 验证渲染结果
        expect(renderedList.length).toBe(4);

        // 验证desc消息保持不变
        expect(renderedList[0]).toEqual({ type: 'desc', content: "System description" });

        // 验证未渲染消息被正确渲染
        expect(renderedList[1]).toEqual({ type: 'chat', content: "User message", sender_name: "Alice" });
        expect(renderedList[2]).toEqual({ type: 'chat', content: "Char message", sender_name: "Bob" });

        // 验证已渲染消息保持不变
        expect(renderedList[3]).toEqual({ type: 'chat', content: "Already rendered message", sender_name: "Narrator" });
    });

    test("26. 应成功测试maxLength限制触发时的截断行为（含memory+predialog）", async () => {
        // 创建带memory和dialog的场景
        const testScene = {
            define: "Scene define",
            memory: [
                { type: "chat" as const, content: "Scene memory 1", sender_name: "System" },
                { type: "chat" as const, content: "Scene memory 2", sender_name: "System" },
            ],
            name: "test",
            dialog: [
                { type: "chat" as const, content: "Scene predialog", sender_name: "Character" },
            ],
        };
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 创建FirstModel
        await FirstModel.loadOrCreate(conversationModel);

        // 创建多条消息，每条约50字符
        const messages: MessageModel[] = [];
        for (let i = 0; i < 10; i++) {
            const msg = await MessageModel.create({
                conversation_id: conversationId,
                parent_message_id: i === 0 ? undefined : messages[i - 1].getMessageId(),
                sender_id: i % 2 === 0 ? "user" : "char",
                sender_type: i % 2 === 0 ? "user" : "char",
                content: `Message number ${i} with some extra content to make it longer`
            });
            messages.push(msg);
        }

        // 定义带memory和dialog的场景
        const defineScene = {
            define: "Define content",
            memory: [
                { type: "chat" as const, content: "Define memory 1", sender_name: "System" },
            ],
            name: "test",
            dialog: [
                { type: "chat" as const, content: "Define predialog", sender_name: "System" },
            ],
        };

        // 设置较小的maxLength
        const smallMaxLength = 200;

        // 获取历史消息
        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxBudget: { maxLength: smallMaxLength, maxCount: 100 },
            conversationModel: conversationModel,
            messageModel: messages[messages.length - 1]
        });

        console.log("=== Test 26 getHistMessageList actual output ===");
        console.log(JSON.stringify(histMessages, null, 2));

        // 强断言：验证完整结构（predialog因budget耗尽未产出）
        expect(histMessages).toEqual([
            {
                type: "chat",
                sender_id: "char",
                sender_type: "char",
                content: "Message number 7 with some extra content to make it longer",
                id: messages[7].getMessageId(),
            },
            {
                type: "chat",
                sender_id: "user",
                sender_type: "user",
                content: "Message number 8 with some extra content to make it longer",
                id: messages[8].getMessageId(),
            },
            {
                type: "chat",
                sender_id: "char",
                sender_type: "char",
                content: "Message number 9 with some extra content to make it longer",
                id: messages[9].getMessageId(),
            },
        ]);
    });

    test("27. 应成功测试maxCount限制触发时的截断行为（含memory+predialog）", async () => {
        // 创建带memory和dialog的场景
        const testScene = {
            define: "Scene define",
            memory: [
                { type: "chat" as const, content: "Scene memory 1", sender_name: "System" },
            ],
            name: "test",
            dialog: [
                { type: "chat" as const, content: "Scene predialog", sender_name: "Character" },
            ],
        };
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 创建FirstModel
        await FirstModel.loadOrCreate(conversationModel);

        // 创建10条消息
        const messages: MessageModel[] = [];
        for (let i = 0; i < 10; i++) {
            const msg = await MessageModel.create({
                conversation_id: conversationId,
                parent_message_id: i === 0 ? undefined : messages[i - 1].getMessageId(),
                sender_id: i % 2 === 0 ? "user" : "char",
                sender_type: i % 2 === 0 ? "user" : "char",
                content: `Message ${i}`
            });
            messages.push(msg);
        }

        // 定义带memory和dialog的场景
        const defineScene = {
            define: "Define content",
            memory: [
                { type: "chat" as const, content: "Define memory 1", sender_name: "System" },
            ],
            name: "test",
            dialog: [
                { type: "chat" as const, content: "Define predialog", sender_name: "System" },
            ],
        };

        // 设置maxCount为3
        const smallMaxCount = 3;

        // 获取历史消息
        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxBudget: { maxLength: 10000, maxCount: smallMaxCount },
            conversationModel: conversationModel,
            messageModel: messages[messages.length - 1]
        });

        console.log("=== Test 27 getHistMessageList actual output ===");
        console.log(JSON.stringify(histMessages, null, 2));

        // 强断言：验证完整结构（predialog因maxCount耗尽未产出）
        expect(histMessages).toEqual([
            {
                type: "chat",
                sender_id: "char",
                sender_type: "char",
                content: "Message 7",
                id: messages[7].getMessageId(),
            },
            {
                type: "chat",
                sender_id: "user",
                sender_type: "user",
                content: "Message 8",
                id: messages[8].getMessageId(),
            },
            {
                type: "chat",
                sender_id: "char",
                sender_type: "char",
                content: "Message 9",
                id: messages[9].getMessageId(),
            },
        ]);
    });

    test("30. 应成功测试深度消息链遍历", async () => {
        // 创建无预对话的场景
        const testScene = { define: "", memory: [], name: "test", dialog: [] };
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();

        // 创建FirstModel
        const firstModel = await FirstModel.loadOrCreate(conversationModel);

        // 创建15层深度的消息链
        const messages: MessageModel[] = [];
        for (let i = 0; i < 15; i++) {
            const msg = await MessageModel.create({
                conversation_id: conversationId,
                parent_message_id: i === 0 ? undefined : messages[i - 1].getMessageId(),
                sender_id: i % 2 === 0 ? "user" : "char",
                sender_type: i % 2 === 0 ? "user" : "char",
                content: `Deep message level ${i}`
            });
            messages.push(msg);
        }

        // 定义场景
        const defineScene = { define: "", memory: [], name: "test", dialog: [] };

        // 获取历史消息
        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxBudget: { maxLength: 10000, maxCount: 100 },
            conversationModel: conversationModel,
            messageModel: messages[messages.length - 1]
        });

        // 验证消息链完整性
        console.log("=== Test 30 getHistMessageList actual output ===");
        console.log(JSON.stringify(histMessages, null, 2));

        // 强断言：完整结构验证15条消息
        expect(histMessages).toEqual([
            ...Array.from({ length: 15 }, (_, i) => ({
                type: "chat",
                sender_id: i % 2 === 0 ? "user" : "char",
                sender_type: i % 2 === 0 ? "user" : "char",
                content: `Deep message level ${i}`,
                id: messages[i].getMessageId(),
                premise: undefined,
            })),
        ]);

        // 验证消息ID链的正确性
        for (let i = 1; i < messages.length; i++) {
            const loadedMsg = await MessageModel.load(messages[i].getMessageId());
            expect(loadedMsg?.getPreMessageId()).toBe(messages[i - 1].getMessageId());
        }
    });

    test("40. 应成功测试onIntercept的include截断（命中计入链）（含memory+predialog）", async () => {
        // 创建带memory和dialog的场景
        const testScene = {
            define: "Scene define",
            memory: [
                { type: "chat" as const, content: "Scene memory 1", sender_name: "System" },
            ],
            name: "test",
            dialog: [
                { type: "chat" as const, content: "Scene predialog", sender_name: "Character" },
            ],
        };
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();
        await FirstModel.loadOrCreate(conversationModel);

        // 创建5条消息链
        const messages: MessageModel[] = [];
        for (let i = 0; i < 5; i++) {
            const msg = await MessageModel.create({
                conversation_id: conversationId,
                parent_message_id: i === 0 ? undefined : messages[i - 1].getMessageId(),
                sender_id: i % 2 === 0 ? "user" : "char",
                sender_type: i % 2 === 0 ? "user" : "char",
                content: `Intercept test msg ${i}`
            });
            messages.push(msg);
        }

        const defineScene = {
            define: "Define content",
            memory: [
                { type: "chat" as const, content: "Define memory 1", sender_name: "System" },
            ],
            name: "test",
            dialog: [
                { type: "chat" as const, content: "Define predialog", sender_name: "System" },
            ],
        };

        // onIntercept 在 msg2 命中返回 'include'：msg2计入链并截断
        // stream顺序：traverseUp(msg4→msg3→msg2) → scene_predialog → define_predialog
        // onIntercept 作用于无sender_name的chat消息
        // msg2命中include后截断，后续scene/define predialog不再产出
        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxBudget: { maxLength: 10000, maxCount: 100 },
            conversationModel: conversationModel,
            messageModel: messages[4],
            onIntercept: (msg) => msg.content.includes("msg 2") ? 'include' : 'continue'
        });

        console.log("=== Test 40 getHistMessageList actual output ===");
        console.log(JSON.stringify(histMessages, null, 2));

        // 强断言：include截断后predialog不应出现（流在onIntercept处终止）
        expect(histMessages).toEqual([
            {
                type: "chat",
                sender_id: "user",
                sender_type: "user",
                content: "Intercept test msg 2",
                id: messages[2].getMessageId(),
            },
            {
                type: "chat",
                sender_id: "char",
                sender_type: "char",
                content: "Intercept test msg 3",
                id: messages[3].getMessageId(),
            },
            {
                type: "chat",
                sender_id: "user",
                sender_type: "user",
                content: "Intercept test msg 4",
                id: messages[4].getMessageId(),
            },
        ]);
    });

    test("41. 应成功测试onIntercept的reject截断（命中不计入链）（含memory+predialog）", async () => {
        const testScene = {
            define: "Scene define",
            memory: [
                { type: "chat" as const, content: "Scene memory 1", sender_name: "System" },
            ],
            name: "test",
            dialog: [
                { type: "chat" as const, content: "Scene predialog", sender_name: "Character" },
            ],
        };
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();
        await FirstModel.loadOrCreate(conversationModel);

        const messages: MessageModel[] = [];
        for (let i = 0; i < 5; i++) {
            const msg = await MessageModel.create({
                conversation_id: conversationId,
                parent_message_id: i === 0 ? undefined : messages[i - 1].getMessageId(),
                sender_id: i % 2 === 0 ? "user" : "char",
                sender_type: i % 2 === 0 ? "user" : "char",
                content: `Reject test msg ${i}`
            });
            messages.push(msg);
        }

        const defineScene = {
            define: "Define content",
            memory: [
                { type: "chat" as const, content: "Define memory 1", sender_name: "System" },
            ],
            name: "test",
            dialog: [
                { type: "chat" as const, content: "Define predialog", sender_name: "System" },
            ],
        };

        // onIntercept 在 msg2 命中返回 'reject'：msg2不计入链并截断
        // 后续scene/define predialog也不再产出
        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxBudget: { maxLength: 10000, maxCount: 100 },
            conversationModel: conversationModel,
            messageModel: messages[4],
            onIntercept: (msg) => msg.content.includes("msg 2") ? 'reject' : 'continue'
        });

        console.log("=== Test 41 getHistMessageList actual output ===");
        console.log(JSON.stringify(histMessages, null, 2));

        // 强断言：reject截断后predialog不应出现（流在onIntercept处终止）
        expect(histMessages).toEqual([
            {
                type: "chat",
                sender_id: "char",
                sender_type: "char",
                content: "Reject test msg 3",
                id: messages[3].getMessageId(),
            },
            {
                type: "chat",
                sender_id: "user",
                sender_type: "user",
                content: "Reject test msg 4",
                id: messages[4].getMessageId(),
            },
        ]);
    });

    test("42. 应成功测试onIntercept的continue不截断（含memory+predialog）", async () => {
        const testScene = {
            define: "Scene define",
            memory: [
                { type: "chat" as const, content: "Scene memory 1", sender_name: "System" },
            ],
            name: "test",
            dialog: [
                { type: "chat" as const, content: "Scene predialog", sender_name: "Character" },
            ],
        };
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();
        await FirstModel.loadOrCreate(conversationModel);

        const messages: MessageModel[] = [];
        for (let i = 0; i < 5; i++) {
            const msg = await MessageModel.create({
                conversation_id: conversationId,
                parent_message_id: i === 0 ? undefined : messages[i - 1].getMessageId(),
                sender_id: i % 2 === 0 ? "user" : "char",
                sender_type: i % 2 === 0 ? "user" : "char",
                content: `Continue test msg ${i}`
            });
            messages.push(msg);
        }

        const defineScene = {
            define: "Define content",
            memory: [
                { type: "chat" as const, content: "Define memory 1", sender_name: "System" },
            ],
            name: "test",
            dialog: [
                { type: "chat" as const, content: "Define predialog", sender_name: "System" },
            ],
        };

        // onIntercept 始终返回 'continue'，不截断
        // 全部5条历史消息 + scene predialog + define predialog 应返回
        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxBudget: { maxLength: 10000, maxCount: 100 },
            conversationModel: conversationModel,
            messageModel: messages[4],
            onIntercept: () => 'continue'
        });

        console.log("=== Test 42 getHistMessageList actual output ===");
        console.log(JSON.stringify(histMessages, null, 2));

        // 强断言：continue不截断时，predialog应出现在历史消息之前
        expect(histMessages).toEqual([
            { type: "chat", content: "Define predialog", sender_name: "System" },
            { type: "chat", content: "Scene predialog", sender_name: "Character" },
            {
                type: "chat",
                sender_id: "user",
                sender_type: "user",
                content: "Continue test msg 0",
                id: messages[0].getMessageId(),
            },
            {
                type: "chat",
                sender_id: "char",
                sender_type: "char",
                content: "Continue test msg 1",
                id: messages[1].getMessageId(),
            },
            {
                type: "chat",
                sender_id: "user",
                sender_type: "user",
                content: "Continue test msg 2",
                id: messages[2].getMessageId(),
            },
            {
                type: "chat",
                sender_id: "char",
                sender_type: "char",
                content: "Continue test msg 3",
                id: messages[3].getMessageId(),
            },
            {
                type: "chat",
                sender_id: "user",
                sender_type: "user",
                content: "Continue test msg 4",
                id: messages[4].getMessageId(),
            },
        ]);
    });

    test("43. 应成功测试onIntercept在length/count限制之后调用（含memory+predialog）", async () => {
        const testScene = {
            define: "Scene define",
            memory: [
                { type: "chat" as const, content: "Scene memory 1", sender_name: "System" },
            ],
            name: "test",
            dialog: [
                { type: "chat" as const, content: "Scene predialog", sender_name: "Character" },
            ],
        };
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();
        await FirstModel.loadOrCreate(conversationModel);

        const messages: MessageModel[] = [];
        for (let i = 0; i < 5; i++) {
            const msg = await MessageModel.create({
                conversation_id: conversationId,
                parent_message_id: i === 0 ? undefined : messages[i - 1].getMessageId(),
                sender_id: i % 2 === 0 ? "user" : "char",
                sender_type: i % 2 === 0 ? "user" : "char",
                content: `Priority test msg ${i}`
            });
            messages.push(msg);
        }

        const defineScene = {
            define: "Define content",
            memory: [
                { type: "chat" as const, content: "Define memory 1", sender_name: "System" },
            ],
            name: "test",
            dialog: [
                { type: "chat" as const, content: "Define predialog", sender_name: "System" },
            ],
        };

        // maxCount=2 优先于 onIntercept：只遍历 msg4→msg3，onIntercept 在 msg2 之前就被 count 截断
        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxBudget: { maxLength: 10000, maxCount: 2 },
            conversationModel: conversationModel,
            messageModel: messages[4],
            onIntercept: (msg) => msg.content.includes("msg 2") ? 'include' : 'continue'
        });

        console.log("=== Test 43 getHistMessageList actual output ===");
        console.log(JSON.stringify(histMessages, null, 2));

        // 强断言：maxCount=2优先于onIntercept，predialog不应出现
        expect(histMessages).toEqual([
            {
                type: "chat",
                sender_id: "char",
                sender_type: "char",
                content: "Priority test msg 3",
                id: messages[3].getMessageId(),
            },
            {
                type: "chat",
                sender_id: "user",
                sender_type: "user",
                content: "Priority test msg 4",
                id: messages[4].getMessageId(),
            },
        ]);
    });

    test("50. getCurrMessageList的maxCount应仅约束hist部分，不包含memory（强断言）", async () => {
        // 创建带memory和dialog的场景
        const testScene = {
            define: "Scene define",
            memory: [
                { type: "chat" as const, content: "Scene memory 1", sender_name: "System" },
                { type: "chat" as const, content: "Scene memory 2", sender_name: "System" },
            ],
            name: "test",
            dialog: [
                { type: "chat" as const, content: "Scene predialog", sender_name: "Character" },
            ],
        };
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();
        await FirstModel.loadOrCreate(conversationModel);

        // 创建5条历史消息
        const messages: MessageModel[] = [];
        for (let i = 0; i < 5; i++) {
            const msg = await MessageModel.create({
                conversation_id: conversationId,
                parent_message_id: i === 0 ? undefined : messages[i - 1].getMessageId(),
                sender_id: i % 2 === 0 ? "user" : "char",
                sender_type: i % 2 === 0 ? "user" : "char",
                content: `Hist msg ${i}`
            });
            messages.push(msg);
        }

        const defineScene = {
            define: "Define content",
            memory: [
                { type: "chat" as const, content: "Define memory 1", sender_name: "System" },
            ],
            name: "test",
            dialog: [
                { type: "chat" as const, content: "Define predialog", sender_name: "System" },
            ],
        };

        // maxCount=3: 仅约束hist-graph子图(含predialog+history)，memory是constant不计入
        // 由于流顺序为 history → scene_predialog → define_predialog
        // maxCount=3 时history占满3条，predialog未产出
        const messageList = await DialogHelper.getCurrMessageList({
            defineScene,
            maxBudget: { maxLength: 10000, maxCount: 3 },
            conversationModel: conversationModel,
            messageModel: messages[4]
        });

        console.log("=== Test 50 getCurrMessageList actual output ===");
        console.log(JSON.stringify(messageList, null, 2));

        // 强断言：memory必须存在（constant块不计入maxCount），hist部分受maxCount=3约束
        expect(messageList).toBeDefined();
        expect(messageList!).toEqual([
            // define 常量块（不计入maxCount）
            { type: "desc", content: "Define content" },
            { type: "chat", content: "Define memory 1", sender_name: "System" },
            // scene 常量块（不计入maxCount）
            { type: "desc", content: "Scene define" },
            { type: "chat", content: "Scene memory 1", sender_name: "System" },
            { type: "chat", content: "Scene memory 2", sender_name: "System" },
            // hist-graph 子图（maxCount=3 约束此部分）
            // 流顺序: history → scene_predialog → define_predialog
            // history占满3条，predialog未产出
            {
                type: "chat",
                sender_id: "user",
                sender_type: "user",
                content: "Hist msg 2",
                id: messages[2].getMessageId(),
                premise: undefined,
            },
            {
                type: "chat",
                sender_id: "char",
                sender_type: "char",
                content: "Hist msg 3",
                id: messages[3].getMessageId(),
                premise: undefined,
            },
            {
                type: "chat",
                sender_id: "user",
                sender_type: "user",
                content: "Hist msg 4",
                id: messages[4].getMessageId(),
                premise: undefined,
            },
        ]);
    });

    test("51. getCurrMessageList的onIntercept截断后memory仍应存在，predialog不应出现（强断言）", async () => {
        const testScene = {
            define: "Scene define",
            memory: [
                { type: "chat" as const, content: "Scene memory 1", sender_name: "System" },
            ],
            name: "test",
            dialog: [
                { type: "chat" as const, content: "Scene predialog", sender_name: "Character" },
            ],
        };
        const conversationModel = await ConversationModel.create({ scene: testScene });
        const conversationId = conversationModel.getConversationId();
        await FirstModel.loadOrCreate(conversationModel);

        // 创建5条历史消息
        const messages: MessageModel[] = [];
        for (let i = 0; i < 5; i++) {
            const msg = await MessageModel.create({
                conversation_id: conversationId,
                parent_message_id: i === 0 ? undefined : messages[i - 1].getMessageId(),
                sender_id: i % 2 === 0 ? "user" : "char",
                sender_type: i % 2 === 0 ? "user" : "char",
                content: `Intercept curr msg ${i}`
            });
            messages.push(msg);
        }

        const defineScene = {
            define: "Define content",
            memory: [
                { type: "chat" as const, content: "Define memory 1", sender_name: "System" },
            ],
            name: "test",
            dialog: [
                { type: "chat" as const, content: "Define predialog", sender_name: "System" },
            ],
        };

        // onIntercept 在 msg2 命中reject：截断后流终止，predialog不产出
        // 但memory是constant块，不受onIntercept影响
        const messageList = await DialogHelper.getCurrMessageList({
            defineScene,
            maxBudget: { maxLength: 10000, maxCount: 100 },
            conversationModel: conversationModel,
            messageModel: messages[4],
            onIntercept: (msg) => msg.content.includes("msg 2") ? 'reject' : 'continue'
        });

        console.log("=== Test 51 getCurrMessageList actual output ===");
        console.log(JSON.stringify(messageList, null, 2));

        // 强断言：memory必须存在，predialog不应出现（onIntercept截断了流）
        expect(messageList).toBeDefined();
        expect(messageList!).toEqual([
            // define 常量块（不受onIntercept影响）
            { type: "desc", content: "Define content" },
            { type: "chat", content: "Define memory 1", sender_name: "System" },
            // scene 常量块（不受onIntercept影响）
            { type: "desc", content: "Scene define" },
            { type: "chat", content: "Scene memory 1", sender_name: "System" },
            // hist-graph 子图：onIntercept reject msg2后流终止，predialog不产出
            {
                type: "chat",
                sender_id: "char",
                sender_type: "char",
                content: "Intercept curr msg 3",
                id: messages[3].getMessageId(),
            },
            {
                type: "chat",
                sender_id: "user",
                sender_type: "user",
                content: "Intercept curr msg 4",
                id: messages[4].getMessageId(),
            },
        ]);
    });
});
