import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { DialogStoreHelper, MessageEntity } from "@sosraciel-lamda/dialog-store";
import { ConversationEntity } from "@sosraciel-lamda/dialog-store";
import { TestMessageExt, TestConversationExt, setupTestDb, teardownTestDb } from "./Util";

describe("Dialog-Store DialogStoreHelper 测试", () => {
    let manager: DBManager;

    beforeAll(async () => {
        manager = await setupTestDb();
    }, 30000);

    afterAll(async () => {
        await teardownTestDb(manager);
    }, 30000);

    test("25. 应在遇到 FirstEntity 时正常结束", async () => {
        // 创建对话
        const convEntity = await ConversationEntity.create<TestConversationExt>({});

        // 创建消息链
        const msg1 = await MessageEntity.create({
            conversation_id: convEntity.getConversationId(),
            sender_id: 'user1',
            content: '消息1',
        });
        const msg2 = await MessageEntity.create({
            conversation_id: convEntity.getConversationId(),
            parent_message_id: msg1.getMessageId(),
            sender_id: 'char1',
            content: '消息2',
        });

        // 测试 createHistChain
        const result = await DialogStoreHelper.createHistChain({
            convEntity,
            startEntity: msg2,
            maxLength: 10000,
            maxCount: 100,
            computeLength: (entity) => entity.getContent().length,
        });

        // 验证结果
        expect(result.chain.length).toBe(2);
        expect(result.totalCount).toBe(2);
        expect(result.stopReason.reason).toBe('first');
        expect(result.chain[0].getMessageId()).toBe(msg1.getMessageId());
        expect(result.chain[1].getMessageId()).toBe(msg2.getMessageId());
    });

    test("26. 应在消息条数超限时停止", async () => {
        // 创建对话
        const convEntity = await ConversationEntity.create<TestConversationExt>({});

        // 创建 5 条消息
        const messages: MessageEntity<TestMessageExt>[] = [];
        let parentId: string | undefined;
        for (let i = 0; i < 5; i++) {
            const msg = await MessageEntity.create({
                conversation_id: convEntity.getConversationId(),
                parent_message_id: parentId,
                sender_id: `sender${i}`,
                content: `消息${i}`,
            });
            messages.push(msg);
            parentId = msg.getMessageId();
        }

        // 测试 createHistChain，maxCount 设为 3
        const result = await DialogStoreHelper.createHistChain({
            convEntity,
            startEntity: messages[4],
            maxLength: 10000,
            maxCount: 3,
            computeLength: (entity) => entity.getContent().length,
        });

        // 验证结果
        expect(result.chain.length).toBe(3);
        expect(result.totalCount).toBe(3);
        expect(result.stopReason.reason).toBe('count');
        if (result.stopReason.reason === 'count') {
            expect(result.stopReason.exceededCount).toBe(4);
        }
    });

    test("27. 应在总长度超限时停止", async () => {
        // 创建对话
        const convEntity = await ConversationEntity.create<TestConversationExt>({});

        // 创建消息链，每条消息长度为 10
        const msg1 = await MessageEntity.create({
            conversation_id: convEntity.getConversationId(),
            sender_id: 'user1',
            content: '0123456789', // 长度 10
        });
        const msg2 = await MessageEntity.create({
            conversation_id: convEntity.getConversationId(),
            parent_message_id: msg1.getMessageId(),
            sender_id: 'char1',
            content: '0123456789', // 长度 10
        });
        const msg3 = await MessageEntity.create({
            conversation_id: convEntity.getConversationId(),
            parent_message_id: msg2.getMessageId(),
            sender_id: 'user2',
            content: '0123456789', // 长度 10
        });

        // 测试 createHistChain，maxLength 设为 25
        const result = await DialogStoreHelper.createHistChain({
            convEntity,
            startEntity: msg3,
            maxLength: 25,
            maxCount: 100,
            computeLength: (entity) => entity.getContent().length,
        });

        // 验证结果
        expect(result.chain.length).toBe(2);
        expect(result.totalLength).toBe(20);
        expect(result.totalCount).toBe(2);
        expect(result.stopReason.reason).toBe('length');
        if (result.stopReason.reason === 'length') {
            // 如果接入第 3 条消息，总长度会是 30
            expect(result.stopReason.wouldBeLength).toBe(30);
        }
    });

    test("28. 应支持自定义 computeLength 计算", async () => {
        // 创建对话
        const convEntity = await ConversationEntity.create<TestConversationExt>({});

        // 创建消息链，内容中包含不同数量的 'a' 字符
        const msg1 = await MessageEntity.create({
            conversation_id: convEntity.getConversationId(),
            sender_id: 'user1',
            content: 'aaabbb', // 包含 3 个 'a'
        });
        const msg2 = await MessageEntity.create({
            conversation_id: convEntity.getConversationId(),
            parent_message_id: msg1.getMessageId(),
            sender_id: 'char1',
            content: 'aaaaacccc', // 包含 5 个 'a'
        });
        const msg3 = await MessageEntity.create({
            conversation_id: convEntity.getConversationId(),
            parent_message_id: msg2.getMessageId(),
            sender_id: 'user2',
            content: 'aaaaaaadddd', // 包含 7 个 'a'
        });

        // 自定义 computeLength：计算内容中 'a' 字符的个数
        const countA = (str: string) => str.split('a').length - 1;

        // 测试 createHistChain，maxLength 设为 10（按 'a' 的个数计算）
        // msg3: 7 个 'a'，可以接入，总长度 7
        // msg2: 5 个 'a'，接入后总长度 12 > 10，停止
        const result = await DialogStoreHelper.createHistChain({
            convEntity,
            startEntity: msg3,
            maxLength: 10,
            maxCount: 100,
            computeLength: (entity) => countA(entity.getContent()),
        });

        // 验证结果
        expect(result.chain.length).toBe(1);
        expect(result.totalLength).toBe(7);
        expect(result.totalCount).toBe(1);
        expect(result.stopReason.reason).toBe('length');
        if (result.stopReason.reason === 'length') {
            // 如果接入 msg2，总长度会是 7 + 5 = 12
            expect(result.stopReason.wouldBeLength).toBe(12);
        }
    });
});
