"""
Reference LIF simulation (numpy/scipy) over the built binaries, using the
Shiu et al. 2024 parameters.  Used to sanity-check that stimulating sensory
groups drives the expected motor readouts before porting the model to JS.

usage: python pipeline/validate_lif.py [stim_group] [readout groups...]
"""
import json, sys, pathlib, time
import numpy as np, scipy.sparse as sp

ROOT = pathlib.Path(__file__).resolve().parents[1]
D = ROOT / "web/data"
meta = json.load(open(D / "meta.json")); groups = json.load(open(D / "groups.json"))
N, E = meta["N"], meta["E"]
rowptr = np.fromfile(D / "rowptr.u32", np.uint32).astype(np.int64)
col = np.fromfile(D / "col.u32", np.uint32).astype(np.int64)
w = np.fromfile(D / "w.i16", np.int16).astype(np.float32)
W = sp.csr_matrix((w, col, rowptr), shape=(N, N))  # row = pre, col = post
WT = W.T.tocsr()                                   # for g_post += sum_pre W[pre,post]*spike[pre]

P = meta["lif"]
dt = 0.5  # ms
v0, vth = P["v_rest_mV"], P["v_th_mV"]
tau_m, tau_s = P["tau_m_ms"], P["tau_syn_ms"]
t_ref, t_dly, w_syn = P["t_refractory_ms"], P["t_delay_ms"], P["w_per_synapse_mV"]
delay_steps = max(1, int(round(t_dly / dt)))


def run(stim, rate_hz=150.0, T_ms=1000.0, seed=0, readouts=()):
    rng = np.random.default_rng(seed)
    v = np.full(N, v0, np.float32); g = np.zeros(N, np.float32)
    ref = np.zeros(N, np.float32)
    ring = [np.zeros(N, np.float32) for _ in range(delay_steps)]
    counts = np.zeros(N, np.int64)
    stim = np.asarray(stim); p = rate_hz * dt / 1000.0
    steps = int(T_ms / dt)
    for s in range(steps):
        # deliver delayed spikes
        sp_in = ring[s % delay_steps]
        g += WT @ sp_in * w_syn
        ring[s % delay_steps] = np.zeros(N, np.float32)
        # Poisson drive (each event ~ w_syn * gain, guaranteed to spike)
        kick = stim[rng.random(len(stim)) < p]
        g[kick] += w_syn * P["poisson_gain"]
        # dynamics
        active = ref <= 0
        v[active] += dt * ((v0 - v[active] + g[active]) / tau_m)
        g -= dt * g / tau_s
        ref -= dt
        fired = (v > vth) & active
        v[fired] = v0; g[fired] = 0; ref[fired] = t_ref
        counts[fired] += 1
        ring[(s + delay_steps) % delay_steps][fired] = 1.0  # deliver after delay
    out = {"total_spikes": int(counts.sum()), "active_neurons": int((counts > 0).sum()),
           "stim_rate": counts[stim].sum() / len(stim) / (T_ms / 1000)}
    for r in readouts:
        idx = np.asarray(groups[r])
        out[r] = round(float(counts[idx].sum() / max(1, len(idx)) / (T_ms / 1000)), 1)
    return out


if __name__ == "__main__":
    tests = [
        ("sugar", ["proboscis_MN", "MN_prob_types", "ingestion_MN", "MDN", "DNp01", "DNg12"]),
        ("bitter", ["proboscis_MN", "MN_prob_types", "MDN", "DNp01"]),
        ("JO-F", ["DNg12", "antennal_MN", "proboscis_MN", "neck_MN"]),
        ("JO-B", ["pC1", "DNp09", "MDN", "antennal_MN", "neck_MN", "WED"]),
        ("JO-A", ["pC1", "DNp09", "MDN", "antennal_MN", "WED"]),
        ("LPLC2", ["DNp01", "DNp07_10", "MDN", "DNa02"]),
        ("LC4", ["DNp01", "DNp07_10", "MDN"]),
        ("ORN_DM1", ["DNp09", "MDN", "proboscis_MN", "PAM"]),
        ("PAM", ["MBON", "KC", "proboscis_MN"]),
        ("pC1de", ["DNp09", "MDN", "oviDN", "DNa02"]),
    ]
    if len(sys.argv) > 1:
        tests = [(sys.argv[1], sys.argv[2:])]
    for stim, ro in tests:
        t = time.time()
        r = run(groups[stim], readouts=ro, T_ms=1000)
        print(f"{stim:8s} ({len(groups[stim]):4d} n) -> {r}   [{time.time()-t:.1f}s]", flush=True)
