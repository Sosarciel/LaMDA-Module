import { Failed, sleep, SLogger, Success, Terminated, Timeout, UtilFunc } from "@zwa73/utils";
import { AnySignaling, SignalingPing } from "./Signaling";
import { WebSocket } from "ws";
import { BaseUrl, getAuthorization } from "@/src/Define";
import { Endpoint } from "@/src/Endpoint";
import { httpsGet } from "./Utils";
import { GatewayResp } from "@/src/Resp";
import qs from 'querystring';


const endpoint = Endpoint.buildEndpoint(3);
const expMaxTime = 60;

/**以2为指数重试  
 * 第一次无延迟
 */
const expRepeatify = async <T extends ()=>Promise<any>> (
    maxTime:number,
    maxCount:number,
    procfn:T,
    verfyfn:((arg:Awaited<ReturnType<T>>)=>boolean|Promise<boolean>),
):Promise<ReturnType<T>|Terminated>=>{
    for(let count = 0;count<maxCount;count++){
        if(count!=0)
            await sleep(Math.min(maxTime,Math.pow(2,count))*1000);
        const result = await procfn();
        if(verfyfn(result)) return result;
    }
    return Terminated;
}

/**以数组中的时间作为延迟  
 * 第一次使用[0]
 */
const seqRepeatify = async <T extends ()=>Promise<any>> (
    timeseq:number[],
    procfn:T,
    verfyfn:((arg:Awaited<ReturnType<T>>)=>boolean|Promise<boolean>),
):Promise<ReturnType<T>|Terminated>=>{
    for (const time of timeseq) {
        await sleep(time*1000);
        const result = await procfn();
        if(verfyfn(result)) return result;
    }
    return Terminated;
}

const Status = [
    "GetGateway",
    "ConnectGateway",
    "AwaitHello",
    "Heartbeat",
    "Terminate",
    "Reconnect",
] as const;
type Status = typeof Status[number];


type ClientConnectEvent = {
    /**成功建立链接时的事件 */
    onconnect:(ws?:WebSocket)=>void|Promise<void>;
    /**链接重置 / 触发sn清空 时的事件 */
    onreset:((ws?:WebSocket)=>void|Promise<void>);
    /**ws被销毁时的事件 */
    onclose:(()=>void|Promise<void>);
}

export class WsConnectManager{

    cce:ClientConnectEvent;
    constructor(
        private token: string,
        clientConnectEvent:ClientConnectEvent,
    ) {
        const client = this;
        this.cce = {
            async onconnect (){
                await clientConnectEvent.onconnect(client.ws);
            },
            async onreset(){
                await clientConnectEvent.onreset(client.ws);
                client.lastsn = 0;
            },
            async onclose(){
                await clientConnectEvent.onclose();
                client.ws?.close();
                client.connected = false;
            }
        };
    }

    private connected = false;
    private currStatus:Status = "GetGateway";
    lastsn=0;
    private ws?:WebSocket;
    private heartbeatEvent?:NodeJS.Timeout;
    private gatewayUrl?:string;
    private session_id?:string;

    async procStatus(){
        return await UtilFunc.matchProc(this.currStatus,{
            GetGateway      :()=>this.ProcGetGateway(),
            ConnectGateway  :()=>this.ProcConnectGateway(),
            Reconnect       :()=>this.ProcReconnect(),
            AwaitHello      :()=>this.ProcAwaitHello(),
            Heartbeat       :()=>this.ProcHeartbeat(),
            Terminate       :()=>"Terminate" as const,
        });
    }

    async start(){
        while(true){
            if(this.currStatus == "Terminate") break;
            this.currStatus = await this.procStatus();
        }
    }

    //#region GetGateway
    async ProcGetGateway():Promise<Status>{
        const result = await expRepeatify(
            expMaxTime, Infinity,
            this.getGateway.bind(this),
            (v)=>typeof v == 'string',
        );
        if(result == Terminated){
            SLogger.error(`获取网关失败 重试到极限 客户端被放弃`);
            return "Terminate"
        }

        this.gatewayUrl = result;
        SLogger.info(`获取网关成功`);
        return "ConnectGateway";
    }
    async getGateway() {
        SLogger.info(`正在获取网关`);
        const opt = {
            hostname: BaseUrl,
            port: 443,
            path: endpoint.Gateway,
            method: "GET" as const,
            headers: {
                "Content-Type": "application/json",
                Authorization: getAuthorization("Bot", this.token),
            },
        };
        const result = (await httpsGet(opt, {
            compress:0,
        }))?.body as GatewayResp;
        //console.log(result);
        return result.data.url;
    }
    //#endregion

    //#region ConnectGateway
    async ProcConnectGateway():Promise<Status>{
        const {gatewayUrl} = this;
        if(gatewayUrl==null) return "GetGateway";

        await this.cce.onreset();
        await this.cce.onclose();
        this.ws = new WebSocket(gatewayUrl);

        const result = await expRepeatify(expMaxTime,2,
            this.tryConnect.bind(this),
            (v)=>v==Success,
        );

        return UtilFunc.matchProc(result, {
            [Terminated]():Status{
                SLogger.warn(`连接网关失败 重试到极限 回退至 GetGateway`);
                return "GetGateway";
            },
            [Success]():Status{
                SLogger.info(`连接网关成功`);
                return "AwaitHello";
            },
            [Failed]():Status{
                SLogger.warn(`连接网关失败 重试到极限 回退至 GetGateway`);
                return "GetGateway";
            },
        });
    }
    async tryConnect(){
        SLogger.info(`正在连接网关`);

        const ws = this.ws;
        if(ws==null) return Failed;

        let openRes:((v:Success)=>void)|null = null;
        let errRes :((v:Failed )=>void)|null = null;
        const openPromise = new Promise<Success>((resolve, reject) => {
            openRes = resolve;
        });
        const errPromise = new Promise<Failed>((resolve, reject) => {
            errRes = resolve;
        });
        const onOpen = ()=>{
            if(openRes) openRes(Success);
            ws.off('error', onError);
        }
        const onError = ()=>{
            if(errRes) errRes(Failed);
            ws.off('open', onOpen);
        }

        ws.once('open', onOpen);
        ws.once('error', onError);

        return await Promise.race([
            openPromise,
            errPromise,
        ]);
    }
    //#endregion

    //#region Reconnect
    async ProcReconnect():Promise<Status>{
        const {gatewayUrl,session_id,lastsn: sn} = this;

        if(gatewayUrl==null) return "GetGateway";
        if(session_id==null) return "GetGateway";

        const reconnectUrl = gatewayUrl+'&'+qs.stringify({
            resume:1,
            session_id,
            sn,
        });

        await this.cce.onclose();
        this.ws = new WebSocket(reconnectUrl);
        this.connected = false;

        const result = await seqRepeatify([8,16],
            this.tryConnect.bind(this),
            (v)=>v==Success,
        );

        return UtilFunc.matchProc(result, {
            [Terminated]():Status{
                SLogger.warn(`重连失败 重试到极限 回退至 GetGateway`);
                return "GetGateway";
            },
            [Success]():Status{
                SLogger.info(`重连成功`);
                return "AwaitHello";
            },
            [Failed]():Status{
                SLogger.warn(`重连失败 重试到极限 回退至 GetGateway`);
                return "GetGateway";
            },
        });
    }
    //#endregion


    //#region AwaitHello
    async ProcAwaitHello():Promise<Status>{
        const result = await this.awaitHello();
        return UtilFunc.matchProc(result, {
            [Timeout]():Status{
                SLogger.warn(`等待hello包失败 超时 回退至 GetGateway`);
                return "GetGateway";
            },
            [Success]():Status{
                SLogger.info(`等待hello包成功`);
                return "Heartbeat";
            },
            [Failed]():Status{
                SLogger.warn(`等待hello包成功 出现错误 回退至 GetGateway`);
                return "GetGateway";
            },
        });
    }

    async awaitHello(){
        const {ws} = this;
        if(ws==null) return Failed;
        return await Promise.race([
            new Promise<Success|Failed>((resolve, reject) => {
                const onmessage = async (data:Buffer) => {
                    //const strdata = await new Promise<string>((sres,srej)=>{
                    //    zlib.unzip(data,(err,buffer)=>{
                    //        if(err) sres('null');
                    //        sres(buffer.toString());
                    //    });
                    //});
                    const strdata = data.toString();
                    try {
                        const jsonData = JSON.parse(strdata) as AnySignaling;
                        if(jsonData==null) resolve(Failed);
                        if(jsonData.s==1){
                            if(jsonData.d.code==0){
                                this.session_id = jsonData.d.session_id;
                                ws.off('message', onmessage);
                                resolve(Success);
                            }
                            else {
                                SLogger.warn(`SignalingHello 错误:${jsonData.d.code}`,`rawdata:${strdata}`);
                                ws.off('message', onmessage);
                                resolve(Failed);
                            }
                        }
                    } catch (error) {
                        console.log(error);
                        SLogger.warn('SignalingHello 错误',error,`rawdata:${strdata}`); // 添加错误处理逻辑
                    }
                }

                ws.on("message", onmessage);
            }),
            UtilFunc.ivk(async ():Promise<Timeout>=>{
                await sleep(6000);
                return Timeout;
            }),
        ]);
    }
    //#endregion

    //#region Heartbeat
    async ProcHeartbeat():Promise<Status>{
        const { ws } = this;
        if(ws==null) return "GetGateway";
        if(!this.connected){
            await this.cce.onconnect();
            this.connected = true;
        }

        const result = await this.heartbeat();
        return UtilFunc.matchProc(result, {
            [Timeout]():Status{
                SLogger.warn(`心跳超时 回退至 Reconnect`);
                return "Reconnect";
            },
            [Terminated]():Status{
                SLogger.info(`心跳中接收到重置信号 回退至 GetGateway`);
                return "GetGateway";
            },
            [Failed]():Status{
                SLogger.warn(`心跳失败 回退至 Reconnect`);
                return "Reconnect";
            },
        });
    }
    async heartbeat(){
        SLogger.info(`正在检查心跳`);
        let bkres:((v:Failed|Timeout|Terminated)=>void)|null= null;
        const bkpromis = new Promise<Failed|Timeout|Terminated>((reslove,reject)=>bkres = reslove);

        const client = this;
        this.heartbeatEvent = setInterval(async ()=>{
            const result = await expRepeatify(
                expMaxTime,2,
                client.checkHeartbeat.bind(this),
                (v)=>v==Success
            );
            UtilFunc.matchProc(result,{
                [Timeout](){
                    SLogger.warn(`检查心跳失败 超时`);
                    if(bkres) bkres(Timeout);
                },
                [Success](){
                    SLogger.info(`检查心跳完成`);
                },
                [Failed](){
                    SLogger.warn(`检查心跳失败 ws不存在 可能是代码错误`);
                    if(bkres) bkres(Terminated);
                },
                [Terminated](){
                    SLogger.warn(`检查心跳失败 重试到极限`);
                    if(bkres) bkres(Failed);
                }
            })
        },30000);

        const recordsn = (data:Buffer)=>{
            try{
                const strdata = data.toString();
                const jsonData = JSON.parse(strdata) as AnySignaling;
                if(jsonData.s==0){
                    const nsn = jsonData.sn;
                    //优先判断可能的重置
                    if(this.lastsn>65500 && nsn<100)
                        this.lastsn = nsn;
                    else this.lastsn = Math.max(this.lastsn,nsn);
                }
                else if(jsonData.s==5){
                    SLogger.warn(`触发重连 code:${jsonData.d.code}`);
                    if(bkres) bkres(Terminated);
                }
            }catch(e){}
        }
        this.ws?.on('message',recordsn);
        const result = await bkpromis;
        clearInterval(this.heartbeatEvent);
        this.ws?.off('message',recordsn);
        this.heartbeatEvent = undefined;
        return result;
    }
    async checkHeartbeat(){
        const ws = this.ws;
        if(ws==null) return Failed;
        const hb:SignalingPing = {
            s: 2,
            sn: this.lastsn
        }
        ws.send(JSON.stringify(hb));

        let res:((v:Success)=>void)|null = null;
        const pongPromise = new Promise<Success>((resolve, reject) => res = resolve);

        const onmessage = (data:Buffer)=>{
            const strdata = data.toString();
            try{
                const jsonData = JSON.parse(strdata) as AnySignaling;
                if(jsonData.s==3){
                    if(res) res(Success);
                }
            }catch(e){
                console.log(e);
                SLogger.warn('SignalingPong 错误',e,`rawdata:${strdata}`); // 添加错误处理逻辑
            }
        }
        ws.on('message', onmessage);

        const result = await Promise.race([
            UtilFunc.ivk(async ():Promise<Timeout>=>{
                await sleep(6000);
                return Timeout
            }),
            pongPromise,
        ]);
        ws.off('message', onmessage);
        return result;
    }
    //#endregion
}

//new WebsocketConnectManager('1/MjYyOTg=/ONxsTfp41qeKE3bhcuPTlg==',()=>{},()=>{}).start();