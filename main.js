// tree-canvas: エージェントが書いた木構造(~/.herdr/trees/<doc>.json)を GUI で描画する。
// 編集はエージェント側(htree CLI か JSON を直接編集)。このモジュールは見る専用 + 折りたたみ/選択。
// props: { doc?: string }  省略時は先頭の文書。
import { View, div, PathBuilder } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, home, exec, readTextFile, watchFolder, theme, shared, spaces } from "herdr";

// モック中(Story が開いたプレビュー)は選択値、本番なら null (ModsStoryBook 契約 v2)
// props().storybook が無いペインは常に本番。固定キーの直読みはしない。
function storybook() {
  const id = props()?.storybook;
  return id ? (shared(`storybook:tree-canvas:${id}`)?.values ?? {}) : null;
}

// データの置き場所(インスタンスごとに 1 度だけ決める):
//   1. props.file   1 ファイルを直接指定
//   2. props.folder そのフォルダの .herdr/trees/
//   3. いま見ている space のフォルダに .herdr/trees/ があればそこ
//   4. ~/.herdr/trees/ (共通)
const GLOBAL = () => `${home()}/.herdr/trees`;
const dirname = (f) => f.replace(/\/[^/]*$/, "") || "/";
const tilde = (d) => (d.startsWith(home()) ? "~" + d.slice(home().length) : d);

// status -> theme 色名
const STATUS = { todo: "dim", doing: "working", done: "done", blocked: "blocked", idle: "idle" };

// ---- モックデータ(storybook.json の状態に対応。symlink 配備では兄弟モジュールを import できないので同居)
// tree-canvas のモックデータ。storybook.json の状態 "tree" の値ごとに 1 つ。
// 各値は { docs: { <文書名>: {title, root} }, error?: string }。
// 構造(state)を変えたら storybook.json と同時に直すこと。

const { mockDocs } = (() => {
const n = (id, label, extra = {}, children) => ({ id, label, ...extra, ...(children ? { children } : {}) });

const FEW = {
  title: "少数のノード",
  root: n("n1", "Herdr Mods 計画", {}, [
    n("n2", "設計", { status: "done", note: "JSON を正にする" }, [
      n("n3", "データ形式", { status: "done" }),
      n("n4", "CLI", { status: "doing" }),
    ]),
    n("n5", "Mod 実装", { status: "doing", note: "描画と折りたたみ" }),
    n("n6", "配布", { status: "todo" }),
  ]),
};

const MEMO = {
  title: "メモ",
  root: n("m1", "メモ", {}, [n("m2", "一つ目", { status: "todo" }), n("m3", "二つ目", { status: "idle" })]),
};

// 3 階層・合計約 50 ノードを機械的に作る。
const STATUSES = ["todo", "doing", "done", "idle", "blocked"];
const many = () => {
  let k = 0; // 呼ぶたびに 1 から振り直す(Mod ファイル先頭は全コピーで共有されるため、状態を外に置かない)
  const mk = (depth) => {
    k += 1;
    const id = `x${k}`;
    const kids = depth < 3 ? Array.from({ length: depth === 0 ? 4 : depth === 1 ? 3 : 3 }, () => mk(depth + 1)) : null;
    return n(id, depth === 0 ? "大きな計画" : `タスク ${k}`, { status: STATUSES[k % STATUSES.length], ...(k % 4 === 0 ? { note: `メモ ${k}` } : {}) }, kids);
  };
  return { title: "多数のノード", root: mk(0) };
};

const STATUS = {
  title: "全ての status",
  root: n("s1", "リリース作業", {}, [
    n("s2", "todo: これから", { status: "todo", note: "着手前" }),
    n("s3", "doing: 作業中", { status: "doing", note: "進行中" }),
    n("s4", "done: 完了", { status: "done", note: "終わった" }),
    n("s5", "blocked: 詰まっている", { status: "blocked", note: "承認待ち" }, [
      n("s6", "原因の調査", { status: "doing" }),
      n("s7", "代替案", { status: "todo" }),
    ]),
    n("s8", "idle: 待機", { status: "idle" }),
    n("s9", "status なし"),
  ]),
};

const LONG = {
  title: "長い名前と長いノートを持つ木",
  root: n("l1", "とても長い名前のルートノード。表示幅の上限(280px)を超えたら切り詰められるはず", {
    note: "ノートも非常に長い場合を想定: これは何十文字も続く説明文で、箱の 2 行目に収まらず省略される。",
  }, [
    n("l2", "A", { status: "done" }),
    n("l3", "Internationalization-and-localization-configuration-service", { status: "doing", note: "English long label without spaces" }),
    n("l4", "日本語の長いラベルが続いたときにどう折り返されるか、切り詰められるかを見る", { status: "blocked", note: "短いノート" }, [
      n("l5", "子もやはり長い名前で、深い階層でも幅が破綻しないことを確認する", { status: "todo" }),
    ]),
  ]),
};

const MOCK = {
  none: { docs: {} },
  few: { docs: { plan: FEW, memo: MEMO } },
  many: { docs: { plan: many(), memo: MEMO } },
  status: { docs: { plan: STATUS, memo: MEMO } },
  long: { docs: { plan: LONG, memo: MEMO } },
  broken: { docs: { plan: null }, error: "JSON が壊れています: Unexpected token } in JSON at position 120" },
};

// 状態に合わせて加工した複製を返す(notes / shapes / direction)。
function mockDocs(sb) {
  const m = MOCK[sb.tree ?? "few"] ?? MOCK.few;
  const docs = {};
  for (const [name, doc] of Object.entries(m.docs)) {
    if (!doc) { docs[name] = null; continue; }
    const c = JSON.parse(JSON.stringify(doc));
    c.direction = sb.direction ?? "LR";
    let i = 0;
    const walk = (x) => {
      if (sb.notes === false) delete x.note;
      if (sb.shapes) x.shape = ["rect", "round", "stadium"][i % 3];
      i += 1;
      (x.children ?? []).forEach(walk);
    };
    walk(c.root);
    docs[name] = c;
  }
  return { docs, error: m.error ?? null };
}
  return { MOCK, mockDocs };
})();

export default class TreeCanvas extends View {
  init(p, cx) {
    this.docs = [];
    this.name = p?.doc ?? null;
    this.data = null;
    this.error = null;
    this.open = {}; // id -> 開閉(ユーザー操作)。未設定ならファイルの collapsed に従う
    this.selected = null;
    this.dir = null; // 画面で選んだ方向("LR" | "TD")。null なら文書の direction
    this.loc = null; // { dir, only? } 置き場所。決まるまで null
    this.watchedDir = null;
    this.mockOn = false; // 直前の render がモックだったか
    this.lastTree = null;
    this.needReload = false;
    this.start(cx);
    cx.timer.every(3000, (cx) => this.reload(cx)); // 監視の取りこぼし用
    cx.timer.every(500, (cx) => { // モック → 本番に戻ったとき一度だけ読み直す
      if (this.needReload) { this.needReload = false; this.loc = null; this.start(cx); }
    });
  }

  // 置き場所を決める(本番のみ)。
  async resolve() {
    const p = props() ?? {};
    if (p.file) return { dir: dirname(p.file), only: p.file.split("/").pop().replace(/\.json$/, "") };
    if (p.folder) return { dir: `${p.folder}/.herdr/trees` };
    // 別マシンの space は watchFolder が使えないので共通フォルダにする
    const sp = spaces().find((x) => x.active);
    if (sp?.folder && !sp.machine) {
      const dir = `${sp.folder}/.herdr/trees`;
      try { if ((await exec("test", ["-d", dir])).code === 0) return { dir }; } catch {}
    }
    return { dir: GLOBAL() };
  }

  // 本番: 置き場所を決めて一覧を読み、フォルダの監視を始める。モック中は何もしない。
  start(cx) {
    if (storybook()) return;
    cx.spawn(async (cx) => {
      if (!this.loc) {
        this.loc = await this.resolve();
        if (this.loc.dir === GLOBAL()) await exec("mkdir", ["-p", this.loc.dir]);
      }
      this.reload(cx);
      if (this.watchedDir === this.loc.dir) return;
      this.watchedDir = this.loc.dir;
      const dir = this.loc.dir;
      for (;;) {
        try { await watchFolder(dir); } catch { this.watchedDir = null; return; }
        this.reload(cx);
      }
    });
  }

  reload(cx) {
    if (storybook() || !this.loc) return; // モック中は本番データ・副作用に触れない
    const { dir, only } = this.loc;
    cx.spawn(async (cx) => {
      if (only) this.docs = [only];
      else {
        try {
          const r = await exec("ls", [dir]);
          this.docs = r.stdout.split("\n").filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
        } catch { this.docs = []; }
      }
      const want = only ?? (props()?.doc ?? this.name ?? this.docs[0] ?? null);
      this.name = want;
      if (want) {
        const text = await readTextFile(`${dir}/${want}.json`);
        if (text == null) { this.data = null; this.error = null; }
        else {
          try { this.data = JSON.parse(text); this.error = null; }
          catch (e) { this.error = `JSON が壊れています: ${e.message}`; }
        }
      }
      cx.notify();
    });
  }

  // モックの値で docs / data / error を作る(副作用なし)。
  applyMock(sb) {
    const { docs, error } = mockDocs(sb);
    const names = Object.keys(docs);
    if (!this.mockOn || this.lastTree !== sb.tree) {
      this.lastTree = sb.tree; this.name = names[0] ?? null; this.open = {}; this.selected = null;
    }
    this.mockOn = true;
    if (!names.includes(this.name)) this.name = names[0] ?? null;
    this.docs = names;
    this.data = this.name ? docs[this.name] : null;
    this.error = error;
  }

  isOpen(n) {
    return n.id in this.open ? this.open[n.id] : !n.collapsed;
  }

  setAll(node, v) {
    this.open[node.id] = v;
    for (const c of node.children ?? []) this.setAll(c, v);
  }

  count(n) {
    return 1 + (n.children ?? []).reduce((a, c) => a + this.count(c), 0);
  }

  // 文字幅の見積もり(全角 ≒ size、半角 ≒ 0.56*size)
  textW(str, size) {
    let w = 0;
    for (const ch of String(str ?? "")) w += ch.charCodeAt(0) > 255 ? size : size * 0.56;
    return w;
  }

  // mermaid の flowchart 風の木レイアウト。doc.direction: "LR"(既定) | "TD"。
  // 葉に段を割り当て、親は子の中央。LR は段=縦、TD は段=横。
  layout(root, dir) {
    const TD = dir === "TD";
    const GAP_MAIN = TD ? 48 : 64, GAP_CROSS = TD ? 20 : 14, PAD = 24;
    const size = (n) => {
      const w = Math.min(280, Math.max(96, this.textW(n.label ?? n.id, 13) + 44, n.note ? this.textW(n.note, 11) + 44 : 0));
      return { w, h: n.note ? 46 : 34 };
    };
    let cursor = PAD;
    const build = (n, depth) => {
      const { w, h } = size(n);
      const kids = this.isOpen(n) ? (n.children ?? []) : [];
      const ch = kids.map((c) => build(c, depth + 1));
      const cross = TD ? w : h; // 段方向の長さ
      let mid;
      if (ch.length) mid = (ch[0].mid + ch[ch.length - 1].mid) / 2;
      else { mid = cursor + cross / 2; cursor += cross + GAP_CROSS; }
      return { n, depth, w, h, mid, x: 0, y: 0, kids: ch };
    };
    const top = build(root, 0);
    const extent = []; // 深さごとの主軸方向の最大長
    const scan = (b) => { extent[b.depth] = Math.max(extent[b.depth] ?? 0, TD ? b.h : b.w); b.kids.forEach(scan); };
    scan(top);
    const pos = [PAD];
    for (let d = 1; d < extent.length; d++) pos[d] = pos[d - 1] + extent[d - 1] + GAP_MAIN;
    const nodes = [], edges = [];
    let W = PAD, H = PAD;
    const place = (b) => {
      if (TD) { b.x = b.mid - b.w / 2; b.y = pos[b.depth]; }
      else { b.x = pos[b.depth]; b.y = b.mid - b.h / 2; }
      nodes.push(b);
      W = Math.max(W, b.x + b.w + PAD); H = Math.max(H, b.y + b.h + PAD);
      for (const k of b.kids) { edges.push([b, k]); place(k); }
    };
    place(top);
    return { nodes, edges, W, H, TD };
  }

  graph(root, t, dir) {
    const { nodes, edges, W, H, TD } = this.layout(root, dir);
    const line = PathBuilder.stroke(1.5), arrows = PathBuilder.fill();
    const AL = 9, AW = 4; // 矢じりの長さ・半幅
    for (const [a, b] of edges) {
      if (TD) {
        const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y, my = (y1 + y2) / 2;
        line.move_to(x1, y1).cubic_bezier_to(x2, y2 - AL, x1, my, x2, my);
        arrows.add_polygon([[x2, y2], [x2 - AW, y2 - AL], [x2 + AW, y2 - AL]], true);
      } else {
        const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
        line.move_to(x1, y1).cubic_bezier_to(x2 - AL, y2, mx, y1, mx, y2);
        arrows.add_polygon([[x2, y2], [x2 - AL, y2 - AW], [x2 - AL, y2 + AW]], true);
      }
    }
    const layer = div().absolute().top(0).left(0).w(W).h(H)
      .child(window.paint_path(line.build(), t.dim).absolute().top(0).left(0).w(W).h(H))
      .child(window.paint_path(arrows.build(), t.dim).absolute().top(0).left(0).w(W).h(H));
    const boxes = nodes.map((b) => {
      const n = b.n, kids = n.children ?? [];
      const col = n.status ? (t[STATUS[n.status] ?? "unknown"] ?? t.unknown) : null;
      const isRoot = b.depth === 0;
      return div().id(`g-${n.id}`).absolute().left(b.x).top(b.y).w(b.w).h(b.h)
        .rounded(n.shape === "rect" ? 2 : n.shape === "stadium" ? b.h / 2 : 8).border(1).border_color(col ?? (isRoot ? t.accent : t.border))
        .bg(isRoot ? t.selected : t.raised)
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { if (kids.length) { this.open[n.id] = !this.isOpen(n); cx.notify(); } })
        .child(
          h_flex().size_full().items_center().gap(8).px(12)
            .when(!!col, (el) => el.child(div().w(8).h(8).flex_none().rounded(4).bg(col)))
            .child(
              v_flex().flex_1().min_w(0).justify_center()
                .child(div().truncate().text_size(13).text_color(t.foreground).child(n.label ?? n.id))
                .when(!!n.note, (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(n.note)))
            )
            .when(kids.length > 0 && !this.isOpen(n), (el) =>
              el.child(div().flex_none().px(5).rounded(8).bg(t.hover).text_size(11).text_color(t.muted).child(`+${this.count(n) - 1}`)))
        );
    });
    return div().relative().w(W).h(H).flex_none().child(layer).children(boxes);
  }

  render(cx) {
    const t = theme();
    const sb = storybook();
    if (sb) this.applyMock(sb);
    else if (this.mockOn) { // モックを切った: 本番を読み直す
      this.mockOn = false; this.docs = []; this.data = null; this.error = null; this.name = props()?.doc ?? null;
      this.open = {}; this.needReload = true; this.loc = null;
    }
    const tabs = h_flex().id("tc-tabs").w_full().gap(4).px(8).py(6).flex_none().children(
      this.docs.map((d) =>
        div().id(`d-${d}`).px(8).py(2).rounded(5).text_size(12)
          .bg(d === this.name ? t.selected : t.surface)
          .text_color(d === this.name ? t.foreground : t.muted)
          .hover((s) => s.bg(t.raised))
          .on_click((_e, cx) => { this.name = d; this.open = {}; this.reload(cx); cx.notify(); })
          .child(d)
      )
    );
    const root = this.data?.root;
    const body = this.error
      ? div().p(12).text_size(12).text_color(t.blocked).child(this.error)
      : root
        ? this.graph(root, t, this.dir ?? this.data?.direction)
        : div().p(12).text_size(12).text_color(t.muted)
            .child(this.docs.length ? "文書を選んでください" : "文書がありません。`htree put <name>` で作ります。");
    const kids = [tabs];
    if (this.data?.title) {
      kids.push(
        h_flex().id("tc-title").w_full().px(12).py(4).flex_none().items_center().justify_between()
          .child(
            h_flex().gap(8).items_center()
              .child(div().text_size(14).font_semibold().text_color(t.foreground).child(this.data.title))
              .child(div().text_size(11).text_color(t.dim).child(sb ? "(mock)" : this.loc ? tilde(this.loc.dir) : ""))
          )
          .child(
            h_flex().gap(8).text_size(11).text_color(t.dim)
              .child(
                div().id("dir").hover((s) => s.text_color(t.foreground))
                  .on_click((_e, cx) => { this.dir = (this.dir ?? this.data?.direction) === "TD" ? "LR" : "TD"; cx.notify(); })
                  .child((this.dir ?? this.data?.direction) === "TD" ? "↓ 縦" : "→ 横")
              )
              .child(div().id("exp").hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { if (root) { this.setAll(root, true); cx.notify(); } }).child("展開"))
              .child(div().id("col").hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { if (root) { this.setAll(root, false); this.open[root.id] = true; cx.notify(); } }).child("折りたたむ"))
          )
      );
    }
    kids.push(
      v_flex().id("tc-v").flex_1().min_h(0).w_full().overflow_y_scrollbar()
        .child(h_flex().id("tc-h").w_full().items_start().overflow_x_scrollbar().child(body))
    );
    return v_flex().id("tc-root").size_full().min_h(0).bg(t.surface).children(kids);
  }
}
