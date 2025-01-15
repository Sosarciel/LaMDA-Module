








export class Endpoint {
    static buildEndpoint(version:3){
        const format = <T extends string>(basepath:T)=>`/api/v${version}/${basepath}` as const;

        return {
            /**获取网关 */
            Gateway:format('gateway/index'),
        }
    }
}