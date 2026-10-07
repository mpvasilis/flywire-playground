"""
Build compact browser-ready binaries from the public FlyWire v783 Codex tables.

Input  (data/raw/, downloaded from https://storage.googleapis.com/flywire-data/codex/data/fafb/783/):
  classification.csv.gz, neurons.csv.gz, coordinates.csv.gz,
  consolidated_cell_types.csv.gz, connections.csv.gz
Output (web/data/):
  pos.f32        N*3 float32   neuron position, micrometres, brain-centred
  rowptr.u32     N+1 uint32    CSR row pointers (pre-synaptic neuron -> edge range)
  col.u32        E   uint32    post-synaptic neuron index per edge
  w.i16          E   int16     signed synapse count (+ excitatory, - GABA/GLUT)
  type.u16       N   uint16    index into meta.cell_types
  superclass.u8  N   uint8     index into meta.super_classes
  klass.u8       N   uint8     index into meta.classes
  subclass.u16   N   uint16    index into meta.sub_classes
  side.u8        N   uint8     index into meta.sides
  nt.u8          N   uint8     index into meta.nt_types
  rootid.u64     N   uint64    FlyWire root id (for Codex links)
  meta.json      dictionaries + counts
  groups.json    named neuron-index lists used by the scenarios
"""
import json, time, pathlib
import numpy as np, pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW, OUT = ROOT / "data/raw", ROOT / "web/data"
OUT.mkdir(parents=True, exist_ok=True)
t0 = time.time()


def log(*a):
    print(f"[{time.time()-t0:6.1f}s]", *a, flush=True)


cls = pd.read_csv(RAW / "classification.csv.gz")
N = len(cls)
idx = pd.Series(np.arange(N, dtype=np.int64), index=cls.root_id.values)
log("neurons", N)

neu = pd.read_csv(RAW / "neurons.csv.gz", usecols=["root_id", "nt_type"]).set_index("root_id").reindex(cls.root_id)
typ = pd.read_csv(RAW / "consolidated_cell_types.csv.gz").set_index("root_id").reindex(cls.root_id)
coo = pd.read_csv(RAW / "coordinates.csv.gz").drop_duplicates("root_id").set_index("root_id").reindex(cls.root_id)
pos = coo.position.str.strip("[]").str.split(expand=True).astype(np.float64).values  # nm
pos = pos / 1000.0  # micrometres
pos -= np.nanmean(pos, axis=0)
# FlyWire/FAFB frame: x = medio-lateral, y = dorso-ventral (down), z = antero-posterior.
missing = np.isnan(pos).any(1)
pos[missing] = 0
log("positions ok, missing", int(missing.sum()), "extent um", np.ptp(pos, axis=0).round(0))


def codes(series, none="unknown"):
    s = series.fillna(none).astype(str)
    cats = sorted(s.unique(), key=lambda x: (x == none, x))
    m = {c: i for i, c in enumerate(cats)}
    return s.map(m).values, cats


type_i, cell_types = codes(typ.primary_type)
sc_i, super_classes = codes(cls.super_class)
cl_i, classes = codes(cls["class"])
sub_i, sub_classes = codes(cls.sub_class)
side_i, sides = codes(cls.side)
nt_i, nt_types = codes(neu.nt_type)
log("cell types", len(cell_types), "sub classes", len(sub_classes))

# ---------------- connectivity ----------------
con = pd.read_csv(RAW / "connections.csv.gz",
                  usecols=["pre_root_id", "post_root_id", "syn_count", "nt_type"],
                  dtype={"syn_count": np.int32, "nt_type": "category"})
log("connection rows", len(con))
con = con[con.pre_root_id.isin(idx.index) & con.post_root_id.isin(idx.index)]
sign = np.where(con.nt_type.isin(["GABA", "GLUT"]), -1, 1).astype(np.int32)
con = pd.DataFrame({"pre": idx.loc[con.pre_root_id].values,
                    "post": idx.loc[con.post_root_id].values,
                    "w": con.syn_count.values * sign})
edges = con.groupby(["pre", "post"], sort=True).w.sum().reset_index()
E = len(edges)
pre = edges.pre.values.astype(np.int64)
post = edges.post.values.astype(np.uint32)
w = np.clip(edges.w.values, -32767, 32767).astype(np.int16)
rowptr = np.zeros(N + 1, dtype=np.int64)
np.add.at(rowptr, pre + 1, 1)
rowptr = np.cumsum(rowptr).astype(np.uint32)
log("edges", E, "excitatory", int((w > 0).sum()), "inhibitory", int((w < 0).sum()),
    "mean out-degree", round(E / N, 1))
in_deg = np.bincount(post, minlength=N)

# ---------------- write binaries ----------------
pos.astype(np.float32).tofile(OUT / "pos.f32")
rowptr.tofile(OUT / "rowptr.u32")
post.tofile(OUT / "col.u32")
w.tofile(OUT / "w.i16")
type_i.astype(np.uint16).tofile(OUT / "type.u16")
sc_i.astype(np.uint8).tofile(OUT / "superclass.u8")
cl_i.astype(np.uint8).tofile(OUT / "klass.u8")
sub_i.astype(np.uint16).tofile(OUT / "subclass.u16")
side_i.astype(np.uint8).tofile(OUT / "side.u8")
nt_i.astype(np.uint8).tofile(OUT / "nt.u8")
cls.root_id.values.astype(np.uint64).tofile(OUT / "rootid.u64")

# ---------------- named groups for scenarios ----------------
ct = np.asarray(cell_types, dtype=object)[type_i]
sub = np.asarray(sub_classes, dtype=object)[sub_i]
kls = np.asarray(classes, dtype=object)[cl_i]
sc = np.asarray(super_classes, dtype=object)[sc_i]
sd = np.asarray(sides, dtype=object)[side_i]


def by_type(*names):
    return np.flatnonzero(np.isin(ct, names))


def by_type_prefix(p):
    return np.flatnonzero(pd.Series(ct).str.startswith(p).values)


def by_sub(*names):
    return np.flatnonzero(np.isin(sub, names))


def by_class(*names):
    return np.flatnonzero(np.isin(kls, names))


groups = {
    # ---- sensory inputs ----
    "JO-A": by_type_prefix("JO-A"),           # Johnston's organ, sound (tone / higher band)
    "JO-B": by_type_prefix("JO-B"),           # Johnston's organ, sound (courtship-song band)
    "JO-CE": by_sub("wind_gravity"),          # JO-C/D/E: wind & gravity (static deflection)
    "JO-F": by_sub("grooming"),               # JO-F: antennal grooming trigger (Shiu 2024)
    "auditory": by_sub("auditory"),
    "sugar": by_sub("sugar/water"),           # sugar/water gustatory receptor neurons
    "bitter": by_sub("bitter"),
    "LB3": by_type("LB3"),                    # labellar taste bristle class 3
    "LPLC2": by_type("LPLC2"),                # looming detectors
    "LC4": by_type("LC4"),                    # looming / size detectors -> giant fiber
    "ORN_DM1": by_type("ORN_DM1"),            # food odour (vinegar)
    "ORN_DA1": by_type("ORN_DA1"),            # cVA pheromone
    "pheromone_ORN": by_sub("pheromone"),
    "R7": by_type("R7"), "R8": by_type("R8"),
    "photoreceptors": by_sub("photo_receptor"),
    "eye_bristle": by_sub("eye_bristle"),
    "head_bristle": by_sub("head_bristle"),
    # ---- central populations ----
    "KC": by_class("Kenyon_Cell"),
    "MBON": by_class("MBON"),
    "PAM": by_type_prefix("PAM"),             # reward dopamine
    "PPL1": by_type_prefix("PPL1"),           # punishment dopamine
    "DAN": by_class("DAN"),
    "pC1": by_type_prefix("pC1"),             # female receptivity / aggression hub
    "pC1a": by_type("pC1a"),
    "pC1de": by_type("pC1d", "pC1e"),
    "aSP": by_type_prefix("aSP"),
    "CX": by_class("CX"),
    "AMMC": by_type_prefix("AMMC"),
    "WED": by_type_prefix("WED"),
    # ---- descending / motor readouts ----
    "DNp01": by_type("DNp01"),                # giant fiber -> escape jump
    "DNp09": by_type("DNp09"),                # forward walking
    "MDN": by_type("MDN"),                    # moonwalker: backward walking
    "DNa01": by_type("DNa01"), "DNa02": by_type("DNa02"),  # steering
    "DNp07_10": by_type("DNp07", "DNp10"),    # landing / leg extension
    "DNg12": by_type_prefix("DNg12"),         # antennal grooming DNs
    "oviDN": by_type_prefix("oviDN"),
    "proboscis_MN": by_sub("proboscis_motor_neuron"),
    "ingestion_MN": by_sub("ingestion_motor_neuron"),
    "antennal_MN": by_sub("antennal_motor_neuron"),
    "neck_MN": by_sub("neck_motor_neuron"),
    "eye_MN": by_sub("eye_motor_neuron"),
    "MN_prob_types": by_type("MN10", "MNx01", "MNx03"),
    "descending": np.flatnonzero(sc == "descending"),
    "motor": np.flatnonzero(sc == "motor"),
}
groups = {k: [int(i) for i in v] for k, v in groups.items()}
for k, v in groups.items():
    log(f"  group {k:16s} {len(v):6d}")
json.dump(groups, open(OUT / "groups.json", "w"))


def centroid(sel):
    sel = np.asarray(sel)
    return pos[sel].mean(0).round(1).tolist() if len(sel) else None


labels = {
    "Optic lobe (L)": centroid(np.flatnonzero((sc == "optic") & (sd == "left"))),
    "Optic lobe (R)": centroid(np.flatnonzero((sc == "optic") & (sd == "right"))),
    "Mushroom body (KCs)": centroid(groups["KC"]),
    "Central complex": centroid(groups["CX"]),
    "Antennal lobe": centroid(by_class("ALPN")),
    "AMMC / hearing": centroid(groups["auditory"]),
    "GNG taste & motor": centroid(groups["sugar"] + groups["proboscis_MN"]),
    "Descending neurons": centroid(groups["descending"]),
}
meta = {
    "N": N, "E": E, "release": "FlyWire FAFB v783 (Codex public tables)",
    "units": "micrometres, centred",
    "position_frame": "x medio-lateral, y dorsal(-)->ventral(+), z anterior->posterior",
    "cell_types": cell_types, "super_classes": super_classes, "classes": classes,
    "sub_classes": sub_classes, "sides": sides, "nt_types": nt_types,
    "in_degree_max": int(in_deg.max()), "labels": labels,
    "lif": {"v_rest_mV": -52, "v_reset_mV": -52, "v_th_mV": -45, "tau_m_ms": 20, "tau_syn_ms": 5,
            "t_refractory_ms": 2.2, "t_delay_ms": 1.8, "w_per_synapse_mV": 0.275,
            "poisson_rate_Hz": 150, "poisson_gain": 250,
            "source": "Shiu et al. 2024 Nature, philshiu/Drosophila_brain_model model.py"},
}
json.dump(meta, open(OUT / "meta.json", "w"))
sizes = {p.name: p.stat().st_size for p in OUT.iterdir()}
log("written", {k: f"{v/1e6:.1f}MB" for k, v in sizes.items()})
