import { JObject } from "@zwa73/utils";

/**方向： server->client
 * 说明： 当我们成功连接 websocket 后，客户端应该在 6s 内收到该包，否则认为连接超时。
 */
export type SignalingHello = {
    s: 1;
    d: {
        /** 0 - 成功
         *  40100 - 缺少参数
         *  40101 - 无效的 token
         *  40102 - token 验证失败
         *  40103 - token 过期 需要重新连接
         */
        code: 0 | 40100 | 40101 | 40102 | 40103;
        session_id?: string;
    };
};


/**
 * 方向： server->client
 * 说明： 在正常连接状态下，收到的消息事件等。
 * 参数列表：
 * 具体参见Event
 * 注意： 该消息会有 sn, 代表消息序号, 针对当前 session 的消息的序号, 客户端需记录该数字,并按顺序接收消息， resume 时需传入该参数才能完成。
 * 注意事项：
 * 收到消息时需要按照 sn 顺序处理, 服务端会尽可能保证 sn 的顺序性
 * 假设收到消息的 sn 出现乱序, 需要先存入暂存区 (buffer) 等待正确的 sn 消息处理后再从暂存区顺序处理
 * 假设收到了一条已处理过的 sn 的消息, 则直接抛弃不处理
 * 客户端需要存储当前已处理成功的最大的 sn, 待心跳 ping 时回传服务端, 如果服务端发现当前客户端最新处理成功的消息 sn 落后于最新消息 (丢包等异常情况), 服务端将会按照客户端指定的 sn 将之后所有最新的消息重传给客户端.
 * 消息内容与 webhook 保持一致
 */
export type SignalingEvent = {
    s: 0;
    d: JObject;
    sn:number;
};

/**方向： client -> server
 * 说明： 每隔 30s(随机-5，+5),将当前的最大 sn 传给服务端,客户端应该在 6s 内收到 PONG, 否则心跳超时。
 * 注意事项：
 * 心跳间隔： 30 秒 + rand(-5,5)秒
 * 如果发了 ping, 6 秒内没有收到 pong，我们应该进入到超时状态。
 */
export type SignalingPing = {
    s: 2;
    /**客户端目前收到的最新的消息 sn */
    sn:number;
};

/**方向： server -> client
 * 说明： 回应客户端发出的 ping
 */
export type SignalingPong = {
    s: 3;
};

/**当链接未断开时 客户端需传入 当前收到的最后一个 sn 序号 */
export type SignalingResume = {
    s: 4;
    sn:number;
};

/**方向： server->client
 * 说明： 服务端通知客户端, 代表该连接已失效, 请重新连接。客户端收到后应该主动断开当前连接。
 * 注意： 客户端收到该信令代表因为某些原因导致当前连接已失效, 需要进行以下操作以避免消息丢失.
 * 重新获取 gateway;
 * 清空本地的 sn 计数;
 * 清空本地消息队列.
 */
export type SignalingReconnect = {
    s: 5;
    d: {
        /**40106    resume 失败, 缺少参数
         * 40107    当前 session 已过期 (resume 失败, PING 的 sn 无效
         * 40108    无效的 sn , 或 sn 已经不存在 (resume 失败, PING 的 sn 无效)
         */
        code: 40106 | 40107 | 41008;
        err: string;
    };
};

/**方向： server->client
 * 说明： 服务端通知客户端 resume 动作成功，中间所有离线消息已经全部发送成功
 */
export type SignalingResumeAck = {
    s: 6;
    d: {
        session_id: string;
    };
};


export type AnySignaling =
    | SignalingHello
    | SignalingEvent
    | SignalingPing
    | SignalingPong
    | SignalingResume
    | SignalingReconnect
    | SignalingResumeAck;