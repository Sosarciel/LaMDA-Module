import { JObject, SLogger } from "@zwa73/utils";
import { IncomingHttpHeaders } from "http";
import https from "https";
import qs from "querystring";

export const httpsGet = async (opt:https.RequestOptions,json:Record<string,string|number>)=>{
    opt.path += `?${qs.stringify(json)}`;
    return await new Promise<{
        headers:IncomingHttpHeaders;
        body:JObject;
    } | undefined>((resolve, reject) => {
        const req = https.request(opt, (res)=>{
            let data = "";
            res.setEncoding("utf8");

            const headers = res.headers;
            res.on("data", (d)=>{
                data += d;
            });
            res.on("end", ()=>{
                try{
                    const body = JSON.parse(data) as JObject;
                    resolve({
                        headers,
                        body
                    });
                }catch(e){
                    SLogger.warn(`httpsGet 解析数据错误: ${e}`);
                    SLogger.warn(`raw: ${data}`);
                    resolve(undefined);
                }
            });
            res.on("error", (e) => {
                SLogger.warn(`httpsGet 接收请求错误: ${e.message}`);
                resolve(undefined);
            });
        });
        req.on("error", (e) => {
            SLogger.warn(
                `httpsGet 发送请求错误:${e}\r\ne.code:${e.message}`
            );
            resolve(undefined);
        });
        req.end();
    });
}