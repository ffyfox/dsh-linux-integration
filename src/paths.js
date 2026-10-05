/**
 * XDG / FreeDesktop 路径解析。
 *
 * 所有路径都在这里集中推导，绝不散落在各处 —— 这样隔离测试只需要设置一个
 * 环境变量 `DSH_DESKTOP_ROOT`，就能把全部读写重定向到沙箱目录，不会碰到
 * 真实用户目录。
 *
 * @module dsh-linux-integration/paths
 */

import os from 'node:os'
import path from 'node:path'

/** 应用在 XDG 目录里使用的统一目录名。 */
export const APP_DIRNAME = 'dsh-lxi'

/**
 * 图标主题里注册的图标名（不含扩展名）。
 *
 * 图标名是**全局命名空间**：主题按名字查找，任何软件都可以占用同一个名字。官方
 * Electron 桌面端的入口用的就是 `deepseek-harness`，本插件早期也用了同一个名字，
 * 并把自己那张位图写进**用户级** hicolor —— 而用户级优先级高于 `/usr/share`。于是
 * 官方端到底显示哪张图，取决于查询工具与请求尺寸（实测：GTK 在 ≤64px 命中系统 SVG、
 * ≥128px 命中用户级 PNG；Qt 一律命中用户级 PNG），两边图标就串了。
 *
 * 所以本插件的图标名必须留在自己的命名空间里：与命令、目录、启动器同名，不再复用
 * 任何别人的名字。`RETIRED_ICON_NAMES` 里的历史名字只用于清理，不参与新文件生成。
 */
export const ICON_NAME = 'dsh-lxi'

/**
 * 曾经使用、如今已退役的图标名。
 *
 * 只用于清理历史遗留（见 `installer.js` 的退役图标清理步骤）——历史版本把这些名字的
 * 位图写进了用户级 hicolor，不清掉就会继续遮挡别人同名的图标。
 */
export const RETIRED_ICON_NAMES = ['deepseek-harness']

/**
 * 安装到 hicolor 主题的位图尺寸档位。
 *
 * 图标源是位图而不是矢量，所以没有「一个文件任意缩放」这回事 —— 主题按
 * **目录名**索引尺寸，只装一档的话，比它大的槽位只能拉伸放大。多装几档是
 * 图标主题的常规做法。512 那一档直接复制源文件，不需要任何外部转换器，
 * 因此无论系统上有没有 ImageMagick，`Icon=` 指向的图标名都能解析到。
 */
export const ICON_SIZES = [128, 256, 512]

/**
 * 某个尺寸档位对应的 apps 目录。
 *
 * @param {string} iconThemeDir hicolor 主题根目录。
 * @param {number} size 边长（像素）。
 * @returns {string}
 */
export function iconDirFor(iconThemeDir, size) {
  return path.join(iconThemeDir, `${size}x${size}`, 'apps')
}

/**
 * 某个尺寸档位下的图标文件路径。
 *
 * `name` 默认是当前图标名；清理历史遗留图标时需要显式传退役名，因此留出这个参数。
 *
 * @param {string} iconThemeDir hicolor 主题根目录。
 * @param {number} size 边长（像素）。
 * @param {string} [name] 图标名，默认 {@link ICON_NAME}。
 * @returns {string}
 */
export function iconFileFor(iconThemeDir, size, name = ICON_NAME) {
  return path.join(iconDirFor(iconThemeDir, size), `${name}.png`)
}

/** 桌面入口的 basename（不含 .desktop）。 */
export const DESKTOP_ENTRY_ID = 'dsh'

/** 由本插件生成的启动脚本文件名。 */
export const LAUNCHER_FILENAME = 'dsh-lxi-app'

/**
 * 放到 `~/.local/bin` 的 CLI 垫片文件名。
 *
 * 为什么需要它：`dsh-lxi` 这个 bin 装完在 `<profile>/node_modules/.bin/` 里，
 * **不在用户的 PATH 上**。于是「dsh-lxi stop」这种提示就没法照做。垫片把
 * 绝对路径固化下来，让命令真的能用。
 */
export const CLI_SHIM_FILENAME = 'dsh-lxi'

/**
 * 推导全部相关路径。
 *
 * @param {NodeJS.ProcessEnv} [env] 环境变量来源，默认 `process.env`。
 * @returns {{
 *   home: string, sandboxed: boolean,
 *   configHome: string, dataHome: string, cacheHome: string, runtimeHome: string,
 *   devRootDir: string,
 *   binDir: string, configDir: string, configFile: string,
 *   applicationsDir: string, desktopEntryFile: string,
 *   iconThemeDir: string, iconSizes: number[],
 *   launcherFile: string,
 *   chromeProfileDir: string,
 *   runtimeDir: string, runtimeEnvFile: string, runtimeJsonFile: string,
 *   logFile: string, backupsDir: string, kwinRulesFile: string,
 *   hyprlandConfFile: string, hyprlandLuaFile: string,
 * }}
 */
export function resolvePaths(env = process.env) {
  const home = env.HOME && env.HOME.length > 0 ? env.HOME : os.homedir()
  const sandbox = env.DSH_DESKTOP_ROOT && env.DSH_DESKTOP_ROOT.length > 0 ? env.DSH_DESKTOP_ROOT : null
  const sandboxed = sandbox !== null

  // 沙箱模式下把 home 也换掉，并**忽略所有 XDG_* 变量** —— 否则一旦用户环境里
  // 设了 XDG_CONFIG_HOME / XDG_DATA_HOME，隔离测试就会写进真实目录。
  const effectiveHome = sandboxed ? path.join(sandbox, 'home') : home

  const xdgConfigHome = !sandboxed && env.XDG_CONFIG_HOME ? env.XDG_CONFIG_HOME : path.join(effectiveHome, '.config')
  const xdgDataHome = !sandboxed && env.XDG_DATA_HOME ? env.XDG_DATA_HOME : path.join(effectiveHome, '.local', 'share')
  const xdgCacheHome = !sandboxed && env.XDG_CACHE_HOME ? env.XDG_CACHE_HOME : path.join(effectiveHome, '.cache')

  // XDG_RUNTIME_DIR 是「本次登录会话」的临时目录，注销即清空 —— 正好适合放
  // 运行时状态（端口 / 进程号 / 带 token 的地址）。沙箱模式或没有该变量时
  // 退回到一个按 uid 隔离的临时目录（沙箱下则退回沙箱内部，保证完全隔离）。
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'nobody'
  const xdgRuntimeHome = sandboxed
    ? path.join(sandbox, 'runtime')
    : env.XDG_RUNTIME_DIR
      ? env.XDG_RUNTIME_DIR
      : path.join(os.tmpdir(), `dsh-lxi-runtime-${uid}`)

  const configDir = path.join(xdgConfigHome, APP_DIRNAME)
  const applicationsDir = path.join(xdgDataHome, 'applications')
  const iconThemeDir = path.join(xdgDataHome, 'icons', 'hicolor')

  const runtimeDir = path.join(xdgRuntimeHome, APP_DIRNAME)

  return {
    home: effectiveHome,
    sandboxed,

    configHome: xdgConfigHome,
    dataHome: xdgDataHome,
    cacheHome: xdgCacheHome,
    runtimeHome: xdgRuntimeHome,

    /**
     * 「开发模式」用的沙箱根目录。
     *
     * 它同时被两处引用，必须一致：桌面入口的右键动作把它作为 `DSH_DESKTOP_ROOT`
     * 传给启动器，而插件读同一个变量后会把 config / data / runtime / bin **全部**
     * 重定向到这里（见本文件顶部的推导）。
     *
     * 为什么需要它：插件的 `autoInstall` 会写 `~/.local/bin` 与
     * `~/.local/share/applications`，这些**不随 profile 分家**。没有这层沙箱，
     * 用开发版代码启动一次就会覆盖掉日常那套的启动器与桌面入口。
     */
    devRootDir: path.join(xdgCacheHome, `${APP_DIRNAME}-dev`),

    binDir: path.join(effectiveHome, '.local', 'bin'),
    configDir,
    configFile: path.join(configDir, 'config.json'),

    applicationsDir,
    desktopEntryFile: path.join(applicationsDir, `${DESKTOP_ENTRY_ID}.desktop`),

    iconThemeDir,
    iconSizes: ICON_SIZES,

    launcherFile: path.join(effectiveHome, '.local', 'bin', LAUNCHER_FILENAME),
    cliShimFile: path.join(effectiveHome, '.local', 'bin', CLI_SHIM_FILENAME),

    // 专用浏览器配置目录：独立进程 → 窗口关闭时进程结束 → 启动器可以可靠地
    // 等到「窗口已关闭」这一事实。见 README 的「生命周期」一节。
    chromeProfileDir: path.join(xdgDataHome, APP_DIRNAME, 'chromium-profile'),

    runtimeDir,
    runtimeEnvFile: path.join(runtimeDir, 'runtime.env'),
    runtimeJsonFile: path.join(runtimeDir, 'runtime.json'),

    logFile: path.join(xdgRuntimeHome, `${APP_DIRNAME}-web.log`),
    backupsDir: path.join(configDir, 'backups'),

    kwinRulesFile: path.join(xdgConfigHome, 'kwinrulesrc'),

    // Hyprland 两套配置格式并存：0.56 起全新安装生成 hyprland.lua（Lua 语法），
    // 老用户升级上来的仍是 hyprland.conf（hyprlang 语法）。同时存在时 .lua 优先。
    hyprlandConfFile: path.join(xdgConfigHome, 'hypr', 'hyprland.conf'),
    hyprlandLuaFile: path.join(xdgConfigHome, 'hypr', 'hyprland.lua'),
  }
}
