# 貓咪轉蛋路線規劃

用 [battle-cats-rolls](https://gitlab.com/godfat/battle-cats-rolls) 的抽蛋演算法，搜尋在多個卡池之間切換的最佳抽蛋順序。

直接用瀏覽器開啟 `index.html` 即可，不需要伺服器。

## 檔案

- `src/engine.js`：種子（xorshift32）、A/B 軌、稀有重複重抽、保底超激換軌。移植自 `gacha.rb`。
- `src/planner.js`：最佳化，兩種模式。
  - 精準模式 `plan()`：對（位置、上一隻稀有、已取得目標集合）做動態規劃，並保留剩餘罐頭／券／加分的 Pareto 前緣，結果保證最佳。
  - 收集模式 `planCollect()`：目標是拿到最多「沒有的」角色。第一次拿到依稀有度或目標優先度計分；已擁有或重複的角色改用「重複」分數（每隻目標可自訂，其餘依稀有度），重複避不開時會選分數高的。要追蹤的角色集合太大，改用 beam search，每一格保留分數最高的 N 條路線（預設 1000）。
- 角色優先度表：每隻角色可以各自設定「優先度」（第一次抽到的分數）、「重複」（之後每隻的分數）、必抽與已擁有；空白就用稀有度預設值。
- 已擁有角色支援 bc.godfat.org 的 `o=` 代碼（base62 的角色編號位元遮罩，同 `owned.rb`），核對連結也會帶上它。
- `src/app.js`、`index.html`：介面。
- `data/bc-*.js`：卡池資料快照。

## 更新卡池資料

```sh
git clone --depth 1 https://gitlab.com/godfat/battle-cats-rolls.git /tmp/bcr
ruby scripts/build-data.rb /tmp/bcr        # 只保留 45 天內結束之後的活動
```

## 測試

```sh
node test/verify-engine.js   # 和 bc.godfat.org 的表格逐格比對（385 格）
node test/bench.js 30000 50  # 精準模式效能
node test/bench-collect.js 15000 30  # 收集模式：不同搜尋寬度的結果比較
```
