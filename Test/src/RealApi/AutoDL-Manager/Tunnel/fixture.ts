/** Tunnel 测试的**假服务脚本**
 *
 * ## 为什么不用真服务
 * `Tunnel` 层的契约是**与服务无关**的：起（`bash start_xxx.sh`）、
 * 探（`pgrep` / `probe_xxx.sh`）、停（`pkill`）、日志（`log_xxx.sh`）。
 * 拿 ComfyUI 那套来测有两个硬伤：
 * 1. **CPU 实例起不来 ComfyUI** —— 测试要么跳过、要么必须烧 GPU
 * 2. **服务行为不可控** —— 想造「慢启动以制造撞锁」就得求人改镜像
 *
 * 故测试自备一套脚本：上传到远端一个临时目录，跑完删掉。
 * 这样**服务的每一分行为都由测试决定**，且模块层彻底与具体用例解耦。
 *
 * ## 假服务的形态
 * 一个极简 HTTP 服务（`python3 -m http.server`），因此可以测完整的**两层判据**：
 * | 判据 | 含义 |
 * |------|------|
 * | `alive` | 进程在不在（`pgrep` 命中 tag） |
 * | `ready` | **端口真的能服务请求**（`probe_xxx.sh` 打它） |
 *
 * 「进程在但还不能服务」正是 ComfyUI 慢启动的形态 —— 现在可以**精确构造**它。
 */

/** 测试用远端脚本目录（每个测试集独占，`afterAll` 删除） */
export const FIXTURE_DIR = "/root/akaset_test_tunnel";

/** 假服务用到的端口（避开生产服务的 6005/6006/7890） */
export const FIXTURE_PORT = {
    /** 「快」服务：立即监听 */
    fast: 18101,
    /** 「慢」服务：启动后先睡 `SLOW_START_SEC` 秒才监听 —— 用来制造撞锁窗口 */
    slow: 18102,
};

/** 慢服务**启动到就绪**的等待秒数（远大于一次抢锁+启动的耗时，保证重叠） */
export const SLOW_START_SEC = 6;

/** 测试用服务的 `unique_tag`
 *
 * 带 `akaset_test_` 前缀，与生产服务的 `comfyui_manager_*` 完全隔离 ——
 * 即使同时在同一台实例上跑，也不会互相 `pkill` 到。
 */
export const FIXTURE_TAG = {
    fast: "akaset_test_fast",
    slow: "akaset_test_slow",
} as const;

/** 假服务的种类 */
export type FixtureKind = keyof typeof FIXTURE_TAG;

/** 生成某个假服务的启动脚本
 *
 * ## ⚠️ 脚本必须**自己是短命**的 —— 拉起就返回
 * 合约是：`start_<svc>.sh` **内部自行保活**，然后立刻 `return`。
 * 若在这里直接 `exec` 成服务进程（那样会永不返回），
 * mgr 那条 `ssh.exec("bash start_xxx.sh")` 就会挂到超时 ——
 * 实测踩到：`退出码 null`，且要等满 5 分钟。
 *
 * 故这里用 `screen -dmS <tag>` 把服务丢进脱离会话，脚本自己**立刻退出**。
 * 这与生产脚本（`_common.sh` 里的 `comfyui_manager_run`）是同一套做法。
 *
 * ## 为什么不用 `exec -a`
 * `python3 -m http.server` 依赖 `sys.argv` 的常规布局，
 * `exec -a` 改掉 `argv[0]` 后会让 `-m` 解析错位。
 * 但 screen 的 `-S <tag>` 已经让**会话名**带上了 tag，
 * 而 `pgrep -f` 会命中 `screen -dmS <tag> …` 这条命令行 —— 探测照样成立。
 *
 * （服务本体自身的 `argv[0]` 仍是 `python3`，故用 `^tag` 数不到它；
 *  测试里数「份数」时改用 screen 会话数，见 lock.test.ts 的说明。）
 *
 * @param kind - 假服务种类
 * @returns 脚本内容
 */
export const startScriptOf = (kind: FixtureKind): string => {
    const port = FIXTURE_PORT[kind];
    const tag = FIXTURE_TAG[kind];
    const sleepSec = kind === "slow" ? SLOW_START_SEC : 0;
    const logf = logPathOf(kind);

    // 服务主体：可选地先睡一会儿，再起 HTTP
    const body = sleepSec > 0
        ? `echo "FIXTURE_SLOW_START\ndelay=${sleepSec}s"\nsleep ${sleepSec}\necho "FIXTURE_LISTENING port=${port}"\nexec ${"/root/miniconda3/bin/python3"} -m http.server ${port} --bind 127.0.0.1`
        : `echo "FIXTURE_FAST_START"\necho "FIXTURE_LISTENING port=${port}"\nexec ${"/root/miniconda3/bin/python3"} -m http.server ${port} --bind 127.0.0.1`;

    return `#!/usr/bin/env bash
# 测试用假服务: ${kind}
#
# 约定（与真实脚本一致）：
#  - **立即返回** —— 保活交给 screen，不等服务退出
#  - 会话名 = tag，使 mgr 的 pgrep -f 能扫到
set -u

TAG="${tag}"
LOGF="${logf}"

# 已在跑就什么都不做（幂等）
if screen -ls 2>/dev/null | grep -q "[.]\${TAG}[[:space:]]"; then
    echo "FIXTURE_ALREADY_RUNNING tag=\${TAG}"
    exit 0
fi

screen -wipe >/dev/null 2>&1 || true

# 服务输出同时进日志文件与终端
screen -dmS "\${TAG}" bash -c '${body.replace(/'/g, `'\\''`)}' 2>&1 | tee -a "\${LOGF}" >/dev/null

echo "FIXTURE_STARTED tag=\${TAG} port=${port}"
exit 0
`;
};

/** 生成某个假服务的探测脚本
 *
 * 判据是**端口真的能服务请求**，而不是「进程在」——
 * 这样 `alive=true, ready=false` 这个中间态才有意义。
 *
 * 只看退出码（与 mgr 的契约一致）：0 = 就绪。
 *
 * @param kind - 假服务种类
 * @returns 脚本内容
 */
export const probeScriptOf = (kind: FixtureKind): string => {
    const port = FIXTURE_PORT[kind];
    return `#!/usr/bin/env bash
# 测试用假服务的就绪探测: ${kind}
#
# 判据是**端口能响应**，不是「进程在」——
# 慢服务在前 ${SLOW_START_SEC} 秒内进程在但端口不通，正好用来测这一层。
set -u
curl -fs --max-time 3 "http://127.0.0.1:${port}/" >/dev/null 2>&1
`;
};

/** 生成某个假服务的日志跟随脚本
 *
 * 契约：**零参数、纯跟随、永不自行结束**。
 * 这里跟随一个由 start 脚本 `tee` 出来的日志文件。
 *
 * @param kind - 假服务种类
 * @returns 脚本内容
 */
export const logScriptOf = (kind: FixtureKind): string =>
    `#!/usr/bin/env bash
# 测试用假服务的日志跟随: ${kind}（纯跟随, 永不自行结束）
set -u
exec tail -n 0 -F "${FIXTURE_DIR}/${FIXTURE_TAG[kind]}.log" 2>/dev/null
`;

/** 假服务在**远端**的日志文件路径（start 脚本往里写） */
export const logPathOf = (kind: FixtureKind): string =>
    `${FIXTURE_DIR}/${FIXTURE_TAG[kind]}.log`;

/** 需要上传到远端的全部文件
 * @returns 相对文件名 → 内容
 */
export const fixtureFiles = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const kind of Object.keys(FIXTURE_TAG) as FixtureKind[]) {
        out[`start_${kind}.sh`] = startScriptOf(kind);
        out[`probe_${kind}.sh`] = probeScriptOf(kind);
        out[`log_${kind}.sh`] = logScriptOf(kind);
    }
    return out;
};
