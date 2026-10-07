"""Pick adaptation strength: must stop the sugar+PPL1 / ORN runaway but keep sugar -> proboscis MN strong."""
import sys, numpy as np
sys.path.insert(0, 'pipeline')
import validate_lif as V
from check_runaway import run
G = V.groups; N = V.N
pm = np.asarray(G['proboscis_MN'])
def run_counts(idx, rate, T, adapt):
    # like run() but returns per-neuron counts for the on phase
    rng = np.random.default_rng(0)
    v = np.full(N, V.v0, np.float32); g = np.zeros(N, np.float32); ref = np.zeros(N, np.float32); th = np.zeros(N, np.float32)
    ring = [np.zeros(N, np.float32) for _ in range(V.delay_steps)]; counts = np.zeros(N, np.int64); idx = np.asarray(idx); p = rate*V.dt/1000
    for s in range(int(T/V.dt)):
        sp_in = ring[s % V.delay_steps]; g += V.WT @ sp_in * V.w_syn; ring[s % V.delay_steps] = np.zeros(N, np.float32)
        kick = idx[rng.random(len(idx)) < p]; g[kick] += V.w_syn * V.P['poisson_gain']
        active = ref <= 0
        v[active] += V.dt * ((V.v0 - v[active] + g[active]) / V.tau_m); g -= V.dt * g / V.tau_s; ref -= V.dt
        fired = (v > V.vth + th) & active; v[fired] = V.v0; g[fired] = 0; ref[fired] = V.t_ref; counts[fired] += 1
        if adapt: th[fired] += adapt[0]; th *= np.exp(-V.dt / adapt[1])
        ring[(s + V.delay_steps) % V.delay_steps][fired] = 1.0
    return counts
for adapt in [(0.2, 300.0), (0.3, 300.0), (0.5, 300.0)]:
    c = run_counts(G['sugar'], 150, 1500, adapt)
    print(adapt, 'sugar->proboscis_MN Hz', round(c[pm].sum()/len(pm)/1.5, 1), '| runaway test:',
          run([('on', np.concatenate([G['sugar'], G['PPL1'], G['bitter']]), 120, 1000), ('off', G['sugar'], 0, 1000)], adapt), flush=True)
