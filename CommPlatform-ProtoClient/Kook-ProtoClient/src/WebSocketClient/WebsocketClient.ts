import { AnyFunc, Failed, JObject, sleep, SLogger, Success, Timeout, UtilFunc } from '@zwa73/utils';
import { BaseUrl, getAuthorization } from '@/src/Define';
import qs from "querystring";
import https from 'https';
import { GatewayResp } from '@/src/Resp';
import { WebSocket } from "ws";
import { IncomingHttpHeaders } from 'http';
import * as zlib from "zlib";
import { AnySignaling, SignalingPing } from './Signaling';
import { Endpoint } from '../Endpoint';
import { httpsGet } from './Utils';
import { WsConnectManager } from './WsConnectManager';




const endpoint = Endpoint.buildEndpoint(3);

/**websocket客户端 */
class WebsocketClient {
    connectManager:WsConnectManager;
    constructor(private token: string) {
        this.connectManager = new WsConnectManager(token, {
            onconnect: (ws) => {
                ws?.on('message', (data) => {
                    
                });
            },
            onreset: () => { },
            onclose: () => { },
        });
    }
    routeEvent(){

    }
}

//const client = new WebsocketClient('1/MjYyOTg=/ONxsTfp41qeKE3bhcuPTlg==');
//client.connectGateway();



