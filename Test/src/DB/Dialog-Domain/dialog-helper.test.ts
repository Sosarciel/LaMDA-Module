import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { DialogStore } from "@sosraciel-lamda/dialog-store";
import type { ConversationStruct, MessageStruct } from "@sosraciel-lamda/dialog-store";
import { ConversationModel, MessageModel, FirstModel, DialogHelper, AnchorModel } from "@sosraciel-lamda/dialog-domain";
import type { DialogMessageData } from "@sosraciel-lamda/dialog-domain";
import type { ConversationHeavyData, MessageModelExt, ConversationModelExt } from "@sosraciel-lamda/dialog-domain";
import { genAnchorId, parseAnchorId, genStatusString, parseStatusString } from "@sosraciel-lamda/dialog-domain";
import { sleep, UtilFunc } from "@zwa73/utils";
import { DBCache } from "@sosraciel-lamda/dialog-store/dist/DBCache";
import { PG_PORT } from "@/src/Constant";
import { createTestConversation, createTestMessage, createTestScene, setupTestDb, teardownTestDb } from "./Util";

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
            maxLength: 1000,
            maxCount: 10,
            convModel: conversationModel,
            msgModel: msg3
        });

        // 验证返回的是数组
        expect(Array.isArray(histMessages)).toBe(true);

        // 筛选用户消息进行强断言验证
        const chatMessages = histMessages.filter(m => m.type === 'chat' && 'sender_id' in m);
        expect(chatMessages.length).toBe(3);

        // 验证第一条消息的完整结构
        expect(chatMessages[0]).toEqual({
            type: "chat",
            sender_id: "user",
            sender_type: "user",
            content: "User message 1",
            id: msg1.getMessageId()
        });

        // 验证第二条消息的完整结构
        expect(chatMessages[1]).toEqual({
            type: "chat",
            sender_id: "char",
            sender_type: "char",
            content: "Character response 1",
            id: msg2.getMessageId()
        });

        // 验证第三条消息的完整结构
        expect(chatMessages[2]).toEqual({
            type: "chat",
            sender_id: "user",
            sender_type: "user",
            content: "User message 2",
            id: msg3.getMessageId()
        });
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
            maxLength: 1000,
            maxCount: 10,
            convModel: conversationModel,
            msgModel: firstModel
        });

        // 验证返回的是数组
        expect(Array.isArray(histMessages)).toBe(true);

        // 从FirstModel开始，不应有用户消息（带sender_id的）
        const chatMessages = histMessages.filter(m => m.type === 'chat' && 'sender_id' in m);
        expect(chatMessages.length).toBe(0);

        // 应包含场景预对话（带sender_name的）
        const sceneDialogs = histMessages.filter(m => m.type === 'chat' && 'sender_name' in m);
        expect(sceneDialogs.length).toBeGreaterThan(0);
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
            message: messageModel,
            conversation: conversationModel
        });

        // 验证位置ID
        expect(posId.conversationId).toBe(conversationId);
        expect(posId.messageId).toBe(messageModel.getMessageId());

        // 通过位置ID恢复对话位置
        const retrievedPos = await DialogHelper.getDialogPos(posId);
        expect(retrievedPos).toBeDefined();
        expect(retrievedPos?.conversation.getConversationId()).toBe(conversationId);
        expect(retrievedPos?.message.getMessageId()).toBe(messageModel.getMessageId());
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

        // 创建FirstModel
        const firstModel = await FirstModel.loadOrCreate(conversationModel);

        // 设置背景信息
        await conversationModel.updateData({ background_info: "Background info content" });

        // 创建消息链
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

        // 定义场景
        const defineScene = {
            define: "Define content",
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
            maxLength: 10000,
            maxCount: 100,
            convModel: conversationModel,
            msgModel: msg2
        });

        // 验证消息列表结构
        const descMessages = messageList?.filter(m => m.type === 'desc') ?? [];
        const chatWithSenderId = messageList?.filter(m => m.type === 'chat' && 'sender_id' in m) ?? [];
        const chatWithSenderName = messageList?.filter(m => m.type === 'chat' && 'sender_name' in m && !('sender_id' in m)) ?? [];

        // 验证desc消息（define和background_info）
        expect(descMessages.length).toBe(2);
        const descContents = descMessages.map(m => m.content);
        expect(descContents).toEqual([
            "Define content",
            "Scene define content",
            "Background info content"
        ]);

        // 验证chat with sender_name消息（memory和dialog）
        expect(chatWithSenderName.length).toBe(5);
        const senderNameContents = chatWithSenderName.map(m => m.content);
        expect(senderNameContents).toEqual([
            "Define memory 1",
            "Scene memory 1",
            "Scene memory 2",
            "Define dialog 1",
            "Scene dialog 1"
        ]);

        // 验证chat with sender_id消息（历史消息）
        expect(chatWithSenderId.length).toBe(2);
        expect(chatWithSenderId[0]).toEqual({
            type: "chat",
            sender_id: "user",
            sender_type: "user",
            content: "User message",
            id: msg1.getMessageId()
        });
        expect(chatWithSenderId[1]).toEqual({
            type: "chat",
            sender_id: "char",
            sender_type: "char",
            content: "Character response",
            id: msg2.getMessageId()
        });
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

    test("26. 应成功测试maxLength限制触发时的截断行为", async () => {
        // 创建无预对话的场景
        const testScene = {
            define: "",
            memory: [],
            name: "test",
            dialog: []
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

        // 定义场景
        const defineScene = {
            define: "",
            memory: [],
            name: "test",
            dialog: []
        };

        // 设置较小的maxLength（约200字符）
        const smallMaxLength = 200;

        // 获取历史消息
        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxLength: smallMaxLength,
            maxCount: 100,
            convModel: conversationModel,
            msgModel: messages[messages.length - 1]
        });

        // 验证总长度不超过maxLength
        const totalLength = histMessages.reduce((sum, m) => sum + m.content.length, 0);
        expect(totalLength).toBeLessThanOrEqual(smallMaxLength);

        // 验证返回的是最新的消息（从后向前截断）
        const chatMessages = histMessages.filter(m => m.type === 'chat' && 'sender_id' in m);
        expect(chatMessages.length).toBeGreaterThan(0);
        expect(chatMessages.length).toBeLessThan(10);
    });

    test("27. 应成功测试maxCount限制触发时的截断行为", async () => {
        // 创建无预对话的场景
        const testScene = {
            define: "",
            memory: [],
            name: "test",
            dialog: []
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

        // 定义场景
        const defineScene = {
            define: "",
            memory: [],
            name: "test",
            dialog: []
        };

        // 设置maxCount为3
        const smallMaxCount = 3;

        // 获取历史消息
        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxLength: 10000,
            maxCount: smallMaxCount,
            convModel: conversationModel,
            msgModel: messages[messages.length - 1]
        });

        // 验证消息数量不超过maxCount
        const chatMessages = histMessages.filter(m => m.type === 'chat' && 'sender_id' in m);
        expect(chatMessages.length).toBeLessThanOrEqual(smallMaxCount);

        // 验证返回的是最新的消息
        expect(chatMessages[chatMessages.length - 1].content).toBe("Message 9");
    });

    test("30. 应成功测试深度消息链遍历", async () => {
        // 创建无预对话的场景
        const testScene = {
            define: "",
            memory: [],
            name: "test",
            dialog: []
        };
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
        const defineScene = {
            define: "",
            memory: [],
            name: "test",
            dialog: []
        };

        // 获取历史消息
        const histMessages = await DialogHelper.getHistMessageList({
            defineScene,
            maxLength: 10000,
            maxCount: 100,
            convModel: conversationModel,
            msgModel: messages[messages.length - 1]
        });

        // 验证消息链完整性
        const chatMessages = histMessages.filter(m => m.type === 'chat' && 'sender_id' in m);
        expect(chatMessages.length).toBe(15);

        // 验证消息顺序（从旧到新）
        for (let i = 0; i < 15; i++) {
            expect(chatMessages[i].content).toBe(`Deep message level ${i}`);
        }

        // 验证消息ID链的正确性
        for (let i = 1; i < messages.length; i++) {
            const loadedMsg = await MessageModel.load(messages[i].getMessageId());
            expect(loadedMsg?.getPreMessageId()).toBe(messages[i - 1].getMessageId());
        }
    });
});
