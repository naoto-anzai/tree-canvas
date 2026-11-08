// tree-canvas: エージェントが書いた木構造(~/.herdr/trees/<doc>.json)を GUI で描画する。
// 編集はエージェント側(htree CLI か JSON を直接編集)。このモジュールは見る専用 + 折りたたみ/選択。
// props: { doc?: string }  省略時は先頭の文書。
import { View, div } from "gpui-kit";
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

  row(n, depth, t, trail) {
    const kids = n.children ?? [];
    const open = this.isOpen(n);
    const sel = this.selected === n.id;
    const color = n.status ? (t[STATUS[n.status] ?? "unknown"] ?? t.unknown) : t.dim;
    const line = h_flex().id(`n-${n.id}`).w_full().items_center().gap(6).h(26).pr(8).rounded(5)
      .bg(sel ? t.selected : t.surface)
      .hover((s) => s.bg(t.raised))
      .on_click((_e, cx) => { this.selected = this.selected === n.id ? null : n.id; cx.notify(); })
      .child(div().w(depth * 16 + 6).h(26).flex_none())
      .child(
        div().id(`c-${n.id}`).w(16).flex_none().text_size(11).text_color(t.muted)
          .on_click((_e, cx) => { cx.stop_propagation(); this.open[n.id] = !open; cx.notify(); })
          .child(kids.length ? (open ? "▾" : "▸") : "")
      )
      .child(div().w(8).h(8).flex_none().rounded(4).bg(color))
      .child(div().flex_1().truncate().text_size(13).text_color(t.foreground).child(n.label ?? n.id))
      .when(!!n.note && !sel, (el) => el.child(div().max_w(260).truncate().text_size(11).text_color(t.dim).child(n.note)))
      .when(kids.length > 0 && !open, (el) => el.child(div().text_size(11).text_color(t.dim).child(`+${this.count(n) - 1}`)));
    const out = [line];
    if (sel && n.note) {
      out.push(
        h_flex().items_start().child(div().w(depth * 16 + 36).flex_none())
          .child(div().flex_1().py(4).text_size(12).text_color(t.muted).child(n.note))
      );
    }
    if (open) for (const c of kids) out.push(...this.row(c, depth + 1, t));
    return out;
  }

  count(n) {
    return 1 + (n.children ?? []).reduce((a, c) => a + this.count(c), 0);
  }

  render(cx) {
    const t = theme();
    const tabs = h_flex().id("tc-tabs").w_full().gap(4).px(8).py(6).flex_none().children(
      this.docs.map((d) =>
        div().id(`d-${d}`).px(8).py(2).rounded(5).text_size(12)
          .bg(d === this.name ? t.selected : t.surface)
          .text_color(d === this.name ? t.foreground : t.muted)
          .hover((s) => s.bg(t.raised))
          .on_click((_e, cx) => { this.name = d; this.selected = null; this.open = {}; this.reload(cx); })
          .child(d)
      )
    );
    const root = this.data?.root;
    const body = this.error
      ? div().p(12).text_size(12).text_color(t.blocked).child(this.error)
      : root
        ? v_flex().id("tc-body").w_full().p(8).gap(1).children(this.row(root, 0, t))
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
    kids.push(v_flex().id("tc-scroll").flex_1().min_h(0).w_full().overflow_y_scrollbar().child(body));
    return v_flex().id("tc-root").size_full().min_h(0).bg(t.surface).children(kids);
  }
}
