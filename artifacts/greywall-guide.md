# 偷桃夜：双关卡使用与扩展

主菜单选择「第一关 · 偷桃夜」或「第二关 · 灰墙情报」，点击进入。暂停、失败、撤离后均可返回关卡选择。语言按钮切换中文/英文。

## 第二关操作

- WASD 移动，鼠标转向，Shift 奔跑，F 灯笼；镜头保持固定眼高。
- 靠近物资箱并对准，按住 E / 鼠标左键 / 手机搜索键 1.4 秒。松开、转身、暂停或受击会中断；每箱每局发放一次。
- Q / 空格 / 鼠标右键 / 手机剑按钮反击。攻击有冷却，注意巨人的蓄力提示；铠甲巨人有较高减伤。
- 手机左摇杆移动，右侧区域转向；搜索、奔跑、灯笼、攻击和暂停有独立按钮。
- 到城市远端城门前的信号区域停留 3.2 秒撤离。无需消灭所有敌人。未撤离的情报在失败后丢失。

## 集中配置

`src/game/city/CityConfig.ts`：五种敌人的高度、生命、减伤、移动/巡逻速度、视距、听觉、攻击距离、伤害、蓄力、冷却、搜索时长，以及玩家反击数值。

`src/game/city/IntelBlueprints.ts`：四档情报的颜色、名称、价值和概率；目前依次为绿色10（65%）、蓝色100（25%）、紫色1,000（8.5%）、橙色10,000（1.5%）。

`src/game/city/CityWorld.ts`：建筑/树木布局、巡逻位置、18个物资点、出生点、撤离位置及 LOD 距离。人类与巨人使用独立的门洞碰撞规则。

## 扩展接口

在 `src/game/LevelRegistry.ts` 调用 `registerLevel` 注册 id、中英文标题/介绍和异步场景工厂。场景实现 `start()`、`startRun(seed?)`、`dispose()`；菜单自动生成选项。

撤离成功时，`window` 发出 `game:extraction` 事件，`detail` 为 `ExtractionSettlement`：`levelId`、`seed`、`counts`、`totalValue`、`extractedAt`。第二关同时将最近一次结算保存在 `localStorage['greywall.last-extraction']`。目前未连接服务端账户或长期仓库；以后可订阅该事件接入。

## 素材和性能边界

城市、怪物和树木为原创程序化模型/纹理，采用平滑枝干、镂空树叶、按材质合批、树木实例化与距离细节裁剪。视觉向自然材质方向改进，仍属于程序化风格，未使用扫描或商业写实资源。真实手机与硬件 GPU 帧率需要设备实测，不能由云端软件渲染帧率推断。

## 复验命令

- `npm run build`
- `npm test`（需要 Playwright Chromium；云端验证使用系统 Chromium）
- 启动生产预览后，`npm run inspect:canvas -- --manifest artifacts/greywall-evidence.json --url http://127.0.0.1:4189/monkeytest/ --seed 42`。
- 可用 `CHROME_EXECUTABLE_PATH` 指定浏览器，`INSPECT_LANG=zh` 指定截图语言，`INSPECT_DPR=1` 指定手机截图像素比。
- 启动开发服务器后运行 `node scripts/capture-city-motion.mjs`，采集真实键盘输入驱动的移动、巨人蓄力/命中、反击和开箱逐帧证据。脚本为可复验性固定到本次证据目录。
