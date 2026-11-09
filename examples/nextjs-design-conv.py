import json,re,sys
# NextTutorial の NODES(register.tsx) を tree-canvas の木に変換するサンプル。
src=open(sys.argv[1]).read()
decided=set(sys.argv[2].split(",")) if len(sys.argv)>2 and sys.argv[2] else set()
nodes=[]
for m in re.finditer(r"\{\s*id:\s*'(\w+)',\s*label:\s*'([^']*)',\s*hint:\s*'([^']*)',\s*depth:\s*(\d+),\s*deps:\s*\[([^\]]*)\]",src,re.S):
    nodes.append(dict(id=m[1],label=m[2].strip(),hint=m[3],depth=int(m[4]),deps=re.findall(r"'(\w+)'",m[5])))
by={n["id"]:n for n in nodes}
def st(n):
    if n["id"] in decided: return "done"
    return "todo" if all(d in decided for d in n["deps"]) else "idle"
tree={}
for n in nodes:
    o={"id":n["id"],"label":n["label"],"status":st(n)}
    note=n["hint"]
    if len(n["deps"])>1:
        note+=" ／ 他の前提: "+" / ".join(by[d]["label"] for d in n["deps"][:-1])
    o["note"]=note; tree[n["id"]]=o
root=None
for n in nodes:
    if not n["deps"]: root=tree[n["id"]]; continue
    p=tree[n["deps"][-1]]; p.setdefault("children",[]).append(tree[n["id"]])
print(json.dumps({"title":"Next.js 設計の依存関係","direction":"LR","root":root},ensure_ascii=False,indent=2))
