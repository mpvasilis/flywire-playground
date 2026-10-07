"""Which neurons keep firing after the stimulus stops, and does blocking synaptic input onto
sensory afferents (axo-axonic ORN->ORN / GRN->GRN excitation) remove the self-sustaining state?"""
import sys, numpy as np, pandas as pd, scipy.sparse as sp
sys.path.insert(0, 'pipeline')
import validate_lif as V
N = V.N; G = V.groups; D = V.D; meta = V.meta
ct = np.asarray(meta['cell_types'], dtype=object)[np.fromfile(D/'type.u16', np.uint16)]
sc = np.asarray(meta['super_classes'], dtype=object)[np.fromfile(D/'superclass.u8', np.uint8)]
kl = np.asarray(meta['classes'], dtype=object)[np.fromfile(D/'klass.u8', np.uint8)]
def run(phases, WT, seed=0):
    rng = np.random.default_rng(seed)
    v = np.full(N, V.v0, np.float32); g = np.zeros(N, np.float32); ref = np.zeros(N, np.float32)
    ring = [np.zeros(N, np.float32) for _ in range(V.delay_steps)]; s = 0; res = []
    for (name, idx, rate, T) in phases:
        idx = np.asarray(idx); p = rate*V.dt/1000; counts = np.zeros(N, np.int64)
        for _ in range(int(T/V.dt)):
            sp_in = ring[s % V.delay_steps]; g += WT @ sp_in * V.w_syn; ring[s % V.delay_steps] = np.zeros(N, np.float32)
            if rate > 0:
                kick = idx[rng.random(len(idx)) < p]; g[kick] += V.w_syn * V.P['poisson_gain']
            active = ref <= 0
            v[active] += V.dt * ((V.v0 - v[active] + g[active]) / V.tau_m); g -= V.dt * g / V.tau_s; ref -= V.dt
            fired = (v > V.vth) & active; v[fired] = V.v0; g[fired] = 0; ref[fired] = V.t_ref; counts[fired] += 1
            ring[(s + V.delay_steps) % V.delay_steps][fired] = 1.0; s += 1
        res.append(counts)
    return res
stim = np.concatenate([G['sugar'], G['PPL1'], G['bitter']])
on, off = run([('on', stim, 120, 800), ('off', stim, 0, 800)], V.WT)
df = pd.DataFrame({'ct': ct, 'sc': sc, 'kl': kl, 'hz': off / 0.8})
act = df[df.hz > 0]
print('OFF phase: active', len(act), 'spikes/s', int(act.hz.sum()))
print(' by super_class:', act.groupby('sc').hz.agg(['count','sum']).sort_values('sum', ascending=False).head(6).round(0).to_dict('index'))
print(' by class:', act.groupby('kl').hz.agg(['count','sum']).sort_values('sum', ascending=False).head(8).round(0).to_dict('index'))
print(' top types:', act.groupby('ct').hz.agg(['count','mean']).sort_values('mean', ascending=False).head(12).round(0).to_dict('index'))
# --- fix candidate A: no synaptic input onto sensory afferents
W = V.W.tolil(copy=True)
sens = np.flatnonzero(sc == 'sensory')
Wc = V.W.tocsc(copy=True)
mask = np.ones(N, bool); mask[sens] = False
Wa = (V.W @ sp.diags(mask.astype(np.float32))).tocsr()     # zero columns (inputs) of sensory neurons
on2, off2 = run([('on', stim, 120, 800), ('off', stim, 0, 800)], Wa.T.tocsr())
print('A) sensory afferents input-only: ON active', int((on2>0).sum()), 'spikes/s', int(on2.sum()/0.8), '| OFF active', int((off2>0).sum()), 'spikes/s', int(off2.sum()/0.8),
      '| proboscis_MN Hz during ON', round(on2[np.asarray(G['proboscis_MN'])].sum()/24/0.8, 1))
on3, off3 = run([('on', G['ORN_DA1'], 60, 800), ('off', stim, 0, 800)], Wa.T.tocsr())
print('A) ORN_DA1: ON active', int((on3>0).sum()), 'spikes/s', int(on3.sum()/0.8), '| OFF active', int((off3>0).sum()), 'spikes/s', int(off3.sum()/0.8))
