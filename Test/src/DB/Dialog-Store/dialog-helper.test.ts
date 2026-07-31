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
        const conversationEntity = await ConversationEntity.create<TestConversationExt>({});

        // 创建消息链
        const msg1 = await MessageEntity.create({
            conversation_id: conversationEntity.getConversationId(),
            sender_id: 'user1',
            content: '消息1',
        });
        const msg2 = await MessageEntity.create({
            conversation_id: conversationEntity.getConversationId(),
            parent_message_id: msg1.getMessageId(),
            sender_id: 'char1',
            content: '消息2',
        });

        // 测试 createHistChain
        const result = await DialogStoreHelper.createHistChain({
            conversationEntity,
            messageEntity: msg2,
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
        const conversationEntity = await ConversationEntity.create<TestConversationExt>({});

        // 创建 5 条消息
        const messages: MessageEntity<TestMessageExt>[] = [];
        let parentId: string | undefined;
        for (let i = 0; i < 5; i++) {
            const msg = await MessageEntity.create({
                conversation_id: conversationEntity.getConversationId(),
                parent_message_id: parentId,
                sender_id: `sender${i}`,
                content: `消息${i}`,
            });
            messages.push(msg);
            parentId = msg.getMessageId();
        }

        // 测试 createHistChain，maxCount 设为 3
        const result = await DialogStoreHelper.createHistChain({
            conversationEntity,
            messageEntity: messages[4],
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
        const conversationEntity = await ConversationEntity.create<TestConversationExt>({});

        // 创建消息链，每条消息长度为 10
        const msg1 = await MessageEntity.create({
            conversation_id: conversationEntity.getConversationId(),
            sender_id: 'user1',
            content: '0123456789', // 长度 10
        });
        const msg2 = await MessageEntity.create({
            conversation_id: conversationEntity.getConversationId(),
            parent_message_id: msg1.getMessageId(),
            sender_id: 'char1',
            content: '0123456789', // 长度 10
        });
        const msg3 = await MessageEntity.create({
            conversation_id: conversationEntity.getConversationId(),
            parent_message_id: msg2.getMessageId(),
            sender_id: 'user2',
            content: '0123456789', // 长度 10
        });

        // 测试 createHistChain，maxLength 设为 25
        const result = await DialogStoreHelper.createHistChain({
            conversationEntity,
            messageEntity: msg3,
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
        const conversationEntity = await ConversationEntity.create<TestConversationExt>({});

        // 创建消息链，内容中包含不同数量的 'a' 字符
        const msg1 = await MessageEntity.create({
            conversation_id: conversationEntity.getConversationId(),
            sender_id: 'user1',
            content: 'aaabbb', // 包含 3 个 'a'
        });
        const msg2 = await MessageEntity.create({
            conversation_id: conversationEntity.getConversationId(),
            parent_message_id: msg1.getMessageId(),
            sender_id: 'char1',
            content: 'aaaaacccc', // 包含 5 个 'a'
        });
        const msg3 = await MessageEntity.create({
            conversation_id: conversationEntity.getConversationId(),
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
            conversationEntity,
            messageEntity: msg3,
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

    test("40. 应支持 onIntercept 返回 include 截断（命中计入链）", async () => {
        const conversationEntity = await ConversationEntity.create<TestConversationExt>({});

        const messages: MessageEntity<TestMessageExt>[] = [];
        let parentId: string | undefined;
        for (let i = 0; i < 5; i++) {
            const msg = await MessageEntity.create({
                conversation_id: conversationEntity.getConversationId(),
                parent_message_id: parentId,
                sender_id: `sender${i}`,
                content: `intercept_msg_${i}`,
            });
            messages.push(msg);
            parentId = msg.getMessageId();
        }

        // onIntercept 在 msg2 命中返回 'include'：msg2计入链并截断
        // traverseUp: msg4→msg3→msg2(命中include)→停止
        // chain(unshift): [msg2, msg3, msg4]
        const result = await DialogStoreHelper.createHistChain({
            conversationEntity,
            messageEntity: messages[4],
            maxLength: 10000,
            maxCount: 100,
            computeLength: (entity) => entity.getContent().length,
            onIntercept: (entity) => entity.getContent().includes('msg_2') ? 'include' : 'continue',
        });

        expect(result.chain.length).toBe(3);
        expect(result.chain[0].getMessageId()).toBe(messages[2].getMessageId());
        expect(result.chain[1].getMessageId()).toBe(messages[3].getMessageId());
        expect(result.chain[2].getMessageId()).toBe(messages[4].getMessageId());
        // intercept_msg_2(15) + intercept_msg_3(15) + intercept_msg_4(15) = 45
        expect(result.totalLength).toBe(45);
        expect(result.totalCount).toBe(3);
        expect(result.stopReason.reason).toBe('intercept');
        if (result.stopReason.reason === 'intercept') {
            expect(result.stopReason.result).toBe('include');
        }
    });

    test("41. 应支持 onIntercept 返回 reject 截断（命中不计入链）", async () => {
        const conversationEntity = await ConversationEntity.create<TestConversationExt>({});

        const messages: MessageEntity<TestMessageExt>[] = [];
        let parentId: string | undefined;
        for (let i = 0; i < 5; i++) {
            const msg = await MessageEntity.create({
                conversation_id: conversationEntity.getConversationId(),
                parent_message_id: parentId,
                sender_id: `sender${i}`,
                content: `reject_msg_${i}`,
            });
            messages.push(msg);
            parentId = msg.getMessageId();
        }

        // onIntercept 在 msg2 命中返回 'reject'：msg2不计入链并截断
        // traverseUp: msg4→msg3→msg2(命中reject,不计入)→停止
        // chain: [msg3, msg4]
        const result = await DialogStoreHelper.createHistChain({
            conversationEntity,
            messageEntity: messages[4],
            maxLength: 10000,
            maxCount: 100,
            computeLength: (entity) => entity.getContent().length,
            onIntercept: (entity) => entity.getContent().includes('msg_2') ? 'reject' : 'continue',
        });

        expect(result.chain.length).toBe(2);
        expect(result.chain[0].getMessageId()).toBe(messages[3].getMessageId());
        expect(result.chain[1].getMessageId()).toBe(messages[4].getMessageId());
        // reject_msg_3(12) + reject_msg_4(12) = 24，msg2未计入
        expect(result.totalLength).toBe(24);
        expect(result.totalCount).toBe(2);
        expect(result.stopReason.reason).toBe('intercept');
        if (result.stopReason.reason === 'intercept') {
            expect(result.stopReason.result).toBe('reject');
        }
    });

    test("42. 应支持 onIntercept 返回 continue 不截断", async () => {
        const conversationEntity = await ConversationEntity.create<TestConversationExt>({});

        const messages: MessageEntity<TestMessageExt>[] = [];
        let parentId: string | undefined;
        for (let i = 0; i < 5; i++) {
            const msg = await MessageEntity.create({
                conversation_id: conversationEntity.getConversationId(),
                parent_message_id: parentId,
                sender_id: `sender${i}`,
                content: `cont_msg_${i}`,
            });
            messages.push(msg);
            parentId = msg.getMessageId();
        }

        // onIntercept 始终返回 'continue'，不截断，遍历到 FirstEntity 正常结束
        const result = await DialogStoreHelper.createHistChain({
            conversationEntity,
            messageEntity: messages[4],
            maxLength: 10000,
            maxCount: 100,
            computeLength: (entity) => entity.getContent().length,
            onIntercept: () => 'continue',
        });

        expect(result.chain.length).toBe(5);
        for (let i = 0; i < 5; i++) {
            expect(result.chain[i].getMessageId()).toBe(messages[i].getMessageId());
        }
        expect(result.stopReason.reason).toBe('first');
    });

    test("43. 应支持 onIntercept 在 length/count 限制之后调用", async () => {
        const conversationEntity = await ConversationEntity.create<TestConversationExt>({});

        const messages: MessageEntity<TestMessageExt>[] = [];
        let parentId: string | undefined;
        for (let i = 0; i < 5; i++) {
            const msg = await MessageEntity.create({
                conversation_id: conversationEntity.getConversationId(),
                parent_message_id: parentId,
                sender_id: `sender${i}`,
                content: `prio_msg_${i}`,
            });
            messages.push(msg);
            parentId = msg.getMessageId();
        }

        // maxCount=2 优先于 onIntercept：只遍历 msg4→msg3，onIntercept 在 msg2 之前就被 count 截断
        const result = await DialogStoreHelper.createHistChain({
            conversationEntity,
            messageEntity: messages[4],
            maxLength: 10000,
            maxCount: 2,
            computeLength: (entity) => entity.getContent().length,
            onIntercept: (entity) => entity.getContent().includes('msg_2') ? 'include' : 'continue',
        });

        expect(result.chain.length).toBe(2);
        expect(result.chain[0].getMessageId()).toBe(messages[3].getMessageId());
        expect(result.chain[1].getMessageId()).toBe(messages[4].getMessageId());
        expect(result.stopReason.reason).toBe('count');
    });
});
