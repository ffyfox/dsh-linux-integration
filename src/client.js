/**
 * 浏览器半侧：Web 设置页「插件 → 插件配置」里的「桌面集成」卡片。
 *
 * ## 为什么要手写这个文件
 *
 * DSH 的客户端模块系统按需加载插件的 `dsh.client` 声明的 `./client` 出口，而那份
 * 产物的格式是 **lazy-CJS factory**：
 *
 * ```js
 * window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => { ... } })
 * ```
 *
 * 执行 bundle 只注册 factory，模块副作用（含 CSS 注入）都在 factory 闭包里，首次
 * 物化时才跑。官方的 `clientBundle` 构建预设没有作为包发布，所以仓库外的插件只能
 * 自己产出这个格式 —— 本文件就是手写的那份，因此：
 *
 *   - **不用 JSX**，只用 `react/jsx-runtime` 的 `jsx` / `jsxs`；
 *   - **不需要构建步骤**，与本项目「纯 ESM、零构建」的取向一致；
 *   - `id` 必须**逐字等于** package.json 的 `name`，否则加载器会拒绝注册。
 *
 * ## 卡片挂在哪（DSH 0.2 起）
 *
 * 0.2 把「配置插件」这件事搬去了侧栏的**插件**页：老设置页那个
 * `settings.plugin.item` keyed slot **已经不存在**（全包搜索只剩注释里的引用），
 * 改成 `dsh-client-ui-plugin-manager` 声明的三个槽位 —— `plugins.item`（官方插件）、
 * `plugins.bundle.config`（组合包，键 = 包名）、`plugins.row.config`（某一行，
 * 键 = `<包名>#<行 id>`）。本卡片挂**行**槽位：界面属于行，而 `Config` schema
 * 正是行的属性。
 *
 * 键必须逐字等于插件管理器的 `rowConfigKey(pkg.name, row.rowId)`；对不上就永远
 * 不会被派发，而且**不会报错** —— 只会静默消失。行上那个「配置」控件的显示条件
 * 就是这个键存在。
 *
 * 槽位会按 `view` 被渲染两次：`page`（行详情页正文）与 `summary`（行描述缺失时
 * 的兜底短句）。`summary` 会被塞进 `<p>` 里，所以那时必须返回 `null`。
 *
 * ## 依赖
 *
 * `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-store`、
 * `@deepseek-ai/dsh-client-ui-primitives` 都在外壳播种的模块表里，因此**不需要**
 * `dsh.client.external` 声明。
 */

window.__ModuleLoader__.load({
  id: 'dsh-linux-integration',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { jsx, jsxs } = require('react/jsx-runtime')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')

    /**
     * 按候选名取一个原件：名字在两代之间变过时用它兜底。
     *
     * 取不到任何一个时返回 `undefined`，而 `jsx(undefined, …)` 会让**整张卡片**在
     * 渲染时抛错 —— React 的表现是把那一块渲染成**空白**，页面其余部分照常、界面
     * 上没有任何提示。所以候选链本身要被用例盯着（见 test/smoke.mjs）。
     *
     * @param {string[]} names 候选的原件名，由新到旧。
     * @returns {Function | undefined} 第一个存在的原件。
     */
    function pickPrimitive(names) {
      for (const name of names) {
        if (primitives[name]) return primitives[name]
      }
      return undefined
    }

    /**
     * 折叠箭头用的图标。
     *
     * 图标原件的命名在两代之间变过：0.1.x 按**尺寸**命名
     * （`IconChevronDownOutline14`），0.2 改成按**字重**命名
     * （`IconChevronDownOutlineRegular` / `…Medium`，尺寸走 `size` 属性、默认就是 14）。
     * 实测踩过：写死旧名时行详情页里的卡片整块变成空白。
     */
    const ChevronDownIcon = pickPrimitive([
      'IconChevronDownOutlineRegular',
      'IconChevronDownOutlineMedium',
      'IconChevronDownOutline14',
    ])

    /** 必须逐字等于 package.json 的 name —— 也等于上面 `load({ id })` 的那一个。 */
    const PACKAGE_NAME = 'dsh-linux-integration'

    /** 设置命名空间：等于 `src/settings.js` 的 `SETTINGS_NAMESPACE`、补丁里的行 id。 */
    const NAMESPACE = 'dsh-lxi'

    /**
     * 行配置槽位的键：`<组合包名>#<行 id>`。
     *
     * 插件管理器用 `rowConfigKey(pkg.name, row.rowId)` 生成它；行上「配置」控件的
     * 显示条件就是它存在。
     */
    const ROW_KEY = `${PACKAGE_NAME}#${NAMESPACE}`

    /**
     * 「灰字提示」在 schema 根 meta 上的键。
     *
     * 必须与 `src/settings.js` 的 `PLACEHOLDER_META` 逐字一致（有用例钉住）。宿主把
     * 「清空这个字段后会回落到什么」（= `config.json` 的当前值）挂在这里，随
     * `settings.describe()` 一起发到浏览器 —— 纯显示信息，不参与配置解析。
     */
    const PLACEHOLDER_META = 'x-dsh-lxi-placeholders'

    /** 本包自己的文案命名空间。 */
    const LOCALE_NS = PACKAGE_NAME

    // -----------------------------------------------------------------------
    // 样式
    // -----------------------------------------------------------------------

    // 与 DSH 自带的插件卡片同构：同一边框、圆角、hover 与展开态，只是类名前缀
    // 换成自己的，避免和别的插件抢样式。颜色全部走主题变量，明暗主题都跟随。
    const CSS_SOURCE = [
      '.dsld_card{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;transition:border-color .16s,background .16s}',
      '.dsld_card:hover{border-color:var(--dsw-alias-label-dimmed)}',
      '.dsld_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}',
      '.dsld_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}',
      '.dsld_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.dsld_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}',
      '.dsld_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}',
      '.dsld_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}',
      '.dsld_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}',
      '.dsld_chevronOpen{transform:rotate(180deg)}',
      '.dsld_body{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}',
      '.dsld_readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}',
      '.dsld_pending{flex:none}',
      '.dsld_footer{border-top:.5px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}',
      '.dsld_failed{min-width:0;color:var(--dsw-alias-state-error-primary);flex:1;margin:0;font-size:12px;line-height:1.5}',
      '.dsld_discard,.dsld_save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}',
      '.dsld_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}',
      '.dsld_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}',
      '.dsld_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}',
      '.dsld_discard:disabled,.dsld_save:disabled{opacity:.4;cursor:default}',
      '.dsld_discard:focus-visible,.dsld_save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dsld_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}',
      '.dsld_field+.dsld_field{border-top:.5px solid var(--dsw-alias-border-l2)}',
      '.dsld_head{align-items:center;gap:8px;display:flex}',
      '.dsld_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}',
      '.dsld_badges{align-items:center;gap:8px;display:inline-flex}',
      '.dsld_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}',
      '.dsld_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
      '.dsld_reset:disabled{cursor:default}',
      '.dsld_input{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}',
      '.dsld_input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}',
      // 灰字提示统一走三级文字色，明暗主题都跟随（浏览器默认的 placeholder 色偏淡且不跟主题）。
      '.dsld_input::placeholder{color:var(--dsw-alias-label-tertiary);opacity:1}',
      '.dsld_input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}',
      // 报错色只有一个来源：0.2 主题里的是 `--dsw-alias-state-error-primary`。曾经写成
      // `--dsw-alias-label-error` —— 那个名字在主题里根本不存在，`var()` 落空后整条声明
      // 变成无效值，于是红线不红、提示文字继承正文色（黑）。引用主题变量必须对着真表核。
      '.dsld_inputInvalid{border-color:var(--dsw-alias-state-error-primary)}',
      '.dsld_invalid{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:1.5}',
      '.dsld_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}',
      '.dsld_choices{align-items:center;gap:8px;display:flex}',
      '.dsld_sizeRow{gap:8px;display:flex}',
      '.dsld_sizeCell{flex:1;min-width:0;flex-direction:column;gap:6px;display:flex}',
      '.dsld_sizeRow .dsld_input{width:100%;min-width:0;box-sizing:border-box}',
    ].join('')

    const CSS_TAG_ID = 'dsh-linux-integration/card.css'
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_TAG_ID)}]`) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-linux-integration'
      tag.dataset.pluginCss = CSS_TAG_ID
      tag.textContent = CSS_SOURCE
      document.head.appendChild(tag)
    }

    const CSS = {
      card: 'dsld_card',
      cardOpen: 'dsld_cardOpen',
      header: 'dsld_header',
      headText: 'dsld_headText',
      name: 'dsld_name',
      description: 'dsld_description',
      chevron: 'dsld_chevron',
      chevronOpen: 'dsld_chevronOpen',
      body: 'dsld_body',
      readOnly: 'dsld_readOnly',
      pending: 'dsld_pending',
      footer: 'dsld_footer',
      failed: 'dsld_failed',
      discard: 'dsld_discard',
      save: 'dsld_save',
      field: 'dsld_field',
      head: 'dsld_head',
      label: 'dsld_label',
      badges: 'dsld_badges',
      reset: 'dsld_reset',
      input: 'dsld_input',
      inputInvalid: 'dsld_inputInvalid',
      invalid: 'dsld_invalid',
      hint: 'dsld_hint',
      choices: 'dsld_choices',
      sizeRow: 'dsld_sizeRow',
      sizeCell: 'dsld_sizeCell',
    }

    /**
     * 输入框的类名。
     *
     * `dsld_inputInvalid` 是**加**在基类上的修饰，绝不能替代它 —— 高度、内边距、圆角、
     * 字号全在 `.dsld_input` 上。一旦掉成裸 input，输入框会塌成一行高、变方角、字号回到
     * 浏览器默认，还会把我们故意关掉的主题焦点环（2px 蓝框）露出来。
     *
     * 2026-10-06 的线上 bug 正是这里：改成「空框 + 灰字」以后，第一个按键必然是 `1`
     * （< 320，非法），于是每敲一下输入框就塌一次、变回正常再塌一次。
     */
    const inputClass = (invalid) => (invalid ? `${CSS.input} ${CSS.inputInvalid}` : CSS.input)

    // -----------------------------------------------------------------------
    // 文案
    // -----------------------------------------------------------------------

    const zh = {
      title: '桌面集成',
      description: 'Linux 桌面入口、独立窗口与服务生命周期。',
      unsaved: '未保存',
      save: '保存',
      saving: '保存中…',
      discard: '放弃修改',
      saveFailed: '保存被拒绝，草稿已保留 —— 请检查取值后重试。',
      readOnly: '当前部署的设置为只读，无法保存修改。',
      expand: '展开',
      collapse: '收起',
      overridden: '已覆盖',
      reset: '重置',
      invalidNumber: '必须是 320–20000 之间的整数',
      profileModeLabel: '窗口模式',
      profileModeHint: 'dedicated 用独立浏览器配置目录，能可靠感知窗口关闭并自动停服务；shared 复用默认配置，但无法感知窗口关闭。',
      profileModeDedicated: '独立（dedicated）',
      profileModeShared: '共享（shared）',
      browserLabel: '浏览器',
      browserHint: 'auto 自动探测，或 chrome / chromium / brave / edge / vivaldi / opera，或可执行文件绝对路径。',
      windowWidthLabel: '窗口宽度',
      windowHeightLabel: '窗口高度',
      windowSizeHint: '独立窗口的初始尺寸（逻辑像素）。GNOME 下若窗口面积超过屏幕工作区约 80%，会被自动最大化，此处尺寸不生效。',
      autoInstallLabel: '启动时自动安装 / 自愈',
      autoInstallHint: '每次 dsh web 启动时把桌面入口、图标与 KWin 规则同步到当前版本。',
      manageKwinRulesLabel: '托管 KWin 窗口规则',
      manageKwinRulesHint: '仅 KDE Plasma 生效，用于把窗口调成上面的尺寸。',
      manageHyprlandRulesLabel: '托管 Hyprland 窗口规则',
      manageHyprlandRulesHint: '仅 Hyprland 生效。默认关闭 —— 此时窗口遵循平铺布局，上面的宽高设置不起作用；开启后会强制该窗口浮动并使用上面的尺寸。',
      terminalActionLabel: '「以终端界面运行」右键动作',
      terminalActionHint: '在桌面入口的右键菜单里附带一个用终端启动 dsh-tui 的动作。',
      terminalCommandLabel: '终端命令',
      terminalCommandHint: '留空则安装时自动探测已安装的终端。',
      hostPortNote: 'host 与 port 不在卡片里 —— 它们必须与 dsh web 实际绑定的地址一致，改请编辑 config.json。',
    }

    const en = {
      title: 'Desktop integration',
      description: 'Linux desktop entry, standalone window, and service lifecycle.',
      unsaved: 'Unsaved',
      save: 'Save',
      saving: 'Saving…',
      discard: 'Discard',
      saveFailed: 'The save was rejected and the draft was kept — check the values and retry.',
      readOnly: 'Settings are read-only in this deployment; changes cannot be saved.',
      expand: 'Expand',
      collapse: 'Collapse',
      overridden: 'Overridden',
      reset: 'Reset',
      invalidNumber: 'Must be an integer between 320 and 20000',
      profileModeLabel: 'Window mode',
      profileModeHint: 'dedicated uses a private browser profile so the window close can be observed and the service stopped; shared reuses your default profile but cannot observe the close.',
      profileModeDedicated: 'Dedicated',
      profileModeShared: 'Shared',
      browserLabel: 'Browser',
      browserHint: 'auto to detect, or chrome / chromium / brave / edge / vivaldi / opera, or an absolute executable path.',
      windowWidthLabel: 'Window width',
      windowHeightLabel: 'Window height',
      windowSizeHint: 'Initial size of the standalone window, in logical pixels. On GNOME a window larger than ~80% of the work area is auto-maximized and this size is ignored.',
      autoInstallLabel: 'Install / heal on startup',
      autoInstallHint: 'Sync the desktop entry, icons, and KWin rule to the current version on every dsh web start.',
      manageKwinRulesLabel: 'Manage the KWin window rule',
      manageKwinRulesHint: 'KDE Plasma only; sizes the window to the values above.',
      manageHyprlandRulesLabel: 'Manage the Hyprland window rule',
      manageHyprlandRulesHint: 'Hyprland only. Off by default — the window then follows the tiling layout and the size above has no effect; turning it on forces this window to float at the size above.',
      terminalActionLabel: '"Open in Terminal" action',
      terminalActionHint: 'Adds a right-click action that launches dsh-tui in a terminal.',
      terminalCommandLabel: 'Terminal command',
      terminalCommandHint: 'Leave empty to auto-detect an installed terminal at install time.',
      hostPortNote: 'host and port are not on this card — they must match the address dsh web actually binds; edit config.json instead.',
    }

    // -----------------------------------------------------------------------
    // 字段模型
    // -----------------------------------------------------------------------

    /** 窗口尺寸的合法区间，与 `src/config.js` 的 normalizeConfig 一致。 */
    const MIN_SIZE = 320
    const MAX_SIZE = 20000

    /**
     * 一个写入单元：写进 settings 命名空间的一个键。
     *
     * 绝大多数键与草稿一一对应；只有 `window` 是 `{width, height}` 对象，在卡片上
     * 拆成两个输入框，所以这里按「组」而不是按「字段」规划写入。
     */
    const GROUPS = [
      { ns: 'profileMode', drafts: ['profileMode'] },
      { ns: 'browser', drafts: ['browser'] },
      { ns: 'window', drafts: ['windowWidth', 'windowHeight'] },
      { ns: 'autoInstall', drafts: ['autoInstall'] },
      { ns: 'manageKwinRules', drafts: ['manageKwinRules'] },
      { ns: 'manageHyprlandRules', drafts: ['manageHyprlandRules'] },
      { ns: 'terminalAction', drafts: ['terminalAction'] },
      { ns: 'terminalCommand', drafts: ['terminalCommand'] },
    ]

    /** 草稿键 -> 所属组。 */
    const GROUP_OF = {}
    for (const group of GROUPS) for (const draft of group.drafts) GROUP_OF[draft] = group

    /**
     * 每个控件一条。`kind` 决定用哪种控件与哪种解析规则。
     */
    const CONTROLS = [
      {
        draft: 'profileMode',
        kind: 'choice',
        choices: ['dedicated', 'shared'],
        labelKey: 'profileModeLabel',
        hintKey: 'profileModeHint',
      },
      { draft: 'browser', kind: 'text', labelKey: 'browserLabel', hintKey: 'browserHint' },
      { draft: 'windowWidth', kind: 'size', labelKey: 'windowWidthLabel', hintKey: 'windowSizeHint' },
      { draft: 'windowHeight', kind: 'size', labelKey: 'windowHeightLabel' },
      { draft: 'autoInstall', kind: 'boolean', labelKey: 'autoInstallLabel', hintKey: 'autoInstallHint' },
      { draft: 'manageKwinRules', kind: 'boolean', labelKey: 'manageKwinRulesLabel', hintKey: 'manageKwinRulesHint' },
      { draft: 'manageHyprlandRules', kind: 'boolean', labelKey: 'manageHyprlandRulesLabel', hintKey: 'manageHyprlandRulesHint' },
      { draft: 'terminalAction', kind: 'boolean', labelKey: 'terminalActionLabel', hintKey: 'terminalActionHint' },
      { draft: 'terminalCommand', kind: 'text', labelKey: 'terminalCommandLabel', hintKey: 'terminalCommandHint' },
    ]

    const DRAFTS = CONTROLS.map((control) => control.draft)

    /** 从解析后的值里读出某个草稿对应的那一项。 */
    function readValue(layer, draft) {
      if (layer === undefined || layer === null) return undefined
      if (draft === 'windowWidth') return layer.window?.width
      if (draft === 'windowHeight') return layer.window?.height
      return layer[draft]
    }

    /** 值 -> 输入框文本。空值渲染成空串，而不是 "undefined"。 */
    function toText(value) {
      if (typeof value === 'boolean') return value ? 'true' : 'false'
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
      if (typeof value === 'string') return value
      return ''
    }

    /**
     * 输入框文本 -> 一个写入意图。
     *
     * 返回 `undefined` 表示这份草稿不是该字段能接受的值：表单仍然 dirty，但保存会
     * **拒绝**而不是丢掉这次编辑。这正是宿主卡片的行为 —— 控件绝不悄悄改写用户输入。
     */
    function parseDraft(draft, text, control) {
      const raw = String(text)
      if (control.kind === 'text') {
        // 文本字段允许清空：清空等于回落到 base 层。
        return raw === '' ? { kind: 'clear' } : { kind: 'set', value: raw }
      }
      if (control.kind === 'boolean') return { kind: 'set', value: raw === 'true' }
      if (control.kind === 'choice') {
        return control.choices.includes(raw) ? { kind: 'set', value: raw } : undefined
      }
      // size
      const trimmed = raw.trim()
      if (trimmed === '') return { kind: 'clear' }
      const num = Number(trimmed)
      if (!Number.isInteger(num) || num < MIN_SIZE || num > MAX_SIZE) return undefined
      return { kind: 'set', value: num }
    }

    const CONTROL_OF = {}
    for (const control of CONTROLS) CONTROL_OF[control.draft] = control

    /** 判断两个 JSON 值是否相等 —— 设置层的值都是 JSON 形状。 */
    function sameJson(a, b) {
      if (a === b) return true
      if (typeof a !== typeof b) return false
      if (a === null || b === null || typeof a !== 'object') return false
      if (Array.isArray(a) !== Array.isArray(b)) return false
      const ka = Object.keys(a)
      const kb = Object.keys(b)
      if (ka.length !== kb.length) return false
      return ka.every((key) => sameJson(a[key], b[key]))
    }

    // -----------------------------------------------------------------------
    // 表单
    // -----------------------------------------------------------------------

    /**
     * 一张卡片的暂存表单。
     *
     * 只暂存草稿，写入发生在保存时 —— 屏幕上所见即保存后所存。宿主是「这个值是否
     * 被接受」的唯一权威（它有自己的校验器），所以写入的结果靠**回读**判断，而不是
     * 在这里预测。
     */
    class CardForm {
      constructor(scope) {
        this.scope = scope
        this.staged = new Map()
        // 「已经被用户碰过并离开」的草稿。判红看它 —— 详见 fieldState。
        this.touched = new Set()
        this.listeners = new Set()
        this.saving = false
        this.failed = false
        scope.subscribe(() => this.publish())
      }

      /** 造一个快照 store；投影在 scope 或草稿变化时重建。 */
      bind(project) {
        const store = createSnapshotStore(project())
        this.listeners.add(() => store.set(project()))
        return store
      }

      /** 某个草稿当前的文本：有草稿用草稿，否则用解析后的值。 */
      draftText(draft) {
        const staged = this.staged.get(draft)
        if (staged !== undefined) return staged.text
        return toText(readValue(this.scope.getSnapshot().value, draft))
      }

      /**
       * 某个草稿的控件状态。
       *
       * 这里的 `invalid` 是**显示用**的：只有用户已经碰过这个框、并且离开了它（失焦）之后
       * 才算真。理由是从 0.7.0 起框里是空的，任何尺寸都得从 `1` 敲起 —— `1`、`14`、`140`
       * 一路都不合法，边敲边红既吓人又没意义；失焦才是「这个值我认了」的时刻。
       *
       * 拦保存用的是另一套判据（`shell().invalid`，基于真正要写什么），所以「先不判红」
       * 不等于「放行非法值」：保存按钮该灰还是灰。
       */
      fieldState(draft) {
        const staged = this.staged.get(draft)
        const ns = GROUP_OF[draft].ns
        if (staged === undefined) {
          return {
            text: toText(readValue(this.scope.getSnapshot().value, draft)),
            overridden: this.stored(ns),
            invalid: false,
            clear: false,
          }
        }
        if (staged.clear) return { text: staged.text, overridden: false, invalid: false, clear: true }
        const parsed = parseDraft(draft, staged.text, CONTROL_OF[draft])
        return {
          text: staged.text,
          overridden: parsed !== undefined && parsed.kind === 'set',
          invalid: parsed === undefined && this.touched.has(draft),
          clear: false,
        }
      }

      /** 输入框失焦：这个草稿从此刻起可以显示非法了。 */
      markTouched(draft) {
        if (this.touched.has(draft)) return
        this.touched.add(draft)
        this.publish()
      }

      /** 卡片级状态。 */
      shell() {
        const snapshot = this.scope.getSnapshot()
        const plan = this.plan()
        return {
          available: snapshot.status === 'ready',
          writable: snapshot.writable,
          dirty: plan.length > 0,
          invalid: plan.some((item) => item.run === undefined),
          saving: this.saving,
          failed: this.failed,
        }
      }

      actions() {
        return {
          edit: (draft, text) => this.stage(draft, { text, clear: false }),
          // 失焦才算「这个值我认了」，此后才显示非法（见 fieldState）。
          blur: (draft) => this.markTouched(draft),
          resetField: (draft) => this.stage(draft, { text: '', clear: true }),
          save: () => {
            void this.save()
          },
          discard: () => {
            if (this.staged.size === 0 && !this.failed) return
            this.staged.clear()
            this.touched.clear()
            this.failed = false
            this.publish()
          },
        }
      }

      stage(draft, edit) {
        this.staged.set(draft, edit)
        this.failed = false
        this.publish()
      }

      /** 一组草稿合并出的写入意图；组内任一草稿非法就是 `undefined`。 */
      groupWrite(group) {
        const parts = {}
        let clear = false
        for (const draft of group.drafts) {
          const staged = this.staged.get(draft)
          if (staged !== undefined && staged.clear) {
            clear = true
            continue
          }
          const parsed = parseDraft(draft, this.draftText(draft), CONTROL_OF[draft])
          if (parsed === undefined) return undefined
          if (parsed.kind === 'clear') {
            clear = true
            continue
          }
          parts[draft] = parsed.value
        }
        if (clear) return { kind: 'clear' }

        if (group.ns === 'window') {
          const width = parts.windowWidth
          const height = parts.windowHeight
          if (typeof width !== 'number' || typeof height !== 'number') return undefined
          return { kind: 'set', value: { width, height } }
        }
        const only = parts[group.drafts[0]]
        return only === undefined ? undefined : { kind: 'set', value: only }
      }

      /** 一次保存会写下的全部内容。 */
      plan() {
        const plan = []
        for (const group of GROUPS) {
          if (!group.drafts.some((draft) => this.staged.has(draft))) continue
          const write = this.groupWrite(group)
          if (write === undefined) {
            plan.push({ ns: group.ns, run: undefined })
            continue
          }
          if (write.kind === 'clear') {
            if (this.stored(group.ns)) plan.push({ ns: group.ns, run: () => this.clear(group.ns) })
            continue
          }
          if (sameJson(write.value, this.sectionValue(group.ns))) continue
          plan.push({ ns: group.ns, run: () => this.store(group.ns, write.value) })
        }
        return plan
      }

      async save() {
        const plan = this.plan()
        const writes = plan.flatMap((item) => (item.run === undefined ? [] : [item.run]))
        if (plan.length === 0 || this.saving || writes.length !== plan.length) return
        this.saving = true
        this.failed = false
        this.publish()
        let landed = true
        for (const write of writes) landed = (await write()) && landed
        if (landed) {
          this.staged.clear()
          this.touched.clear()
        }
        this.saving = false
        this.failed = !landed
        this.publish()
      }

      // 宿主拒绝写入时 `scope.set` / `scope.unset` **不会 reject**，只是静默返回。
      // 所以唯一可靠的判据是回读：写完之后再看用户层里到底是什么。
      async clear(ns) {
        await this.scope.unset(ns)
        return !this.stored(ns)
      }

      async store(ns, value) {
        await this.scope.set(ns, value)
        const user = this.scope.getSnapshot().user
        return user !== undefined && sameJson(user[ns], value)
      }

      sectionValue(ns) {
        return this.scope.getSnapshot().value?.[ns]
      }

      stored(ns) {
        const user = this.scope.getSnapshot().user
        return user !== undefined && Object.hasOwn(user, ns)
      }

      publish() {
        for (const listener of this.listeners) listener()
      }
    }

    // -----------------------------------------------------------------------
    // 组件
    // -----------------------------------------------------------------------

    /** 一个带标签、覆盖徽标与重置按钮的控件外壳。 */
    function Field(props) {
      const { t } = props
      return jsxs('div', {
        className: CSS.field,
        children: [
          jsxs('div', {
            className: CSS.head,
            children: [
              jsx('label', { className: CSS.label, htmlFor: props.id, children: t(props.labelKey) }),
              props.overridden
                ? jsxs('span', {
                    className: CSS.badges,
                    children: [
                      jsx(primitives.Tag, { tone: 'neutral', children: t('overridden') }),
                      jsx('button', {
                        type: 'button',
                        className: CSS.reset,
                        disabled: props.disabled,
                        onClick: props.onReset,
                        children: t('reset'),
                      }),
                    ],
                  })
                : null,
            ],
          }),
          props.children,
          jsx('p', {
            className: props.invalid ? CSS.invalid : CSS.hint,
            children: props.invalid ? t('invalidNumber') : t(props.hintKey),
          }),
        ],
      })
    }

    /** 文本 / 数字输入。 */
    function TextControl(props) {
      const { t, control, state, disabled } = props
      const numeric = control.kind === 'size'
      return jsxs(Field, {
        t,
        id: props.id,
        labelKey: control.labelKey,
        hintKey: control.hintKey ?? 'windowSizeHint',
        overridden: state.overridden,
        invalid: state.invalid,
        disabled,
        onReset: () => props.onReset(control.draft),
        children: [
          jsx('input', {
            id: props.id,
            className: inputClass(state.invalid),
            type: 'text',
            ...(numeric ? { inputMode: 'numeric' } : {}),
            ...(state.invalid ? { 'aria-invalid': true } : {}),
            value: state.text,
            // 未覆盖时输入框是空的，灰字提示「清空后回落到什么」（= config.json 的当前值）。
            placeholder: props.placeholder ?? '',
            disabled,
            onChange: (event) => props.onEdit(control.draft, event.target.value),
            onBlur: () => props.onBlur(control.draft),
          }),
        ],
      })
    }

    /**
     * 窗口宽度 + 高度：**同一行并列**。
     *
     * 这两个值本来就属于同一个 `window` 对象（写入时也是一个整体），拆成上下两行
     * 既浪费纵向空间，也让人看不出它们是一对。所以合成一行两个单元格，每个单元格
     * 各自保留标签、覆盖徽标与重置按钮；提示与校验信息放在整行下方共用。
     */
    function SizePairControl(props) {
      const { t, controls, states, placeholders, disabled } = props
      const invalid = states.some((state) => state.invalid)

      const cell = (control, state, index) =>
        jsxs(
          'div',
          {
            className: CSS.sizeCell,
            children: [
              jsxs('div', {
                className: CSS.head,
                children: [
                  jsx('label', {
                    className: CSS.label,
                    htmlFor: `dsld-${control.draft}`,
                    children: t(control.labelKey),
                  }),
                  state.overridden
                    ? jsxs('span', {
                        className: CSS.badges,
                        children: [
                          jsx(primitives.Tag, { tone: 'neutral', children: t('overridden') }),
                          jsx('button', {
                            type: 'button',
                            className: CSS.reset,
                            disabled,
                            onClick: () => props.onReset(control.draft),
                            children: t('reset'),
                          }),
                        ],
                      })
                    : null,
                ],
              }),
              jsx('input', {
                id: `dsld-${control.draft}`,
                className: inputClass(state.invalid),
                type: 'text',
                inputMode: 'numeric',
                ...(state.invalid ? { 'aria-invalid': true } : {}),
                value: state.text,
                placeholder: placeholders?.[index] ?? '',
                disabled,
                onChange: (event) => props.onEdit(control.draft, event.target.value),
                onBlur: () => props.onBlur(control.draft),
              }),
            ],
          },
          control.draft,
        )

      return jsxs('div', {
        className: CSS.field,
        children: [
          jsx('div', {
            className: CSS.sizeRow,
            children: controls.map((control, index) => cell(control, states[index], index)),
          }),
          jsx('p', {
            className: invalid ? CSS.invalid : CSS.hint,
            children: invalid ? t('invalidNumber') : t('windowSizeHint'),
          }),
        ],
      })
    }

    /** 布尔开关。 */
    function SwitchControl(props) {
      const { t, control, state, disabled } = props
      return jsxs(Field, {
        t,
        id: props.id,
        labelKey: control.labelKey,
        hintKey: control.hintKey,
        overridden: state.overridden,
        invalid: false,
        disabled,
        onReset: () => props.onReset(control.draft),
        children: [
          jsx(primitives.Switch, {
            // 没覆盖时开关显示**当前生效的那个值**（来自 config.json），而不是一律显示
            // 关闭 —— 否则「它现在是开着的」这件事在界面上根本看不出来，用户还会点反。
            // 开关没有灰字可用，所以「是否已覆盖」仍由标签旁的徽标表达。
            checked: state.overridden ? state.text === 'true' : props.placeholder === 'true',
            disabled,
            label: t(control.labelKey),
            onChange: (next) => props.onEdit(control.draft, next ? 'true' : 'false'),
          }),
        ],
      })
    }

    /** 二选一。没有 select 原语，用两个 Pill 表达 —— 选项只有两个，比下拉更省一次点击。 */
    function ChoiceControl(props) {
      const { t, control, state, disabled } = props
      return jsxs(Field, {
        t,
        id: props.id,
        labelKey: control.labelKey,
        hintKey: control.hintKey,
        overridden: state.overridden,
        invalid: false,
        disabled,
        onReset: () => props.onReset(control.draft),
        children: [
          jsx('div', {
            className: CSS.choices,
            children: control.choices.map((choice) =>
              jsx(
                primitives.Pill,
                {
                  // 与开关同理：没覆盖时高亮的是**当前生效**的那个选项。
                  active: state.overridden ? state.text === choice : props.placeholder === choice,
                  onClick: disabled ? undefined : () => props.onEdit(control.draft, choice),
                  children: t(choice === 'dedicated' ? 'profileModeDedicated' : 'profileModeShared'),
                },
                choice,
              ),
            ),
          }),
        ],
      })
    }

    /**
     * 渲染「桌面集成」卡片。
     *
     * @param props - 文案查询 `t`、注入的 `useLinuxDesktopCard` 快照钩子，以及表单动作。
     */
    function LinuxDesktopCard(props) {
      // 行描述缺失时插件管理器会按 `summary` 渲染这个槽位，而那一份是塞进 `<p>`
      // 的一行短句 —— 整张卡片塞进去会产出非法嵌套。先于任何 hook 返回，免得白建
      // 一份表单。短句让页面自己用包描述。
      if (props.view === 'summary') return null

      const { t } = props
      // 灰字提示每次都现取：它是宿主随 schema 发过来的「清空后会回落到什么」。
      const placeholders = typeof props.placeholders === 'function' ? props.placeholders() : (props.placeholders ?? {})
      const state = props.useLinuxDesktopCard((snapshot) => snapshot)
      const [open, setOpen] = React.useState(false)
      const saveStarted = React.useRef(false)

      // 保存成功后自动收起；失败则保持展开，让用户看到失败原因并修改草稿。
      React.useEffect(() => {
        if (state.saving) {
          saveStarted.current = true
          return
        }
        if (!saveStarted.current) return
        saveStarted.current = false
        if (!state.dirty && !state.failed) setOpen(false)
      }, [state.dirty, state.failed, state.saving])

      // 宿主没服务这个命名空间时什么都不渲染 —— 与自带配置页一致，不留空壳。
      if (!state.available) return null

      const title = t('title')
      const disabled = !state.writable
      const blocked = !state.dirty || state.invalid || state.saving

      return jsxs('div', {
        className: open ? `${CSS.card} ${CSS.cardOpen}` : CSS.card,
        children: [
          jsxs('button', {
            type: 'button',
            className: CSS.header,
            'aria-expanded': open,
            'aria-label': `${t(open ? 'collapse' : 'expand')}: ${title}`,
            onClick: () => setOpen(!open),
            children: [
              jsxs('span', {
                className: CSS.headText,
                children: [
                  jsx('span', { className: CSS.name, children: title }),
                  jsx('span', { className: CSS.description, children: t('description') }),
                ],
              }),
              state.dirty
                ? jsx(primitives.Tag, { tone: 'neutral', className: CSS.pending, children: t('unsaved') })
                : null,
              jsx(ChevronDownIcon, {
                className: open ? `${CSS.chevron} ${CSS.chevronOpen}` : CSS.chevron,
              }),
            ],
          }),
          open
            ? jsxs('div', {
                className: CSS.body,
                children: [
                  disabled
                    ? jsx('p', { className: CSS.readOnly, role: 'status', children: t('readOnly') })
                    : null,
                  ...CONTROLS.flatMap((control) => {
                    // 宽度与高度合并成一行渲染，所以高度自己不再单独出一行。
                    if (control.draft === 'windowHeight') return []
                    if (control.draft === 'windowWidth') {
                      const height = CONTROLS.find((item) => item.draft === 'windowHeight')
                      return [
                        jsx(SizePairControl, {
                          key: 'windowSize',
                          t,
                          disabled,
                          controls: [control, height],
                          states: [state.fields.windowWidth, state.fields.windowHeight],
                          placeholders: [placeholders.windowWidth, placeholders.windowHeight],
                          onEdit: props.edit,
                          onBlur: props.blur,
                          onReset: props.resetField,
                        }),
                      ]
                    }

                    const id = `dsld-${control.draft}`
                    const state_ = state.fields[control.draft]
                    const shared = {
                      key: control.draft,
                      t,
                      id,
                      control,
                      state: state_,
                      placeholder: placeholders[control.draft] ?? '',
                      disabled,
                      onEdit: props.edit,
                      onBlur: props.blur,
                      onReset: props.resetField,
                    }
                    if (control.kind === 'boolean') return [jsx(SwitchControl, shared)]
                    if (control.kind === 'choice') return [jsx(ChoiceControl, shared)]
                    return [jsx(TextControl, shared)]
                  }),
                  jsx('p', { className: CSS.hint, children: t('hostPortNote') }),
                  jsxs('div', {
                    className: CSS.footer,
                    children: [
                      state.failed
                        ? jsx('p', { className: CSS.failed, role: 'status', children: t('saveFailed') })
                        : null,
                      jsx('button', {
                        type: 'button',
                        className: CSS.discard,
                        disabled: !state.dirty || state.saving,
                        onClick: props.discard,
                        children: t('discard'),
                      }),
                      jsx('button', {
                        type: 'button',
                        className: CSS.save,
                        disabled: blocked || disabled,
                        onClick: props.save,
                        children: t(state.saving ? 'saving' : 'save'),
                      }),
                    ],
                  }),
                ],
              })
            : null,
        ],
      })
    }

    // -----------------------------------------------------------------------
    // 插件
    // -----------------------------------------------------------------------

    /** 需要的浏览器侧服务。 */
    const inject = ['slots', 'locale']

    /**
     * @param {object} ctx 浏览器插件上下文。
     */
    function apply(ctx) {
      const t = ctx.locale.bind(LOCALE_NS)
      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'dsh-linux-integration: card dictionaries')

      // 设置表单的共享服务叫 `configForms`（0.1.7 之前叫 `settingsScope`；0.2 起
      // 只剩 `configForms`）。必须用 `ctx.get(...)`：Cordis 的上下文代理在读取
      // **未声明**的服务属性时会直接抛异常（`cannot get property "<name>" without
      // inject`），`ctx.inject([...])` 或可选链都来不及生效。
      //
      // 也不能把它写回 `inject` —— 那样在缺少该服务的宿主上这一行会卡成 pending，
      // 整个 web 界面起不来（2026-09-24 就是这么炸的：服务改名，插件行等待一个
      // 永远不会出现的服务）。找不到就安静跳过：卡片只是锦上添花。
      const configForms = ctx.get('configForms')
      const scope = configForms?.get(NAMESPACE)
      if (!scope) return

      // 灰字提示怎么来的：宿主把「清空后会回落到什么」挂在 schema 根节点的 meta 上，
      // 随 describe 一起发过来。这是 ui-settings 文档里专门留给「schema 内省」的那面
      // 镜像（`configForms.describe()`），不需要自己走 wire。
      const mirror = typeof configForms?.describe === 'function' ? configForms.describe() : undefined
      const readPlaceholders = () => {
        try {
          const view = mirror?.getSnapshot?.().view
          const row = view?.namespaces?.find((candidate) => candidate.ns === NAMESPACE)
          const schema = row?.schema
          return schema?.refs?.[schema.uid]?.meta?.[PLACEHOLDER_META] ?? {}
        } catch {
          return {}
        }
      }

      const form = new CardForm(scope)
      const actions = form.actions()
      const store = form.bind(() => ({
        ...form.shell(),
        fields: Object.fromEntries(DRAFTS.map((draft) => [draft, form.fieldState(draft)])),
      }))

      // keyed slot：键必须是 `<组合包名>#<行 id>`，否则行上不会出现「配置」控件，
      // 打开了也派发不到这张卡。
      ctx.slots.inject('plugins.row.config', () =>
        ctx.slots.register(
          {
            name: 'plugins.row.config',
            key: ROW_KEY,
            locale: LOCALE_NS,
            inject: () => ({ hooks: { linuxDesktopCard: store }, placeholders: readPlaceholders, ...actions }),
          },
          LinuxDesktopCard,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
