import { DBManager } from '@sosraciel-lamda/postgresql-manager';



let dbmgr:DBManager = undefined as any;

beforeAll(async ()=>{
    dbmgr = await DBManager.create({
        port:5433,
        user: 'postgres',
        database: 'postgres',
        host: 'localhost',
        max: 10,  // 最大连接数
        idleTimeoutMillis: 30000, // 30秒后关闭空闲连接
    });
});

afterAll(async ()=>{
    dbmgr.stop();
})

describe('PostgresSQL-Manager', () => {
    it('测试连接', async () => {
        const res = await dbmgr.client.sql`SELECT 1 as value;`;
        expect(res.rows[0].value).toBe(1);
    });
});

