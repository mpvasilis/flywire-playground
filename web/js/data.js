// Loads the binaries produced by pipeline/build_connectome.py
export async function loadConnectome(base = './data/', onProgress = () => {}) {
  const files = {
    meta: 'meta.json', groups: 'groups.json',
    pos: 'pos.f32', rowptr: 'rowptr.u32', col: 'col.u32', w: 'w.i16',
    type: 'type.u16', superclass: 'superclass.u8', klass: 'klass.u8',
    subclass: 'subclass.u16', side: 'side.u8', nt: 'nt.u8', rootid: 'rootid.u64',
  };
  const out = {};
  let done = 0; const total = Object.keys(files).length;
  await Promise.all(Object.entries(files).map(async ([k, f]) => {
    const r = await fetch(base + f);
    if (!r.ok) throw new Error(`failed to load ${f}: ${r.status}`);
    out[k] = f.endsWith('.json') ? await r.json() : await r.arrayBuffer();
    onProgress(++done / total, f);
  }));
  const d = {
    meta: out.meta, groups: out.groups,
    pos: new Float32Array(out.pos),
    rowptr: out.rowptr, col: out.col, w: out.w,            // raw buffers -> worker
    type: new Uint16Array(out.type), superclass: new Uint8Array(out.superclass),
    klass: new Uint8Array(out.klass), subclass: new Uint16Array(out.subclass),
    side: new Uint8Array(out.side), nt: new Uint8Array(out.nt),
    rootid: new BigUint64Array(out.rootid),
  };
  d.N = d.meta.N;
  d.typeName = (i) => d.meta.cell_types[d.type[i]];
  d.superName = (i) => d.meta.super_classes[d.superclass[i]];
  d.className = (i) => d.meta.classes[d.klass[i]];
  d.subName = (i) => d.meta.sub_classes[d.subclass[i]];
  d.sideName = (i) => d.meta.sides[d.side[i]];
  d.ntName = (i) => d.meta.nt_types[d.nt[i]];
  d.codexUrl = (i) => `https://codex.flywire.ai/app/cell_details?root_id=${d.rootid[i].toString()}`;
  // cell-type -> neuron index lookup (lazy)
  d.byType = (name) => {
    const ti = d.meta.cell_types.indexOf(name);
    if (ti < 0) return [];
    const r = []; for (let i = 0; i < d.N; i++) if (d.type[i] === ti) r.push(i);
    return r;
  };
  d.byTypePrefix = (prefix) => {
    const set = new Set(); d.meta.cell_types.forEach((t, i) => { if (t.startsWith(prefix)) set.add(i); });
    const r = []; for (let i = 0; i < d.N; i++) if (set.has(d.type[i])) r.push(i);
    return r;
  };
  return d;
}
