# tree-canvas

エージェントが成果物を「木構造」で描くための Herdr Mod。木は JSON ファイルが正で、Mod は保存を検知して GUI で描画する(mermaid の flowchart LR 風: 箱+曲線エッジ、クリックで子を折りたたみ、status の色枠、ノートは箱の2行目。編集 UI は未実装)。

- 文書: プロジェクト内 `.herdr/trees/<doc>.json`(なければ共通の `~/.herdr/trees/`)
- 編集 CLI: `bin/htree`(`~/.local/bin/htree` に symlink)
- 表示: `htree open <doc>`(右に Mod ペインとして分割)

## 導入

    git clone <このリポジトリ> tree-canvas && cd tree-canvas
    ln -s "$PWD" ~/.config/herdr-app/mods/tree-canvas
    ln -s "$PWD/bin/htree" ~/.local/bin/htree

## エージェント向け使い方

    printf -- '- 計画\n  - [done] 設計 :: 注記\n  - [doing] 実装\n' | htree put plan --title "計画"
    htree add plan n3 "子ノード" --status todo      # n3 の子に追加。id は出力される
    htree edit plan n3 --status done --note "完了"
    htree mv plan n4 n2 ; htree rm plan n5
    htree show plan                                  # ASCII + id
    htree open plan                                  # GUI で表示

status: todo / doing / done / blocked / idle(任意)。`root` は最上位ノードの別名。
JSON を直接書いてもよい: `{"title": "...", "root": {"id": "n1", "label": "...", "note"?, "status"?, "collapsed"?, "children"?: [...]}}`

## mermaid 風の描画

- 方向: 文書の `"direction": "LR"`(既定, 左→右) または `"TD"`(上→下)。`htree dir <doc> TD`
- エッジ: 曲線 + 矢じり(親→子)
- 形: ノードの `"shape"`: `rect` / `round`(既定) / `stadium`。`htree edit <doc> <id> --shape stadium`

## データの置き場所

Mod 側(優先順): `props.file` > `props.folder/.herdr/trees/` > 見ている space のフォルダの `.herdr/trees/` > `~/.herdr/trees/`。インスタンス(ペイン)ごとに起動時に 1 度決める。リモートマシンの space は共通フォルダ。
CLI 側(`htree`): `HTREE_DIR` > 上方の `.herdr/trees/` > `~/.herdr/trees/`。`htree init` でプロジェクトに作成、`htree where` で確認、`-g` で共通を強制。`htree open` はプロジェクトのフォルダを props で渡す。

## ストーリーブック / 注意

- モックは `main.js` に同居(`storybook.json` の状態に対応)。**`mods/` への symlink 配備では、兄弟 `.js` を `import` できない**(`resolves outside the application directory`)。`herdr-app check` は通っても、ライブでは読み込みに失敗する。
- エージェント向けの使い方は skill `tree-canvas`(エージェント用の個人スキル。この Mod の使い方を `htree` の例つきでまとめたもの)。

## examples

`examples/nextjs-design-conv.py`: 依存関係を TSX にベタ書きした Claude Code Mod(`NODES` 配列)を、この Mod の木 JSON に変換するサンプル。複数の前提は最後の前提の子にして、残りは note に書く。
