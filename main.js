// tree-canvas: エージェントが書いた木構造(~/.herdr/trees/<doc>.json)を GUI で描画する。
// 編集はエージェント側(htree CLI か JSON を直接編集)。このモジュールは見る専用 + 折りたたみ/選択。
// props: { doc?: string }  省略時は先頭の文書。
import { View, div, PathBuilder } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, home, exec, readTextFile, watchFolder, theme } from "herdr";

const DIR = () => `${home()}/.herdr/trees`;

// status -> theme 色名
const STATUS = { todo: "dim", doing: "working", done: "done", blocked: "blocked", idle: "idle" };

export default class TreeCanvas extends View {
  init(p, cx) {
    this.docs = [];
    this.name = p?.doc ?? null;
    this.data = null;
    this.error = null;
    this.open = {}; // id -> 開閉(ユーザー操作)。未設定ならファイルの collapsed に従う
    this.selected = null;
    this.reload(cx);
    cx.timer.every(3000, (cx) => this.reload(cx)); // 監視の取りこぼし用
    cx.spawn(async (cx) => {
      await exec("mkdir", ["-p", DIR()]);
      for (;;) {
        try { await watchFolder(DIR()); } catch { return; }
        this.reload(cx);
      }
    });
  }

  reload(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await exec("ls", [DIR()]);
        this.docs = r.stdout.split("\n").filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
      } catch { this.docs = []; }
      const want = props()?.doc ?? this.name ?? this.docs[0] ?? null;
      this.name = want;
      if (want) {
        const text = await readTextFile(`${DIR()}/${want}.json`);
        if (text == null) { this.data = null; this.error = null; }
        else {
          try { this.data = JSON.parse(text); this.error = null; }
          catch (e) { this.error = `JSON が壊れています: ${e.message}`; }
        }
      }
      cx.notify();
    });
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
    const tabs = h_flex().id("tc-tabs").w_full().gap(4).px(8).py(6).flex_none().children(
      this.docs.map((d) =>
        div().id(`d-${d}`).px(8).py(2).rounded(5).text_size(12)
          .bg(d === this.name ? t.selected : t.surface)
          .text_color(d === this.name ? t.foreground : t.muted)
          .hover((s) => s.bg(t.raised))
          .on_click((_e, cx) => { this.name = d; this.open = {}; this.reload(cx); })
          .child(d)
      )
    );
    const root = this.data?.root;
    const body = this.error
      ? div().p(12).text_size(12).text_color(t.blocked).child(this.error)
      : root
        ? this.graph(root, t, this.data?.direction)
        : div().p(12).text_size(12).text_color(t.muted)
            .child(this.docs.length ? "文書を選んでください" : "文書がありません。`htree put <name>` で作ります。");
    const kids = [tabs];
    if (this.data?.title) {
      kids.push(
        h_flex().id("tc-title").w_full().px(12).py(4).flex_none().items_center().justify_between()
          .child(div().text_size(14).font_semibold().text_color(t.foreground).child(this.data.title))
          .child(
            h_flex().gap(8).text_size(11).text_color(t.dim)
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
