import { DBManager } from "@sosraciel-lamda/postgresql-manager";
import { DialogStore } from "@sosraciel-lamda/dialog-store";
import type { ConversationStruct, MessageStruct, AnchorStruct, ConversationStructExt, MessageStructExt, AnchorStructExt } from "@sosraciel-lamda/dialog-store";
import { DBCache } from "@sosraciel-lamda/dialog-store/dist/DBCache";
import { UtilFunc } from "@zwa73/utils";
import { PG_PORT } from "@/src/Constant";

/**测试用轻数据类型 */
export type TestLightData = {
    sender_type?: 'user' | 'char';
    status?: string;
};

/**测试用重数据类型 */
export type TestHeavyData = {
    translate_content_table?: Record<string, string>;
    metadata?: { key: string; value?: string };
};

/**测试用消息扩展类型 */
export type TestMessageExt = {
    m_light: TestLightData;
    m_heavy: TestHeavyData;
};

/**测试用对话扩展类型 */
export type TestConversationExt = {
    m_light: TestLightData;
    m_heavy: TestHeavyData;
    c_light: TestLightData;
    c_heavy: TestHeavyData;
};

/**测试用锚点扩展类型 */
export type TestAnchorExt = {
    a_light: TestLightData;
    a_heavy: TestHeavyData;
};

/**创建测试对话结构体 */
export const createTestConversation = <TConv extends ConversationStructExt = {m_light:{}, m_heavy:{}, c_light:{}, c_heavy:{}}>(
    options?: {
        conversation_id?: string;
        light_data?: Partial<TConv['c_light']>;
        heavy_data?: Partial<TConv['c_heavy']>;
    }
): ConversationStruct<TConv> => {
    return {
        data: {
            conversation_id: options?.conversation_id || UtilFunc.genUUID(),
            ...(options?.light_data && { light_data: options.light_data }),
            ...(options?.heavy_data && { heavy_data: options.heavy_data }),
        }
    } as ConversationStruct<TConv>;
};

/**创建测试消息结构体 */
export const createTestMessage = <TMsg extends MessageStructExt = {m_light:{}, m_heavy:{}}>(
    conversationId: string,
    options?: {
        message_id?: string;
        parent_message_id?: string | null;
        sender_id?: string;
        content?: string;
        light_data?: Partial<TMsg['m_light']>;
        heavy_data?: Partial<TMsg['m_heavy']>;
    }
): MessageStruct<TMsg> => {
    return {
        data: {
            message_id: options?.message_id || UtilFunc.genUUID(),
            conversation_id: conversationId,
            parent_message_id: options?.parent_message_id || null,
            sender_id: options?.sender_id || "user",
            content: options?.content || "Test message",
            ...(options?.light_data && { light_data: options.light_data }),
            ...(options?.heavy_data && { heavy_data: options.heavy_data }),
        }
    } as MessageStruct<TMsg>;
};

/**创建测试锚点结构体 */
export const createTestAnchor = <TExt extends AnchorStructExt = {a_light:{}, a_heavy:{}}>(
    options?: {
        anchor_id?: string;
        conversation_id?: string;
        message_id?: string;
        light_data?: Partial<TExt['a_light']>;
        heavy_data?: Partial<TExt['a_heavy']>;
    }
): AnchorStruct<TExt> => {
    return {
        data: {
            anchor_id: options?.anchor_id || UtilFunc.genUUID(),
            ...(options?.conversation_id && { conversation_id: options.conversation_id }),
            ...(options?.message_id && { message_id: options.message_id }),
            ...(options?.light_data && { light_data: options.light_data }),
            ...(options?.heavy_data && { heavy_data: options.heavy_data }),
        }
    } as AnchorStruct<TExt>;
};

/**设置测试数据库 */
export const setupTestDb = async (): Promise<DBManager> => {
    // 创建数据库管理器
    const manager = await DBManager.create({
        port: PG_PORT,
        user: "postgres",
        database: "postgres",
        host: "localhost",
        max: 10,
        idleTimeoutMillis: 1000 * 30,
    });

    // 测试数据库连接
    const result = await manager.client.query("SELECT 1");
    expect(result.rowCount).toBe(1);

    // 初始化DialogStore
    DialogStore.initInject(Promise.resolve(manager));
    await DialogStore.inited;

    // 清理测试数据
    await manager.client.query(`DELETE FROM dialog.message`);
    await manager.client.query(`DELETE FROM dialog.conversation`);
    await manager.client.query(`DELETE FROM dialog.anchor`);

    return manager;
};

/**清理测试数据库 */
export const teardownTestDb = async (manager: DBManager | undefined) => {
    // 清理数据库
    try {
        if (manager) {
            // 删除测试数据
            await manager.client.query(`DELETE FROM dialog.message`);
            await manager.client.query(`DELETE FROM dialog.conversation`);
            await manager.client.query(`DELETE FROM dialog.anchor`);
            // 关闭数据库连接
            await manager.stop();
        }

        // 清理缓存
        DBCache.dispose();

    } catch (e) {
        // 忽略错误
    }
};
