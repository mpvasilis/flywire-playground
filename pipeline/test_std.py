"""Short-term synaptic depression (per presynaptic neuron): does it stop the AL/LH/MB runaway
while keeping the sugar -> proboscis pathway intact?"""
import sys, numpy as np
sys.path.insert(0, 'pipeline')
import validate_lif as V
N = V.N; G = V.groups
def run(phases, u, tau_rec, adapt=None, seed=0):
    rng = np.random.default_rng(seed)
    v = np.full(N, V.v0, np.float32); g = np.zeros(N, np.float32); ref = np.zeros(N, np.float32); th = np.zeros(N, np.float32)
    x = np.ones(N, np.float32)                     # synaptic resource per presynaptic neuron
    ring = [np.zeros(N, np.float32) for _ in range(V.delay_steps)]; s = 0; res = []
    for (name, idx, rate, T) in phases:
        idx = np.asarray(idx); p = rate*V.dt/1000; counts = np.zeros(N, np.int64)
        for _ in range(int(T/V.dt)):
            sp_in = ring[s % V.delay_steps]; g += V.WT @ sp_in * V.w_syn; ring[s % V.delay_steps] = np.zeros(N, np.float32)
            if rate > 0:
                kick = idx[rng.random(len(idx)) < p]; g[kick] += V.w_syn * V.P['poisson_gain']
            active = ref <= 0
            v[active] += V.dt * ((V.v0 - v[active] + g[active]) / V.tau_m); g -= V.dt * g / V.tau_s; ref -= V.dt
            fired = (v > V.vth + th) & active; v[fired] = V.v0; g[fired] = 0; ref[fired] = V.t_ref; counts[fired] += 1
            if adapt: th[fired] += adapt[0]; th *= np.exp(-V.dt / adapt[1])
            # deliver with current resource, then deplete and recover
            out = np.zeros(N, np.float32); out[fired] = x[fired]; x[fired] *= (1 - u); x += (1 - x) * (V.dt / tau_rec)
            ring[(s + V.delay_steps) % V.delay_steps] = out; s += 1
        res.append(counts)
    return res
pm = np.asarray(G['proboscis_MN']); dnp01 = np.asarray(G['DNp01']); dng35 = np.asarray(G['DNg35'] if 'DNg35' in G else [])
stim = np.concatenate([G['sugar'], G['PPL1'], G['bitter']])
for (u, tr, ad) in [(0.15, 400.0, None), (0.3, 400.0, None), (0.15, 400.0, (0.3, 300.0))]:
    on, off = run([('on', stim, 120, 800), ('off', stim, 0, 800)], u, tr, ad)
    s_on, = run([('sugar', G['sugar'], 150, 1000)], u, tr, ad)
    l_on, = run([('loom', G['LPLC2'], 150, 1000)], u, tr, ad)
    print(f"STD u={u} tau={tr} adapt={ad}: sugar+PPL1 ON {int(on.sum()/0.8)} sp/s ({int((on>0).sum())} n) -> OFF {int(off.sum()/0.8)} sp/s ({int((off>0).sum())} n)"
          f" | sugar->proboscis_MN {s_on[pm].sum()/len(pm):.1f} Hz | LPLC2->DNp01 {l_on[dnp01].sum()/2:.1f} Hz", flush=True)
