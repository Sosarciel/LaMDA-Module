/** Tunnel 测试的服务**部署与清理**
 *
 * 与 {@link ./fixture} 配套：那边定义「假服务长什么样」，
 * 这边负责「把它放到远端、跑完收拾干净」。
 *
 * ## 为什么每个测试用**自己的**脚本目录
 * 生产脚本在 `/root/ComfyUI-Manager`，测试脚本在 `/root/akaset_test_tunnel` ——
 * 两者服务 tag 也不同（`comfyui_manager_*` vs `akaset_test_*`）。
 * 于是**测试与生产可以同时在同一台实例上跑而互不干扰**，
 * 也不会因为测试把生产服务停掉而影响正在进行的业务。
 */

import type { SshClient } from "@sosraciel-lamda/autodl-manager";
import { SLogger } from "@zwa73/utils";

import { FIXTURE_DIR, FIXTURE_PORT, FIXTURE_TAG, type FixtureKind, fixtureFiles } from "./fixture";

/** 只用到 `exec` 的最小 SSH 形状 —— 便于在测试里传轻量替身 */
type SshLike = { exec: (cmd: string) => Promise<{ stdout: string }> };

/** 彻底停掉某个假服务，并**确认**它真的不在了
 *
 * ## 为什么不能只 `pkill`
 * 服务是 `screen` 会话里跑的 `python3 -m http.server`：
 * `pkill -f '^<tag>'` 只命中**会话名**那条命令行，服务本体（`argv[0]` 是
 * `python3`）不一定被带走；而 `screen -wipe` 又只清死会话。
 * 结果就是「以为停了其实还在」—— 后续用例会踩到上一个用例的残留，
 * 表现为「探测早已就绪」「锁没起作用」这类**假失败**。
 *
 * 故这里按**会话 + 端口**双管齐下，并轮询到确实清干净为止。
 *
 * @param param.ssh  - SSH 客户端
 * @param param.kind - 假服务种类
 */
export const stopFixture = async (param: { ssh: SshLike; kind: FixtureKind }): Promise<void> => {
    const { ssh, kind } = param;
    const tag = FIXTURE_TAG[kind];
    const port = FIXTURE_PORT[kind];

    await ssh.exec(`screen -S '${tag}' -X quit >/dev/null 2>&1 || true`);
    await ssh.exec(`pkill -f 'http.server ${port}' >/dev/null 2>&1 || true`);
    await ssh.exec(`screen -wipe >/dev/null 2>&1 || true`);

    for (let i = 0; i < 20; i++) {
        const r = await ssh.exec(
            `curl -fs --max-time 1 http://127.0.0.1:${port}/ >/dev/null 2>&1 && echo STILL_UP || echo GONE;`
            + ` screen -ls 2>/dev/null | grep -c '[.]${tag}[[:space:]]'`);
        const lines = r.stdout.trim().split(/\r?\n/);
        if (lines[0] === "GONE" && Number(lines[1] ?? "0") === 0) return;
        await new Promise(r2 => setTimeout(r2, 300));
    }
    throw new Error(`假服务 ${kind} 未能停干净（端口 ${port} 仍有响应或会话仍在）`);
};

/** 某个假服务当前是否在跑（会话存在且端口有响应）
 *
 * @param param.ssh  - SSH 客户端
 * @param param.kind - 假服务种类
 * @returns 是否在跑
 */
export const isFixtureUp = async (param: { ssh: SshLike; kind: FixtureKind }): Promise<boolean> => {
    const { ssh, kind } = param;
    const tag = FIXTURE_TAG[kind];
    const port = FIXTURE_PORT[kind];
    const r = await ssh.exec(
        `curl -fs --max-time 3 http://127.0.0.1:${port}/ >/dev/null 2>&1 && echo UP || echo DOWN;`
        + ` screen -ls 2>/dev/null | grep -c '[.]${tag}[[:space:]]'`);
    const lines = r.stdout.trim().split(/\r?\n/);
    return lines[0] === "UP" && Number(lines[1] ?? "0") >= 1;
};

/** 把假服务脚本上传到远端并赋可执行权限
 *
 * @param ssh - SSH 客户端
 */
export const deployFixtures = async (ssh: SshClient): Promise<void> => {
    // 先清一次：上一轮若异常中断，可能留下旧脚本/旧日志
    await ssh.exec(`rm -rf '${FIXTURE_DIR}'`);

    for (const [name, content] of Object.entries(fixtureFiles())) {
        await ssh.uploadText(content, `${FIXTURE_DIR}/${name}`);
        await ssh.exec(`chmod +x '${FIXTURE_DIR}/${name}'`);
    }

    // 语法自检：脚本写错时立刻暴露，而不是等到「服务起不来」再去猜
    const bad = await ssh.exec(
        `for f in '${FIXTURE_DIR}'/*.sh; do bash -n "$f" || echo "BAD:$f"; done; echo CHECKED`);
    if (bad.stdout.includes("BAD:")) {
        throw new Error(`假服务脚本语法错误: ${bad.stdout}`);
    }

    SLogger.info(`  假服务已部署到 ${FIXTURE_DIR}`);
};

/** 停掉所有假服务并删除整个测试目录
 *
 * **幂等** —— 即使什么都没起、目录不存在也不报错，
 * 免得收尾失败把测试结果染红。
 *
 * @param ssh - SSH 客户端
 */
export const cleanupFixtures = async (ssh: SshClient): Promise<void> => {
    try {
        // 按 tag 停（与 mgr 的判据同源），再兜底 wipe 死会话
        await ssh.exec("pkill -f '^akaset_test_' 2>/dev/null || true");
        await ssh.exec("screen -wipe >/dev/null 2>&1 || true");
        await ssh.exec(`rm -rf '${FIXTURE_DIR}'`);
        SLogger.info(`  假服务与测试目录已清理`);
    } catch (e) {
        // 收尾失败不该让测试变红
        SLogger.warn(`  清理假服务失败(不影响结果): ${e}`);
    }
};
