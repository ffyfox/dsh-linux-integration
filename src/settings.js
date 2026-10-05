/**
 * 桌面集成的 `Config` schema，以及「DSH 设置层 → 生效配置」的合并规则。
 *
 * ## DSH 0.2 的机制（2026-10-06 实测）
 *
 * 设置页的表单不再由插件注册，而是 `dsh-settings` 从**插件模块导出的 `Config`**
 * 派生：`describe()` 只列出「`fiber.runtime.Config` 存在、且至少有一个 volatile
 * 字段」的条目，键就是**这一行在 profile 补丁里的 id**（本包 = `dsh-lxi`）。
 * 用户改的值不写进插件自己的 config.json，而写进
 * `~/.dsh/profiles/<名>/cordis.patch.yml` 的 `- id: dsh-lxi` + `config:` 之下。
 *
 * 注意「自动生成表单」这件事：`dsh-settings` 会把表单描述符与 `autoGenerate` 一起
 * 报出来，但**目前没有任何已发布的客户端消费它**（0.2.0-rc.2 与桌面端自带的
 * 0.2.1-alpha.1 都只把它当 wire 字段传）。所以界面仍由本包自己的
 * `src/client.js` 画，挂到侧栏「插件」页的 `plugins.row.config` 槽位上。
 *
 * ## 三件必须记牢的事
 *
 * 1. **只有根节点是 volatile**（`z.object({…}).volatile()`）。根节点 volatile 时
 *    `isVolatilePath` 对**任意路径**都返回 true，卡片才能按「一整组 window」这种
 *    粒度写；反过来，若改成逐字段 volatile，写 `path: ['window']` 会被宿主以
 *    「不是 volatile 字段」拒绝 —— 而卡片正是这么写 window 的。schemastery 另外
 *    禁止 volatile 套 volatile，所以子字段一律不加 volatile。
 * 2. **一律不写 `.default()`**。写了默认值，cordis 解析后的 config **总是**带全部
 *    键，于是「config.json → 设置层」的合并会用 schema 默认值把用户在 config.json
 *    里改过的值静默压掉。不写默认值时缺键就是缺席（实测：既不写 `.default()` 也
 *    不写 `.required()` 时，缺键不报错、也不出现在结果里），合并因此是精确的。
 *    代价是设置页上从没设置过的字段显示为空 —— 那正是「沿用 config.json」。
 * 3. **值可能被包成 volatile 引用**。schemastery 把 volatile 的值包成
 *    `{ get(), [Symbol.for('cosmokit.volatile.write')] }`，要 `.get()` 才拿到真值。
 *    `isVolatile` 用 `Symbol.for` 判定，所以**不需要**把 cosmokit 变成依赖。
 *
 * ## 合并规则
 *
 * 生效值 = `config.json` → DSH 设置层（只取真正出现过的键）。
 * `host` / `port` **刻意不进 schema**：它们必须与 `dsh web` 实际绑定的地址一致，
 * 放进设置页只会制造两份互相矛盾的真相。
 *
 * schema 只约束**类型**，不约束范围：`config.js` 的 `normalizeConfig` 才是范围
 * 权威（320–20000，非法值回落到默认值并 warn）。两层判定必须一致 —— schema 若
 * 更严，一个 `window.width: 200` 的手改补丁会让**整行加载失败**，而它在
 * config.json 里只是一条警告。
 *
 * ## 为什么 schemastery 是「同步 + 退路」加载
 *
 * `Config` 必须是模块加载时就已存在的导出（cordis 直接读 `runtime.Config`），
 * 没法像 0.6.x 那样「用到才 await import」。所以这里同步解析：先试本包自己的
 * 依赖，再退回**正在运行的这个 dsh 进程**安装目录里的那一份 —— pnpm 的 `link:`
 * 协议不解析被链接包自己的依赖，那条安装路只能靠退路。两条都不通时 `Config`
 * 是 `undefined`：插件照常加载、桌面集成照常工作，只是设置页没有这张卡片。
 *
 * @module dsh-linux-integration/settings
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

/**
 * 设置命名空间名（= 本行在 profile 补丁里的 id）。
 *
 * 与 `src/index.js` 的 `name`、`cordis.patch.yml` 的行 `id`、`src/client.js` 的
 * `NAMESPACE` 四处必须一致；`dsh-settings` 按行 id 键控表单，所以这个名字会变成
 * 永久的设置存储键。
 */
export const SETTINGS_NAMESPACE = 'dsh-lxi'

/**
 * 进 DSH 设置层的字段。这份清单同时被 schema 与合并函数使用，所以两处不可能走偏。
 */
export const SETTINGS_FIELDS = [
  'profileMode',
  'browser',
  'window',
  'autoInstall',
  'manageKwinRules',
  'manageHyprlandRules',
  'terminalAction',
  'terminalCommand',
]

/**
 * 「灰字提示」用的 meta 键：挂在 schema **根节点**的 meta 上。
 *
 * 每个键是**客户端草稿名**（`windowWidth` / `windowHeight` 这种），值是「清空这个
 * 字段后会回落到什么」的文本 —— 也就是 `config.json` 里归一化后的当前值。
 *
 * 为什么走 meta 而不是 schema 的 `.default()`：默认值参与 cordis 的配置解析，
 * 会把 `config.json` 里用户改过的值静默压掉（见文件头的说明）；meta 只是随 schema
 * 发给浏览器看的显示信息，**不参与任何解析**。实测它能完整活过
 * `plainSchema`（`new z(schema.toJSON())` + 只删 `volatile`）与 `toJSON()` 两趟，
 * 所以浏览器一次属性读取即可拿到，不必遍历 schema 引用图。
 *
 * ⚠️ 键名必须与 `src/client.js` 的 `DRAFTS` 一一对应（有用例钉住）。
 */
export const PLACEHOLDER_META = 'x-dsh-lxi-placeholders'

/**
 * 把配置归一成「灰字提示」表。
 *
 * @param {object} config `src/config.js` 归一化后的完整配置。
 * @returns {Record<string, string>} 草稿名 → 提示文本。
 */
export function settingsPlaceholders(config) {
  const text = (value) => (value === undefined || value === null ? '' : String(value))
  const source = config && typeof config === 'object' ? config : {}
  return {
    profileMode: text(source.profileMode),
    browser: text(source.browser),
    windowWidth: text(source.window?.width),
    windowHeight: text(source.window?.height),
    autoInstall: text(source.autoInstall),
    manageKwinRules: text(source.manageKwinRules),
    manageHyprlandRules: text(source.manageHyprlandRules),
    terminalAction: text(source.terminalAction),
    terminalCommand: text(source.terminalCommand),
  }
}

/**
 * 把「灰字提示」写进 schema 的根 meta。
 *
 * 每次读到 `config.json` 都刷新一次，所以用户在设置页看到的灰字始终是「此刻清空
 * 会回落到什么」。schema 不存在（宿主机没有 schemastery）时安静跳过。
 *
 * @param {any} schema `Config`。
 * @param {object} config `src/config.js` 归一化后的完整配置。
 * @returns {boolean} 是否写成功。
 */
export function setPlaceholders(schema, config) {
  // schemastery 的 schema 是**可调用的对象**（`typeof` 是 'function'），所以两种都收。
  if (schema === undefined || schema === null) return false
  if (typeof schema !== 'object' && typeof schema !== 'function') return false
  if (schema.meta === undefined || schema.meta === null) return false
  schema.meta[PLACEHOLDER_META] = settingsPlaceholders(config)
  return true
}

/** 运行期依赖：`Config` 在模块加载时就要用它构造。 */
const SCHEMASTERY_PACKAGE = '@deepseek-ai/schemastery'

/**
 * volatile 引用的记号。
 *
 * `@deepseek-ai/cosmokit` 用 `Symbol.for('cosmokit.volatile.write')` 标记 volatile
 * 值；`Symbol.for` 走的是全局注册表，所以这里能拿到同一个符号而无需依赖 cosmokit。
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * 判断一个值是不是 volatile 引用。
 *
 * 判定方式与 cosmokit 的 `isVolatile` 完全一致（`write in value`），只是符号来源
 * 不同 —— 见 `VOLATILE_WRITE` 的说明。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isVolatile(value) {
  return typeof value === 'object' && value !== null && VOLATILE_WRITE in value
}

/**
 * 取出 volatile 引用里的真值；普通值原样返回。
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function unwrapVolatile(value) {
  return isVolatile(value) ? value.get() : value
}

/**
 * 用传入的 schemastery 实例构造 Config schema。
 *
 * 接受 `z` 而不是自己加载，是为了让 schema 本身可以在零依赖的测试里被检查。
 *
 * @param {any} z schemastery 默认导出。
 * @returns {any} schema。
 */
export function createSettingsSchema(z) {
  return z
    .object({
      profileMode: z.union([z.const('dedicated'), z.const('shared')]),
      browser: z.string(),
      window: z
        .object({
          width: z.number(),
          height: z.number(),
        })
        // schemastery 给「对象」schema 的 `meta.default` 就是 `{}`，于是缺键时
        // 父级会**凭空长出一个 `window: {}`** —— 那会让 settingsOverlay 认为
        // 「用户设置过 window」，把 config.json 里的宽高压回默认值。
        // 显式 `default(undefined)` 才是我们要的「缺键即缺席」。
        .default(undefined),
      autoInstall: z.boolean(),
      manageKwinRules: z.boolean(),
      manageHyprlandRules: z.boolean(),
      terminalAction: z.boolean(),
      terminalCommand: z.string(),
    })
    .volatile()
}

/**
 * 从宿主解析后的条目配置里挑出**真正被设置过**的那部分，作为设置层覆盖。
 *
 * 三件事都在这里收口：
 *   - 只挑 `SETTINGS_FIELDS` 里的键（`host` / `port` 之类永远进不来）；
 *   - 值为 `undefined` 的键**不出现** —— 它意味着「用户没在设置页里动过」，
 *     合并时必须让 config.json 继续说了算；
 *   - volatile 引用在这里解包（根节点与字段各一层，后者是为了将来留活口）。
 *
 * @param {unknown} entryConfig cordis 解析后传给 `apply` 的条目配置。
 * @returns {object} 设置层覆盖。
 */
export function settingsOverlay(entryConfig) {
  const source = unwrapVolatile(entryConfig)
  if (source === null || typeof source !== 'object') return {}

  const overlay = {}
  for (const field of SETTINGS_FIELDS) {
    const value = source[field]
    if (value === undefined) continue
    overlay[field] = unwrapVolatile(value)
  }
  return overlay
}

/**
 * 从**正在运行的这个 dsh 进程**所在的安装目录里找 schemastery。
 *
 * 做法是从 `process.argv[1]`（`dsh` 的可执行入口）取真实路径，逐级向上找
 * `node_modules/@deepseek-ai/schemastery`。找不到就返回空数组，调用方安静降级。
 *
 * @returns {string[]} 候选的 schemastery 目录，由近及远。
 */
function candidateSchemaModules() {
  const entry = process.argv[1]
  if (typeof entry !== 'string' || entry === '') return []

  let real
  try {
    real = fs.realpathSync(entry)
  } catch {
    return []
  }

  const candidates = []
  let dir = path.dirname(real)
  for (let depth = 0; depth < 6; depth += 1) {
    candidates.push(path.join(dir, 'node_modules', SCHEMASTERY_PACKAGE))
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return candidates
}

/**
 * 同步加载 schemastery。
 *
 * 顺序：本包自己的依赖 → dsh 安装目录里的那几份。只认 CJS 构建，因为 `require`
 * 无法同步加载 `.mjs`（`@deepseek-ai/schemastery` 两个入口都提供）。
 *
 * @returns {any | null} schemastery 的默认导出；两条路都不通时为 null。
 */
export function loadSchemastery() {
  const require = createRequire(import.meta.url)

  const from = (target) => {
    const loaded = require(target)
    return loaded?.default ?? loaded
  }

  try {
    return from(SCHEMASTERY_PACKAGE)
  } catch {
    // 本地 link: 安装时的常态，继续走退路。
  }

  for (const dir of candidateSchemaModules()) {
    for (const file of ['lib/index.cjs', 'lib/index.js']) {
      const candidate = path.join(dir, file)
      if (!fs.existsSync(candidate)) continue
      try {
        return from(candidate)
      } catch {
        // 换下一个候选。
      }
    }
  }
  return null
}

/**
 * 本行的 `Config`：cordis 读它来校验/归一化条目配置，`dsh-settings` 读它来派生
 * 设置页表单。
 *
 * 构造失败（宿主机上没有 schemastery）时是 `undefined` —— cordis 的
 * `resolveConfig` 对没有 `Config` 的插件直接原样返回配置，插件照常工作。
 *
 * @type {any}
 */
export const Config = (() => {
  try {
    const z = loadSchemastery()
    if (z === null) return undefined
    const schema = createSettingsSchema(z)
    // describe() 会调 schema.toJSON()，构造完立刻验一次，别等到服务端才炸。
    if (typeof schema?.toJSON !== 'function') return undefined
    schema.toJSON()
    return schema
  } catch {
    return undefined
  }
})()
