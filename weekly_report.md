# CS211 Project B 本周实验结果报告

统计周期：2026 年 11 月 16–17 日（America/Los_Angeles）；按本地数据快照生成。

## 1. 本周结论

本周完成了无 root OPPO Find X7 上资源采集方法的实机修复与 W0 空闲场景 A/B/C 试跑。当前自动配对得到 3 套实验（Repetition 1、3、4），共 9 条入选记录。入选记录的 CPU、内存和电池指标均可用。用户决定不追加资源实验，本阶段以现有数据及明确限制收尾。

这不是整个项目的最终验收。第 3 轮 A 延后近两小时补跑，温度显著不同；其对照可信度弱于单次采样完整性。三个重复的 C−B 系统 CPU 均为正，但电池估算不能可靠证明 Perfetto 的增量能耗，更不能据负差值宣称节能。

本地 runs 目录共 26 条实验记录；自动资源配对有 14 条排除条目。排除条目可表示单条运行，也可表示不完整分组，不能解释为同样数量的失败实验。附录涵盖全部记录，未只选择成功结果。

## 2. 平台、协议与采集方法

- 手机：OPPO Find X7（PHZ110），Android 16，无 root，使用无线 ADB。
- 实际目标进程组：`com.google.android.googlequicksearchbox`；Gemini UI 运行于 Google App，数据不等于 Gemini 独占资源。旧版 `com.google.android.apps.bard` 记录单独保留，不与新版混合。
- 入选 Google App 版本：17.74.18.ve.arm64；Project B：1.5 / versionCode 6。
- A：Gemini 前台空闲、Project B 停止；B：Gemini 前台、Project B 后台；C：在 B 基础上开启 Perfetto。三组均存在 ADB 观察器；Simpleperf 关闭。
- W0：前台空闲、不提交任务、不添加 marker。正式窗口 300 秒、采样间隔 15 秒、准备 30 秒。
- 新采集器 `adb-proc-stat-v2`：累计 CPU 计数差分；系统 CPU 排除 idle 和 iowait，进程 CPU 相对单核。首个快照建立基线。PSS 按确认的进程 PID 汇总。
- 电量来自电池 charge counter，电压采用经机型与驱动路径约束的 OPPO 毫伏适配。能量为相邻电量下降乘平均端点电压后求和，功率按实际电池读数窗口折算。它是整机估算而非硬件测量或 App 能耗。
- 旧 `adb-dumpsys-v1` CPU 窗口和新方法含义不同，分组隔离。详见随包 `source/RESOURCE_V2.md`。

## 3. 九条入选记录：完整指标

以下 CPU/PSS/系统内存为每次运行的样本中位数；功率为电池窗口平均估算。CPU 中位数与平均功率不能直接按比例比较。运行短 ID 可在附录映射到完整 ID。

|轮次|组|运行 ID 前八位|开始时间（本地）|系统 CPU %|Agent CPU %|控制 CPU %|Agent PSS KiB|控制 PSS KiB|系统内存 KiB|电量 µAh|能量 mWh|功率 mW|
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
|1|A|a4d9482f|11-17 01:01:40|5.064|3.252|0.000|391016|0|5716340|20000|76.343|916.759|
|1|B|1adecac3|11-17 01:10:35|4.732|3.259|0.506|345206|114962|5820200|22000|83.879|1002.390|
|1|C|1cc839c3|11-17 01:18:46|5.845|3.381|0.469|346564|116610|5875272|18000|68.578|827.723|
|3|A|6515405d|11-17 20:02:12|4.735|3.291|0.000|353865|0|6027432|16000|68.106|818.219|
|3|B|e021e7a2|11-17 18:08:48|5.661|3.203|0.435|369419|107915|5930412|20000|86.306|1036.524|
|3|C|10159579|11-17 18:16:09|6.221|3.309|0.466|483518|110501|6171984|18000|77.609|931.318|
|4|A|15b429f3|11-17 20:35:44|4.605|3.248|0.000|357487|0|5908952|18000|75.954|912.202|
|4|B|6a660547|11-17 20:42:57|5.015|3.263|0.531|354997|113540|6034288|20000|84.319|1011.963|
|4|C|0d4f82d3|11-17 20:18:42|6.111|3.439|0.530|415500|113327|6139084|18000|76.340|916.003|

### 3.1 采样质量与环境

|轮次/组|快照数|CPU有效区间 系统/Agent/控制|CPU拒绝数|原始命令错误数|电池温度 °C|电量显示 %|电池窗口 s|观察器累计耗时 s|trace 字节|
|---|---:|---|---:|---:|---|---|---:|---:|---:|
|1/A|21|20/20/20|0|0|31.6–32.3|44–44|299.790|34.895|0|
|1/B|21|20/20/20|0|0|30.8–31.3|43–44|301.244|45.506|0|
|1/C|21|20/20/20|0|0|30.5–30.7|42–43|298.265|41.301|6671891|
|3/A|21|20/20/20|0|0|26.2–26.5|90–91|299.653|33.614|0|
|3/B|21|20/20/20|0|0|31.4–33.3|96–96|299.753|37.938|0|
|3/C|21|20/20/20|0|0|30.2–31.1|95–96|299.997|38.613|7526813|
|4/A|21|20/20/20|0|0|28.2–28.2|87–87|299.752|32.232|0|
|4/B|21|20/20/20|0|0|28.3–28.4|86–87|299.960|37.355|0|
|4/C|21|20/20/20|0|0|28.1–28.2|89–89|300.025|39.158|6568715|

观察器耗时包括命令和通信等待，不是 CPU 时间，不能直接从 CPU 或能耗中扣除。trace 文件存在仅证明捕获产物存在，本报告未对每个 trace 做 Binder 内容完整性验收。

## 4. 逐轮差值与跨轮汇总

B−A 表示控制 App 配置增量，C−B 表示启用 Perfetto 的增量，C−A 表示完整测试配置增量。所有负值保留。跨轮采用“各轮差值的中位数”，而非先合并所有快照。n=3 指三套运行，不是 60 个独立实验。

|轮次|对比|系统 CPU 百分点|Agent CPU 单核百分点|控制 CPU 单核百分点|Agent PSS KiB|控制 PSS KiB|系统内存 KiB|电量 µAh|能量 mWh|功率 mW|
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
|1|B−A|-0.332|0.007|0.506|-45810|114962|103860|2000|7.536|85.631|
|1|C−B|1.113|0.122|-0.037|1358|1648|55072|-4000|-15.301|-174.667|
|1|C−A|0.781|0.129|0.469|-44452|116610|158932|-2000|-7.765|-89.035|
|3|B−A|0.927|-0.088|0.435|15554|107915|-97020|4000|18.200|218.305|
|3|C−B|0.560|0.106|0.031|114099|2586|241572|-2000|-8.697|-105.207|
|3|C−A|1.487|0.018|0.466|129653|110501|144552|2000|9.503|113.099|
|4|B−A|0.411|0.015|0.531|-2490|113540|125336|2000|8.365|99.761|
|4|C−B|1.095|0.176|-0.001|60503|-213|104796|-2000|-7.979|-95.960|
|4|C−A|1.506|0.191|0.530|58013|113327|230132|0|0.386|3.801|
|三轮中位数|B−A|0.411|0.007|0.506|-2490|113540|103860|2000|8.365|99.761|
|三轮中位数|C−B|1.095|0.122|-0.001|60503|1648|104796|-2000|-8.697|-105.207|
|三轮中位数|C−A|1.487|0.129|0.469|58013|113327|158932|0|0.386|3.801|

各列分别取中位数，因此汇总的 B−A 与 C−B 不一定相加等于汇总 C−A。

### 4.1 第 3 轮敏感性检查

第 3 轮 B/C 于 11 月 17 日 18:08/18:16 开始，A 于 20:02 补跑。B 温度 31.4–33.3°C，C 30.2–31.1°C，A 26.2–26.5°C。保留该轮，但不能假定温度和后台状态可比。下表不含第 3 轮，仅作敏感性检查，不据结果方向挑选数据。

|对比|全部三轮 CPU 差值中位数（百分点）|仅 1/4 轮 CPU 差值中位数|全部三轮功率差值中位数 mW|仅 1/4 轮功率差值中位数 mW|
|---|---:|---:|---:|---:|
|controller|0.411|0.039|99.761|92.696|
|tracing|1.095|1.104|-105.207|-135.313|
|total|1.487|1.144|3.801|-42.617|

仅两轮的中位数为两数平均，证据量更少。此检查提示总功率结论对纳入哪些轮次敏感，不支持固定能耗开销或节能结论。

## 5. 异常、修复及解释

1. 旧采集器使用的 dumpsys CPU 窗口存在缓存/过期现象；更换为累计计数差值，并验证 PID/进程身份。
2. OPPO dumpsys 电压返回 4，不能直接按 mV 使用；采用受机型/驱动路径约束的 sysfs 电压适配，保留原始读数及单位。
3. Google App 使用带后缀的多进程，按单一包名 meminfo 查询失败；修复为逐 PID 校验并汇总 PSS。
4. 部分运行发生 ADB 超时、offline 或 closed，导致状态未知。缺失值没有被填零；对应运行按质量规则排除。提示“状态不匹配”不一定说明用户违规，原始错误才是依据。
5. Repetition=2 的两次 B 在 100% 电量时，dumpsys 和 sysfs 的 42 次计数均为 4,238,000 µAh。能耗不可用，而不是零耗电。两条 B 同编号也造成配对歧义；原记录保留。
6. 本周已记录的工程验证包括 51 项 Python 测试、前端语法/接线检查和短时实机采集；这是此前验证记录，本报告生成时未重新运行完整测试。

## 6. 可支持的结论与限制

- 采集可行性：在这台无 root 手机和当前软件版本下，可获取目标进程组 CPU/PSS、整机 CPU/内存和电池估算。
- CPU：三轮 C−B 均为正，约 +0.56 至 +1.11 个百分点；这是小样本、单设备、W0 场景的观察，不是普遍性能保证或统计显著性结论。
- 内存：控制进程本身有明确 PSS 成本，但系统内存还受 Google App 与其他进程波动影响，不能把系统差值全部归因于控制器。
- 能耗：负功率差值保留，不解释为 Perfetto 节能。观察到约 2,000 µAh 的最小非零电量步长，五分钟窗口中对应约 91–103 mW 的量级（取决于电压），这不是严格误差界限。
- 时间/温度：第 3 轮补跑间隔大；其他轮也有温度、电量和 App 状态变化。当前配对代码不检查这些因素。
- 观察器：无线 ADB 和 dumpsys 成本存在于各组，且读取进程数不同，成本不一定完全相同。进程短生命周期、共享/隔离工作进程可能遗漏。
- 样本边界：本数据只覆盖 Gemini/Google App 的 W0 资源场景；不能代表实际任务、其他 Agent 或所有手机。

## 7. 后续工作（不追加本阶段 A/B/C）

按用户决定，不补第 5 轮。本阶段以当前数据、失败记录与限制结束。下一阶段先审核已有 Binder 任务数据，确认第二个独立 Agent，再补齐计划中的两个 Agent × W0/W1/W2 × 3 次正式任务矩阵。资源试跑不替代该矩阵。Simpleperf 另作诊断，不能混入标准 A/B/C。报告尚不能给出 Binder 路径、接口语义或分类准确率结论。可改进采集断线提示、配对时间/温度展示，但不应为获得期望方向而修改结果公式。

## 附录 A：全部运行清单

下表“入选”仅指本报告三套自动配对；其他记录继续保留。状态 complete 与用户 outcome=success 不自动代表采集质量合格。

|完整 run ID|开始时间（本地）|Conditions|轮次|模式|状态/Outcome|入选|问题或失败原因|
|---|---|---|---:|---|---|---|---|
|1f6885ff55d94382ab8ddc22335484f6|11-16 00:54:38|resource-pilot-v1|1|A|complete/success|否|Need real, unplugged, discharging readings throughout the run|
|b51ddfa539a94e068055047f28493a30|11-16 01:05:16|resource-pilot-v1|1|B|complete/success|否|Voltage unavailable or outside supported single-cell range; charge only|
|c4dcc4e99afd4841991108da8668da62|11-16 01:13:57|resource-pilot-v1|1|C|complete/success|否|Voltage unavailable or outside supported single-cell range; charge only|
|456b8320868b490096f91bbbaa5ccd65|11-16 21:52:15|resource-pilot-v2|1|A|complete/success|否||
|d3dda67c60e74849b5e1beccd8189a29|11-16 21:59:34|resource-pilot-v2|1|B|failed/None|否|adb.exe: device offline|
|1e140e41dd09474eb31cf05b03c7fada|11-16 22:01:27|resource-pilot-v2|1|B|complete/success|否|Controller process presence does not match the selected arm; Phone was not confirmed unplugged and discharging throughout the window; Target process not confirmed throughout the window; Need real, unplugged, discharging readings throughout the run|
|a7f7918bf968475ba7522ff21244b17b|11-16 23:00:25|resource-pilot-v2|1|C|failed/None|否|Unplug USB/wireless charging and confirm discharging before resource capture|
|278c27650b8941a6b64b9e2f207724ac|11-16 23:00:32|resource-pilot-v2|1|C|complete/success|否||
|3474658d513c4e80adcc6c4d4b3056d9|11-17 01:01:28|resource-pilot-v3|1|A|failed/None|否|Keep the selected Agent in the foreground before starting; detected edu.cs211.projectb|
|a4d9482f4029492180f7a4064a8c2017|11-17 01:01:40|resource-pilot-v3|1|A|complete/success|是||
|1adecac32a4841c8ae535fd921c36359|11-17 01:10:35|resource-pilot-v3|1|B|complete/success|是||
|1cc839c3dc50493aba13e572b63f3706|11-17 01:18:46|resource-pilot-v3|1|C|complete/success|是||
|c749316235464bef9612dd5f770d1c23|11-17 17:17:58|resource-pilot-v3|1|B|failed/None|否|Resource experiment stopped before measurement|
|46213fef0485416eb861b34e64c24908|11-17 17:19:11|resource-pilot-v3|9|B|failed/None|否|Resource experiment stopped before measurement|
|66b688316b0f47ed9169c8579bb61ca4|11-17 17:19:23|resource-pilot-v3|2|B|complete/success|否|No charge change resolved; this does not mean zero energy cost|
|c9dcc015d4164aa78037a38da2c835b0|11-17 17:27:15|resource-pilot-v3|2|B|complete/success|否|No charge change resolved; this does not mean zero energy cost|
|52dff150ece54ba592d0d04d5fd9e6c1|11-17 18:07:59|resource-pilot-v3|2|B|complete/None|否|Fewer than two samples; Fixed measurement window was interrupted; Measurement window shorter than requested; Need at least two battery samples|
|e021e7a2eeef4ff2b3f271be28a60c23|11-17 18:08:48|resource-pilot-v3|3|B|complete/success|是||
|1015957904c5425b9df993d0bc16c7d5|11-17 18:16:09|resource-pilot-v3|3|C|complete/success|是||
|2cbe0bf985b240b3a8543f18ba1916ff|11-17 18:24:53|resource-pilot-v3|3|A|complete/success|否|Controller process presence does not match the selected arm; Target process not confirmed throughout the window|
|6515405d4d9a4df69122cfed0bc2487e|11-17 20:02:12|resource-pilot-v3|3|A|complete/success|是||
|483ac69b283f43fba3acdb280970281e|11-17 20:11:23|resource-pilot-v3|4|C|complete/failure|否|Controller process presence does not match the selected arm; Phone was not confirmed unplugged and discharging throughout the window; Target process not confirmed throughout the window; Need real, unplugged, discharging readings throughout the run|
|0d4f82d3f0bf4b3fa329597947e34e8d|11-17 20:18:42|resource-pilot-v3|4|C|complete/success|是||
|412fc75ee0ab485688b18a752d340a23|11-17 20:25:20|resource-pilot-v3|4|A|complete/success|否|Controller process presence does not match the selected arm; Phone was not confirmed unplugged and discharging throughout the window; Target process not confirmed throughout the window; Need real, unplugged, discharging readings throughout the run|
|15b429f3d2394561aa5c78adf14a17e6|11-17 20:35:44|resource-pilot-v3|4|A|complete/success|是||
|6a660547208a443f8858f3f98b433921|11-17 20:42:57|resource-pilot-v3|4|B|complete/success|是||

## 附录 B：全部运行指标（含排除记录）

旧采集器指标不得与新采集器合并。缺失以“不可用”标识；无资源文件的运行通常在开始阶段失败。每项峰值、样本数、原始快照与命令错误完整保存在数据包中。

### 1f6885ff55d94382ab8ddc22335484f6

模式：resource_agent；Conditions：resource-pilot-v1；Repetition：1。

采集器：adb-dumpsys-v1；时长：301.050 秒；快照：21；CPU 拒绝数：8。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|7.400|10.000|13||
|Agent CPU (单核 %)|0.400|0.700|9||
|Controller CPU (单核 %)|0|0|13||
|Agent PSS (KiB)|29367|29473|21||
|Controller PSS (KiB)|0|0|21||
|系统已用内存 (KiB)|6202868|6294632|21||

电量消耗 (µAh)：不可用。

估算能量 (mWh)：不可用。

估算功率 (mW)：不可用。

电池说明：Need real, unplugged, discharging readings throughout the run

用户 Notes：Pilot A; Gemini stayed foreground and idle for the full window; screen stayed on; unplugged; no interaction; controller was not reopened.

### b51ddfa539a94e068055047f28493a30

模式：resource_controller；Conditions：resource-pilot-v1；Repetition：1。

采集器：adb-dumpsys-v1；时长：301.167 秒；快照：21；CPU 拒绝数：20。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|不可用|6.600|1|Need at least two available, valid samples|
|Agent CPU (单核 %)|不可用|0.400|1|Need at least two available, valid samples|
|Controller CPU (单核 %)|不可用|0.400|1|Need at least two available, valid samples|
|Agent PSS (KiB)|25851|26287|21||
|Controller PSS (KiB)|134264|135822|21||
|系统已用内存 (KiB)|6234388|6334016|21||

电量消耗 (µAh)：20000。

估算能量 (mWh)：不可用。

估算功率 (mW)：不可用。

电池说明：Voltage unavailable or outside supported single-cell range; charge only

用户 Notes：Pilot B; controller opened and connected before the run, then left in background; Gemini stayed foreground and idle; screen stayed on; unplugged; no interaction.

### c4dcc4e99afd4841991108da8668da62

模式：resource_trace；Conditions：resource-pilot-v1；Repetition：1。

采集器：adb-dumpsys-v1；时长：301.038 秒；快照：21；CPU 拒绝数：20。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|不可用|7.500|1|Need at least two available, valid samples|
|Agent CPU (单核 %)|不可用|0.400|1|Need at least two available, valid samples|
|Controller CPU (单核 %)|不可用|0.400|1|Need at least two available, valid samples|
|Agent PSS (KiB)|26139|26292|21||
|Controller PSS (KiB)|127639|127920|21||
|系统已用内存 (KiB)|6161248|6183348|21||

电量消耗 (µAh)：18000。

估算能量 (mWh)：不可用。

估算功率 (mW)：不可用。

电池说明：Voltage unavailable or outside supported single-cell range; charge only

用户 Notes：Pilot C; controller opened and connected before the run, then left in background; Gemini stayed foreground and idle; screen stayed on; unplugged; no interaction; Perfetto capture completed.

### 456b8320868b490096f91bbbaa5ccd65

模式：resource_agent；Conditions：resource-pilot-v2；Repetition：1。

采集器：adb-proc-stat-v2；时长：301.602 秒；快照：21；CPU 拒绝数：0。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|4.611|6.804|20||
|Agent CPU (单核 %)|3.269|3.916|20||
|Controller CPU (单核 %)|0.000|0.000|20||
|Agent PSS (KiB)|363167|370845|21||
|Controller PSS (KiB)|0|0|21||
|系统已用内存 (KiB)|6503468|6561816|21||

电量消耗 (µAh)：18000。

估算能量 (mWh)：72.810。

估算功率 (mW)：874.210。

电池说明：

用户 Notes：W0 idle; Gemini foreground throughout; screen on; unplugged; wireless ADB; no interaction; no markers; Project B stopped by backend; Simpleperf off.

### d3dda67c60e74849b5e1beccd8189a29

模式：resource_controller；Conditions：resource-pilot-v2；Repetition：1。

无资源汇总文件；错误：adb.exe: device offline

### 1e140e41dd09474eb31cf05b03c7fada

模式：resource_controller；Conditions：resource-pilot-v2；Repetition：1。

采集器：adb-proc-stat-v2；时长：301.825 秒；快照：21；CPU 拒绝数：2。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|5.048|7.388|18||
|Agent CPU (单核 %)|3.303|4.015|18||
|Controller CPU (单核 %)|0.462|0.938|18||
|Agent PSS (KiB)|342069.500|362068|20||
|Controller PSS (KiB)|114868.000|115060|20||
|系统已用内存 (KiB)|6747480.000|6826228|20||

电量消耗 (µAh)：不可用。

估算能量 (mWh)：不可用。

估算功率 (mW)：不可用。

电池说明：Need real, unplugged, discharging readings throughout the run

用户 Notes：W0 idle; Gemini foreground throughout; screen on; unplugged; wireless ADB; no interaction; no markers; Project B connected and backgrounded; Perfetto off; Simpleperf off.

### a7f7918bf968475ba7522ff21244b17b

模式：resource_trace；Conditions：resource-pilot-v2；Repetition：1。

无资源汇总文件；错误：Unplug USB/wireless charging and confirm discharging before resource capture

### 278c27650b8941a6b64b9e2f207724ac

模式：resource_trace；Conditions：resource-pilot-v2；Repetition：1。

采集器：adb-proc-stat-v2；时长：301.874 秒；快照：21；CPU 拒绝数：0。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|6.379|8.625|20||
|Agent CPU (单核 %)|3.407|4.637|20||
|Controller CPU (单核 %)|0.468|0.732|20||
|Agent PSS (KiB)|425186|427329|21||
|Controller PSS (KiB)|117241|117257|21||
|系统已用内存 (KiB)|6456216|6568316|21||

电量消耗 (µAh)：18000。

估算能量 (mWh)：71.927。

估算功率 (mW)：863.475。

电池说明：

用户 Notes：W0 idle; Gemini foreground throughout; screen on; unplugged; wireless ADB; no interaction; no markers; Project B connected and backgrounded; Perfetto on; Simpleperf off.

### 3474658d513c4e80adcc6c4d4b3056d9

模式：resource_agent；Conditions：resource-pilot-v3；Repetition：1。

无资源汇总文件；错误：Keep the selected Agent in the foreground before starting; detected edu.cs211.projectb

### a4d9482f4029492180f7a4064a8c2017

模式：resource_agent；Conditions：resource-pilot-v3；Repetition：1。

采集器：adb-proc-stat-v2；时长：301.616 秒；快照：21；CPU 拒绝数：0。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|5.064|6.722|20||
|Agent CPU (单核 %)|3.252|4.705|20||
|Controller CPU (单核 %)|0.000|0.000|20||
|Agent PSS (KiB)|391016|415497|21||
|Controller PSS (KiB)|0|0|21||
|系统已用内存 (KiB)|5716340|5789020|21||

电量消耗 (µAh)：20000。

估算能量 (mWh)：76.343。

估算功率 (mW)：916.759。

电池说明：

用户 Notes：W0 idle; Gemini foreground throughout; screen on; unplugged; wireless ADB; no interaction; no markers; Project B stopped by backend; Simpleperf off.

### 1adecac32a4841c8ae535fd921c36359

模式：resource_controller；Conditions：resource-pilot-v3；Repetition：1。

采集器：adb-proc-stat-v2；时长：303.411 秒；快照：21；CPU 拒绝数：0。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|4.732|15.789|20||
|Agent CPU (单核 %)|3.259|4.090|20||
|Controller CPU (单核 %)|0.506|0.996|20||
|Agent PSS (KiB)|345206|347335|21||
|Controller PSS (KiB)|114962|116063|21||
|系统已用内存 (KiB)|5820200|5944916|21||

电量消耗 (µAh)：22000。

估算能量 (mWh)：83.879。

估算功率 (mW)：1002.390。

电池说明：

用户 Notes：W0 idle; Gemini foreground throughout; screen on; unplugged; wireless ADB; no interaction; no markers; Project B connected and backgrounded; Perfetto off; Simpleperf off.

### 1cc839c3dc50493aba13e572b63f3706

模式：resource_trace；Conditions：resource-pilot-v3；Repetition：1。

采集器：adb-proc-stat-v2；时长：301.689 秒；快照：21；CPU 拒绝数：0。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|5.845|6.962|20||
|Agent CPU (单核 %)|3.381|4.269|20||
|Controller CPU (单核 %)|0.469|0.824|20||
|Agent PSS (KiB)|346564|347433|21||
|Controller PSS (KiB)|116610|116638|21||
|系统已用内存 (KiB)|5875272|5937904|21||

电量消耗 (µAh)：18000。

估算能量 (mWh)：68.578。

估算功率 (mW)：827.723。

电池说明：

用户 Notes：W0 idle; Gemini foreground throughout; screen on; unplugged; wireless ADB; no interaction; no markers; Project B connected and backgrounded; Perfetto on; Simpleperf off.

### c749316235464bef9612dd5f770d1c23

模式：resource_controller；Conditions：resource-pilot-v3；Repetition：1。

无资源汇总文件；错误：Resource experiment stopped before measurement

### 46213fef0485416eb861b34e64c24908

模式：resource_controller；Conditions：resource-pilot-v3；Repetition：9。

无资源汇总文件；错误：Resource experiment stopped before measurement

### 66b688316b0f47ed9169c8579bb61ca4

模式：resource_controller；Conditions：resource-pilot-v3；Repetition：2。

采集器：adb-proc-stat-v2；时长：301.753 秒；快照：21；CPU 拒绝数：0。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|5.147|11.270|20||
|Agent CPU (单核 %)|3.069|3.764|20||
|Controller CPU (单核 %)|0.469|1.138|20||
|Agent PSS (KiB)|383242|394890|21||
|Controller PSS (KiB)|130235|131087|21||
|系统已用内存 (KiB)|6353448|6565312|21||

电量消耗 (µAh)：不可用。

估算能量 (mWh)：不可用。

估算功率 (mW)：不可用。

电池说明：No charge change resolved; this does not mean zero energy cost

用户 Notes：W0 idle; Gemini foreground throughout; screen on; unplugged; wireless ADB; no interaction; no markers; Project B connected and backgrounded; Perfetto off; Simpleperf off.

### c9dcc015d4164aa78037a38da2c835b0

模式：resource_controller；Conditions：resource-pilot-v3；Repetition：2。

采集器：adb-proc-stat-v2；时长：301.726 秒；快照：21；CPU 拒绝数：0。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|5.222|9.532|20||
|Agent CPU (单核 %)|3.100|11.113|20||
|Controller CPU (单核 %)|0.465|0.535|20||
|Agent PSS (KiB)|395298|409078|21||
|Controller PSS (KiB)|125269|125313|21||
|系统已用内存 (KiB)|6407484|6506700|21||

电量消耗 (µAh)：不可用。

估算能量 (mWh)：不可用。

估算功率 (mW)：不可用。

电池说明：No charge change resolved; this does not mean zero energy cost

用户 Notes：W0 idle; Gemini foreground throughout; screen on; unplugged; wireless ADB; no interaction; no markers; Project B connected and backgrounded; Perfetto off; Simpleperf off.

### 52dff150ece54ba592d0d04d5fd9e6c1

模式：resource_controller；Conditions：resource-pilot-v3；Repetition：2。

采集器：adb-proc-stat-v2；时长：12.656 秒；快照：1；CPU 拒绝数：0。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|不可用|不可用|0|Need at least two available, valid samples|
|Agent CPU (单核 %)|不可用|不可用|0|Need at least two available, valid samples|
|Controller CPU (单核 %)|不可用|不可用|0|Need at least two available, valid samples|
|Agent PSS (KiB)|不可用|378492|1|Need at least two available, valid samples|
|Controller PSS (KiB)|不可用|115748|1|Need at least two available, valid samples|
|系统已用内存 (KiB)|不可用|5872112|1|Need at least two available, valid samples|

电量消耗 (µAh)：不可用。

估算能量 (mWh)：不可用。

估算功率 (mW)：不可用。

电池说明：Need at least two battery samples

用户 Notes：

### e021e7a2eeef4ff2b3f271be28a60c23

模式：resource_controller；Conditions：resource-pilot-v3；Repetition：3。

采集器：adb-proc-stat-v2；时长：301.775 秒；快照：21；CPU 拒绝数：0。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|5.661|13.495|20||
|Agent CPU (单核 %)|3.203|4.159|20||
|Controller CPU (单核 %)|0.435|0.797|20||
|Agent PSS (KiB)|369419|372116|21||
|Controller PSS (KiB)|107915|110488|21||
|系统已用内存 (KiB)|5930412|6011732|21||

电量消耗 (µAh)：20000。

估算能量 (mWh)：86.306。

估算功率 (mW)：1036.524。

电池说明：

用户 Notes：W0 idle; Gemini foreground throughout; screen on; unplugged; wireless ADB; no interaction; no markers; Project B connected and backgrounded; Perfetto off; Simpleperf off.

### 1015957904c5425b9df993d0bc16c7d5

模式：resource_trace；Conditions：resource-pilot-v3；Repetition：3。

采集器：adb-proc-stat-v2；时长：301.888 秒；快照：21；CPU 拒绝数：0。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|6.221|10.509|20||
|Agent CPU (单核 %)|3.309|4.087|20||
|Controller CPU (单核 %)|0.466|0.735|20||
|Agent PSS (KiB)|483518|484843|21||
|Controller PSS (KiB)|110501|110705|21||
|系统已用内存 (KiB)|6171984|6259932|21||

电量消耗 (µAh)：18000。

估算能量 (mWh)：77.609。

估算功率 (mW)：931.318。

电池说明：

用户 Notes：W0 idle; Gemini foreground throughout; screen on; unplugged; wireless ADB; no interaction; no markers; Project B connected and backgrounded; Perfetto on; Simpleperf off.

### 2cbe0bf985b240b3a8543f18ba1916ff

模式：resource_agent；Conditions：resource-pilot-v3；Repetition：3。

采集器：adb-proc-stat-v2；时长：301.597 秒；快照：21；CPU 拒绝数：2。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|4.968|8.931|18||
|Agent CPU (单核 %)|3.248|4.100|18||
|Controller CPU (单核 %)|0.000|0.000|18||
|Agent PSS (KiB)|365825.000|367521|20||
|Controller PSS (KiB)|0.000|0|20||
|系统已用内存 (KiB)|5930192|5998184|21||

电量消耗 (µAh)：16000。

估算能量 (mWh)：68.854。

估算功率 (mW)：826.368。

电池说明：

用户 Notes：W0 idle; Gemini foreground throughout; screen on; unplugged; wireless ADB; no interaction; no markers; Project B stopped by backend; Simpleperf off.

### 6515405d4d9a4df69122cfed0bc2487e

模式：resource_agent；Conditions：resource-pilot-v3；Repetition：3。

采集器：adb-proc-stat-v2；时长：301.451 秒；快照：21；CPU 拒绝数：0。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|4.735|8.287|20||
|Agent CPU (单核 %)|3.291|4.036|20||
|Controller CPU (单核 %)|0.000|0.000|20||
|Agent PSS (KiB)|353865|354996|21||
|Controller PSS (KiB)|0|0|21||
|系统已用内存 (KiB)|6027432|6109888|21||

电量消耗 (µAh)：16000。

估算能量 (mWh)：68.106。

估算功率 (mW)：818.219。

电池说明：

用户 Notes：W0 idle; Gemini foreground throughout; screen on; unplugged; wireless ADB; no interaction; no markers; Project B stopped by backend; Simpleperf off.

### 483ac69b283f43fba3acdb280970281e

模式：resource_trace；Conditions：resource-pilot-v3；Repetition：4。

采集器：adb-proc-stat-v2；时长：301.642 秒；快照：21；CPU 拒绝数：8。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|6.351|9.107|15||
|Agent CPU (单核 %)|3.445|4.068|12||
|Controller CPU (单核 %)|0.631|1.996|12||
|Agent PSS (KiB)|352021.500|353975|16||
|Controller PSS (KiB)|116493.000|355104|16||
|系统已用内存 (KiB)|6199516|6253768|17||

电量消耗 (µAh)：不可用。

估算能量 (mWh)：不可用。

估算功率 (mW)：不可用。

电池说明：Need real, unplugged, discharging readings throughout the run

用户 Notes：Wireless ADB was disconnected for a duration and was connected back automatically. 

### 0d4f82d3f0bf4b3fa329597947e34e8d

模式：resource_trace；Conditions：resource-pilot-v3；Repetition：4。

采集器：adb-proc-stat-v2；时长：302.117 秒；快照：21；CPU 拒绝数：0。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|6.111|7.784|20||
|Agent CPU (单核 %)|3.439|4.341|20||
|Controller CPU (单核 %)|0.530|1.327|20||
|Agent PSS (KiB)|415500|432595|21||
|Controller PSS (KiB)|113327|113542|21||
|系统已用内存 (KiB)|6139084|6233568|21||

电量消耗 (µAh)：18000。

估算能量 (mWh)：76.340。

估算功率 (mW)：916.003。

电池说明：

用户 Notes：W0 idle; Gemini foreground throughout; screen on; unplugged; wireless ADB; no interaction; no markers; Project B connected and backgrounded; Perfetto on; Simpleperf off.

### 412fc75ee0ab485688b18a752d340a23

模式：resource_agent；Conditions：resource-pilot-v3；Repetition：4。

采集器：adb-proc-stat-v2；时长：301.473 秒；快照：21；CPU 拒绝数：2。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|4.849|6.070|18||
|Agent CPU (单核 %)|3.307|4.037|18||
|Controller CPU (单核 %)|0.000|0.000|18||
|Agent PSS (KiB)|358834.500|361612|20||
|Controller PSS (KiB)|0.000|0|20||
|系统已用内存 (KiB)|6021598.000|6082868|20||

电量消耗 (µAh)：不可用。

估算能量 (mWh)：不可用。

估算功率 (mW)：不可用。

电池说明：Need real, unplugged, discharging readings throughout the run

用户 Notes：W0 idle; Gemini foreground throughout; screen on; unplugged; wireless ADB; no interaction; no markers; Project B stopped by backend; Simpleperf off.

### 15b429f3d2394561aa5c78adf14a17e6

模式：resource_agent；Conditions：resource-pilot-v3；Repetition：4。

采集器：adb-proc-stat-v2；时长：301.597 秒；快照：21；CPU 拒绝数：0。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|4.605|9.807|20||
|Agent CPU (单核 %)|3.248|3.965|20||
|Controller CPU (单核 %)|0.000|0.000|20||
|Agent PSS (KiB)|357487|358568|21||
|Controller PSS (KiB)|0|0|21||
|系统已用内存 (KiB)|5908952|5956000|21||

电量消耗 (µAh)：18000。

估算能量 (mWh)：75.954。

估算功率 (mW)：912.202。

电池说明：

用户 Notes：W0 idle; Gemini foreground throughout; screen on; unplugged; wireless ADB; no interaction; no markers; Project B stopped by backend; Simpleperf off.

### 6a660547208a443f8858f3f98b433921

模式：resource_controller；Conditions：resource-pilot-v3；Repetition：4。

采集器：adb-proc-stat-v2；时长：301.762 秒；快照：21；CPU 拒绝数：0。

|指标|中位数|峰值|有效样本数|原因|
|---|---:|---:|---:|---|
|系统 CPU (%)|5.015|7.966|20||
|Agent CPU (单核 %)|3.263|4.088|20||
|Controller CPU (单核 %)|0.531|0.930|20||
|Agent PSS (KiB)|354997|356221|21||
|Controller PSS (KiB)|113540|113932|21||
|系统已用内存 (KiB)|6034288|6071972|21||

电量消耗 (µAh)：20000。

估算能量 (mWh)：84.319。

估算功率 (mW)：1011.963。

电池说明：

用户 Notes：W0 idle; Gemini foreground throughout; screen on; unplugged; wireless ADB; no interaction; no markers; Project B connected and backgrounded; Perfetto off; Simpleperf off.


## 附录 C：数据包与复核

`weekly_report.md` 为本报告；`evaluation.json` 和 `resource_comparisons.json` 为当前代码生成的机器可读评价；`all_data.zip` 包含全部运行文件（包括 trace、JSON、已有 CSV）、相关采集/分析代码及文档、完整校验清单。未包含后端 access token、整个 Git 仓库或无关文件。原始 metadata/trace 可能包含设备、软件包列表等信息，属于完整实验材料。

数据包按原文件字节复制，未修改原始实验或补写缺失值。SHA-256 清单用于验证归档一致性。自动配对与人工有效性判断的区别、特别是第 3 轮的限制，应在演示和最终报告中保留。