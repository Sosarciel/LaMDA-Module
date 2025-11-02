



/**一个场景 */
export type Scene={
    /**场景定义 */
    define:string;
    /**场景预对话 会遗忘的对话列表 */
    dialog:CharMessageEntry[];
    /**场景记忆对话 不会遗忘的对话列表 */
    memory:CharMessageEntry[];
    /**场景名 */
    name:string;
};

/**角色消息对象 */
export type CharMessageEntry={
    /**必定为 chat */
    type:'chat';
    /**角色名称 */
    name:string;
    /**消息内容 */
    content:string;
    /**消息id 未定义代表未记录的临时消息或系统消息*/
    id?:string;
}

/**旁白消息对象 */
export type SystemMessageEntry={
    /**必定为 desc */
    type:'desc';
    /**消息内容 */
    content:string;
}

/**通用消息表 */
export type ChatMessagesList={
    /**临时提示 */
    temporaryPrompt?:string;
    /**消息表 */
    messageList:CharMessageEntry|SystemMessageEntry[];
}

/**消息可用类型 */
export const MessageTypeList = ["chat","desc"];
export type MessageType = typeof MessageTypeList[number];