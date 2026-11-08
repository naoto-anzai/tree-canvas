# tree-canvas

エージェントが成果物を「木構造」で描くための Herdr Mod。木は JSON ファイルが正で、Mod は保存を検知して GUI で描画する(mermaid の flowchart LR 風: 箱+曲線エッジ、クリックで子を折りたたみ、status の色枠、ノートは箱の2行目。編集 UI は未実装)。

- 文書: `~/.herdr/trees/<doc>.json`
- 編集 CLI: `bin/htree`(`~/.local/bin/htree` に symlink)
- 表示: `htree open <doc>`(右に Mod ペインとして分割)

## 導入

    ln -s ~/Projects/herdr-mods/tree-canvas ~/.config/herdr-app/mods/tree-canvas
    ln -s ~/Projects/herdr-mods/tree-canvas/bin/htree ~/.local/bin/htree

## エージェント向け使い方

    printf -- '- 計画\n  - [done] 設計 :: 注記\n  - [doing] 実装\n' | htree put plan --title "計画"
    htree add plan n3 "子ノード" --status todo      # n3 の子に追加。id は出力される
    htree edit plan n3 --status done --note "完了"
    htree mv plan n4 n2 ; htree rm plan n5
    htree show plan                                  # ASCII + id
    htree open plan                                  # GUI で表示

status: todo / doing / done / blocked / idle(任意)。`root` は最上位ノードの別名。
JSON を直接書いてもよい: `{"title": "...", "root": {"id": "n1", "label": "...", "note"?, "status"?, "collapsed"?, "children"?: [...]}}`
