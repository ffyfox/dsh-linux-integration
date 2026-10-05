/**
 * `dsh-linux-integration` 的宿主插件行。
 *
 * 这一行跑在 `dsh web` 进程内部，只做三件事：
 *
 * 1. **发布运行时状态**：服务绑定端口之后，把「端口 / 进程号 / 带 token 的地址」
 *    写进 XDG 运行时目录。这是整个方案的信任基石 —— 桌面启动器因此能拿到
 *    鉴权地址，而不是只能去 grep 自己写的日志。
 *
 * 2. **幂等自愈桌面集成**：把桌面入口、图标、启动脚本、KWin 规则同步到当前版本。
 *    内容没变就不碰文件，所以每次启动的额外开销接近于零。
 *
 * 3. **导出 `Config`**：DSH 0.2 起，设置页的表单由 `dsh-settings` 从这个导出
 *    派生（按行 id 键控，值存进 profile 补丁文档）。不导出这一项，设置页上就
 *    永远没有本插件的条目 —— 详见 `src/settings.js`。
 *
 * 安全约定（对应需求「不应影响任何 dsh web 本身功能」）：
 *   - 通过 `inject` 声明依赖，缺少 connection / webServer 的 profile（tui、headless）
 *     里这一行会停在 PENDING 而不激活 —— 不会在任何其它 profile 里产生副作用。
 *   - 所有副作用都包在 try/catch 里，任何一步失败都只写日志，绝不向上抛。
 *   - 非 Linux 直接返回。
 *
 * @module dsh-linux-integration
 */

import { connectHost, readConfig } from './config.js'
import { detectDesktopEnvironment } from './detect.js'
import { install, pluginVersion } from './installer.js'
import { resolvePaths } from './paths.js'
import { clearRuntime, writeRuntime } from './runtime.js'
import { Config, SETTINGS_NAMESPACE, setPlaceholders, settingsOverlay } from './settings.js'

/**
 * 本行的 `Config` schema（见 `src/settings.js`）。
 *
 * cordis 读它来校验 / 归一化条目配置，`dsh-settings` 读它来派生设置页表单；
 * 宿主机上没有 schemastery 时它是 `undefined`，此时插件照常加载、只是没有
 * 设置页那张卡片。
 */
export { Config }

/**
 * Cordis 插件名（出现在 Loader 树与诊断里）。
 *
 * 必须与 `cordis.patch.yml` 里的行 `id` 一致 —— 那是这一行在 Loader 树里的身份。
 * 2026-10-06 由 `linux-desktop` 改为 `dsh-lxi`：0.6.0 那次整体更名漏了它，
 * 而新版 DSH 的设置表单正是**按行 id 键控**的（见 `src/settings.js` 的说明），
 * 所以这个名字会变成永久的设置存储键，越早定下来越好。
 */
export const name = 'dsh-lxi'

/**
 * 声明依赖的两个宿主服务。
 *
 * 这是一个「声明式开关」：`dsh web` 里有它们，插件才会激活；`dsh --profile tui`
 * 里没有，插件就永远停在 PENDING。桌面集成因此天然只作用于 web 界面。
 *
 * `settings` **刻意不在这里** —— 它只用来提供设置页卡片，属于可选增强。放进
 * 插件级 inject 会让整行在缺少设置服务的部署里停住，连运行时状态都发布不了。
 * 0.7.0 起本行连那个服务都不再需要：表单由 `Config` 导出派生（见
 * `src/settings.js`），生命周期通知走事件而不是服务依赖。
 */
export const inject = ['connection', 'webServer']

/**
 * Cordis 插件入口。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [config] 本行在 profile 补丁里的 `config:`，已由 cordis 按
 *   `Config` schema 解析（缺键缺席，不会有默认值填充 —— 见 `src/settings.js`）。
 */
export function apply(ctx, config) {
  if (process.platform !== 'linux') return

  const env = process.env
  const paths = resolvePaths(env)
  const version = pluginVersion()

  /**
   * 调试输出要不要镜像到 stderr。
   *
   * 必须镜像：DSH 的 `ctx.logger` **默认只进内存环形缓冲**（cordis 的 LoggerService
   * 默认 exporter 只 push 进 buffer，boot 只为「启动失败」收集 warn/error），全树
   * 没有任何输出到 stdout 的 exporter，`dsh` 也没有 `--verbose` 之类的开关。也就是
   * 说只走 `ctx.logger` 的诊断**任何地方都看不见** —— 而调试开关的意义正是让人看见。
   * 镜像后：从桌面图标启动时，启动器的 `>>"$LOG_FILE" 2>&1` 会把它落到
   * `$XDG_RUNTIME_DIR/dsh-lxi-web.log`（见 `src/assets/launcher.sh.tpl`）。
   */
  const debug = env.DSH_DESKTOP_DEBUG === '1'

  const log = (...args) => {
    try {
      const logger = ctx.logger?.('dsh-lxi')
      if (logger?.info) logger.info(...args)
      if (debug) console.error('[dsh-lxi]', ...args)
    } catch {
      // 日志本身绝不能成为失败源。
    }
  }
  const warn = (...args) => {
    try {
      const logger = ctx.logger?.('dsh-lxi')
      if (logger?.warn) logger.warn(...args)
      if (debug) console.error('[dsh-lxi]', ...args)
    } catch {
      /* ignore */
    }
  }

  // ---- 生效配置 ----------------------------------------------------------
  // 每次现读 config.json（用户可能正拿着编辑器改），再叠上 DSH 设置层的覆盖。
  // 覆盖层只包含「真在设置文档里出现过的键」，所以 config.json 里没被设置页
  // 动过的字段继续说了算；没有设置文档时覆盖层是空的，行为与本改动之前一致。
  let warnedAboutFile = false
  const fileConfig = () => {
    const result = readConfig(paths)
    if (!warnedAboutFile) {
      warnedAboutFile = true
      for (const warning of result.warnings) warn(warning)
    }
    // 每次读到 config.json 就把「清空后会回落到什么」刷进 schema 的根 meta：
    // 设置页里的灰字提示读的就是它（纯显示信息，不参与配置解析）。
    try {
      setPlaceholders(Config, result.config)
    } catch (error) {
      warn(`刷新设置页灰字提示失败：${error?.message ?? String(error)}`)
    }
    return result.config
  }
  /**
   * 读设置层覆盖。
   *
   * 每次都重新解包：`Config` 是 volatile 的，cordis 会原地更新那个引用，所以
   * 不能在 apply 里把值取出来存着。
   */
  const readOverlay = () => {
    try {
      return settingsOverlay(config)
    } catch (error) {
      warn(`读取设置覆盖层失败：${error?.message ?? String(error)}`)
      return {}
    }
  }
  const effectiveConfig = () => ({ ...fileConfig(), ...readOverlay() })

  // ---- 幂等自愈桌面集成 --------------------------------------------------
  const autoInstall = () => {
    try {
      const config = effectiveConfig()
      if (!config.autoInstall) {
        log('配置里关闭了 autoInstall，跳过自动安装')
        return
      }

      const desktop = detectDesktopEnvironment(env)
      if (!desktop.session.hasDisplay) {
        log('当前没有图形会话，跳过自动安装')
        return
      }

      const result = install({ paths, config, env, quiet: true })
      if (!result.ok) {
        const failure = result.steps.find((step) => step.status === 'failed')
        warn(`桌面集成自动安装未完成：${failure?.detail ?? '原因未知'}（可运行 dsh-lxi doctor 诊断）`)
        return
      }
      log(result.changed ? '桌面集成已安装 / 更新完成' : '桌面集成已是最新')
    } catch (error) {
      // 自动安装失败绝不能让 dsh web 起不来。
      warn(`桌面集成自动安装异常：${error?.message ?? String(error)}`)
    }
  }

  /**
   * 诊断：本行到底有没有被 `dsh-settings` 报成一张设置表单。
   *
   * 为什么值得专门写一条：设置界面「静默消失」是这个项目踩过两次的坑（0.6.0 漏改
   * 行 id；0.2 换了整套机制），而它在界面上**没有任何报错** —— 只有真人在意到
   * 「怎么没有那张卡片」才发现。宿主这一侧是唯一能看到真相的地方。
   *
   * 只在 `DSH_DESKTOP_DEBUG=1` 时跑，且必须在 Loader 树落定之后（describe() 会
   * 跳过还没进入 active 的条目，包括本行自己）。
   */
  const probeSettingsForm = () => {
    if (env.DSH_DESKTOP_DEBUG !== '1') return
    try {
      ctx.inject(['settings'], (settingsCtx) => {
        try {
          const descriptors = settingsCtx.settings.describe() ?? []
          const mine = descriptors.find((row) => row.ns === SETTINGS_NAMESPACE)
          if (mine) {
            log(
              `设置表单已就绪：ns=${mine.ns} autoGenerate=${String(mine.autoGenerate)} ` +
                `applies=${String(mine.applies)} revision=${String(mine.revision)}`,
            )
          } else {
            warn(
              `设置表单缺失：dsh-settings 没有报出 ${SETTINGS_NAMESPACE} —— ` +
                '检查 Config 导出与补丁里的行 id 是否一致',
            )
          }
        } catch (error) {
          warn(`读取设置表单描述符失败：${error?.message ?? String(error)}`)
        }
      })
    } catch (error) {
      warn(`接入 settings 服务失败：${error?.message ?? String(error)}`)
    }
  }

  // ---- 运行时状态 --------------------------------------------------------
  ctx.effect(() => {
    const publish = (reason) => {
      try {
        const port = ctx.webServer?.port
        if (typeof port !== 'number' || port <= 0) {
          // 端口 0 表示还没 bind（或由 OS 分配且尚未确定），等下一次机会。
          return false
        }
        const config = effectiveConfig()
        const host = connectHost(config)
        const base = `http://${host}:${String(port)}/`
        const url = ctx.connection.authenticatedUrl(base)
        writeRuntime(paths, { pid: process.pid, host, port, url, version })
        log(`运行时状态已发布（${reason}）：${host}:${String(port)} → ${paths.runtimeEnvFile}`)
        return true
      } catch (error) {
        warn(`发布运行时状态失败（${reason}）：${error?.message ?? String(error)}`)
        return false
      }
    }

    // 发布两次，是刻意的「双保险」：
    //   - 立刻发布一次：HTTP 服务在行激活时就 bind 了，此时桌面启动器可能已经在
    //     轮询运行时文件。越早出现，启动器拿到带 token 地址的窗口期就越短。
    //   - Loader 树落定后再发布一次：与 dsh-web-app 自己「打印 URL」的时机对齐，
    //     确保最终落盘的是权威值。
    // 两次写的是同一份内容（token 在进程生命周期内不变），重复写没有副作用。
    publish('immediate')

    try {
      const loader = ctx.get('loader')
      const settled = typeof loader?.await === 'function' ? loader.await() : undefined
      if (settled && typeof settled.then === 'function') {
        settled.then(
          () => {
            publish('after-loader')
            probeSettingsForm()
          },
          () => warn('等待 Loader 树落定失败，运行时状态仅保留了即时发布的那一份'),
        )
      }
    } catch (error) {
      warn(`等待 Loader 树时出错：${error?.message ?? String(error)}`)
    }

    return () => {
      // 进程正常退出时清掉运行时状态，避免启动器读到陈旧记录。
      // clearRuntime 内部会校验 pid，不会误删新进程刚写下的状态。
      try {
        clearRuntime(paths, { pid: process.pid })
      } catch {
        /* ignore */
      }
    }
  })

  // ---- 首次自愈 + 设置变更通知 -------------------------------------------
  // 先装一次：设置层可用与否都不影响桌面集成的自愈。
  autoInstall()

  // DSH 把设置写进 profile 补丁之后，**本行不会被重启**：cordis-plugin-loader 的
  // `_commitVolatile()` 对「只有 volatile 值变了」的更新走原地写入
  // （`updateVolatile(ref, source)` → `ref[write](source.get())`），并 emit
  // `loader/volatile-update`。本插件的 schema 是**根节点整体 volatile**，所以每一次
  // 保存都属于这种情况 —— 这个监听器因此不是冗余保险，而是「保存后立即生效」的
  // **唯一通路**：`readOverlay()` 每次现读那个引用，拿到的一定是新值。
  //
  // 不发日志：首次 describe() 也会发一次（revision 从「没见过」变成 0），那不是
  // 用户改动；而 install 本身会把结果写进日志（「已是最新」/「已安装 / 更新完成」）。
  try {
    ctx.on('settings/document-updated', (namespace) => {
      if (namespace !== SETTINGS_NAMESPACE) return
      autoInstall()
    })
  } catch (error) {
    warn(`订阅设置变更失败：${error?.message ?? String(error)}`)
  }
}
